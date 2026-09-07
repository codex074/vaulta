import { defineStore } from 'pinia'
import { login, logout, getCurrentUser, changePassword as changePasswordApi } from '../api/auth.js'

export const useAuthStore = defineStore('auth', {
  state: () => ({ user: null, checked: false }),
  actions: {
    async checkSession() {
      try {
        this.user = await getCurrentUser()
      } catch {
        this.user = null
      } finally {
        this.checked = true
      }
    },
    async signIn(username, password) {
      await login(username, password)
      this.user = await getCurrentUser()
    },
    async signOut() {
      await logout()
      this.user = null
    },
    async changePassword(currentPassword, newPassword) {
      await changePasswordApi(currentPassword, newPassword)
    },
  },
})
