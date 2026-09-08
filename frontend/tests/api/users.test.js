import { describe, it, expect, vi, beforeEach } from 'vitest'
import { listUsers, createUser, deleteUser, isValidUsername, updateUserScopes } from '../../src/api/users.js'

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

  it('createUser POSTs a which/data envelope with X-Password, share+home scopes for a non-admin', async () => {
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
      scopes: [{ name: 'share', scope: '/' }, { name: 'home', scope: '/newperson' }],
    })
  })

  it('createUser grants root home scope for an admin instead of a per-username folder', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 201 })
    await createUser('adminpass', { username: 'newadmin', password: 'newpass123', admin: true })
    const body = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(body.data.permissions.admin).toBe(true)
    expect(body.data.scopes).toEqual([{ name: 'share', scope: '/' }, { name: 'home', scope: '/' }])
  })

  it('createUser defaults admin to false when not specified', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 201 })
    await createUser('adminpass', { username: 'newperson', password: 'newpass123' })
    const body = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(body.data.permissions.admin).toBe(false)
    expect(body.data.scopes).toEqual([{ name: 'share', scope: '/' }, { name: 'home', scope: '/newperson' }])
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

  describe('isValidUsername', () => {
    it('accepts letters, digits, dot, underscore, hyphen up to 32 chars', () => {
      expect(isValidUsername('codex')).toBe(true)
      expect(isValidUsername('Codex_074-1.dev')).toBe(true)
      expect(isValidUsername('a'.repeat(32))).toBe(true)
    })

    it('rejects an empty username', () => {
      expect(isValidUsername('')).toBe(false)
    })

    it('rejects a username longer than 32 characters', () => {
      expect(isValidUsername('a'.repeat(33))).toBe(false)
    })

    it('rejects characters outside the allowed set', () => {
      expect(isValidUsername('bad name')).toBe(false)
      expect(isValidUsername('bad/name')).toBe(false)
      expect(isValidUsername('bad@name')).toBe(false)
    })

    it('rejects the literal "." and ".." even though they match the character class', () => {
      expect(isValidUsername('.')).toBe(false)
      expect(isValidUsername('..')).toBe(false)
    })
  })

  describe('updateUserScopes', () => {
    it('PUTs /api/users?id=<id> with a which:[scopes] envelope and X-Password', async () => {
      global.fetch.mockResolvedValue({ ok: true, status: 200 })
      const user = { id: 7, username: 'legacy', permissions: { admin: false } }
      const scopes = [{ name: 'share', scope: '/' }, { name: 'home', scope: '/legacy' }]
      await updateUserScopes(user, 'adminpass', scopes)
      const [url, opts] = global.fetch.mock.calls[0]
      expect(url).toBe('/api/users?id=7')
      expect(opts.method).toBe('PUT')
      expect(opts.headers['X-Password']).toBe('adminpass')
      const body = JSON.parse(opts.body)
      expect(body.which).toEqual(['scopes'])
      expect(body.data).toEqual({ ...user, scopes })
    })

    it('throws the API error message on failure', async () => {
      global.fetch.mockResolvedValue({
        ok: false, status: 400, statusText: 'Bad Request',
        clone() { return this },
        json: () => Promise.resolve({ message: 'scope folder does not exist' }),
      })
      const user = { id: 7, username: 'legacy' }
      await expect(updateUserScopes(user, 'adminpass', [])).rejects.toThrow('scope folder does not exist')
    })
  })
})
