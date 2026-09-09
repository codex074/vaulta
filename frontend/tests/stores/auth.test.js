// frontend/tests/stores/auth.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '../../src/stores/auth.js'
import * as authApi from '../../src/api/auth.js'
import * as profilesApi from '../../src/api/profiles.js'

vi.mock('../../src/api/auth.js', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  getCurrentUser: vi.fn(),
  changePassword: vi.fn(),
  renewToken: vi.fn(),
}))

vi.mock('../../src/api/profiles.js', () => ({
  getMyProfile: vi.fn(),
  updateMyDisplayName: vi.fn(),
}))

describe('auth store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
  })

  afterEach(() => vi.restoreAllMocks())

  it('checkSession sets user on success', async () => {
    // A recent lastActivity models a continuing session (prefs already
    // written by a prior signIn/recordActivity) — distinct from the
    // "cookie present but no prefs at all" case covered below, which now
    // signs out defensively.
    localStorage.setItem('vaulta-last-activity', String(Date.now()))
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
    localStorage.setItem('vaulta-last-activity', String(Date.now()))
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
    localStorage.setItem('vaulta-last-activity', String(Date.now()))
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

  it('signIn stores the remember choice and stamps activity', async () => {
    authApi.getCurrentUser.mockResolvedValue({ id: 1, username: 'u' })
    profilesApi.getMyProfile.mockResolvedValue({})
    const store = useAuthStore()
    await store.signIn('u', 'p', { remember: true })
    expect(localStorage.getItem('vaulta-remember')).toBe('1')
    expect(Number(localStorage.getItem('vaulta-last-activity'))).toBeGreaterThan(0)
    await store.signIn('u', 'p')
    expect(localStorage.getItem('vaulta-remember')).toBe('0')
  })

  it('checkSession signs out a stale unremembered session with a notice', async () => {
    localStorage.setItem('vaulta-remember', '0')
    localStorage.setItem('vaulta-last-activity', String(Date.now() - 2 * 3_600_000))
    authApi.logout.mockResolvedValue()
    const store = useAuthStore()
    await store.checkSession()
    expect(authApi.logout).toHaveBeenCalled()
    expect(authApi.getCurrentUser).not.toHaveBeenCalled()
    expect(store.user).toBeNull()
    expect(store.checked).toBe(true)
    expect(store.signedOutReason).toBe('Signed out after 1 hour of inactivity.')
    expect(localStorage.getItem('vaulta-last-activity')).toBeNull()
  })

  it('checkSession keeps a remembered session however old it is', async () => {
    localStorage.setItem('vaulta-remember', '1')
    localStorage.setItem('vaulta-last-activity', String(Date.now() - 40 * 24 * 3_600_000))
    authApi.getCurrentUser.mockResolvedValue({ id: 1, username: 'u' })
    profilesApi.getMyProfile.mockResolvedValue({})
    const store = useAuthStore()
    await store.checkSession()
    expect(store.user).not.toBeNull()
    expect(authApi.logout).not.toHaveBeenCalled()
  })

  it('enforceIdle signs out only when idle past the limit', async () => {
    authApi.getCurrentUser.mockResolvedValue({ id: 1, username: 'u' })
    profilesApi.getMyProfile.mockResolvedValue({})
    authApi.logout.mockResolvedValue()
    const store = useAuthStore()
    const t0 = 5_000_000_000
    vi.useFakeTimers()
    vi.setSystemTime(t0)
    try {
      await store.signIn('u', 'p')
      store.recordActivity(t0)
      expect(store.enforceIdle(t0 + 3_600_000)).toBe(false)
      expect(store.user).not.toBeNull()
      expect(store.enforceIdle(t0 + 3_600_001)).toBe(true)
      expect(store.user).toBeNull()
      expect(store.signedOutReason).toBe('Signed out after 1 hour of inactivity.')
    } finally {
      vi.useRealTimers()
    }
  })

  it('recordActivity throttles storage writes', async () => {
    const store = useAuthStore()
    store.recordActivity(1_000)
    store.recordActivity(1_000 + 29_999)
    expect(localStorage.getItem('vaulta-last-activity')).toBe('1000')
    store.recordActivity(1_000 + 30_000)
    expect(localStorage.getItem('vaulta-last-activity')).toBe('31000')
  })

  it('renewIfDue renews at most once per five minutes and only when signed in', async () => {
    authApi.renewToken.mockResolvedValue()
    const store = useAuthStore()
    await store.renewIfDue(1_000)
    expect(authApi.renewToken).not.toHaveBeenCalled()
    store.user = { id: 1 }
    await store.renewIfDue(1_000)
    await store.renewIfDue(1_000 + 299_999)
    expect(authApi.renewToken).toHaveBeenCalledTimes(1)
    await store.renewIfDue(1_000 + 300_000)
    expect(authApi.renewToken).toHaveBeenCalledTimes(2)
  })

  it('renewIfDue swallows a failed renewal', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    authApi.renewToken.mockRejectedValue(new Error('nope'))
    const store = useAuthStore()
    store.user = { id: 1 }
    await expect(store.renewIfDue(1_000)).resolves.toBeUndefined()
  })

  it('signOut clears the stored prefs', async () => {
    localStorage.setItem('vaulta-remember', '1')
    authApi.logout.mockResolvedValue()
    const store = useAuthStore()
    await store.signOut()
    expect(localStorage.getItem('vaulta-remember')).toBeNull()
  })

  it('idle sign-out keeps stale prefs when logout fails, so the next check signs out again', async () => {
    localStorage.setItem('vaulta-remember', '0')
    localStorage.setItem('vaulta-last-activity', String(Date.now() - 2 * 3_600_000))
    authApi.logout.mockRejectedValue(new Error('network down'))
    const store = useAuthStore()
    await store.checkSession()
    expect(store.user).toBeNull()
    expect(store.signedOutReason).toBe('Signed out after 1 hour of inactivity.')
    expect(localStorage.getItem('vaulta-last-activity')).not.toBeNull()

    authApi.getCurrentUser.mockClear()
    store.checked = false
    await store.checkSession()
    expect(authApi.getCurrentUser).not.toHaveBeenCalled()
    expect(store.user).toBeNull()
    expect(store.signedOutReason).toBe('Signed out after 1 hour of inactivity.')
  })

  it('checkSession signs out when storage is available but no prefs exist at all (cookie-only state)', async () => {
    authApi.logout.mockResolvedValue()
    const store = useAuthStore()
    await store.checkSession()
    expect(authApi.getCurrentUser).not.toHaveBeenCalled()
    expect(authApi.logout).toHaveBeenCalled()
    expect(store.user).toBeNull()
    expect(store.signedOutReason).toBe('Signed out after 1 hour of inactivity.')
  })

  it('enforces the idle limit through the memory mirror when storage throws', () => {
    authApi.logout.mockResolvedValue()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked') })
    const store = useAuthStore()
    store.user = { id: 1 }
    const t0 = 5_000_000_000
    store.recordActivity(t0)
    expect(store.enforceIdle(t0 + 3_600_000)).toBe(false)
    expect(store.user).not.toBeNull()
    expect(store.enforceIdle(t0 + 3_600_001)).toBe(true)
    expect(store.user).toBeNull()
  })

  it('renewIfDue signs out without renewing when the session is idle-expired', async () => {
    authApi.logout.mockResolvedValue()
    localStorage.setItem('vaulta-remember', '0')
    localStorage.setItem('vaulta-last-activity', String(Date.now() - 2 * 3_600_000))
    const store = useAuthStore()
    store.user = { id: 1 }
    await store.renewIfDue(Date.now())
    expect(authApi.renewToken).not.toHaveBeenCalled()
    expect(store.user).toBeNull()
  })

  it('signIn clears signedOutReason even when getMyProfile rejects (non-401)', async () => {
    authApi.login.mockResolvedValue()
    authApi.getCurrentUser.mockResolvedValue({ id: 3, username: 'u' })
    profilesApi.getMyProfile.mockRejectedValue({ status: 502 })
    const store = useAuthStore()
    store.signedOutReason = 'Signed out after 1 hour of inactivity.'
    await store.signIn('u', 'p')
    expect(store.signedOutReason).toBe('')
    expect(store.user).toMatchObject({ uid: '3', username: 'u' })
  })

  it('signIn clears signedOutReason before loadIdentity, even when identity loading itself fails', async () => {
    // Unlike the getMyProfile case above (which loadIdentity swallows
    // internally and so doesn't discriminate ordering), a getCurrentUser
    // rejection propagates out of signIn — this only stays cleared if the
    // assignment happens before the await, per review item #10.
    authApi.login.mockResolvedValue()
    authApi.getCurrentUser.mockRejectedValue(new Error('boom'))
    const store = useAuthStore()
    store.signedOutReason = 'Signed out after 1 hour of inactivity.'
    await expect(store.signIn('u', 'p')).rejects.toThrow('boom')
    expect(store.signedOutReason).toBe('')
  })
})
