import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useStarredStore } from '../../src/stores/starred.js'
import { useAuthStore } from '../../src/stores/auth.js'
import * as resources from '../../src/api/resources.js'
import * as ownership from '../../src/api/ownership.js'

vi.mock('../../src/api/resources.js', () => ({
  listDirectory: vi.fn(),
  SOURCES: ['home', 'share'],
}))
vi.mock('../../src/api/ownership.js', () => ({
  lookupOwnership: vi.fn(),
}))

describe('starred store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('loadStarred collects pinned entries from the root folder of the share source when the user has no home drive', async () => {
    resources.listDirectory.mockResolvedValue({
      path: '/', source: 'share',
      folders: [],
      files: [
        { name: 'a.txt', type: 'text/plain', size: 1, modified: '2026-09-07T00:00:00Z' },
        { name: 'b.txt', type: 'text/plain', size: 1, modified: '2026-09-07T00:00:00Z' },
      ],
      pinnedItems: ['a.txt'],
    })
    const store = useStarredStore()
    await store.loadStarred()
    expect(resources.listDirectory).toHaveBeenCalledTimes(1)
    expect(resources.listDirectory).toHaveBeenCalledWith('share', '/')
    expect(store.entries).toEqual([
      { name: 'a.txt', type: 'text/plain', size: 1, modified: '2026-09-07T00:00:00Z', source: 'share', path: '/a.txt', pinned: true },
    ])
  })

  it('loadStarred recurses into subfolders and skips /.trash', async () => {
    resources.listDirectory.mockImplementation((source, path) => {
      if (source !== 'share') return Promise.resolve({ path, source, folders: [], files: [], pinnedItems: [] })
      if (path === '/') {
        return Promise.resolve({
          path: '/', source: 'share',
          folders: [
            { name: 'Photos', type: 'directory', size: 4096, modified: '2026-09-07T00:00:00Z' },
            { name: '.trash', type: 'directory', size: 4096, modified: '2026-09-07T00:00:00Z' },
          ],
          files: [],
          pinnedItems: [],
        })
      }
      if (path === '/Photos') {
        return Promise.resolve({
          path: '/Photos', source: 'share',
          folders: [],
          files: [{ name: 'c.jpg', type: 'image/jpeg', size: 2, modified: '2026-09-07T00:00:00Z' }],
          pinnedItems: ['c.jpg'],
        })
      }
      throw new Error(`unexpected path ${path}`)
    })
    const store = useStarredStore()
    await store.loadStarred()
    expect(store.entries).toEqual([
      { name: 'c.jpg', type: 'image/jpeg', size: 2, modified: '2026-09-07T00:00:00Z', source: 'share', path: '/Photos/c.jpg', pinned: true },
    ])
    expect(resources.listDirectory).not.toHaveBeenCalledWith('share', '/.trash')
  })

  it('loadStarred enriches share entries with ownership metadata keyed by their path', async () => {
    resources.listDirectory.mockResolvedValue({
      path: '/', source: 'share',
      folders: [],
      files: [{ name: 'a.txt', type: 'text/plain', size: 1, modified: '2026-09-07T00:00:00Z' }],
      pinnedItems: ['a.txt'],
    })
    ownership.lookupOwnership.mockResolvedValue({
      '/a.txt': { uploadedByUid: '2', uploadedByUsername: 'jay' },
    })
    const store = useStarredStore()
    await store.loadStarred()
    expect(ownership.lookupOwnership).toHaveBeenCalledWith(['/a.txt'])
    expect(store.entries[0].uploadedByUid).toBe('2')
    expect(store.entries[0].uploadedByUsername).toBe('jay')
  })

  it('loadStarred sets loading and error state correctly on failure', async () => {
    resources.listDirectory.mockRejectedValue(new Error('boom'))
    const store = useStarredStore()
    await expect(store.loadStarred()).rejects.toThrow('boom')
    expect(store.error).toBeInstanceOf(Error)
    expect(store.loading).toBe(false)
  })

  it('loadStarred walks both drives when the user has a home drive, tagging each result with its source', async () => {
    const auth = useAuthStore()
    auth.user = { uid: '2', scopes: [{ name: 'share', scope: '/' }, { name: 'home', scope: '/codex' }] }
    resources.listDirectory.mockImplementation((source, path) => {
      if (path !== '/') return Promise.resolve({ path, source, folders: [], files: [], pinnedItems: [] })
      if (source === 'share') {
        return Promise.resolve({
          path: '/', source: 'share', folders: [], pinnedItems: ['s.txt'],
          files: [{ name: 's.txt', type: 'text/plain', size: 1, modified: '2026-09-07T00:00:00Z' }],
        })
      }
      return Promise.resolve({
        path: '/', source: 'home', folders: [], pinnedItems: ['h.txt'],
        files: [{ name: 'h.txt', type: 'text/plain', size: 1, modified: '2026-09-07T00:00:00Z' }],
      })
    })
    const store = useStarredStore()
    await store.loadStarred()
    const sources = store.entries.map((e) => e.source).sort()
    expect(sources).toEqual(['home', 'share'])
    expect(resources.listDirectory).toHaveBeenCalledWith('home', '/')
    expect(resources.listDirectory).toHaveBeenCalledWith('share', '/')
  })

  it('loadStarred skips the ownership lookup for home entries', async () => {
    const auth = useAuthStore()
    auth.user = { uid: '2', scopes: [{ name: 'share', scope: '/' }, { name: 'home', scope: '/codex' }] }
    resources.listDirectory.mockImplementation((source, path) => {
      if (path !== '/') return Promise.resolve({ path, source, folders: [], files: [], pinnedItems: [] })
      return Promise.resolve({
        path: '/', source, folders: [], pinnedItems: ['h.txt'],
        files: [{ name: 'h.txt', type: 'text/plain', size: 1, modified: '2026-09-07T00:00:00Z' }],
      })
    })
    ownership.lookupOwnership.mockResolvedValue({})
    const store = useStarredStore()
    await store.loadStarred()
    expect(ownership.lookupOwnership).toHaveBeenCalledTimes(1)
    const [paths] = ownership.lookupOwnership.mock.calls[0]
    expect(paths).toEqual(['/h.txt'])
  })

  it('loadStarred tolerates one drive failing without breaking the other (allSettled)', async () => {
    const auth = useAuthStore()
    auth.user = { uid: '2', scopes: [{ name: 'share', scope: '/' }, { name: 'home', scope: '/codex' }] }
    resources.listDirectory.mockImplementation((source, path) => {
      if (source === 'home') return Promise.reject(new Error('home unavailable'))
      if (path !== '/') return Promise.resolve({ path, source, folders: [], files: [], pinnedItems: [] })
      return Promise.resolve({
        path: '/', source: 'share', folders: [], pinnedItems: ['s.txt'],
        files: [{ name: 's.txt', type: 'text/plain', size: 1, modified: '2026-09-07T00:00:00Z' }],
      })
    })
    const store = useStarredStore()
    await store.loadStarred()
    expect(store.entries).toHaveLength(1)
    expect(store.entries[0].source).toBe('share')
    expect(store.error).toBeNull()
  })
})
