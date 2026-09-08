import { defineStore } from 'pinia'
import { listTrash, restoreFromTrash, deleteForever, emptyTrash } from '../api/trash.js'
import { useAuthStore } from './auth.js'
import { canDeleteEntry } from '../permissions.js'

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
      const auth = useAuthStore()
      await emptyTrash((item) => canDeleteEntry(item, auth.user))
      await this.loadTrash()
    },
  },
})
