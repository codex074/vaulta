export const EXPIRY_OPTIONS = [
  { value: '1d', label: '1 day', days: 1 },
  { value: '7d', label: '7 days', days: 7 },
  { value: '30d', label: '30 days', days: 30 },
  { value: 'never', label: 'Never', days: 0 },
]

// FBQ's POST /api/share takes expires as a string number plus a unit.
// We only ever use days; "never" means leaving expires out entirely.
export function buildCreateBody({ source, path, expiry = '7d', password = '' }) {
  const option = EXPIRY_OPTIONS.find((o) => o.value === expiry) ?? EXPIRY_OPTIONS[1]
  const body = { source, path, unit: 'days' }
  if (option.days > 0) body.expires = String(option.days)
  if (password) body.password = password
  return body
}

export function guestUrlFor(hash, origin = window.location.origin) {
  return `${origin}/s/${hash}`
}

const GUEST_PATH = /^\/s\/([A-Za-z0-9_-]+)\/?$/

export function parseGuestHash(pathname) {
  const match = GUEST_PATH.exec(pathname)
  return match ? match[1] : null
}

export function formatExpiry(expireUnix, nowMs = Date.now()) {
  if (!expireUnix) return 'Never'
  const diffMs = expireUnix * 1000 - nowMs
  if (diffMs <= 0) return 'Expired'
  const minutes = Math.round(diffMs / 60_000)
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? '' : 's'}`
  const hours = Math.round(diffMs / 3_600_000)
  if (hours < 24) return `in ${hours} hour${hours === 1 ? '' : 's'}`
  const days = Math.floor(diffMs / 86_400_000)
  return `in ${days} day${days === 1 ? '' : 's'}`
}

// FBQ reports share.source as the source's disk path (/srv/home) and
// share.path as the index path inside it (which, for home, starts with the
// owner's own folder). Labels only need the last segment.
export function driveLabelFor(share) {
  const source = String(share.source ?? '')
  return source === 'home' || source.endsWith('/home') ? 'My Drive' : 'Shared'
}

export function shareDisplayName(share) {
  const trimmed = String(share.path ?? '').replace(/\/+$/, '')
  const base = trimmed.slice(trimmed.lastIndexOf('/') + 1)
  return base || driveLabelFor(share)
}
