import { authorizedFetch, apiError, notifyUnauthorized } from './http.js'
import { moveOwnership } from './ownership.js'
import { CHUNK_SIZE, shouldChunk, planChunks, overallProgress, isRetryable, partialUploadsFor } from '../components/chunkPlan.js'

export const SOURCES = ['home', 'share']

function resourcesUrl(source, path, extraParams = {}) {
  const params = new URLSearchParams({ path, source, ...extraParams })
  return `/api/resources?${params.toString()}`
}

export async function listDirectory(source, path) {
  const response = await authorizedFetch(resourcesUrl(source, path))
  if (!response.ok) throw await apiError(response)
  return response.json()
}

export async function makeDirectory(source, path) {
  const response = await authorizedFetch(resourcesUrl(source, path, { override: 'false', isDir: 'true' }), {
    method: 'POST',
  })
  if (!response.ok) throw await apiError(response)
}

function abortError() {
  const err = new Error('Upload cancelled')
  err.name = 'AbortError'
  return err
}

// One XHR. `onProgress(loaded, total)` reports raw bytes; callers map it to
// whatever scale they need. Rejects with AbortError on abort, with an Error
// carrying `.status` on a non-2xx response, and with a plain Error on a
// network failure (no status — the retry helper treats that as transient).
function sendUpload({ url, body, contentType, headers = {}, onProgress, signal }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }
    const xhr = new XMLHttpRequest()
    let settled = false
    const finish = (fn) => (value) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      fn(value)
    }
    const onAbort = () => {
      xhr.abort()
      finish(reject)(abortError())
    }
    signal?.addEventListener('abort', onAbort)
    xhr.onabort = () => finish(reject)(abortError())
    xhr.open('POST', url, true)
    xhr.setRequestHeader('Content-Type', contentType)
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value)
    xhr.withCredentials = true
    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(event.loaded, event.total)
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        finish(resolve)()
      } else {
        if (xhr.status === 401) notifyUnauthorized()
        let message = 'Upload failed'
        try {
          const body = JSON.parse(xhr.responseText)
          if (body && body.message) message = body.message
        } catch {
          // non-JSON response body, keep the fallback message
        }
        finish(reject)(Object.assign(new Error(message), { status: xhr.status }))
      }
    }
    xhr.onerror = () => finish(reject)(new Error('Network error during upload'))
    xhr.send(body)
  })
}

// `signal` (an AbortSignal) lets the caller cancel an in-flight upload: the
// XHR is aborted and the promise rejects with an AbortError, so callers can
// tell a deliberate cancel apart from a failure. Files above CHUNK_SIZE go up
// in pieces on the same endpoint using FBQ's chunk protocol (see
// chunkPlan.js) — Cloudflare rejects single request bodies over 100 MB
// before they ever reach the NAS. FileBrowser writes uploads as a stream, so
// a cancelled upload can leave a partial file (or chunk temp file) behind —
// it is the caller's job to delete it (see App.vue's cancel handling, and
// removePartialUploads below).
// Best-effort: does an entry already sitting at `fullPath` match `size`?
// Used only to tell a genuine conflict apart from "the previous whole-upload
// attempt actually finished before we saw its response" (see the 409
// handling in uploadFile below). Any listing failure just means "no", never
// throws — the caller falls back to surfacing the original 409.
async function targetAlreadyUploaded(source, fullPath, size) {
  try {
    const slash = fullPath.lastIndexOf('/')
    const dir = slash <= 0 ? '/' : fullPath.slice(0, slash)
    const name = fullPath.slice(slash + 1)
    const listing = await listDirectory(source, dir)
    return (listing.files || []).some((entry) => entry.name === name && entry.size === size)
  } catch {
    return false
  }
}

export async function uploadFile(source, path, file, onProgress, { signal, chunkSize = CHUNK_SIZE } = {}) {
  const url = resourcesUrl(source, path, { override: 'false' })
  if (!shouldChunk(file.size, chunkSize)) {
    return sendUpload({
      url,
      body: file,
      contentType: file.type || 'application/octet-stream',
      onProgress: onProgress ? (loaded, total) => onProgress(Math.round((loaded / total) * 100)) : null,
      signal,
    })
  }
  // FBQ truncates its chunk temp file to the chunk's start offset AND
  // deletes it (`os.Remove(tempFilePath)`, upstream backend/http/resource.go
  // resourcePostHandler) whenever a chunk body fails mid-stream. Re-sending
  // the failed chunk at the same offset is therefore never safe: FBQ
  // reopens the temp with O_CREATE, seeks to that offset, and everything
  // before it becomes a zero-filled hole, so the final rename ships a
  // correctly-sized but corrupt file. The only safe recovery is to restart
  // the whole upload from offset 0 — MAX_CHUNK_ATTEMPTS bounds how many
  // whole-upload attempts that is worth.
  for (let attempt = 1; ; attempt++) {
    try {
      for (const { offset, end } of planChunks(file.size, chunkSize)) {
        try {
          await sendUpload({
            url,
            body: file.slice(offset, end),
            contentType: 'application/octet-stream',
            headers: { 'X-File-Chunk-Offset': String(offset), 'X-File-Total-Size': String(file.size) },
            onProgress: onProgress ? (loaded) => onProgress(overallProgress(offset, loaded, file.size)) : null,
            signal,
          })
        } catch (err) {
          // A restart's chunk 0 runs FBQ's conflict check again. A 409
          // there can mean the previous whole-upload attempt actually
          // finished (its response was lost, e.g. to the same network
          // failure that triggered this restart) and the target now
          // exists — check before treating it as a real conflict. Only
          // chunk 0 performs the conflict check, and only a restart
          // (attempt > 1) can legitimately hit "our own" completed upload —
          // a first-attempt 409 is always a genuine pre-existing file.
          if (err?.status === 409 && attempt > 1 && offset === 0 && (await targetAlreadyUploaded(source, path, file.size))) {
            return
          }
          throw err
        }
      }
      return
    } catch (err) {
      if (!isRetryable(err, attempt)) throw err
    }
  }
}

// A cancelled chunked upload can leave FBQ's "<name>.<md5>.uploading.tmp"
// beside the target. Best-effort removal; nothing here may throw.
export async function removePartialUploads(source, fullPath) {
  try {
    const slash = fullPath.lastIndexOf('/')
    const dir = slash <= 0 ? '/' : fullPath.slice(0, slash)
    const name = fullPath.slice(slash + 1)
    const listing = await listDirectory(source, dir)
    const base = dir.endsWith('/') ? dir : `${dir}/`
    for (const partial of partialUploadsFor(name, listing.files || [])) {
      try {
        await deleteItem(source, `${base}${partial.name}`)
      } catch {
        // leave it; the user can remove it from the listing
      }
    }
  } catch {
    // listing failed — nothing we can do, and the upload error already shows
  }
}

export async function deleteItem(source, path) {
  const response = await authorizedFetch(resourcesUrl(source, path), { method: 'DELETE' })
  if (!response.ok) throw await apiError(response)
}

export async function transferItem({ fromSource, fromPath, toSource, toPath }, action = 'move') {
  const response = await authorizedFetch('/api/resources', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: [{ fromSource, fromPath, toSource, toPath }],
      action,
      overwrite: false,
      rename: false,
    }),
  })
  if (!response.ok) throw await apiError(response)
  // A copy leaves the source in place with its own owner, so only a real
  // move carries the ownership record forward. Ownership tracking stays
  // share-only (see design spec's Non-Goals), so this only fires when both
  // sides of the move are the share drive. Best-effort: this is UI
  // metadata, not a security control.
  if (action === 'move' && fromSource === 'share' && toSource === 'share') {
    try {
      await moveOwnership(fromPath, toPath)
    } catch {
      // ignore
    }
  }
}

export async function moveItem(source, fromPath, toPath) {
  return transferItem({ fromSource: source, fromPath, toSource: source, toPath }, 'move')
}

export async function copyItem(source, fromPath, toPath) {
  return transferItem({ fromSource: source, fromPath, toSource: source, toPath }, 'copy')
}

export async function renameItem(source, path, newName) {
  const lastSlash = path.lastIndexOf('/')
  const parent = lastSlash <= 0 ? '' : path.slice(0, lastSlash)
  const toPath = `${parent}/${newName}`
  return moveItem(source, path, toPath)
}

export function downloadUrl(source, path, { inline = false } = {}) {
  const params = new URLSearchParams({ file: path, source })
  if (inline) params.set('inline', 'true')
  return `/api/resources/download?${params.toString()}`
}

export function previewUrl(source, path, size = 'small') {
  const params = new URLSearchParams({ path, source, size })
  return `/api/resources/preview?${params.toString()}`
}

export async function getFileText(source, path) {
  const response = await authorizedFetch(resourcesUrl(source, path, { content: 'true' }))
  if (!response.ok) throw await apiError(response)
  const data = await response.json()
  return data.content
}
