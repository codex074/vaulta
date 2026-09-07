import { defineStore } from 'pinia'
import { listDirectory, bulkDelete } from '../api/resources.js'

const VIEW_MODE_KEY = 'nas-view-mode'

export const useFilesStore = defineStore('files', {
  state: () => ({
    currentPath: '/',
    entries: [],
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
