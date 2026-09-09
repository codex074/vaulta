import { describe, it, expect, vi, beforeEach } from 'vitest'
import { authorizedFetch, onUnauthorized, onRenewRequested } from '../../src/api/http.js'

describe('authorizedFetch', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  it('passes through successful responses unchanged', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200 })
    const response = await authorizedFetch('/api/resources')
    expect(response.status).toBe(200)
  })

  it('invokes registered callbacks on a 401 without throwing an extra error', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 401 })
    const callback = vi.fn()
    onUnauthorized(callback)
    const response = await authorizedFetch('/api/resources')
    expect(callback).toHaveBeenCalled()
    expect(response.status).toBe(401)
  })

  it('notifies renew listeners when FBQ flags the token for renewal', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, headers: { get: (name) => (name === 'X-Renew-Token' ? 'true' : null) } })
    const callback = vi.fn()
    const off = onRenewRequested(callback)
    await authorizedFetch('/api/resources')
    expect(callback).toHaveBeenCalledTimes(1)
    off()
    await authorizedFetch('/api/resources')
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('does not notify renew listeners without the header or without headers at all', async () => {
    const callback = vi.fn()
    onRenewRequested(callback)
    global.fetch.mockResolvedValue({ ok: true, status: 200, headers: { get: () => null } })
    await authorizedFetch('/api/resources')
    global.fetch.mockResolvedValue({ ok: true, status: 200 })
    await authorizedFetch('/api/resources')
    expect(callback).not.toHaveBeenCalled()
  })
})
