import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFilesStore } from '../../src/stores/files.js'
import * as resources from '../../src/api/resources.js'
import * as pinned from '../../src/api/pinned.js'
import * as trash from '../../src/api/trash.js'

vi.mock('../../src/api/resources.js', () => ({
  listDirectory: vi.fn(),
}))
vi.mock('../../src/api/pinned.js', () => ({
  togglePinned: vi.fn(),
}))
vi.mock('../../src/api/trash.js', () => ({
  softDelete: vi.fn(),
}))

describe('files store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('loadDirectory stores folders before files, both alphabetized', async () => {
    resources.listDirectory.mockResolvedValue({
      path: '/', source: 'share',
      folders: [{ name: 'Zeta', type: 'directory' }, { name: 'Alpha', type: 'directory' }],
      files: [{ name: 'b.txt', type: 'text/plain' }, { name: 'a.txt', type: 'text/plain' }],
    })
    const store = useFilesStore()
    await store.loadDirectory('/')
    expect(store.entries.map((e) => e.name)).toEqual(['Alpha', 'Zeta', 'a.txt', 'b.txt'])
    expect(store.currentPath).toBe('/')
  })

  it('defaults to grid view and toggles to list, persisting the choice', () => {
    const store = useFilesStore()
    expect(store.viewMode).toBe('grid')
    store.toggleViewMode()
    expect(store.viewMode).toBe('list')
    expect(localStorage.getItem('nas-view-mode')).toBe('list')
  })

  it('restores the persisted view mode on store creation', () => {
    localStorage.setItem('nas-view-mode', 'list')
    const store = useFilesStore()
    expect(store.viewMode).toBe('list')
  })

  it('toggleSelect adds and removes paths from the selection set', () => {
    const store = useFilesStore()
    store.toggleSelect('/a.jpg')
    expect(store.selected.has('/a.jpg')).toBe(true)
    store.toggleSelect('/a.jpg')
    expect(store.selected.has('/a.jpg')).toBe(false)
  })

  it('deleteSelected calls softDelete for each selected path and clears selection', async () => {
    trash.softDelete.mockResolvedValue(undefined)
    const store = useFilesStore()
    store.toggleSelect('/a.jpg')
    store.toggleSelect('/b.jpg')
    await store.deleteSelected()
    expect(trash.softDelete).toHaveBeenCalledWith('/a.jpg')
    expect(trash.softDelete).toHaveBeenCalledWith('/b.jpg')
    expect(store.selected.size).toBe(0)
  })

  it('deleteSelected throws listing the paths that failed, but still clears selection', async () => {
    trash.softDelete.mockImplementation((path) =>
      path === '/bad.jpg' ? Promise.reject(new Error('boom')) : Promise.resolve()
    )
    const store = useFilesStore()
    store.toggleSelect('/bad.jpg')
    await expect(store.deleteSelected()).rejects.toThrow('/bad.jpg')
    expect(store.selected.size).toBe(0)
  })

  it('loadDirectory captures pinnedItems from the response into pinnedNames', async () => {
    resources.listDirectory.mockResolvedValue({
      path: '/', source: 'share', folders: [], files: [{ name: 'a.txt', type: 'text/plain' }],
      pinnedItems: ['a.txt'],
    })
    const store = useFilesStore()
    await store.loadDirectory('/')
    expect(store.pinnedNames).toEqual(new Set(['a.txt']))
  })

  it('loadDirectory defaults pinnedNames to empty when the response omits pinnedItems', async () => {
    resources.listDirectory.mockResolvedValue({ path: '/', source: 'share', folders: [], files: [] })
    const store = useFilesStore()
    await store.loadDirectory('/')
    expect(store.pinnedNames).toEqual(new Set())
  })

  it('toggleStar pins an unpinned item and updates pinnedNames', async () => {
    pinned.togglePinned.mockResolvedValue(undefined)
    const store = useFilesStore()
    store.currentPath = '/'
    await store.toggleStar({ name: 'a.txt' })
    expect(pinned.togglePinned).toHaveBeenCalledWith({ name: 'a.txt', path: '/', source: 'share' }, 'add')
    expect(store.pinnedNames.has('a.txt')).toBe(true)
  })

  it('toggleStar unpins an already-pinned item', async () => {
    pinned.togglePinned.mockResolvedValue(undefined)
    const store = useFilesStore()
    store.currentPath = '/'
    store.pinnedNames = new Set(['a.txt'])
    await store.toggleStar({ name: 'a.txt' })
    expect(pinned.togglePinned).toHaveBeenCalledWith({ name: 'a.txt', path: '/', source: 'share' }, 'remove')
    expect(store.pinnedNames.has('a.txt')).toBe(false)
  })
})
