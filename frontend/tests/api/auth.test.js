import { describe, it, expect, vi, beforeEach } from 'vitest'
import { login, logout, getCurrentUser, changePassword } from '../../src/api/auth.js'

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

  it('changePassword fetches the current user for their id, then PUTs a which/data-scoped password-only update', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ id: 2, username: 'codex', permissions: { admin: true } }) })
      .mockResolvedValueOnce({ ok: true, status: 204 })
    await changePassword('oldpass', 'newpass')
    const [url, opts] = global.fetch.mock.calls[1]
    expect(url).toBe('/api/users?id=2')
    expect(opts.method).toBe('PUT')
    expect(opts.headers['X-Password']).toBe('oldpass')
    const body = JSON.parse(opts.body)
    expect(body).toEqual({ which: ['password'], data: { password: 'newpass' } })
  })

  it('changePassword throws with status on failure (e.g. wrong current password)', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ id: 2, username: 'codex' }) })
      .mockResolvedValueOnce({ ok: false, status: 401, json: () => Promise.resolve({ message: 'wrong password' }) })
    await expect(changePassword('wrongpass', 'newpass')).rejects.toMatchObject({ status: 401 })
  })
})
