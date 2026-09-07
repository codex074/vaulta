import { defineStore } from 'pinia'
import { listTrash, restoreFromTrash, deleteForever, emptyTrash } from '../api/trash.js'

export const useTrashStore = defineStore('trash', {
  state: () => ({ entries: [], loading: false, error: null }),
  actions: {
    async loadTrash() {
      this.loading = true
      this.error = null
      try {
        this.entries = await listTrash()
      } catch (err) {
        this.error = err
        throw err
      } finally {
        this.loading = false
      }
    },
    async restore(item) {
      await restoreFromTrash(item)
      await this.loadTrash()
    },
    async deleteForeverItem(item) {
      await deleteForever(item)
      await this.loadTrash()
    },
    async emptyAll() {
      await emptyTrash()
      await this.loadTrash()
    },
  },
})
