import { defineStore } from 'pinia'
import { login, logout, getCurrentUser, changePassword as changePasswordApi, renewToken } from '../api/auth.js'
import { getMyProfile, updateMyDisplayName } from '../api/profiles.js'
import { readSessionPrefs, writeSessionPrefs, clearSessionPrefs, isIdleExpired, shouldWriteActivity, shouldRenew, storageAvailable } from '../sessionPolicy.js'

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
  state: () => ({ user: null, checked: false, signedOutReason: '', lastRenewAt: null, lastActivity: null, remember: false }),
  getters: {
    isAdmin: (state) => Boolean(state.user?.permissions?.admin),
    hasHomeDrive: (state) => Boolean(state.user?.scopes?.some((scope) => scope.name === 'home')),
  },
  actions: {
    // Storage prefs are authoritative when reachable; when storage throws
    // (private mode, quota, Safari ITP purge) this in-memory mirror is the
    // fallback so idle enforcement still works for the current tab.
    currentPrefs() {
      if (storageAvailable(storage())) return readSessionPrefs(storage())
      return { remember: this.remember, lastActivity: this.lastActivity }
    },
    async checkSession() {
      try {
        const prefs = this.currentPrefs()
        const now = Date.now()
        if (isIdleExpired(prefs, now)) {
          await this.idleSignOut()
          return
        }
        // A 401 (or any other failure) here means there is no session at
        // all — e.g. a first-time visitor with no cookie. That must fall
        // straight through to the outer catch with no idle notice and no
        // logout call; it is NOT the same as the cookie-without-prefs case
        // below, which only applies once we know a session actually exists.
        const identity = await loadIdentity()
        // A valid FBQ cookie can outlive the prefs that track it (legacy
        // session from before this feature, storage purged by Safari ITP,
        // or a previous idleSignOut whose logout() call failed). Only once
        // identity has loaded successfully — proving a session exists — do
        // we treat "no prefs at all" as expired too, rather than silently
        // re-adopting a cookie we have no activity record for.
        const cookieWithoutPrefs = storageAvailable(storage()) && !prefs.remember && prefs.lastActivity === null
        if (cookieWithoutPrefs) {
          await this.idleSignOut()
          return
        }
        this.user = identity
        this.recordActivity()
      } catch {
        this.user = null
      } finally {
        this.checked = true
      }
    },
    async signIn(username, password, { remember = false } = {}) {
      await login(username, password)
      const now = Date.now()
      this.remember = remember
      this.lastActivity = now
      writeSessionPrefs(storage(), { remember, lastActivity: now })
      this.signedOutReason = ''
      this.user = await loadIdentity()
    },
    async signOut() {
      try {
        await logout()
      } catch (err) {
        console.warn('sign-out request failed', err)
      } finally {
        clearSessionPrefs(storage())
        this.remember = false
        this.lastActivity = null
        this.user = null
        this.signedOutReason = ''
        this.lastRenewAt = null
      }
    },
    idleSignOut() {
      this.signedOutReason = IDLE_SIGNOUT_MESSAGE
      this.user = null
      this.lastRenewAt = null
      return logout()
        .then(() => {
          clearSessionPrefs(storage())
          this.remember = false
          this.lastActivity = null
        })
        .catch(() => {
          // Logout failed — keep the stale prefs (storage AND mirror) so the
          // next checkSession/enforceIdle re-evaluates this session as
          // expired instead of silently re-adopting a still-valid cookie.
        })
    },
    recordActivity(now = Date.now()) {
      const prefs = this.currentPrefs()
      this.lastActivity = now
      this.remember = prefs.remember
      if (shouldWriteActivity(prefs.lastActivity, now)) writeSessionPrefs(storage(), { remember: prefs.remember, lastActivity: now })
    },
    enforceIdle(now = Date.now()) {
      if (!this.user || !isIdleExpired(this.currentPrefs(), now)) return false
      this.idleSignOut()
      return true
    },
    async renewIfDue(now = Date.now()) {
      if (this.enforceIdle(now)) return
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
