import { describe, it, expect, vi, beforeEach } from 'vitest'
import { togglePinned } from '../../src/api/pinned.js'

describe('pinned API', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  it('PATCHes /api/users/pinnedItems with action=add by default', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 204 })
    await togglePinned({ name: 'Photos', path: '/', source: 'share' })
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/users/pinnedItems?action=add')
    expect(opts.method).toBe('PATCH')
    expect(JSON.parse(opts.body)).toEqual({ name: 'Photos', path: '/', source: 'share' })
  })

  it('uses action=remove when passed explicitly', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 204 })
    await togglePinned({ name: 'Photos', path: '/', source: 'share' }, 'remove')
    const [url] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/users/pinnedItems?action=remove')
  })

  it('throws the API error message on failure', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      clone() { return this },
      json: () => Promise.resolve({ message: 'not allowed' }),
    })
    await expect(togglePinned({ name: 'a', path: '/', source: 'share' })).rejects.toThrow('not allowed')
  })
})
