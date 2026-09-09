// Pure helpers for the admin Disk status dialog. Kept free of Vue/API
// concerns so they're trivial to unit test (see tests/components/diskStatus.test.js).

// Thresholds per design spec: hdd runs warmer at rest than ssd/nvme, so it
// gets its own (lower) band. `c` may be null/undefined when Proxmox didn't
// report a temperature for this disk — that's 'unknown', never a guess.
export function temperatureLevel(type, c) {
  if (c === null || c === undefined) return 'unknown'
  const isHdd = type === 'hdd'
  const warnAt = isHdd ? 45 : 60
  const hotAt = isHdd ? 50 : 70
  if (c > hotAt) return 'hot'
  if (c >= warnAt) return 'warn'
  return 'ok'
}

export function healthLevel(health) {
  if (health === 'PASSED') return 'ok'
  if (health === 'FAILED') return 'bad'
  return 'unknown'
}

// "5,823 h · 243 days" — power-on hours as reported, plus a rounded day
// count so an admin doesn't have to do the division in their head.
export function formatHours(hours) {
  if (hours === null || hours === undefined) return '—'
  const days = Math.round(hours / 24)
  return `${hours.toLocaleString('en-US')} h · ${days} days`
}
