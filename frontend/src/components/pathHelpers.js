export function siblingPath(path, newName) {
  const lastSlash = path.lastIndexOf('/')
  const parent = lastSlash <= 0 ? '' : path.slice(0, lastSlash)
  return `${parent}/${newName}`
}

export function entryPath(entry, currentPath) {
  if (entry.path) return entry.path
  return `${currentPath}${currentPath.endsWith('/') ? '' : '/'}${entry.name}`
}

// Selection keys are source-qualified (source:path) so the same relative
// path in two different drives can't collide in a single multi-select Set —
// the exact collision this feature exists to prevent, since Starred/Trash
// now aggregate entries from both drives at once.
export function selectionKey(entry, currentPath, defaultSource) {
  const source = entry.source ?? defaultSource
  return `${source}:${entryPath(entry, currentPath)}`
}

export function parseSelectionKey(key) {
  const idx = key.indexOf(':')
  return { source: key.slice(0, idx), path: key.slice(idx + 1) }
}

// collapseTrail keeps a breadcrumb on one line by hiding the middle of a deep
// path behind a "…" menu: the root (first crumb) and the last `tail` crumbs
// are always shown; anything between them goes into `hidden` (still reachable
// through the menu). Shallow paths return everything with no hidden section.
export function collapseTrail(crumbs, tail = 2) {
  if (crumbs.length === 0) return { lead: null, hidden: [], tail: [] }
  if (crumbs.length <= tail + 1) return { lead: crumbs[0], hidden: [], tail: crumbs.slice(1) }
  return {
    lead: crumbs[0],
    hidden: crumbs.slice(1, crumbs.length - tail),
    tail: crumbs.slice(crumbs.length - tail),
  }
}
