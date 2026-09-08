import { describe, it, expect, vi, beforeEach } from 'vitest'
import { stampOwnership, lookupOwnership, moveOwnership, deleteOwnership } from '../../src/api/ownership.js'

describe('ownership API', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  it('stamps a path with the caller identity', async () => {
    const record = { uploadedByUid: '2', uploadedByUsername: 'jay', uploadedAt: '2026-09-08T00:00:00Z' }
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(record) })
    await expect(stampOwnership('/photos/a.jpg')).resolves.toEqual(record)
    const [url, options] = global.fetch.mock.calls[0]
    expect(url).toBe('/nasapi/ownership')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toEqual({ path: '/photos/a.jpg' })
  })

  it('looks up ownership for a batch of paths', async () => {
    const records = { '/photos/a.jpg': { uploadedByUid: '2', uploadedByUsername: 'jay' } }
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ records }) })
    await expect(lookupOwnership(['/photos/a.jpg', '/photos/b.jpg'])).resolves.toEqual(records)
    const [url, options] = global.fetch.mock.calls[0]
    expect(url).toBe('/nasapi/ownership/lookup')
    expect(JSON.parse(options.body)).toEqual({ paths: ['/photos/a.jpg', '/photos/b.jpg'] })
  })

  it('returns an empty map when the lookup request fails', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 500 })
    await expect(lookupOwnership(['/photos/a.jpg'])).resolves.toEqual({})
  })

  it('moves an ownership record from one path to another', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 204 })
    await moveOwnership('/photos/a.jpg', '/.trash/1__a.jpg')
    const [url, options] = global.fetch.mock.calls[0]
    expect(url).toBe('/nasapi/ownership/move')
    expect(JSON.parse(options.body)).toEqual({ from: '/photos/a.jpg', to: '/.trash/1__a.jpg' })
  })

  it('deletes an ownership record by path', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 204 })
    await deleteOwnership('/photos/a.jpg')
    const [url, options] = global.fetch.mock.calls[0]
    expect(url).toBe('/nasapi/ownership?path=%2Fphotos%2Fa.jpg')
    expect(options.method).toBe('DELETE')
  })
})
