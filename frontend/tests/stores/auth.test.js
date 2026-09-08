// frontend/tests/stores/auth.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '../../src/stores/auth.js'
import * as authApi from '../../src/api/auth.js'
import * as profilesApi from '../../src/api/profiles.js'

vi.mock('../../src/api/auth.js', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  getCurrentUser: vi.fn(),
  changePassword: vi.fn(),
}))

vi.mock('../../src/api/profiles.js', () => ({
  getMyProfile: vi.fn(),
  updateMyDisplayName: vi.fn(),
}))

describe('auth store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('checkSession sets user on success', async () => {
    authApi.getCurrentUser.mockResolvedValue({ id: 2, username: 'codex' })
    profilesApi.getMyProfile.mockResolvedValue({ uid: '2', username: 'codex', displayName: 'Codex Home' })
    const store = useAuthStore()
    await store.checkSession()
    expect(store.user.username).toBe('codex')
    expect(store.user.uid).toBe('2')
    expect(store.user.displayName).toBe('Codex Home')
    expect(store.checked).toBe(true)
  })

  it('checkSession leaves user null on 401', async () => {
    authApi.getCurrentUser.mockRejectedValue({ status: 401 })
    const store = useAuthStore()
    await store.checkSession()
    expect(store.user).toBeNull()
    expect(store.checked).toBe(true)
  })

  it('signIn logs in then refreshes the current user', async () => {
    authApi.login.mockResolvedValue()
    authApi.getCurrentUser.mockResolvedValue({ id: 2, username: 'codex' })
    profilesApi.getMyProfile.mockResolvedValue({ uid: '2', username: 'codex', displayName: 'Codex Home' })
    const store = useAuthStore()
    await store.signIn('codex', 'hunter2')
    expect(authApi.login).toHaveBeenCalledWith('codex', 'hunter2')
    expect(store.user.username).toBe('codex')
    expect(store.user.displayName).toBe('Codex Home')
  })

  it('signOut clears user', async () => {
    authApi.logout.mockResolvedValue()
    const store = useAuthStore()
    store.user = { username: 'codex' }
    await store.signOut()
    expect(store.user).toBeNull()
  })

  it('changePassword delegates to the API with the given credentials', async () => {
    authApi.changePassword.mockResolvedValue()
    const store = useAuthStore()
    await store.changePassword('oldpass', 'newpass')
    expect(authApi.changePassword).toHaveBeenCalledWith('oldpass', 'newpass')
  })

  it('falls back to username while keeping the numeric UID when the profile service is unavailable', async () => {
    authApi.getCurrentUser.mockResolvedValue({ id: 7, username: 'legacy-login' })
    profilesApi.getMyProfile.mockRejectedValue({ status: 502 })
    const store = useAuthStore()
    await store.checkSession()
    expect(store.user).toMatchObject({ uid: '7', username: 'legacy-login', displayName: 'legacy-login' })
  })

  it('updates display name without changing UID or login username', async () => {
    profilesApi.updateMyDisplayName.mockResolvedValue({ uid: '2', username: 'codex', displayName: 'New Name' })
    const store = useAuthStore()
    store.user = { id: 2, uid: '2', username: 'codex', displayName: 'Old Name' }
    await store.updateDisplayName('New Name')
    expect(profilesApi.updateMyDisplayName).toHaveBeenCalledWith('New Name')
    expect(store.user).toMatchObject({ id: 2, uid: '2', username: 'codex', displayName: 'New Name' })
  })

  describe('isAdmin', () => {
    it('is true when the user has the admin permission', () => {
      const store = useAuthStore()
      store.user = { uid: '2', permissions: { admin: true } }
      expect(store.isAdmin).toBe(true)
    })

    it('is false for a non-admin user', () => {
      const store = useAuthStore()
      store.user = { uid: '2', permissions: { admin: false } }
      expect(store.isAdmin).toBe(false)
    })

    it('is false when there is no signed-in user', () => {
      const store = useAuthStore()
      expect(store.isAdmin).toBe(false)
    })
  })

  describe('hasHomeDrive', () => {
    it('is true when the user\'s scopes include a home entry', () => {
      const store = useAuthStore()
      store.user = { uid: '2', scopes: [{ name: 'share', scope: '/' }, { name: 'home', scope: '/codex' }] }
      expect(store.hasHomeDrive).toBe(true)
    })

    it('is false when the user has no home scope', () => {
      const store = useAuthStore()
      store.user = { uid: '2', scopes: [{ name: 'share', scope: '/' }] }
      expect(store.hasHomeDrive).toBe(false)
    })

    it('is false when there is no signed-in user or no scopes at all', () => {
      const store = useAuthStore()
      expect(store.hasHomeDrive).toBe(false)
      store.user = { uid: '2' }
      expect(store.hasHomeDrive).toBe(false)
    })
  })
})
