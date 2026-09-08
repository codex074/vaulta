import { authorizedFetch, apiError, notifyUnauthorized } from './http.js'
import { moveOwnership } from './ownership.js'

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

export function uploadFile(source, path, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', resourcesUrl(source, path, { override: 'false' }), true)
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    xhr.withCredentials = true
    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100))
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
      } else {
        if (xhr.status === 401) notifyUnauthorized()
        let message = 'Upload failed'
        try {
          const body = JSON.parse(xhr.responseText)
          if (body && body.message) message = body.message
        } catch {
          // non-JSON response body, keep the fallback message
        }
        reject(Object.assign(new Error(message), { status: xhr.status }))
      }
    }
    xhr.onerror = () => reject(new Error('Network error during upload'))
    xhr.send(file)
  })
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
