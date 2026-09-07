import { moveItem, uploadFile, getFileText, deleteItem, listDirectory, makeDirectory } from './resources.js'

function basename(path) {
  const idx = path.lastIndexOf('/')
  return idx === -1 ? path : path.slice(idx + 1)
}

export function trashPathFor(originalPath, ts = Date.now()) {
  return `/.trash/${ts}__${basename(originalPath)}`
}

export function metaPathFor(trashPath) {
  return `${trashPath}.trashmeta`
}

export async function softDelete(originalPath) {
  const ts = Date.now()
  const trashPath = trashPathFor(originalPath, ts)
  try {
    await makeDirectory('/.trash')
  } catch (err) {
    if (err.status !== 409) throw err
  }
  await moveItem(originalPath, trashPath)
  try {
    const meta = { originalPath, deletedAt: ts }
    const blob = new Blob([JSON.stringify(meta)], { type: 'application/json' })
    await uploadFile(metaPathFor(trashPath), blob)
  } catch (err) {
    throw new Error(`Moved to trash, but couldn't save its restore info: ${err.message}`)
  }
}

export async function listTrash() {
  const result = await listDirectory('/.trash')
  const allEntries = [...(result.folders || []), ...(result.files || [])]
  const metaNames = new Set(allEntries.filter((e) => e.name.endsWith('.trashmeta')).map((e) => e.name))
  const itemEntries = allEntries.filter((e) => !e.name.endsWith('.trashmeta'))

  const items = []
  for (const entry of itemEntries) {
    const trashPath = `/.trash/${entry.name}`
    let originalPath = null
    let deletedAt = null
    if (metaNames.has(`${entry.name}.trashmeta`)) {
      try {
        const text = await getFileText(metaPathFor(trashPath))
        const parsed = JSON.parse(text)
        originalPath = parsed.originalPath
        deletedAt = parsed.deletedAt
      } catch {
        // corrupt or unreadable sidecar — still show the item, just without restore info
      }
    }
    items.push({ ...entry, path: trashPath, trashPath, originalPath, deletedAt })
  }
  return items
}

export async function restoreFromTrash(item) {
  if (!item.originalPath) throw new Error('Missing restore information for this item.')
  await moveItem(item.trashPath, item.originalPath)
  try {
    await deleteItem(metaPathFor(item.trashPath))
  } catch (err) {
    throw new Error(`Restored, but couldn't remove its trash record: ${err.message}`)
  }
}

export async function deleteForever(item) {
  await deleteItem(item.trashPath)
  if (!item.originalPath) return
  try {
    await deleteItem(metaPathFor(item.trashPath))
  } catch (err) {
    throw new Error(`Deleted, but couldn't remove its trash record: ${err.message}`)
  }
}

export async function emptyTrash() {
  const items = await listTrash()
  const failed = []
  for (const item of items) {
    try {
      await deleteForever(item)
    } catch (err) {
      failed.push({ path: item.trashPath, message: err.message })
    }
  }
  if (failed.length) {
    throw new Error(`Could not delete: ${failed.map((f) => f.path).join(', ')}`)
  }
}
