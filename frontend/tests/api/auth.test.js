import { describe, it, expect, vi, beforeEach } from 'vitest'
import { login, logout, getCurrentUser } from '../../src/api/auth.js'

describe('auth API', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  it('login sends X-Password header and username as a query param', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve('token') })
    await login('codex', 'hunter2')
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toContain('/api/auth/login')
    expect(url).toContain('username=codex')
    expect(opts.headers['X-Password']).toBe('hunter2')
    expect(opts.credentials).toBe('same-origin')
  })

  it('login throws with status on failure', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 401, text: () => Promise.resolve('bad creds') })
    await expect(login('codex', 'wrong')).rejects.toMatchObject({ status: 401 })
  })

  it('getCurrentUser returns parsed JSON on success', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ username: 'codex' }) })
    const user = await getCurrentUser()
    expect(user.username).toBe('codex')
  })

  it('getCurrentUser throws with status 401 when not logged in', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 401, json: () => Promise.resolve({}) })
    await expect(getCurrentUser()).rejects.toMatchObject({ status: 401 })
  })

  it('logout calls POST /api/auth/logout', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200 })
    await logout()
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toContain('/api/auth/logout')
    expect(opts.method).toBe('POST')
  })
})
