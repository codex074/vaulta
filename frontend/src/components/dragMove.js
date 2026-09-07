import { moveItem } from '../api/resources.js'

const MIME = 'application/x-nas-webui-paths'

export function beginDrag(event, paths) {
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData(MIME, JSON.stringify(paths))
}

export function dragPaths(event) {
  const raw = event.dataTransfer.getData(MIME)
  if (!raw) return []
  try {
    return JSON.parse(raw)
  } catch {
    return []
  }
}

// Browsers only expose getData() at drop time; during dragenter/dragover only
// the MIME type list is readable, so hover feedback checks presence via types.
export function hasDragPayload(event) {
  return Array.from(event.dataTransfer.types || []).includes(MIME)
}

export function selectionToDrag(path, selected) {
  if (selected.has(path) && selected.size > 1) return Array.from(selected)
  return [path]
}

export function isValidDropTarget(targetPath, targetIsDirectory, draggedPaths) {
  if (!targetIsDirectory) return false
  return !draggedPaths.includes(targetPath)
}

export function isWithin(path, ancestorPath) {
  if (path === ancestorPath) return true
  const prefix = ancestorPath === '/' ? '/' : `${ancestorPath}/`
  return path.startsWith(prefix)
}

function basename(path) {
  const idx = path.lastIndexOf('/')
  return idx === -1 ? path : path.slice(idx + 1)
}

export async function moveInto(draggedPaths, targetPath) {
  const base = targetPath === '/' ? '' : targetPath
  const failed = []
  for (const path of draggedPaths) {
    try {
      await moveItem(path, `${base}/${basename(path)}`)
    } catch (err) {
      failed.push({ path, message: err.message })
    }
  }
  if (failed.length) {
    throw new Error(`Could not move: ${failed.map((f) => f.path).join(', ')}`)
  }
}
