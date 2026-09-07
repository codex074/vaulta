import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  trashPathFor, metaPathFor, softDelete, listTrash, restoreFromTrash, deleteForever, emptyTrash,
} from '../../src/api/trash.js'
import * as resources from '../../src/api/resources.js'

vi.mock('../../src/api/resources.js', () => ({
  moveItem: vi.fn(),
  uploadFile: vi.fn(),
  getFileText: vi.fn(),
  deleteItem: vi.fn(),
  listDirectory: vi.fn(),
  makeDirectory: vi.fn(),
}))

describe('trash API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('trashPathFor prefixes the basename with a timestamp under /.trash', () => {
    expect(trashPathFor('/Photos/a.jpg', 1700000000000)).toBe('/.trash/1700000000000__a.jpg')
    expect(trashPathFor('/a.jpg', 1700000000000)).toBe('/.trash/1700000000000__a.jpg')
  })

  it('metaPathFor appends .trashmeta to a trash path', () => {
    expect(metaPathFor('/.trash/1__a.jpg')).toBe('/.trash/1__a.jpg.trashmeta')
  })

  it('softDelete moves the item into /.trash and uploads a sidecar', async () => {
    resources.makeDirectory.mockResolvedValue(undefined)
    resources.moveItem.mockResolvedValue(undefined)
    resources.uploadFile.mockResolvedValue(undefined)
    await softDelete('/Photos/a.jpg')
    expect(resources.moveItem).toHaveBeenCalledTimes(1)
    const [from, to] = resources.moveItem.mock.calls[0]
    expect(from).toBe('/Photos/a.jpg')
    expect(to).toMatch(/^\/\.trash\/\d+__a\.jpg$/)
    expect(resources.uploadFile).toHaveBeenCalledTimes(1)
    const [metaPath, blob] = resources.uploadFile.mock.calls[0]
    expect(metaPath).toBe(`${to}.trashmeta`)
    const text = await blob.text()
    const meta = JSON.parse(text)
    expect(meta.originalPath).toBe('/Photos/a.jpg')
    expect(typeof meta.deletedAt).toBe('number')
  })

  it('softDelete surfaces a clear error when the sidecar upload fails after a successful move', async () => {
    resources.makeDirectory.mockResolvedValue(undefined)
    resources.moveItem.mockResolvedValue(undefined)
    resources.uploadFile.mockRejectedValue(new Error('disk full'))
    await expect(softDelete('/a.jpg')).rejects.toThrow("Moved to trash, but couldn't save its restore info: disk full")
  })

  it('softDelete creates /.trash first, then moves the item', async () => {
    resources.makeDirectory.mockResolvedValue(undefined)
    resources.moveItem.mockResolvedValue(undefined)
    resources.uploadFile.mockResolvedValue(undefined)
    await softDelete('/a.jpg')
    expect(resources.makeDirectory).toHaveBeenCalledWith('/.trash')
    expect(resources.makeDirectory).toHaveBeenCalledTimes(1)
    expect(resources.moveItem).toHaveBeenCalledTimes(1)
  })

  it('softDelete treats a 409 from makeDirectory (already exists) as success', async () => {
    const conflict = Object.assign(new Error('already exists'), { status: 409 })
    resources.makeDirectory.mockRejectedValue(conflict)
    resources.moveItem.mockResolvedValue(undefined)
    resources.uploadFile.mockResolvedValue(undefined)
    await expect(softDelete('/a.jpg')).resolves.toBeUndefined()
    expect(resources.moveItem).toHaveBeenCalledTimes(1)
  })

  it('softDelete propagates a non-409 makeDirectory failure without attempting the move', async () => {
    const permissionError = Object.assign(new Error('permission denied'), { status: 403 })
    resources.makeDirectory.mockRejectedValue(permissionError)
    await expect(softDelete('/a.jpg')).rejects.toThrow('permission denied')
    expect(resources.moveItem).not.toHaveBeenCalled()
  })

  it('listTrash pairs each item with its parsed sidecar and skips .trashmeta files themselves', async () => {
    resources.listDirectory.mockResolvedValue({
      path: '/.trash', source: 'share',
      folders: [],
      files: [
        { name: '1__a.jpg', type: 'image/jpeg', size: 10, modified: '2026-09-07T00:00:00Z' },
        { name: '1__a.jpg.trashmeta', type: 'text/plain', size: 40, modified: '2026-09-07T00:00:00Z' },
      ],
    })
    resources.getFileText.mockResolvedValue('{"originalPath":"/Photos/a.jpg","deletedAt":1}')
    const items = await listTrash()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      name: '1__a.jpg',
      trashPath: '/.trash/1__a.jpg',
      originalPath: '/Photos/a.jpg',
      deletedAt: 1,
    })
  })

  it('listTrash leaves originalPath/deletedAt null when a sidecar is missing', async () => {
    resources.listDirectory.mockResolvedValue({
      path: '/.trash', source: 'share',
      folders: [],
      files: [{ name: '2__b.jpg', type: 'image/jpeg', size: 10, modified: '2026-09-07T00:00:00Z' }],
    })
    const items = await listTrash()
    expect(items[0].originalPath).toBeNull()
    expect(items[0].deletedAt).toBeNull()
  })

  it('restoreFromTrash moves the item back and deletes its sidecar', async () => {
    resources.moveItem.mockResolvedValue(undefined)
    resources.deleteItem.mockResolvedValue(undefined)
    await restoreFromTrash({ trashPath: '/.trash/1__a.jpg', originalPath: '/Photos/a.jpg' })
    expect(resources.moveItem).toHaveBeenCalledWith('/.trash/1__a.jpg', '/Photos/a.jpg')
    expect(resources.deleteItem).toHaveBeenCalledWith('/.trash/1__a.jpg.trashmeta')
  })

  it('restoreFromTrash refuses to restore an item with no known original path', async () => {
    await expect(restoreFromTrash({ trashPath: '/.trash/2__b.jpg', originalPath: null }))
      .rejects.toThrow('Missing restore information for this item.')
    expect(resources.moveItem).not.toHaveBeenCalled()
  })

  it('deleteForever deletes both the item and its sidecar', async () => {
    resources.deleteItem.mockResolvedValue(undefined)
    await deleteForever({ trashPath: '/.trash/1__a.jpg', originalPath: '/Photos/a.jpg' })
    expect(resources.deleteItem).toHaveBeenCalledWith('/.trash/1__a.jpg')
    expect(resources.deleteItem).toHaveBeenCalledWith('/.trash/1__a.jpg.trashmeta')
  })

  it('deleteForever skips the sidecar delete when there was no sidecar', async () => {
    resources.deleteItem.mockResolvedValue(undefined)
    await deleteForever({ trashPath: '/.trash/2__b.jpg', originalPath: null })
    expect(resources.deleteItem).toHaveBeenCalledTimes(1)
    expect(resources.deleteItem).toHaveBeenCalledWith('/.trash/2__b.jpg')
  })

  it('emptyTrash deletes every listed item and collects failures into one error', async () => {
    resources.listDirectory.mockResolvedValue({
      path: '/.trash', source: 'share',
      folders: [],
      files: [
        { name: '1__a.jpg', type: 'image/jpeg', size: 1, modified: '2026-09-07T00:00:00Z' },
        { name: '2__b.jpg', type: 'image/jpeg', size: 1, modified: '2026-09-07T00:00:00Z' },
      ],
    })
    resources.deleteItem.mockImplementation((path) =>
      path === '/.trash/2__b.jpg' ? Promise.reject(new Error('locked')) : Promise.resolve()
    )
    await expect(emptyTrash()).rejects.toThrow('/.trash/2__b.jpg')
  })
})
