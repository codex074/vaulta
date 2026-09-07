// frontend/tests/stores/auth.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '../../src/stores/auth.js'
import * as authApi from '../../src/api/auth.js'

vi.mock('../../src/api/auth.js', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  getCurrentUser: vi.fn(),
  changePassword: vi.fn(),
}))

describe('auth store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('checkSession sets user on success', async () => {
    authApi.getCurrentUser.mockResolvedValue({ username: 'codex' })
    const store = useAuthStore()
    await store.checkSession()
    expect(store.user.username).toBe('codex')
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
    authApi.getCurrentUser.mockResolvedValue({ username: 'codex' })
    const store = useAuthStore()
    await store.signIn('codex', 'hunter2')
    expect(authApi.login).toHaveBeenCalledWith('codex', 'hunter2')
    expect(store.user.username).toBe('codex')
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
})
