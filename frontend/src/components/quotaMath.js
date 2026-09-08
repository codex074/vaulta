import { formatSize } from './fileFormat.js'

export function quotaPercent(usedBytes, limitBytes) {
  if (!limitBytes) return 0
  return Math.min(100, Math.round((usedBytes / limitBytes) * 100))
}

export function quotaFillColor(percent) {
  if (percent >= 90) return 'var(--danger)'
  if (percent >= 75) return 'var(--warning)'
  return 'var(--accent)'
}

export function quotaLabel(quota) {
  if (!quota.hasDrive) return ''
  if (quota.unlimited) return `${formatSize(quota.usedBytes)} used`
  if (!quota.limitBytes) return 'No quota set — ask an admin'
  return `${formatSize(quota.usedBytes)} of ${formatSize(quota.limitBytes)} used`
}

// driveStatus describes whether a user's `home` scope is what this app
// expects: `/<username>` for a non-admin (their private folder), anything
// for an admin (who legitimately sits at `/` to see every drive). A
// non-admin at `/` is the FBQ "defaultEnabled merge" misconfiguration —
// they would see everyone's drive — so it is reported as not ok and the
// Manage users dialog offers to fix it.
export function driveStatus(user) {
  const isAdmin = Boolean(user.permissions?.admin)
  const expected = isAdmin ? '/' : `/${user.username}`
  const home = (user.scopes || []).find((s) => s.name === 'home')
  if (!home) return { hasScope: false, scope: null, expected, ok: false }
  return { hasScope: true, scope: home.scope, expected, ok: isAdmin || home.scope === expected }
}
