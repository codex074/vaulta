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
vi.mock('../../src/api/resources.js', () => ({
  SOURCES: ['home', 'share'],
}))

describe('trash store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('loadTrash populates entries from listTrash on the share source by default (no home drive)', async () => {
    trashApi.listTrash.mockResolvedValue([{ name: 'a.jpg', trashPath: '/.trash/1__a.jpg', source: 'share' }])
    const store = useTrashStore()
    await store.loadTrash()
    expect(trashApi.listTrash).toHaveBeenCalledTimes(1)
    expect(trashApi.listTrash).toHaveBeenCalledWith('share')
    expect(store.entries).toEqual([{ name: 'a.jpg', trashPath: '/.trash/1__a.jpg', source: 'share' }])
    expect(store.loading).toBe(false)
  })

  it('loadTrash aggregates entries from both drives when the user has a home drive', async () => {
    const auth = useAuthStore()
    auth.user = { uid: '2', scopes: [{ name: 'share', scope: '/' }, { name: 'home', scope: '/codex' }] }
    trashApi.listTrash.mockImplementation((source) =>
      Promise.resolve([{ name: `${source}.jpg`, trashPath: `/.trash/1__${source}.jpg`, source }])
    )
    const store = useTrashStore()
    await store.loadTrash()
    expect(trashApi.listTrash).toHaveBeenCalledWith('home')
    expect(trashApi.listTrash).toHaveBeenCalledWith('share')
    expect(store.entries.map((e) => e.source).sort()).toEqual(['home', 'share'])
  })

  it('loadTrash tolerates one drive failing without breaking the other (allSettled)', async () => {
    const auth = useAuthStore()
    auth.user = { uid: '2', scopes: [{ name: 'share', scope: '/' }, { name: 'home', scope: '/codex' }] }
    trashApi.listTrash.mockImplementation((source) =>
      source === 'home' ? Promise.reject(new Error('home unavailable')) : Promise.resolve([{ name: 'a.jpg', trashPath: '/.trash/1__a.jpg', source: 'share' }])
    )
    const store = useTrashStore()
    await store.loadTrash()
    expect(store.entries).toEqual([{ name: 'a.jpg', trashPath: '/.trash/1__a.jpg', source: 'share' }])
    expect(store.error).toBeNull()
  })

  it('loadTrash sets and clears the error state when every source fails', async () => {
    trashApi.listTrash.mockRejectedValue(new Error('boom'))
    const store = useTrashStore()
    await expect(store.loadTrash()).rejects.toThrow('boom')
    expect(store.error).toBeInstanceOf(Error)
    expect(store.loading).toBe(false)
  })

  it('restore calls restoreFromTrash with the item (carrying its own source) then reloads the trash list', async () => {
    trashApi.restoreFromTrash.mockResolvedValue(undefined)
    trashApi.listTrash.mockResolvedValue([])
    const store = useTrashStore()
    const item = { trashPath: '/.trash/1__a.jpg', originalPath: '/a.jpg', source: 'home' }
    await store.restore(item)
    expect(trashApi.restoreFromTrash).toHaveBeenCalledWith(item)
    expect(trashApi.listTrash).toHaveBeenCalledTimes(1)
  })

  it('deleteForeverItem calls deleteForever then reloads the trash list', async () => {
    trashApi.deleteForever.mockResolvedValue(undefined)
    trashApi.listTrash.mockResolvedValue([])
    const store = useTrashStore()
    const item = { trashPath: '/.trash/1__a.jpg', originalPath: '/a.jpg', source: 'share' }
    await store.deleteForeverItem(item)
    expect(trashApi.deleteForever).toHaveBeenCalledWith(item)
    expect(trashApi.listTrash).toHaveBeenCalledTimes(1)
  })

  it('emptyAll empties the share source only when there is no home drive', async () => {
    trashApi.emptyTrash.mockResolvedValue(undefined)
    trashApi.listTrash.mockResolvedValue([])
    const store = useTrashStore()
    await store.emptyAll()
    expect(trashApi.emptyTrash).toHaveBeenCalledTimes(1)
    expect(trashApi.emptyTrash.mock.calls[0][0]).toBe('share')
    expect(trashApi.listTrash).toHaveBeenCalledTimes(1)
  })

  it('emptyAll empties both drives when the user has a home drive', async () => {
    const auth = useAuthStore()
    auth.user = { uid: '2', scopes: [{ name: 'share', scope: '/' }, { name: 'home', scope: '/codex' }] }
    trashApi.emptyTrash.mockResolvedValue(undefined)
    trashApi.listTrash.mockResolvedValue([])
    const store = useTrashStore()
    await store.emptyAll()
    expect(trashApi.emptyTrash).toHaveBeenCalledTimes(2)
    const sourcesEmptied = trashApi.emptyTrash.mock.calls.map((c) => c[0]).sort()
    expect(sourcesEmptied).toEqual(['home', 'share'])
  })

  it('emptyAll passes a predicate that only allows items the current user may delete', async () => {
    let capturedPredicate
    trashApi.emptyTrash.mockImplementation(async (source, canDelete) => { capturedPredicate = canDelete })
    trashApi.listTrash.mockResolvedValue([])
    const store = useTrashStore()
    const auth = useAuthStore()
    auth.user = { uid: '3', permissions: { admin: false } }
    await store.emptyAll()
    expect(capturedPredicate({ uploadedByUid: '2' })).toBe(false)
    expect(capturedPredicate({ uploadedByUid: '3' })).toBe(true)
  })
})
