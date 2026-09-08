import { defineStore } from 'pinia'
import { listDirectory } from '../api/resources.js'
import { togglePinned } from '../api/pinned.js'
import { softDelete } from '../api/trash.js'
import { lookupOwnership } from '../api/ownership.js'
import { useStarredStore } from './starred.js'

const VIEW_MODE_KEY = 'nas-view-mode'

function parentOf(path) {
  const idx = path.lastIndexOf('/')
  return idx <= 0 ? '/' : path.slice(0, idx)
}

function joinPath(dir, name) {
  const base = dir.endsWith('/') ? dir : `${dir}/`
  return `${base}${name}`
}

export const useFilesStore = defineStore('files', {
  state: () => ({
    currentPath: '/',
    entries: [],
    pinnedNames: new Set(),
    viewMode: localStorage.getItem(VIEW_MODE_KEY) === 'list' ? 'list' : 'grid',
    selected: new Set(),
    loading: false,
    error: null,
  }),
  actions: {
    async loadDirectory(path) {
      this.loading = true
      this.error = null
      try {
        const result = await listDirectory(path)
        const folders = [...(result.folders || [])].sort((a, b) => a.name.localeCompare(b.name))
        const files = [...(result.files || [])].sort((a, b) => a.name.localeCompare(b.name))
        const entries = [...folders, ...files]
        const records = (await lookupOwnership(entries.map((entry) => entry.path || joinPath(path, entry.name)))) || {}
        this.entries = entries.map((entry) => {
          const record = records[entry.path || joinPath(path, entry.name)]
          return record
            ? { ...entry, uploadedByUid: record.uploadedByUid, uploadedByUsername: record.uploadedByUsername }
            : entry
        })
        this.currentPath = path
        this.selected = new Set()
        this.pinnedNames = new Set(result.pinnedItems || [])
      } catch (err) {
        this.error = err
        throw err
      } finally {
        this.loading = false
      }
    },
    toggleViewMode() {
      this.viewMode = this.viewMode === 'grid' ? 'list' : 'grid'
      localStorage.setItem(VIEW_MODE_KEY, this.viewMode)
    },
    toggleSelect(path) {
      const next = new Set(this.selected)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      this.selected = next
    },
    clearSelection() {
      this.selected = new Set()
    },
    selectAllPaths(paths) {
      this.selected = new Set(paths)
    },
    async toggleStar(entry) {
      const parentPath = entry.path ? parentOf(entry.path) : this.currentPath
      const isPinned = entry.pinned ?? this.pinnedNames.has(entry.name)
      await togglePinned({ name: entry.name, path: parentPath, source: 'share' }, isPinned ? 'remove' : 'add')
      if (!entry.path) {
        const next = new Set(this.pinnedNames)
        if (isPinned) next.delete(entry.name)
        else next.add(entry.name)
        this.pinnedNames = next
      } else if (isPinned) {
        const starred = useStarredStore()
        starred.entries = starred.entries.filter((e) => e.path !== entry.path)
      }
    },
    async deleteSelected(paths = Array.from(this.selected)) {
      const failed = []
      for (const path of paths) {
        try {
          await softDelete(path)
        } catch (err) {
          failed.push({ path, message: err.message })
        }
      }
      this.selected = new Set()
      if (failed.length) {
        const names = failed.map((f) => f.path).join(', ')
        throw new Error(`Could not delete: ${names}`)
      }
    },
  },
})
