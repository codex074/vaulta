import { describe, it, expect, vi, beforeEach } from 'vitest'
import { listUsers, createUser, deleteUser } from '../../src/api/users.js'

describe('users API', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  it('listUsers GETs /api/users and returns the parsed array', async () => {
    const users = [{ id: 2, username: 'codex' }]
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(users) })
    const result = await listUsers()
    expect(global.fetch.mock.calls[0][0]).toBe('/api/users')
    expect(result).toEqual(users)
  })

  it('listUsers throws the API error message on failure', async () => {
    global.fetch.mockResolvedValue({
      ok: false, status: 403, statusText: 'Forbidden',
      clone() { return this },
      json: () => Promise.resolve({ message: 'not allowed' }),
    })
    await expect(listUsers()).rejects.toThrow('not allowed')
  })

  it('createUser POSTs a which/data envelope with X-Password and the new user fields', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 201 })
    await createUser('adminpass', { username: 'newperson', password: 'newpass123', admin: false })
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/users')
    expect(opts.method).toBe('POST')
    expect(opts.headers['X-Password']).toBe('adminpass')
    const body = JSON.parse(opts.body)
    expect(body.which).toEqual([])
    expect(body.data).toEqual({
      username: 'newperson',
      password: 'newpass123',
      loginMethod: 'password',
      permissions: {
        api: true, modify: true, share: true, realtime: true,
        delete: true, create: true, download: true, admin: false,
      },
      scopes: [{ name: 'share', scope: '/' }],
    })
  })

  it('createUser defaults admin to false when not specified', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 201 })
    await createUser('adminpass', { username: 'newperson', password: 'newpass123' })
    const body = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(body.data.permissions.admin).toBe(false)
  })

  it('createUser can grant admin', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 201 })
    await createUser('adminpass', { username: 'newadmin', password: 'newpass123', admin: true })
    const body = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(body.data.permissions.admin).toBe(true)
  })

  it('createUser throws the API error message on failure', async () => {
    global.fetch.mockResolvedValue({
      ok: false, status: 400, statusText: 'Bad Request',
      clone() { return this },
      json: () => Promise.resolve({ message: 'username already exists' }),
    })
    await expect(createUser('adminpass', { username: 'dup', password: 'x' })).rejects.toThrow('username already exists')
  })

  it('deleteUser DELETEs /api/users?id=<id> with X-Password', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200 })
    await deleteUser(5, 'adminpass')
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/users?id=5')
    expect(opts.method).toBe('DELETE')
    expect(opts.headers['X-Password']).toBe('adminpass')
  })

  it('deleteUser throws the API error message on failure', async () => {
    global.fetch.mockResolvedValue({
      ok: false, status: 401, statusText: 'Unauthorized',
      clone() { return this },
      json: () => Promise.resolve({ message: 'wrong password' }),
    })
    await expect(deleteUser(5, 'wrongpass')).rejects.toThrow('wrong password')
  })
})
