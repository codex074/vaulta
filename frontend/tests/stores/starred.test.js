import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useStarredStore } from '../../src/stores/starred.js'
import * as resources from '../../src/api/resources.js'

vi.mock('../../src/api/resources.js', () => ({
  listDirectory: vi.fn(),
}))

describe('starred store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('loadStarred collects pinned entries from the root folder', async () => {
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
    expect(store.entries).toEqual([
      { name: 'a.txt', type: 'text/plain', size: 1, modified: '2026-09-07T00:00:00Z', path: '/a.txt' },
    ])
  })

  it('loadStarred recurses into subfolders and skips /.trash', async () => {
    resources.listDirectory.mockImplementation((path) => {
      if (path === '/') {
        return Promise.resolve({
          path: '/', source: 'share',
          folders: [{ name: 'Photos', type: 'directory', size: 4096, modified: '2026-09-07T00:00:00Z' }],
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
      { name: 'c.jpg', type: 'image/jpeg', size: 2, modified: '2026-09-07T00:00:00Z', path: '/Photos/c.jpg' },
    ])
    expect(resources.listDirectory).not.toHaveBeenCalledWith('/.trash')
  })

  it('loadStarred sets loading and error state correctly on failure', async () => {
    resources.listDirectory.mockRejectedValue(new Error('boom'))
    const store = useStarredStore()
    await expect(store.loadStarred()).rejects.toThrow('boom')
    expect(store.error).toBeInstanceOf(Error)
    expect(store.loading).toBe(false)
  })
})
