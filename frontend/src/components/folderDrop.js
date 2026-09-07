function readFile(entry) {
  return new Promise((resolve, reject) => entry.file(resolve, reject))
}

// FileSystemDirectoryReader.readEntries() only returns one batch per call and
// must be called repeatedly until it resolves empty to see every child.
function readDirectoryBatch(reader) {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject))
}

async function readAllChildren(directoryEntry) {
  const reader = directoryEntry.createReader()
  const all = []
  let batch = await readDirectoryBatch(reader)
  while (batch.length) {
    all.push(...batch)
    batch = await readDirectoryBatch(reader)
  }
  return all
}

async function collectEntry(entry, prefix) {
  if (entry.isFile) {
    const file = await readFile(entry)
    return [{ file, path: `${prefix}${entry.name}` }]
  }
  if (entry.isDirectory) {
    const children = await readAllChildren(entry)
    const nested = await Promise.all(children.map((child) => collectEntry(child, `${prefix}${entry.name}/`)))
    return nested.flat()
  }
  return []
}

export async function collectFilesFromDataTransfer(dataTransfer) {
  const items = Array.from(dataTransfer.items || [])
  const entries = items.map((item) => item.webkitGetAsEntry && item.webkitGetAsEntry()).filter(Boolean)
  if (!entries.length) {
    return Array.from(dataTransfer.files || []).map((file) => ({ file, path: file.name }))
  }
  const results = await Promise.all(entries.map((entry) => collectEntry(entry, '')))
  return results.flat()
}

export function directoriesFor(paths) {
  const dirs = new Set()
  for (const path of paths) {
    const idx = path.lastIndexOf('/')
    if (idx > 0) dirs.add(path.slice(0, idx))
  }
  return Array.from(dirs)
}
