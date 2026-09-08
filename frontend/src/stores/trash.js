import { defineStore } from 'pinia'
import { listTrash, restoreFromTrash, deleteForever, emptyTrash } from '../api/trash.js'
import { SOURCES } from '../api/resources.js'
import { useAuthStore } from './auth.js'
import { canDeleteEntry } from '../permissions.js'

function reachableSources() {
  const auth = useAuthStore()
  return auth.hasHomeDrive ? SOURCES : ['share']
}

export const useTrashStore = defineStore('trash', {
  state: () => ({ entries: [], loading: false, error: null }),
  actions: {
    async loadTrash() {
      this.loading = true
      this.error = null
      try {
        const results = await Promise.allSettled(reachableSources().map((source) => listTrash(source)))
        const allFailed = results.every((r) => r.status === 'rejected')
        if (allFailed) {
          throw results[0].reason
        }
        this.entries = results.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value)
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
      const canDelete = (item) => canDeleteEntry(item, auth.user)
      const failed = []
      for (const source of reachableSources()) {
        try {
          await emptyTrash(source, canDelete)
        } catch (err) {
          failed.push(err)
        }
      }
      await this.loadTrash()
      if (failed.length) throw failed[0]
    },
  },
})
