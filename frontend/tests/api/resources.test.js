import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  listDirectory, makeDirectory, deleteItem,
  transferItem, moveItem, copyItem, renameItem, downloadUrl, previewUrl, uploadFile, getFileText,
  removePartialUploads,
  SOURCES,
} from '../../src/api/resources.js'
import * as ownership from '../../src/api/ownership.js'

vi.mock('../../src/api/ownership.js', () => ({
  moveOwnership: vi.fn(),
}))

describe('resources API', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
    vi.clearAllMocks()
  })

  it('exports the known sources', () => {
    expect(SOURCES).toEqual(['home', 'share'])
  })

  it('listDirectory calls GET with the given source and returns JSON', async () => {
    const body = { name: 'share', path: '/', source: 'share', folders: [], files: [] }
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(body) })
    const result = await listDirectory('share', '/')
    expect(global.fetch.mock.calls[0][0]).toContain('/api/resources?path=%2F&source=share')
    expect(result).toEqual(body)
  })

  it('listDirectory works against the home source', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}) })
    await listDirectory('home', '/Documents')
    expect(global.fetch.mock.calls[0][0]).toBe('/api/resources?path=%2FDocuments&source=home')
  })

  it('makeDirectory POSTs with isDir=true and does not split nested paths', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200 })
    await makeDirectory('share', '/Photos/2026')
    expect(global.fetch).toHaveBeenCalledTimes(1)
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toContain('source=share')
    expect(url).toContain('path=%2FPhotos%2F2026')
    expect(url).toContain('isDir=true')
    expect(opts.method).toBe('POST')
  })

  it('makeDirectory works against the home source', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200 })
    await makeDirectory('home', '/Docs')
    const [url] = global.fetch.mock.calls[0]
    expect(url).toContain('source=home')
  })

  it('deleteItem calls DELETE with the given source and item path', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200 })
    await deleteItem('share', '/Photos/a.jpg')
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toContain('source=share')
    expect(url).toContain('path=%2FPhotos%2Fa.jpg')
    expect(opts.method).toBe('DELETE')
  })

  it('transferItem PATCHes items with the given from/to sources and paths', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200 })
    await transferItem({ fromSource: 'share', fromPath: '/a.jpg', toSource: 'home', toPath: '/a.jpg' }, 'copy')
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/resources')
    expect(opts.method).toBe('PATCH')
    const body = JSON.parse(opts.body)
    expect(body.action).toBe('copy')
    expect(body.items[0]).toEqual({
      fromSource: 'share', fromPath: '/a.jpg', toSource: 'home', toPath: '/a.jpg',
    })
  })

  it('transferItem defaults to a move action', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200 })
    await transferItem({ fromSource: 'share', fromPath: '/a.jpg', toSource: 'share', toPath: '/b.jpg' })
    const body = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(body.action).toBe('move')
  })

  it('moveItem PATCHes with a move action, same source on both sides', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200 })
    await moveItem('share', '/Photos/a.jpg', '/Archive/a.jpg')
    const [, opts] = global.fetch.mock.calls[0]
    const body = JSON.parse(opts.body)
    expect(body.action).toBe('move')
    expect(body.items[0]).toEqual({
      fromSource: 'share', fromPath: '/Photos/a.jpg', toSource: 'share', toPath: '/Archive/a.jpg',
    })
  })

  it('moveItem carries the ownership record forward for a share-to-share move', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200 })
    await moveItem('share', '/Photos/a.jpg', '/Archive/a.jpg')
    expect(ownership.moveOwnership).toHaveBeenCalledWith('/Photos/a.jpg', '/Archive/a.jpg')
  })

  it('moveItem does not touch ownership for a home-to-home move', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200 })
    await moveItem('home', '/a.jpg', '/b.jpg')
    expect(ownership.moveOwnership).not.toHaveBeenCalled()
  })

  it('moveItem does not carry ownership forward for a copy (the source still exists)', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200 })
    await copyItem('share', '/Photos/a.jpg', '/Archive/a.jpg')
    expect(ownership.moveOwnership).not.toHaveBeenCalled()
  })

  it('moveItem still succeeds when carrying ownership forward fails', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200 })
    ownership.moveOwnership.mockRejectedValue(new Error('nasapi down'))
    await expect(moveItem('share', '/a.jpg', '/b.jpg')).resolves.toBeUndefined()
  })

  it('renameItem computes the sibling path from the parent directory', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200 })
    await renameItem('share', '/Photos/old.jpg', 'new.jpg')
    const body = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(body.items[0].toPath).toBe('/Photos/new.jpg')
  })

  it('renameItem works for a top-level item on the home source', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200 })
    await renameItem('home', '/old.jpg', 'new.jpg')
    const body = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(body.items[0]).toEqual({ fromSource: 'home', fromPath: '/old.jpg', toSource: 'home', toPath: '/new.jpg' })
  })

  it('downloadUrl builds a plain GET link for the given source', () => {
    expect(downloadUrl('share', '/Photos/a.jpg')).toBe('/api/resources/download?file=%2FPhotos%2Fa.jpg&source=share')
    expect(downloadUrl('home', '/Photos/a.jpg')).toBe('/api/resources/download?file=%2FPhotos%2Fa.jpg&source=home')
  })

  it('downloadUrl accepts an inline option for browser-native preview', () => {
    expect(downloadUrl('share', '/Photos/a.jpg', { inline: true })).toBe(
      '/api/resources/download?file=%2FPhotos%2Fa.jpg&source=share&inline=true'
    )
  })

  it('downloadUrl omits inline entirely when not requested', () => {
    expect(downloadUrl('share', '/Photos/a.jpg', {})).toBe('/api/resources/download?file=%2FPhotos%2Fa.jpg&source=share')
  })

  it('previewUrl defaults to small size', () => {
    expect(previewUrl('share', '/Photos/a.jpg')).toBe('/api/resources/preview?path=%2FPhotos%2Fa.jpg&source=share&size=small')
  })

  it('previewUrl accepts an explicit size and source', () => {
    expect(previewUrl('home', '/Photos/a.jpg', 'large')).toBe('/api/resources/preview?path=%2FPhotos%2Fa.jpg&source=home&size=large')
  })

  it('getFileText requests content=true for the given source and returns the content field', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ name: 'x.trashmeta', content: '{"originalPath":"/a.txt"}' }),
    })
    const text = await getFileText('share', '/.trash/x.trashmeta')
    expect(global.fetch.mock.calls[0][0]).toContain('source=share')
    expect(global.fetch.mock.calls[0][0]).toContain('path=%2F.trash%2Fx.trashmeta')
    expect(global.fetch.mock.calls[0][0]).toContain('content=true')
    expect(text).toBe('{"originalPath":"/a.txt"}')
  })

  it('listDirectory throws the message from the JSON error body', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      clone() { return this },
      json: () => Promise.resolve({ status: 404, message: 'lstat /srv/share/x.txt: no such file or directory' }),
    })
    await expect(listDirectory('share', '/x')).rejects.toThrow('lstat /srv/share/x.txt: no such file or directory')
  })

  it('listDirectory falls back to statusText when the body is not JSON', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      clone() { return this },
      json: () => Promise.reject(new Error('not json')),
    })
    await expect(listDirectory('share', '/x')).rejects.toThrow('Internal Server Error')
  })

  it('uploadFile rejects with status 401 on unauthorized', async () => {
    let capturedOnload
    const mockXhr = {
      open: vi.fn(),
      setRequestHeader: vi.fn(),
      send: vi.fn(),
      upload: {},
      status: 401,
      responseText: '{"message":"Unauthorized"}',
    }
    const MockXhr = class {
      constructor() {
        return mockXhr
      }
    }
    Object.defineProperty(mockXhr, 'onload', {
      set: (fn) => { capturedOnload = fn },
    })

    vi.stubGlobal('XMLHttpRequest', MockXhr)

    const uploadPromise = uploadFile('share', '/test.txt', new File(['test'], 'test.txt'))
    // Simulate xhr.onload being called
    if (capturedOnload) capturedOnload()

    await expect(uploadPromise).rejects.toMatchObject({ status: 401 })
  })

  it('uploadFile targets the home source in its request URL', async () => {
    let openedUrl
    const mockXhr = {
      open: (method, url) => { openedUrl = url },
      setRequestHeader: vi.fn(),
      send: vi.fn(),
      upload: {},
      status: 200,
    }
    const MockXhr = class {
      constructor() {
        return mockXhr
      }
    }
    Object.defineProperty(mockXhr, 'onload', { set: () => {} })
    vi.stubGlobal('XMLHttpRequest', MockXhr)
    uploadFile('home', '/test.txt', new File(['test'], 'test.txt'))
    expect(openedUrl).toContain('source=home')
  })

  it('uploadFile aborts the XHR and rejects with AbortError when its signal fires', async () => {
    const mockXhr = { open: vi.fn(), setRequestHeader: vi.fn(), send: vi.fn(), abort: vi.fn(), upload: {}, status: 0 }
    vi.stubGlobal('XMLHttpRequest', class { constructor() { return mockXhr } })
    const controller = new AbortController()
    const promise = uploadFile('home', '/big.bin', new File(['x'], 'big.bin'), null, { signal: controller.signal })
    expect(mockXhr.send).toHaveBeenCalled()
    controller.abort()
    expect(mockXhr.abort).toHaveBeenCalled()
    // The browser fires onabort after xhr.abort(); simulate it.
    if (mockXhr.onabort) mockXhr.onabort()
    await expect(promise).rejects.toMatchObject({ name: 'AbortError', message: 'Upload cancelled' })
  })

  it('uploadFile never sends when the signal is already aborted', async () => {
    const mockXhr = { open: vi.fn(), setRequestHeader: vi.fn(), send: vi.fn(), abort: vi.fn(), upload: {}, status: 0 }
    vi.stubGlobal('XMLHttpRequest', class { constructor() { return mockXhr } })
    const controller = new AbortController()
    controller.abort()
    await expect(uploadFile('home', '/big.bin', new File(['x'], 'big.bin'), null, { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' })
    expect(mockXhr.send).not.toHaveBeenCalled()
  })

  // A scripted XHR double: each constructed instance records what was sent
  // and lets the test drive onload/onerror. `responses` is consumed in
  // order. A response may carry `afterLoad`, run synchronously right after
  // `onload` fires in the same microtask — e.g. to abort the controller the
  // instant a chunk finishes, before the next chunk's `send` is called.
  function scriptedXhr(responses) {
    const instances = []
    vi.stubGlobal('XMLHttpRequest', class {
      constructor() {
        const inst = {
          headers: {}, upload: {}, status: 0, responseText: '',
          open: (method, url) => { inst.method = method; inst.url = url },
          setRequestHeader: (k, v) => { inst.headers[k] = v },
          abort: () => { inst.aborted = true; inst.onabort?.() },
          send: (body) => {
            inst.body = body
            instances.push(inst)
            const next = responses.shift() ?? { status: 200 }
            queueMicrotask(() => {
              if (next.progress && inst.upload.onprogress) {
                inst.upload.onprogress({ lengthComputable: true, loaded: next.progress.loaded, total: next.progress.total })
              }
              if (next.networkError) { inst.onerror?.(); return }
              inst.status = next.status
              inst.responseText = next.body ?? ''
              inst.onload?.()
              next.afterLoad?.()
            })
          },
        }
        return inst
      }
    })
    return instances
  }

  it('uploads a large file in chunks with FBQ chunk headers and aggregate progress', async () => {
    const instances = scriptedXhr([
      { status: 200, progress: { loaded: 4, total: 4 } },
      { status: 200, progress: { loaded: 4, total: 4 } },
      { status: 200, progress: { loaded: 2, total: 2 } },
    ])
    const progress = []
    const file = new File(['0123456789'], 'big.bin')
    await uploadFile('home', '/big.bin', file, (pct) => progress.push(pct), { chunkSize: 4 })
    expect(instances).toHaveLength(3)
    expect(instances.map((i) => i.headers['X-File-Chunk-Offset'])).toEqual(['0', '4', '8'])
    expect(instances.every((i) => i.headers['X-File-Total-Size'] === '10')).toBe(true)
    expect(instances.every((i) => i.headers['Content-Type'] === 'application/octet-stream')).toBe(true)
    expect(instances.every((i) => i.url.includes('override=false') && i.url.includes('source=home'))).toBe(true)
    expect(instances.map((i) => i.body.size)).toEqual([4, 4, 2])
    expect(progress).toEqual([40, 80, 100])
  })

  it('keeps a small file on the single-request path', async () => {
    const instances = scriptedXhr([{ status: 200 }])
    await uploadFile('share', '/small.bin', new File(['abc'], 'small.bin'), null, { chunkSize: 4 })
    expect(instances).toHaveLength(1)
    expect(instances[0].headers['X-File-Chunk-Offset']).toBeUndefined()
    expect(instances[0].body).toBeInstanceOf(File)
  })

  it('retries a chunk after a 5xx or network error by restarting the whole upload at offset 0', async () => {
    // FBQ deletes the chunk temp file when a chunk body fails mid-stream, so
    // resuming at the same offset would resend a hole-filled file. A failure
    // on chunk 2 (offset 4) must restart the whole upload from offset 0.
    const instances = scriptedXhr([
      { status: 200 },
      { networkError: true },
      { status: 200 },
      { status: 200 },
      { status: 200 },
    ])
    await uploadFile('home', '/big.bin', new File(['0123456789'], 'big.bin'), null, { chunkSize: 4 })
    expect(instances.map((i) => i.headers['X-File-Chunk-Offset'])).toEqual(['0', '4', '0', '4', '8'])
  })

  it('resends the same slice sizes on a restarted attempt', async () => {
    const instances = scriptedXhr([
      { status: 200 },
      { networkError: true },
      { status: 200 },
      { status: 200 },
      { status: 200 },
    ])
    await uploadFile('home', '/big.bin', new File(['0123456789'], 'big.bin'), null, { chunkSize: 4 })
    expect(instances.map((i) => i.body.size)).toEqual([4, 4, 4, 4, 2])
  })

  it('gives up after three whole-upload attempts, each restarting at chunk 0', async () => {
    const instances = scriptedXhr([{ networkError: true }, { networkError: true }, { networkError: true }])
    await expect(uploadFile('home', '/big.bin', new File(['0123456789'], 'big.bin'), null, { chunkSize: 4 }))
      .rejects.toThrow('Network error during upload')
    expect(instances).toHaveLength(3)
    expect(instances.every((i) => i.headers['X-File-Chunk-Offset'] === '0')).toBe(true)
  })

  it('does not retry a 4xx and surfaces its message and status', async () => {
    const instances = scriptedXhr([{ status: 409, body: '{"message":"already exists"}' }, { status: 200 }])
    await expect(uploadFile('home', '/big.bin', new File(['0123456789'], 'big.bin'), null, { chunkSize: 4 }))
      .rejects.toMatchObject({ status: 409, message: 'already exists' })
    expect(instances).toHaveLength(1)
    // First-attempt 409 must never trigger the "did the previous attempt
    // already finish?" listing check — that only applies to a restart.
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('treats a 409 on a restarted chunk 0 as success when the target already matches', async () => {
    global.fetch.mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ files: [{ name: 'big.bin', size: 10 }] }),
    })
    const instances = scriptedXhr([{ status: 200 }, { status: 200 }, { networkError: true }, { status: 409, body: '{"message":"already exists"}' }])
    await expect(uploadFile('home', '/big.bin', new File(['0123456789'], 'big.bin'), null, { chunkSize: 4 })).resolves.toBeUndefined()
    expect(instances).toHaveLength(4)
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('rethrows a 409 on a restarted chunk 0 when the listed target size does not match', async () => {
    global.fetch.mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ files: [{ name: 'big.bin', size: 7 }] }),
    })
    scriptedXhr([{ status: 200 }, { status: 200 }, { networkError: true }, { status: 409, body: '{"message":"already exists"}' }])
    await expect(uploadFile('home', '/big.bin', new File(['0123456789'], 'big.bin'), null, { chunkSize: 4 }))
      .rejects.toMatchObject({ status: 409, message: 'already exists' })
  })

  it('aborts an in-flight chunk and rejects with AbortError', async () => {
    const controller = new AbortController()
    const instances = scriptedXhr([{ status: 200 }])
    const promise = uploadFile('home', '/big.bin', new File(['0123456789'], 'big.bin'), null, { chunkSize: 4, signal: controller.signal })
    // Abort synchronously, before the scripted XHR's queued microtask fires,
    // so the first chunk is still in flight. A macrotask wait (setTimeout)
    // here would let the whole microtask chain — all three chunks — run to
    // completion first, since nothing yields to the macrotask queue between
    // chunks; by then there would be nothing left to abort.
    controller.abort()
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(instances.length).toBeLessThanOrEqual(2)
    expect(instances[0].aborted).toBe(true)
  })

  it('does not start the next chunk once the signal is aborted', async () => {
    const controller = new AbortController()
    const instances = scriptedXhr([
      { status: 200, afterLoad: () => controller.abort() },
      { status: 200 },
      { status: 200 },
    ])
    const promise = uploadFile('home', '/big.bin', new File(['0123456789'], 'big.bin'), null, { chunkSize: 4, signal: controller.signal })
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(instances).toHaveLength(1)
    expect(instances[0].headers['X-File-Chunk-Offset']).toBe('0')
  })

  it('removePartialUploads deletes only the temp files belonging to the cancelled name', async () => {
    const md5 = 'b'.repeat(32)
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ files: [
        { name: `movie.mp4.${md5}.uploading.tmp` }, { name: `other.mp4.${md5}.uploading.tmp` }, { name: 'movie.mp4' },
      ] }) })
      .mockResolvedValueOnce({ ok: true, status: 200 })
    await removePartialUploads('home', '/Videos/movie.mp4')
    expect(global.fetch.mock.calls[0][0]).toContain('/api/resources?path=%2FVideos&source=home')
    expect(global.fetch.mock.calls[1][0]).toContain(`path=%2FVideos%2Fmovie.mp4.${md5}.uploading.tmp`)
    expect(global.fetch.mock.calls[1][1].method).toBe('DELETE')
    expect(global.fetch.mock.calls).toHaveLength(2)
  })

  it('removePartialUploads never throws', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('down'))
    await expect(removePartialUploads('home', '/x.bin')).resolves.toBeUndefined()
  })
})
