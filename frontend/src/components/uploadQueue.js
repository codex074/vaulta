// Pure state helpers for the upload tray. An entry moves
// pending → uploading → done | error | cancelled. Uploads run one at a time
// (see App.vue), so cancelling a pending entry simply skips it, while
// cancelling the one in flight aborts its XHR through the entry's own
// AbortController.

export function createUploadEntry(id, name) {
  return { id, name, progress: 0, status: 'pending', message: '', controller: new AbortController() }
}

export function isCancellable(entry) {
  return entry.status === 'pending' || entry.status === 'uploading'
}

export function cancelUpload(entry) {
  if (!isCancellable(entry)) return
  if (entry.status === 'uploading') entry.controller.abort()
  entry.status = 'cancelled'
  entry.message = 'Cancelled'
}

export function activeUploads(entries) {
  return entries.filter(isCancellable)
}
