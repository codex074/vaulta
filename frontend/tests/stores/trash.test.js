import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTrashStore } from '../../src/stores/trash.js'
import { useAuthStore } from '../../src/stores/auth.js'
import * as trashApi from '../../src/api/trash.js'

vi.mock('../../src/api/trash.js', () => ({
  listTrash: vi.fn(),
  restoreFromTrash: vi.fn(),
  deleteForever: vi.fn(),
  emptyTrash: vi.fn(),
}))

describe('trash store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('loadTrash populates entries from listTrash', async () => {
    trashApi.listTrash.mockResolvedValue([{ name: 'a.jpg', trashPath: '/.trash/1__a.jpg' }])
    const store = useTrashStore()
    await store.loadTrash()
    expect(store.entries).toEqual([{ name: 'a.jpg', trashPath: '/.trash/1__a.jpg' }])
    expect(store.loading).toBe(false)
  })

  it('loadTrash sets and clears the error state on failure', async () => {
    trashApi.listTrash.mockRejectedValue(new Error('boom'))
    const store = useTrashStore()
    await expect(store.loadTrash()).rejects.toThrow('boom')
    expect(store.error).toBeInstanceOf(Error)
    expect(store.loading).toBe(false)
  })

  it('restore calls restoreFromTrash then reloads the trash list', async () => {
    trashApi.restoreFromTrash.mockResolvedValue(undefined)
    trashApi.listTrash.mockResolvedValue([])
    const store = useTrashStore()
    const item = { trashPath: '/.trash/1__a.jpg', originalPath: '/a.jpg' }
    await store.restore(item)
    expect(trashApi.restoreFromTrash).toHaveBeenCalledWith(item)
    expect(trashApi.listTrash).toHaveBeenCalledTimes(1)
  })

  it('deleteForeverItem calls deleteForever then reloads the trash list', async () => {
    trashApi.deleteForever.mockResolvedValue(undefined)
    trashApi.listTrash.mockResolvedValue([])
    const store = useTrashStore()
    const item = { trashPath: '/.trash/1__a.jpg', originalPath: '/a.jpg' }
    await store.deleteForeverItem(item)
    expect(trashApi.deleteForever).toHaveBeenCalledWith(item)
    expect(trashApi.listTrash).toHaveBeenCalledTimes(1)
  })

  it('emptyAll calls emptyTrash then reloads the trash list', async () => {
    trashApi.emptyTrash.mockResolvedValue(undefined)
    trashApi.listTrash.mockResolvedValue([])
    const store = useTrashStore()
    await store.emptyAll()
    expect(trashApi.emptyTrash).toHaveBeenCalledTimes(1)
    expect(trashApi.listTrash).toHaveBeenCalledTimes(1)
  })

  it('emptyAll passes a predicate that only allows items the current user may delete', async () => {
    let capturedPredicate
    trashApi.emptyTrash.mockImplementation(async (canDelete) => { capturedPredicate = canDelete })
    trashApi.listTrash.mockResolvedValue([])
    const store = useTrashStore()
    const auth = useAuthStore()
    auth.user = { uid: '3', permissions: { admin: false } }
    await store.emptyAll()
    expect(capturedPredicate({ uploadedByUid: '2' })).toBe(false)
    expect(capturedPredicate({ uploadedByUid: '3' })).toBe(true)
  })
})
