import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  listDirectory, makeDirectory, deleteItem, bulkDelete,
  moveItem, renameItem, downloadUrl, uploadFile, getFileText,
} from '../../src/api/resources.js'

describe('resources API', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  it('listDirectory calls GET with source=share and returns JSON', async () => {
    const body = { name: 'share', path: '/', source: 'share', folders: [], files: [] }
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(body) })
    const result = await listDirectory('/')
    expect(global.fetch.mock.calls[0][0]).toContain('/api/resources?path=%2F&source=share')
    expect(result).toEqual(body)
  })

  it('makeDirectory POSTs with isDir=true and does not split nested paths', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200 })
    await makeDirectory('/Photos/2026')
    expect(global.fetch).toHaveBeenCalledTimes(1)
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toContain('path=%2FPhotos%2F2026')
    expect(url).toContain('isDir=true')
    expect(opts.method).toBe('POST')
  })

  it('deleteItem calls DELETE with the item path', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200 })
    await deleteItem('/Photos/a.jpg')
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toContain('path=%2FPhotos%2Fa.jpg')
    expect(opts.method).toBe('DELETE')
  })

  it('bulkDelete posts an array of {source,path} to /api/resources/bulk', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ succeeded: [], failed: [] }) })
    await bulkDelete(['/a.jpg', '/b.jpg'])
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toContain('/api/resources/bulk')
    expect(opts.method).toBe('DELETE')
    const body = JSON.parse(opts.body)
    expect(body).toEqual([
      { source: 'share', path: '/a.jpg' },
      { source: 'share', path: '/b.jpg' },
    ])
  })

  it('moveItem PATCHes with a move action', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200 })
    await moveItem('/Photos/a.jpg', '/Archive/a.jpg')
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toContain('/api/resources')
    expect(opts.method).toBe('PATCH')
    const body = JSON.parse(opts.body)
    expect(body.action).toBe('move')
    expect(body.items[0]).toEqual({
      fromSource: 'share', fromPath: '/Photos/a.jpg', toSource: 'share', toPath: '/Archive/a.jpg',
    })
  })

  it('renameItem computes the sibling path from the parent directory', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200 })
    await renameItem('/Photos/old.jpg', 'new.jpg')
    const body = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(body.items[0].toPath).toBe('/Photos/new.jpg')
  })

  it('renameItem works for a top-level item', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200 })
    await renameItem('/old.jpg', 'new.jpg')
    const body = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(body.items[0].toPath).toBe('/new.jpg')
  })

  it('downloadUrl builds a plain GET link', () => {
    expect(downloadUrl('/Photos/a.jpg')).toBe('/api/resources/download?file=%2FPhotos%2Fa.jpg&source=share')
  })

  it('getFileText requests content=true and returns the content field', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ name: 'x.trashmeta', content: '{"originalPath":"/a.txt"}' }),
    })
    const text = await getFileText('/.trash/x.trashmeta')
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
    await expect(listDirectory('/x')).rejects.toThrow('lstat /srv/share/x.txt: no such file or directory')
  })

  it('listDirectory falls back to statusText when the body is not JSON', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      clone() { return this },
      json: () => Promise.reject(new Error('not json')),
    })
    await expect(listDirectory('/x')).rejects.toThrow('Internal Server Error')
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

    const uploadPromise = uploadFile('/test.txt', new File(['test'], 'test.txt'))
    // Simulate xhr.onload being called
    if (capturedOnload) capturedOnload()

    await expect(uploadPromise).rejects.toMatchObject({ status: 401 })
  })
})
