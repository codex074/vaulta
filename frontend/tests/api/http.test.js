import { describe, it, expect, vi, beforeEach } from 'vitest'
import { authorizedFetch, onUnauthorized } from '../../src/api/http.js'

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
})
