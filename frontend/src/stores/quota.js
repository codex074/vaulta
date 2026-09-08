import { defineStore } from 'pinia'
import { getMyQuota } from '../api/quota.js'

export const useQuotaStore = defineStore('quota', {
  state: () => ({
    hasDrive: false,
    unlimited: false,
    limitBytes: 0,
    usedBytes: 0,
    loaded: false,
  }),
  actions: {
    async refresh() {
      const quota = await getMyQuota()
      this.hasDrive = quota.hasDrive
      this.unlimited = quota.unlimited
      this.limitBytes = quota.limitBytes
      this.usedBytes = quota.usedBytes
      this.loaded = true
    },
  },
})
