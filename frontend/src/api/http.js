const listeners = new Set()
const renewListeners = new Set()

export function onUnauthorized(callback) {
  listeners.add(callback)
  return () => listeners.delete(callback)
}

export function notifyUnauthorized() {
  for (const callback of listeners) callback()
}

export function onRenewRequested(callback) {
  renewListeners.add(callback)
  return () => renewListeners.delete(callback)
}

export function notifyRenewRequested() {
  for (const callback of renewListeners) callback()
}

export async function apiError(response) {
  let message = response.statusText || `Request failed (${response.status})`
  try {
    const body = await response.clone().json()
    if (body && body.message) message = body.message
  } catch {
    // response body wasn't JSON (or already consumed) — keep the fallback message
  }
  const err = new Error(message)
  err.status = response.status
  return err
}

export async function authorizedFetch(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', ...options })
  if (response.status === 401) {
    notifyUnauthorized()
  }
  // FBQ flags a token with under 30 minutes left; the auth store renews it.
  if (response.headers?.get?.('X-Renew-Token') === 'true') notifyRenewRequested()
  return response
}
