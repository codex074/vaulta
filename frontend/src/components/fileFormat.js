export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = -1
  do {
    value /= 1024
    unitIndex += 1
  } while (value >= 1024 && unitIndex < units.length - 1)
  return `${value.toFixed(1)} ${units[unitIndex]}`
}

export function formatRelativeTime(isoString, now = new Date()) {
  const then = new Date(isoString)
  const diffMs = now - then
  const minute = 60_000, hour = 3_600_000, day = 86_400_000, week = 7 * day
  if (diffMs < hour) return `${Math.max(1, Math.round(diffMs / minute))}m ago`
  if (diffMs < day) return `${Math.round(diffMs / hour)}h ago`
  if (diffMs < week) return `${Math.round(diffMs / day)}d ago`
  return `${Math.round(diffMs / week)}w ago`
}

export function iconFor(entry) {
  if (entry.type === 'directory') return '📁'
  if (entry.type.startsWith('image/')) return '🖼️'
  if (entry.type.startsWith('video/')) return '🎞️'
  if (entry.type === 'application/pdf') return '📕'
  return '📄'
}
