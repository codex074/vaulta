import { defineStore } from 'pinia'
import { listDirectory, bulkDelete } from '../api/resources.js'
import { togglePinned } from '../api/pinned.js'

const VIEW_MODE_KEY = 'nas-view-mode'

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
        this.entries = [...folders, ...files]
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
    async toggleStar(entry) {
      const isPinned = this.pinnedNames.has(entry.name)
      await togglePinned({ name: entry.name, path: this.currentPath, source: 'share' }, isPinned ? 'remove' : 'add')
      const next = new Set(this.pinnedNames)
      if (isPinned) next.delete(entry.name)
      else next.add(entry.name)
      this.pinnedNames = next
    },
    async deleteSelected() {
      const paths = Array.from(this.selected)
      const result = await bulkDelete(paths)
      await this.loadDirectory(this.currentPath)
      const failed = result && Array.isArray(result.failed) ? result.failed : []
      if (failed.length) {
        const names = failed.map((f) => (typeof f === 'string' ? f : f.path || JSON.stringify(f))).join(', ')
        throw new Error(`Could not delete: ${names}`)
      }
    },
  },
})
