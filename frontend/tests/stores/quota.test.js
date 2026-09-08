import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useQuotaStore } from '../../src/stores/quota.js'
import * as quotaApi from '../../src/api/quota.js'

vi.mock('../../src/api/quota.js', () => ({
  getMyQuota: vi.fn(),
}))

describe('quota store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('starts unloaded with zeroed-out state', () => {
    const store = useQuotaStore()
    expect(store.loaded).toBe(false)
    expect(store.hasDrive).toBe(false)
    expect(store.unlimited).toBe(false)
    expect(store.limitBytes).toBe(0)
    expect(store.usedBytes).toBe(0)
  })

  it('refresh populates state from getMyQuota and marks it loaded', async () => {
    quotaApi.getMyQuota.mockResolvedValue({ hasDrive: true, unlimited: false, limitBytes: 5000, usedBytes: 1200 })
    const store = useQuotaStore()
    await store.refresh()
    expect(store.hasDrive).toBe(true)
    expect(store.unlimited).toBe(false)
    expect(store.limitBytes).toBe(5000)
    expect(store.usedBytes).toBe(1200)
    expect(store.loaded).toBe(true)
  })

  it('refresh reflects an admin\'s unlimited quota', async () => {
    quotaApi.getMyQuota.mockResolvedValue({ hasDrive: true, unlimited: true, limitBytes: 0, usedBytes: 42 })
    const store = useQuotaStore()
    await store.refresh()
    expect(store.unlimited).toBe(true)
    expect(store.usedBytes).toBe(42)
  })

  it('refresh reflects a user with no home drive at all', async () => {
    quotaApi.getMyQuota.mockResolvedValue({ hasDrive: false, unlimited: false, limitBytes: 0, usedBytes: 0 })
    const store = useQuotaStore()
    await store.refresh()
    expect(store.hasDrive).toBe(false)
    expect(store.loaded).toBe(true)
  })
})
