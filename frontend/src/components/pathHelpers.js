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
