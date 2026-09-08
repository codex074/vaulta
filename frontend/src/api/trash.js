import { moveItem, uploadFile, getFileText, deleteItem, listDirectory, makeDirectory } from './resources.js'
import { lookupOwnership, deleteOwnership } from './ownership.js'

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

export async function softDelete(source, originalPath) {
  const ts = Date.now()
  const trashPath = trashPathFor(originalPath, ts)
  try {
    await makeDirectory(source, '/.trash')
  } catch (err) {
    if (err.status !== 409) throw err
  }
  await moveItem(source, originalPath, trashPath)
  try {
    const meta = { originalPath, deletedAt: ts }
    const blob = new Blob([JSON.stringify(meta)], { type: 'application/json' })
    await uploadFile(source, metaPathFor(trashPath), blob)
  } catch (err) {
    throw new Error(`Moved to trash, but couldn't save its restore info: ${err.message}`)
  }
}

export async function listTrash(source) {
  let result
  try {
    result = await listDirectory(source, '/.trash')
  } catch (err) {
    // No .trash folder yet on this drive — treat as an empty trash rather
    // than surfacing an error the user can't act on.
    if (err.status === 404) return []
    throw err
  }
  const allEntries = [...(result.folders || []), ...(result.files || [])]
  const metaNames = new Set(allEntries.filter((e) => e.name.endsWith('.trashmeta')).map((e) => e.name))
  const itemEntries = allEntries.filter((e) => !e.name.endsWith('.trashmeta'))

  const items = []
  for (const entry of itemEntries) {
    const trashPath = `/.trash/${entry.name}`
    const hasMeta = metaNames.has(`${entry.name}.trashmeta`)
    let originalPath = null
    let deletedAt = null
    if (hasMeta) {
      try {
        const text = await getFileText(source, metaPathFor(trashPath))
        const parsed = JSON.parse(text)
        originalPath = parsed.originalPath
        deletedAt = parsed.deletedAt
      } catch {
        // corrupt or unreadable sidecar — still show the item, just without restore info;
        // hasMeta stays true so cleanup still removes the sidecar
      }
    }
    const displayName = entry.name.replace(/^\d+__/, '')
    items.push({ ...entry, source, path: trashPath, trashPath, originalPath, deletedAt, hasMeta, displayName })
  }
  // Ownership tracking stays share-only (see design spec's Non-Goals) — a
  // user's home drive has no other viewer to attribute uploads to.
  if (source !== 'share') return items
  const records = (await lookupOwnership(items.map((item) => item.trashPath))) || {}
  return items.map((item) => {
    const record = records[item.trashPath]
    return record
      ? { ...item, uploadedByUid: record.uploadedByUid, uploadedByUsername: record.uploadedByUsername }
      : item
  })
}

export async function restoreFromTrash(item) {
  if (!item.originalPath) throw new Error('Missing restore information for this item.')
  await moveItem(item.source, item.trashPath, item.originalPath)
  try {
    await deleteItem(item.source, metaPathFor(item.trashPath))
  } catch (err) {
    throw new Error(`Restored, but couldn't remove its trash record: ${err.message}`)
  }
}

export async function deleteForever(item) {
  await deleteItem(item.source, item.trashPath)
  if (item.source === 'share') {
    try {
      await deleteOwnership(item.trashPath)
    } catch {
      // Best-effort, see softDelete.
    }
  }
  if (!item.hasMeta) return
  try {
    await deleteItem(item.source, metaPathFor(item.trashPath))
  } catch (err) {
    throw new Error(`Deleted, but couldn't remove its trash record: ${err.message}`)
  }
}

export async function emptyTrash(source, canDelete = () => true) {
  const result = await listDirectory(source, '/.trash')
  const allEntries = [...(result.folders || []), ...(result.files || [])]
  const itemNames = new Set(allEntries.filter((e) => !e.name.endsWith('.trashmeta')).map((e) => e.name))
  const orphanMetaPaths = allEntries
    .filter((e) => e.name.endsWith('.trashmeta') && !itemNames.has(e.name.slice(0, -'.trashmeta'.length)))
    .map((e) => `/.trash/${e.name}`)

  const items = await listTrash(source)
  const failed = []
  for (const item of items) {
    if (!canDelete(item)) continue
    try {
      await deleteForever(item)
    } catch (err) {
      failed.push({ path: item.trashPath, message: err.message })
    }
  }
  for (const metaPath of orphanMetaPaths) {
    try {
      await deleteItem(source, metaPath)
    } catch (err) {
      failed.push({ path: metaPath, message: err.message })
    }
  }
  if (failed.length) {
    throw new Error(`Could not delete: ${failed.map((f) => f.path).join(', ')}`)
  }
}
