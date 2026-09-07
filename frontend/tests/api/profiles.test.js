import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getMyProfile,
  updateMyDisplayName,
  listProfiles,
  updateUserDisplayName,
  deleteUserProfile,
} from '../../src/api/profiles.js'

describe('profiles API', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  it('loads the current profile keyed by a stable UID', async () => {
    const profile = { uid: '2', username: 'login-handle', displayName: 'Display Name' }
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(profile) })
    await expect(getMyProfile()).resolves.toEqual(profile)
    expect(global.fetch.mock.calls[0][0]).toBe('/nasapi/profile')
  })

  it('updates only the current user display name', async () => {
    const profile = { uid: '2', username: 'login-handle', displayName: 'New Name' }
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(profile) })
    await expect(updateMyDisplayName('New Name')).resolves.toEqual(profile)
    const [url, options] = global.fetch.mock.calls[0]
    expect(url).toBe('/nasapi/profile')
    expect(options.method).toBe('PUT')
    expect(JSON.parse(options.body)).toEqual({ displayName: 'New Name' })
  })

  it('returns the UID profile map for admins', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ profiles: { 2: { displayName: 'Name' } } }) })
    await expect(listProfiles()).resolves.toEqual({ 2: { displayName: 'Name' } })
  })

  it('updates and deletes another profile by encoded UID', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ uid: '2', displayName: 'Name' }) })
      .mockResolvedValueOnce({ ok: true, status: 204 })
    await updateUserDisplayName('2', 'Name')
    await deleteUserProfile('2')
    expect(global.fetch.mock.calls[0][0]).toBe('/nasapi/profiles/2')
    expect(global.fetch.mock.calls[1][0]).toBe('/nasapi/profiles/2')
    expect(global.fetch.mock.calls[1][1].method).toBe('DELETE')
  })
})
