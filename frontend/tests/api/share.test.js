import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createShare, listShares, sharesFor, deleteShare } from '../../src/api/share.js'

describe('share API', () => {
  beforeEach(() => { global.fetch = vi.fn() })

  it('createShare posts the FBQ body and returns the share', async () => {
    const share = { hash: 'h1', expire: 0, hasPassword: false }
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(share) })
    const result = await createShare('share', '/Docs', { expiry: '30d', password: 'pw' })
    const [url, init] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/share')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ source: 'share', path: '/Docs', expires: '30', unit: 'days', password: 'pw' })
    expect(result).toEqual(share)
  })

  it('listShares GETs /api/share/list', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve([{ hash: 'a' }]) })
    expect(await listShares()).toEqual([{ hash: 'a' }])
    expect(global.fetch.mock.calls[0][0]).toBe('/api/share/list')
  })

  it('sharesFor GETs by path and source, and treats 404 as no links', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve([{ hash: 'a' }]) })
    expect(await sharesFor('home', '/Photos/x y')).toEqual([{ hash: 'a' }])
    expect(global.fetch.mock.calls[0][0]).toBe('/api/share?path=%2FPhotos%2Fx+y&source=home')
    global.fetch.mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found', clone() { return this }, json: () => Promise.reject(new Error('no body')) })
    expect(await sharesFor('home', '/none')).toEqual([])
  })

  it('deleteShare DELETEs by hash and throws the server message on failure', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, status: 200 })
    await deleteShare('h1')
    expect(global.fetch.mock.calls[0][0]).toBe('/api/share?hash=h1')
    expect(global.fetch.mock.calls[0][1].method).toBe('DELETE')
    global.fetch.mockResolvedValueOnce({ ok: false, status: 403, statusText: 'Forbidden', clone() { return this }, json: () => Promise.resolve({ message: 'not yours' }) })
    await expect(deleteShare('h2')).rejects.toThrow('not yours')
  })
})
