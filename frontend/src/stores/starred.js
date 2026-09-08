import { defineStore } from 'pinia'
import { listDirectory, SOURCES } from '../api/resources.js'
import { lookupOwnership } from '../api/ownership.js'
import { useAuthStore } from './auth.js'

async function walk(source, path) {
  const result = await listDirectory(source, path)
  const folders = result.folders || []
  const files = result.files || []
  const pinned = new Set(result.pinnedItems || [])
  const base = path.endsWith('/') ? path : `${path}/`

  const found = [...folders, ...files]
    .filter((entry) => pinned.has(entry.name))
    .map((entry) => ({ ...entry, source, path: `${base}${entry.name}`, pinned: true }))

  for (const folder of folders) {
    if (folder.name === '.trash') continue
    const childPath = `${base}${folder.name}`
    found.push(...(await walk(source, childPath)))
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
        const auth = useAuthStore()
        const sources = auth.hasHomeDrive ? SOURCES : ['share']
        const results = await Promise.allSettled(sources.map((source) => walk(source, '/')))
        const found = results.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value)
        const allFailed = results.every((r) => r.status === 'rejected')
        if (allFailed) {
          throw results[0].reason
        }
        // Ownership tracking stays share-only (see design spec's Non-Goals).
        const shareEntries = found.filter((entry) => entry.source === 'share')
        const records = shareEntries.length
          ? (await lookupOwnership(shareEntries.map((entry) => entry.path))) || {}
          : {}
        this.entries = found.map((entry) => {
          if (entry.source !== 'share') return entry
          const record = records[entry.path]
          return record
            ? { ...entry, uploadedByUid: record.uploadedByUid, uploadedByUsername: record.uploadedByUsername }
            : entry
        })
      } catch (err) {
        this.error = err
        throw err
      } finally {
        this.loading = false
      }
    },
  },
})
