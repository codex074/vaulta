import { describe, it, expect, vi } from 'vitest'
import { createUploadEntry, cancelUpload, isCancellable, activeUploads } from '../../src/components/uploadQueue.js'

describe('uploadQueue', () => {
  it('creates a pending entry with its own abort controller', () => {
    const entry = createUploadEntry(1, 'photo.jpg')
    expect(entry).toMatchObject({ id: 1, name: 'photo.jpg', progress: 0, status: 'pending', message: '' })
    expect(entry.controller).toBeInstanceOf(AbortController)
    expect(isCancellable(entry)).toBe(true)
  })

  it('cancelling a pending entry marks it cancelled without touching the controller', () => {
    const entry = createUploadEntry(1, 'a.bin')
    const abort = vi.spyOn(entry.controller, 'abort')
    cancelUpload(entry)
    expect(entry.status).toBe('cancelled')
    expect(entry.message).toBe('Cancelled')
    expect(abort).not.toHaveBeenCalled()
    expect(isCancellable(entry)).toBe(false)
  })

  it('cancelling an uploading entry aborts its controller so the XHR stops', () => {
    const entry = createUploadEntry(1, 'a.bin')
    entry.status = 'uploading'
    cancelUpload(entry)
    expect(entry.controller.signal.aborted).toBe(true)
    expect(entry.status).toBe('cancelled')
  })

  it('finished, failed and cancelled entries cannot be cancelled again', () => {
    for (const status of ['done', 'error', 'cancelled']) {
      const entry = createUploadEntry(1, 'a.bin')
      entry.status = status
      expect(isCancellable(entry)).toBe(false)
      cancelUpload(entry)
      expect(entry.status).toBe(status)
    }
  })

  it('activeUploads lists only pending and uploading entries', () => {
    const entries = ['pending', 'uploading', 'done', 'error', 'cancelled'].map((status, i) => {
      const entry = createUploadEntry(i, `${status}.bin`)
      entry.status = status
      return entry
    })
    expect(activeUploads(entries).map((e) => e.name)).toEqual(['pending.bin', 'uploading.bin'])
  })
})
