// Cloudflare caps a single request body at 100 MB (free plan), so anything
// bigger goes to FileBrowser Quantum in chunks on the same POST endpoint,
// using its X-File-Chunk-Offset / X-File-Total-Size protocol.
export const CHUNK_SIZE = 25 * 1024 * 1024
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

// Re-sending a chunk at the same offset is idempotent on FBQ's side (it
// seeks and overwrites), so transient failures are worth another try.
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
