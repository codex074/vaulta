// Cloudflare caps a single request body at 100 MB (free plan), so anything
// bigger goes to FileBrowser Quantum in chunks on the same POST endpoint,
// using its X-File-Chunk-Offset / X-File-Total-Size protocol. Chunks are
// kept well under that cap so one chunk fits a slow home uplink inside
// Cloudflare's ~100 s origin timeout.
export const CHUNK_SIZE = 10 * 1024 * 1024
export const MAX_CHUNK_ATTEMPTS = 3

export function shouldChunk(size, chunkSize = CHUNK_SIZE) {
  return size > chunkSize
}

export function planChunks(size, chunkSize = CHUNK_SIZE) {
  const chunks = []
  for (let offset = 0; offset < size; offset += chunkSize) {
    chunks.push({ offset, end: Math.min(offset + chunkSize, size) })
  }
  return chunks
}

export function overallProgress(offset, loaded, total) {
  if (total <= 0) return 100
  return Math.min(100, Math.round(((offset + loaded) / total) * 100))
}

// A network error or 5xx during a chunk body is worth another try — but not
// at the same offset: FBQ deletes the temp file when a chunk body fails
// mid-stream (see resources.js), so the caller restarts the whole upload
// from offset 0 rather than resuming here. This just decides whether the
// error is transient enough to retry at all.
export function isRetryable(err, attempt, max = MAX_CHUNK_ATTEMPTS) {
  if (attempt >= max) return false
  if (err?.name === 'AbortError') return false
  if (err?.status === undefined) return true
  return err.status >= 500
}

// FBQ writes chunks to "<target>.<md5 of real path>.uploading.tmp" beside
// the target and renames it into place on the last chunk.
export const PARTIAL_UPLOAD_PATTERN = /^(.+)\.[0-9a-f]{32}\.uploading\.tmp$/

export function isPartialUpload(name) {
  return PARTIAL_UPLOAD_PATTERN.test(name)
}

export function partialUploadsFor(name, entries) {
  return entries.filter((entry) => {
    const match = PARTIAL_UPLOAD_PATTERN.exec(entry.name)
    return match !== null && match[1] === name
  })
}
