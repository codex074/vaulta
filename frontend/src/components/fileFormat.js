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

// FileBrowser Quantum 1.5.x renders these through MuPDF, which can abort the
// whole FBQ process on some files (upstream issue #2763, fixed only in 2.x).
// Every request for such a thumbnail is a chance to take FBQ down for a few
// seconds, so Vaulta shows an icon instead and never asks.
const MUPDF_THUMBNAIL_EXTENSIONS = new Set(['pdf', 'xps', 'epub', 'mobi', 'fb2', 'cbz'])

export function canRequestThumbnail(entry) {
  if (!entry.hasPreview) return false
  if (entry.type === 'directory') return true
  const dot = entry.name.lastIndexOf('.')
  const ext = dot === -1 ? '' : entry.name.slice(dot + 1).toLowerCase()
  return !MUPDF_THUMBNAIL_EXTENSIONS.has(ext)
}

export function pickFolderPreviewPaths(result, basePath, limit = 4) {
  const base = basePath.endsWith('/') ? basePath : `${basePath}/`
  return (result.files || [])
    .filter((file) => canRequestThumbnail(file))
    .slice(0, limit)
    .map((file) => `${base}${file.name}`)
}

export function iconFor(entry) {
  if (entry.type === 'directory') return '📁'
  if (entry.type.startsWith('image/')) return '🖼️'
  if (entry.type.startsWith('video/')) return '🎞️'
  if (entry.type === 'application/pdf') return '📕'
  return '📄'
}
