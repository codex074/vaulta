import { defineStore } from 'pinia'
import { login, logout, getCurrentUser, changePassword as changePasswordApi, renewToken } from '../api/auth.js'
import { getMyProfile, updateMyDisplayName } from '../api/profiles.js'
import { readSessionPrefs, writeSessionPrefs, clearSessionPrefs, isIdleExpired, shouldWriteActivity, shouldRenew } from '../sessionPolicy.js'

export const IDLE_SIGNOUT_MESSAGE = 'Signed out after 1 hour of inactivity.'
const storage = () => window.localStorage

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
  state: () => ({ user: null, checked: false, signedOutReason: '', lastRenewAt: null }),
  getters: {
    isAdmin: (state) => Boolean(state.user?.permissions?.admin),
    hasHomeDrive: (state) => Boolean(state.user?.scopes?.some((scope) => scope.name === 'home')),
  },
  actions: {
    async checkSession() {
      try {
        if (isIdleExpired(readSessionPrefs(storage()), Date.now())) {
          await this.idleSignOut()
          return
        }
        this.user = await loadIdentity()
        this.recordActivity()
      } catch {
        this.user = null
      } finally {
        this.checked = true
      }
    },
    async signIn(username, password, { remember = false } = {}) {
      await login(username, password)
      writeSessionPrefs(storage(), { remember, lastActivity: Date.now() })
      this.user = await loadIdentity()
      this.signedOutReason = ''
    },
    async signOut() {
      try {
        await logout()
      } finally {
        clearSessionPrefs(storage())
        this.user = null
      }
    },
    idleSignOut() {
      this.signedOutReason = IDLE_SIGNOUT_MESSAGE
      clearSessionPrefs(storage())
      this.user = null
      return logout().catch(() => {
        // cookie lingers until FBQ expires it; the login screen still shows
      })
    },
    recordActivity(now = Date.now()) {
      const prefs = readSessionPrefs(storage())
      if (shouldWriteActivity(prefs.lastActivity, now)) writeSessionPrefs(storage(), { remember: prefs.remember, lastActivity: now })
    },
    enforceIdle(now = Date.now()) {
      if (!this.user || !isIdleExpired(readSessionPrefs(storage()), now)) return false
      this.idleSignOut()
      return true
    },
    async renewIfDue(now = Date.now()) {
      if (!this.user || !shouldRenew(this.lastRenewAt, now)) return
      this.lastRenewAt = now
      try {
        await renewToken()
      } catch (err) {
        console.warn('token renewal failed', err)
      }
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
