import { onRenewRequested } from './api/http.js'

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'scroll']
const IDLE_CHECK_INTERVAL_MS = 60_000

// Wires the auth store's session policy to the page: user input counts as
// activity, idleness is checked every minute and whenever the tab comes
// back, and FBQ's renew signal triggers a (throttled) token renewal.
export function installSessionGuard(auth, { win = window, doc = document } = {}) {
  const onActivity = () => auth.recordActivity()
  const onVisibility = () => {
    if (doc.visibilityState !== 'visible') return
    if (!auth.enforceIdle()) auth.recordActivity()
  }
  for (const name of ACTIVITY_EVENTS) win.addEventListener(name, onActivity, { passive: true, capture: true })
  doc.addEventListener('visibilitychange', onVisibility)
  const timer = win.setInterval(() => auth.enforceIdle(), IDLE_CHECK_INTERVAL_MS)
  const offRenew = onRenewRequested(() => auth.renewIfDue())
  return () => {
    for (const name of ACTIVITY_EVENTS) win.removeEventListener(name, onActivity, { capture: true })
    doc.removeEventListener('visibilitychange', onVisibility)
    win.clearInterval(timer)
    offRenew()
  }
}
