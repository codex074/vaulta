import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getShareInfo, listPublic, publicDownloadUrl, publicPreviewUrl, fetchPublicBlobUrl, fetchPublicText,
} from '../../src/api/publicShare.js'

describe('public share API', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
    global.URL.createObjectURL = vi.fn(() => 'blob:fake')
  })

  it('getShareInfo GETs share/info without credentials', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ hasPassword: true }) })
    expect(await getShareInfo('h1')).toEqual({ hasPassword: true })
    const [url, init] = global.fetch.mock.calls[0]
    expect(url).toBe('/public/api/share/info?hash=h1')
    expect(init.credentials).toBe('omit')
  })

  it('listPublic sends the password header only when set', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ files: [] }) })
    await listPublic('h1', '/Sub dir', 'secret')
    let [url, init] = global.fetch.mock.calls[0]
    expect(url).toBe('/public/api/resources?hash=h1&path=%2FSub+dir')
    expect(init.headers['X-SHARE-PASSWORD']).toBe('secret')
    await listPublic('h1', '/')
    ;[url, init] = global.fetch.mock.calls[1]
    expect(init.headers).toEqual({})
  })

  it('listPublic surfaces the status on failure', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized', clone() { return this }, json: () => Promise.reject(new Error('x')) })
    await expect(listPublic('h1', '/', 'wrong')).rejects.toMatchObject({ status: 401 })
  })

  it('builds download and preview URLs', () => {
    expect(publicDownloadUrl('h1', '/a b.jpg')).toBe('/public/api/resources/download?hash=h1&file=%2Fa+b.jpg')
    expect(publicDownloadUrl('h1', '/a.pdf', { inline: true })).toBe('/public/api/resources/download?hash=h1&file=%2Fa.pdf&inline=true')
    expect(publicPreviewUrl('h1', '/a.jpg')).toBe('/public/api/resources/preview?hash=h1&path=%2Fa.jpg&size=small')
  })

  it('fetchPublicBlobUrl fetches with the header and returns an object URL', async () => {
    const blob = new Blob(['x'])
    global.fetch.mockResolvedValue({ ok: true, status: 200, blob: () => Promise.resolve(blob) })
    expect(await fetchPublicBlobUrl('h1', '/a.jpg', 'pw')).toBe('blob:fake')
    expect(global.fetch.mock.calls[0][0]).toBe('/public/api/resources/download?hash=h1&file=%2Fa.jpg&inline=true')
    expect(global.fetch.mock.calls[0][1].headers['X-SHARE-PASSWORD']).toBe('pw')
    expect(global.URL.createObjectURL).toHaveBeenCalledWith(blob)
  })

  it('fetchPublicText returns the content field', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ content: 'hello' }) })
    expect(await fetchPublicText('h1', '/n.txt', '')).toBe('hello')
    expect(global.fetch.mock.calls[0][0]).toBe('/public/api/resources?hash=h1&path=%2Fn.txt&content=true')
  })
})
