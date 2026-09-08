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

export function partitionDeletable(entries, selectedPaths, user, currentPath) {
  const allowed = []
  const blocked = []
  for (const entry of entries) {
    const path = fullPathFor(entry, currentPath)
    if (!selectedPaths.has(path)) continue
    const withPath = { ...entry, path }
    ;(canDeleteEntry(entry, user) ? allowed : blocked).push(withPath)
  }
  return { allowed, blocked }
}
