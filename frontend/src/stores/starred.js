import { defineStore } from 'pinia'
import { listDirectory } from '../api/resources.js'

async function walk(path) {
  const result = await listDirectory(path)
  const folders = result.folders || []
  const files = result.files || []
  const pinned = new Set(result.pinnedItems || [])
  const base = path.endsWith('/') ? path : `${path}/`

  const found = [...folders, ...files]
    .filter((entry) => pinned.has(entry.name))
    .map((entry) => ({ ...entry, path: `${base}${entry.name}` }))

  for (const folder of folders) {
    if (folder.name === '.trash') continue
    const childPath = `${base}${folder.name}`
    found.push(...(await walk(childPath)))
  }
  return found
}

export const useStarredStore = defineStore('starred', {
  state: () => ({ entries: [], loading: false, error: null }),
  actions: {
    async loadStarred() {
      this.loading = true
      this.error = null
      try {
        this.entries = await walk('/')
      } catch (err) {
        this.error = err
        throw err
      } finally {
        this.loading = false
      }
    },
  },
})
