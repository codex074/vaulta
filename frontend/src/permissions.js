import { entryPath, selectionKey } from './components/pathHelpers.js'

// Client-side courtesy gate, not a security boundary: it hides delete
// controls for files someone else uploaded, matching this app's existing
// client-orchestrated trash/starred pattern. An owner-less entry (upload
// predates this feature, or its ownership record was lost) stays deletable
// by anyone, same as before this feature existed.
export function canDeleteEntry(entry, user) {
  if (!user) return false
  if (user.permissions?.admin) return true
  if (!entry?.uploadedByUid) return true
  return String(entry.uploadedByUid) === String(user.uid)
}

// Browse-view entries from listDirectory carry no .path of their own (see
// FileTile's identical fallback) — only starred/trash entries are already
// stamped with a full path. Mirrors that same fallback so a bulk selection
// resolves to the same paths the UI used to build it.
export function fullPathFor(entry, currentPath) {
  if (entry.path) return entry.path
  const base = currentPath.endsWith('/') ? currentPath : `${currentPath}/`
  return `${base}${entry.name}`
}

// selectedKeys holds source:path selection keys (see pathHelpers.js), so
// membership is checked the same way the selection was built — an entry
// with no source of its own falls back to defaultSource (the currently
// browsed drive), matching selectionKey's own fallback.
export function partitionDeletable(entries, selectedKeys, user, currentPath, defaultSource) {
  const allowed = []
  const blocked = []
  for (const entry of entries) {
    const key = selectionKey(entry, currentPath, defaultSource)
    if (!selectedKeys.has(key)) continue
    const source = entry.source ?? defaultSource
    const path = entryPath(entry, currentPath)
    const withPath = { ...entry, source, path }
    ;(canDeleteEntry(entry, user) ? allowed : blocked).push(withPath)
  }
  return { allowed, blocked }
}
