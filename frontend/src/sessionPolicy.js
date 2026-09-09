// Client-side session policy. FBQ's token lifetime is server-wide, so the
// 1-hour idle sign-out for "don't keep me signed in" is enforced here.
export const IDLE_LIMIT_MS = 3_600_000
export const RENEW_MIN_INTERVAL_MS = 300_000
export const ACTIVITY_WRITE_INTERVAL_MS = 30_000
export const REMEMBER_KEY = 'vaulta-remember'
export const LAST_ACTIVITY_KEY = 'vaulta-last-activity'

export function readSessionPrefs(storage) {
  try {
    const remember = storage.getItem(REMEMBER_KEY) === '1'
    const raw = storage.getItem(LAST_ACTIVITY_KEY)
    const parsed = raw === null ? NaN : Number(raw)
    return { remember, lastActivity: Number.isFinite(parsed) ? parsed : null }
  } catch {
    return { remember: false, lastActivity: null }
  }
}

export function writeSessionPrefs(storage, { remember, lastActivity }) {
  try {
    storage.setItem(REMEMBER_KEY, remember ? '1' : '0')
    if (lastActivity === null || lastActivity === undefined) storage.removeItem(LAST_ACTIVITY_KEY)
    else storage.setItem(LAST_ACTIVITY_KEY, String(lastActivity))
  } catch {
    // storage unavailable (private mode, quota) — the session simply isn't remembered
  }
}

export function clearSessionPrefs(storage) {
  try {
    storage.removeItem(REMEMBER_KEY)
    storage.removeItem(LAST_ACTIVITY_KEY)
  } catch {
    // nothing to clear
  }
}

export function isIdleExpired({ remember, lastActivity }, now, limit = IDLE_LIMIT_MS) {
  if (remember || lastActivity === null) return false
  return now - lastActivity > limit
}

export function shouldWriteActivity(lastActivity, now, interval = ACTIVITY_WRITE_INTERVAL_MS) {
  return lastActivity === null || now - lastActivity >= interval
}

export function shouldRenew(lastRenewAt, now, min = RENEW_MIN_INTERVAL_MS) {
  return lastRenewAt === null || now - lastRenewAt >= min
}
