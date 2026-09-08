import { defineStore } from 'pinia'
import { login, logout, getCurrentUser, changePassword as changePasswordApi } from '../api/auth.js'
import { getMyProfile, updateMyDisplayName } from '../api/profiles.js'

async function loadIdentity() {
  const user = await getCurrentUser()
  const fallback = { uid: String(user.id), displayName: user.username }
  try {
    const profile = await getMyProfile()
    return { ...user, ...fallback, ...profile }
  } catch (error) {
    if (error?.status === 401) throw error
    return { ...user, ...fallback }
  }
}

export const useAuthStore = defineStore('auth', {
  state: () => ({ user: null, checked: false }),
  getters: {
    isAdmin: (state) => Boolean(state.user?.permissions?.admin),
    hasHomeDrive: (state) => Boolean(state.user?.scopes?.some((scope) => scope.name === 'home')),
  },
  actions: {
    async checkSession() {
      try {
        this.user = await loadIdentity()
      } catch {
        this.user = null
      } finally {
        this.checked = true
      }
    },
    async signIn(username, password) {
      await login(username, password)
      this.user = await loadIdentity()
    },
    async signOut() {
      await logout()
      this.user = null
    },
    async changePassword(currentPassword, newPassword) {
      await changePasswordApi(currentPassword, newPassword)
    },
    async updateDisplayName(displayName) {
      const profile = await updateMyDisplayName(displayName)
      this.user = { ...this.user, ...profile }
    },
  },
})
