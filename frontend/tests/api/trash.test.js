import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  trashPathFor, metaPathFor, softDelete, listTrash, restoreFromTrash, deleteForever, emptyTrash,
} from '../../src/api/trash.js'
import * as resources from '../../src/api/resources.js'
import * as ownership from '../../src/api/ownership.js'

vi.mock('../../src/api/resources.js', () => ({
  moveItem: vi.fn(),
  uploadFile: vi.fn(),
  getFileText: vi.fn(),
  deleteItem: vi.fn(),
  listDirectory: vi.fn(),
  makeDirectory: vi.fn(),
}))
vi.mock('../../src/api/ownership.js', () => ({
  lookupOwnership: vi.fn(),
  deleteOwnership: vi.fn(),
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

  it('softDelete moves the item into /.trash and uploads a sidecar, on the given source', async () => {
    resources.makeDirectory.mockResolvedValue(undefined)
    resources.moveItem.mockResolvedValue(undefined)
    resources.uploadFile.mockResolvedValue(undefined)
    await softDelete('share', '/Photos/a.jpg')
    expect(resources.makeDirectory).toHaveBeenCalledWith('share', '/.trash')
    expect(resources.moveItem).toHaveBeenCalledTimes(1)
    const [source, from, to] = resources.moveItem.mock.calls[0]
    expect(source).toBe('share')
    expect(from).toBe('/Photos/a.jpg')
    expect(to).toMatch(/^\/\.trash\/\d+__a\.jpg$/)
    expect(resources.uploadFile).toHaveBeenCalledTimes(1)
    const [uploadSource, metaPath, blob] = resources.uploadFile.mock.calls[0]
    expect(uploadSource).toBe('share')
    expect(metaPath).toBe(`${to}.trashmeta`)
    const text = await blob.text()
    const meta = JSON.parse(text)
    expect(meta.originalPath).toBe('/Photos/a.jpg')
    expect(typeof meta.deletedAt).toBe('number')
  })

  it('softDelete works against the home source', async () => {
    resources.makeDirectory.mockResolvedValue(undefined)
    resources.moveItem.mockResolvedValue(undefined)
    resources.uploadFile.mockResolvedValue(undefined)
    await softDelete('home', '/a.jpg')
    expect(resources.makeDirectory).toHaveBeenCalledWith('home', '/.trash')
    expect(resources.moveItem.mock.calls[0][0]).toBe('home')
    expect(resources.uploadFile.mock.calls[0][0]).toBe('home')
  })

  it('softDelete surfaces a clear error when the sidecar upload fails after a successful move', async () => {
    resources.makeDirectory.mockResolvedValue(undefined)
    resources.moveItem.mockResolvedValue(undefined)
    resources.uploadFile.mockRejectedValue(new Error('disk full'))
    await expect(softDelete('share', '/a.jpg')).rejects.toThrow("Moved to trash, but couldn't save its restore info: disk full")
  })

  it('softDelete creates /.trash first, then moves the item', async () => {
    resources.makeDirectory.mockResolvedValue(undefined)
    resources.moveItem.mockResolvedValue(undefined)
    resources.uploadFile.mockResolvedValue(undefined)
    await softDelete('share', '/a.jpg')
    expect(resources.makeDirectory).toHaveBeenCalledTimes(1)
    expect(resources.moveItem).toHaveBeenCalledTimes(1)
  })

  it('softDelete treats a 409 from makeDirectory (already exists) as success', async () => {
    const conflict = Object.assign(new Error('already exists'), { status: 409 })
    resources.makeDirectory.mockRejectedValue(conflict)
    resources.moveItem.mockResolvedValue(undefined)
    resources.uploadFile.mockResolvedValue(undefined)
    await expect(softDelete('share', '/a.jpg')).resolves.toBeUndefined()
    expect(resources.moveItem).toHaveBeenCalledTimes(1)
  })

  it('softDelete propagates a non-409 makeDirectory failure without attempting the move', async () => {
    const permissionError = Object.assign(new Error('permission denied'), { status: 403 })
    resources.makeDirectory.mockRejectedValue(permissionError)
    await expect(softDelete('share', '/a.jpg')).rejects.toThrow('permission denied')
    expect(resources.moveItem).not.toHaveBeenCalled()
  })

  it('listTrash pairs each item with its parsed sidecar, skips .trashmeta files, and stamps the source', async () => {
    resources.listDirectory.mockResolvedValue({
      path: '/.trash', source: 'share',
      folders: [],
      files: [
        { name: '1__a.jpg', type: 'image/jpeg', size: 10, modified: '2026-09-07T00:00:00Z' },
        { name: '1__a.jpg.trashmeta', type: 'text/plain', size: 40, modified: '2026-09-07T00:00:00Z' },
      ],
    })
    resources.getFileText.mockResolvedValue('{"originalPath":"/Photos/a.jpg","deletedAt":1}')
    const items = await listTrash('share')
    expect(resources.listDirectory).toHaveBeenCalledWith('share', '/.trash')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      name: '1__a.jpg',
      displayName: 'a.jpg',
      source: 'share',
      trashPath: '/.trash/1__a.jpg',
      originalPath: '/Photos/a.jpg',
      deletedAt: 1,
      hasMeta: true,
    })
  })

  it('listTrash lists the home source and stamps items with it', async () => {
    resources.listDirectory.mockResolvedValue({
      path: '/.trash', source: 'home',
      folders: [],
      files: [{ name: '2__b.jpg', type: 'image/jpeg', size: 10, modified: '2026-09-07T00:00:00Z' }],
    })
    const items = await listTrash('home')
    expect(resources.listDirectory).toHaveBeenCalledWith('home', '/.trash')
    expect(items[0].source).toBe('home')
  })

  it('listTrash degrades a 404 (no .trash folder yet) to an empty list', async () => {
    resources.listDirectory.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }))
    await expect(listTrash('home')).resolves.toEqual([])
  })

  it('listTrash propagates a non-404 failure', async () => {
    resources.listDirectory.mockRejectedValue(Object.assign(new Error('server error'), { status: 500 }))
    await expect(listTrash('share')).rejects.toThrow('server error')
  })

  it('listTrash keeps hasMeta true when the sidecar exists but its JSON is unparseable', async () => {
    resources.listDirectory.mockResolvedValue({
      path: '/.trash', source: 'share',
      folders: [],
      files: [
        { name: '3__c.jpg', type: 'image/jpeg', size: 10, modified: '2026-09-07T00:00:00Z' },
        { name: '3__c.jpg.trashmeta', type: 'text/plain', size: 4, modified: '2026-09-07T00:00:00Z' },
      ],
    })
    resources.getFileText.mockResolvedValue('not json at all')
    const items = await listTrash('share')
    expect(items).toHaveLength(1)
    expect(items[0].hasMeta).toBe(true)
    expect(items[0].originalPath).toBeNull()
    expect(items[0].deletedAt).toBeNull()
  })

  it('listTrash enriches share items with ownership metadata for their trash path', async () => {
    resources.listDirectory.mockResolvedValue({
      path: '/.trash', source: 'share',
      folders: [],
      files: [{ name: '1__a.jpg', type: 'image/jpeg', size: 10, modified: '2026-09-07T00:00:00Z' }],
    })
    ownership.lookupOwnership.mockResolvedValue({
      '/.trash/1__a.jpg': { uploadedByUid: '2', uploadedByUsername: 'jay' },
    })
    const items = await listTrash('share')
    expect(ownership.lookupOwnership).toHaveBeenCalledWith(['/.trash/1__a.jpg'])
    expect(items[0].uploadedByUid).toBe('2')
    expect(items[0].uploadedByUsername).toBe('jay')
  })

  it('listTrash skips the ownership lookup entirely for the home source', async () => {
    resources.listDirectory.mockResolvedValue({
      path: '/.trash', source: 'home',
      folders: [],
      files: [{ name: '1__a.jpg', type: 'image/jpeg', size: 10, modified: '2026-09-07T00:00:00Z' }],
    })
    const items = await listTrash('home')
    expect(ownership.lookupOwnership).not.toHaveBeenCalled()
    expect(items[0].uploadedByUid).toBeUndefined()
  })

  it('listTrash leaves originalPath/deletedAt null when a sidecar is missing', async () => {
    resources.listDirectory.mockResolvedValue({
      path: '/.trash', source: 'share',
      folders: [],
      files: [{ name: '2__b.jpg', type: 'image/jpeg', size: 10, modified: '2026-09-07T00:00:00Z' }],
    })
    const items = await listTrash('share')
    expect(items[0].originalPath).toBeNull()
    expect(items[0].deletedAt).toBeNull()
    expect(items[0].hasMeta).toBe(false)
  })

  it('restoreFromTrash uses the item\'s own source to move it back and delete its sidecar', async () => {
    resources.moveItem.mockResolvedValue(undefined)
    resources.deleteItem.mockResolvedValue(undefined)
    await restoreFromTrash({ source: 'home', trashPath: '/.trash/1__a.jpg', originalPath: '/Photos/a.jpg', hasMeta: true })
    expect(resources.moveItem).toHaveBeenCalledWith('home', '/.trash/1__a.jpg', '/Photos/a.jpg')
    expect(resources.deleteItem).toHaveBeenCalledWith('home', '/.trash/1__a.jpg.trashmeta')
  })

  it('restoreFromTrash refuses to restore an item with no known original path', async () => {
    await expect(restoreFromTrash({ source: 'share', trashPath: '/.trash/2__b.jpg', originalPath: null }))
      .rejects.toThrow('Missing restore information for this item.')
    expect(resources.moveItem).not.toHaveBeenCalled()
  })

  it('deleteForever deletes both the item and its sidecar on the item\'s own source', async () => {
    resources.deleteItem.mockResolvedValue(undefined)
    await deleteForever({ source: 'home', trashPath: '/.trash/1__a.jpg', originalPath: '/Photos/a.jpg', hasMeta: true })
    expect(resources.deleteItem).toHaveBeenCalledWith('home', '/.trash/1__a.jpg')
    expect(resources.deleteItem).toHaveBeenCalledWith('home', '/.trash/1__a.jpg.trashmeta')
  })

  it('deleteForever cleans up the ownership record for a share trash path', async () => {
    resources.deleteItem.mockResolvedValue(undefined)
    ownership.deleteOwnership.mockResolvedValue(undefined)
    await deleteForever({ source: 'share', trashPath: '/.trash/1__a.jpg', originalPath: '/Photos/a.jpg', hasMeta: true })
    expect(ownership.deleteOwnership).toHaveBeenCalledWith('/.trash/1__a.jpg')
  })

  it('deleteForever skips the ownership call entirely for a home trash path', async () => {
    resources.deleteItem.mockResolvedValue(undefined)
    await deleteForever({ source: 'home', trashPath: '/.trash/1__a.jpg', originalPath: '/Photos/a.jpg', hasMeta: true })
    expect(ownership.deleteOwnership).not.toHaveBeenCalled()
  })

  it('deleteForever skips the sidecar delete when there was no sidecar', async () => {
    resources.deleteItem.mockResolvedValue(undefined)
    await deleteForever({ source: 'share', trashPath: '/.trash/2__b.jpg', originalPath: null, hasMeta: false })
    expect(resources.deleteItem).toHaveBeenCalledTimes(1)
    expect(resources.deleteItem).toHaveBeenCalledWith('share', '/.trash/2__b.jpg')
  })

  it('deleteForever still removes a present-but-corrupt sidecar (hasMeta true, originalPath null)', async () => {
    resources.deleteItem.mockResolvedValue(undefined)
    await deleteForever({ source: 'share', trashPath: '/.trash/3__c.jpg', originalPath: null, hasMeta: true })
    expect(resources.deleteItem).toHaveBeenCalledTimes(2)
    expect(resources.deleteItem).toHaveBeenCalledWith('share', '/.trash/3__c.jpg')
    expect(resources.deleteItem).toHaveBeenCalledWith('share', '/.trash/3__c.jpg.trashmeta')
  })

  it('emptyTrash deletes every listed item on the given source and collects failures into one error', async () => {
    resources.listDirectory.mockResolvedValue({
      path: '/.trash', source: 'share',
      folders: [],
      files: [
        { name: '1__a.jpg', type: 'image/jpeg', size: 1, modified: '2026-09-07T00:00:00Z' },
        { name: '2__b.jpg', type: 'image/jpeg', size: 1, modified: '2026-09-07T00:00:00Z' },
      ],
    })
    resources.deleteItem.mockImplementation((source, path) =>
      path === '/.trash/2__b.jpg' ? Promise.reject(new Error('locked')) : Promise.resolve()
    )
    await expect(emptyTrash('share')).rejects.toThrow('/.trash/2__b.jpg')
  })

  it('emptyTrash skips items an optional predicate disallows, leaving them in trash', async () => {
    resources.listDirectory.mockResolvedValue({
      path: '/.trash', source: 'share',
      folders: [],
      files: [
        { name: '1__a.jpg', type: 'image/jpeg', size: 1, modified: '2026-09-07T00:00:00Z' },
        { name: '2__b.jpg', type: 'image/jpeg', size: 1, modified: '2026-09-07T00:00:00Z' },
      ],
    })
    resources.deleteItem.mockResolvedValue(undefined)
    await emptyTrash('share', (item) => item.name !== '2__b.jpg')
    expect(resources.deleteItem).toHaveBeenCalledWith('share', '/.trash/1__a.jpg')
    expect(resources.deleteItem).not.toHaveBeenCalledWith('share', '/.trash/2__b.jpg')
  })

  it('emptyTrash also sweeps an orphaned .trashmeta whose item is already gone', async () => {
    resources.listDirectory.mockResolvedValue({
      path: '/.trash', source: 'share',
      folders: [],
      files: [
        { name: '1__a.jpg', type: 'image/jpeg', size: 1, modified: '2026-09-07T00:00:00Z' },
        { name: '1__a.jpg.trashmeta', type: 'text/plain', size: 40, modified: '2026-09-07T00:00:00Z' },
        { name: '9__gone.jpg.trashmeta', type: 'text/plain', size: 40, modified: '2026-09-07T00:00:00Z' },
      ],
    })
    resources.getFileText.mockResolvedValue('{"originalPath":"/Photos/a.jpg","deletedAt":1}')
    resources.deleteItem.mockResolvedValue(undefined)
    await expect(emptyTrash('share')).resolves.toBeUndefined()
    expect(resources.deleteItem).toHaveBeenCalledTimes(3)
    expect(resources.deleteItem).toHaveBeenCalledWith('share', '/.trash/1__a.jpg')
    expect(resources.deleteItem).toHaveBeenCalledWith('share', '/.trash/1__a.jpg.trashmeta')
    expect(resources.deleteItem).toHaveBeenCalledWith('share', '/.trash/9__gone.jpg.trashmeta')
  })

  it('emptyTrash works against the home source', async () => {
    resources.listDirectory.mockResolvedValue({
      path: '/.trash', source: 'home',
      folders: [],
      files: [{ name: '1__a.jpg', type: 'image/jpeg', size: 1, modified: '2026-09-07T00:00:00Z' }],
    })
    resources.deleteItem.mockResolvedValue(undefined)
    await emptyTrash('home')
    expect(resources.listDirectory).toHaveBeenCalledWith('home', '/.trash')
    expect(resources.deleteItem).toHaveBeenCalledWith('home', '/.trash/1__a.jpg')
  })
})
