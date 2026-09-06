import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  listDirectory, makeDirectory, deleteItem, bulkDelete,
  moveItem, renameItem, downloadUrl,
} from '../../src/api/resources.js'

describe('resources API', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  it('listDirectory calls GET with source=share and returns JSON', async () => {
    const body = { name: 'share', path: '/', source: 'share', folders: [], files: [] }
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(body) })
    const result = await listDirectory('/')
    expect(global.fetch.mock.calls[0][0]).toContain('/api/resources?path=%2F&source=share')
    expect(result).toEqual(body)
  })

  it('makeDirectory POSTs with isDir=true and does not split nested paths', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200 })
    await makeDirectory('/Photos/2026')
    expect(global.fetch).toHaveBeenCalledTimes(1)
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toContain('path=%2FPhotos%2F2026')
    expect(url).toContain('isDir=true')
    expect(opts.method).toBe('POST')
  })

  it('deleteItem calls DELETE with the item path', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200 })
    await deleteItem('/Photos/a.jpg')
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toContain('path=%2FPhotos%2Fa.jpg')
    expect(opts.method).toBe('DELETE')
  })

  it('bulkDelete posts an array of {source,path} to /api/resources/bulk', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ succeeded: [], failed: [] }) })
    await bulkDelete(['/a.jpg', '/b.jpg'])
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toContain('/api/resources/bulk')
    expect(opts.method).toBe('DELETE')
    const body = JSON.parse(opts.body)
    expect(body).toEqual([
      { source: 'share', path: '/a.jpg' },
      { source: 'share', path: '/b.jpg' },
    ])
  })

  it('moveItem PATCHes with a move action', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200 })
    await moveItem('/Photos/a.jpg', '/Archive/a.jpg')
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toContain('/api/resources')
    expect(opts.method).toBe('PATCH')
    const body = JSON.parse(opts.body)
    expect(body.action).toBe('move')
    expect(body.items[0]).toEqual({
      fromSource: 'share', fromPath: '/Photos/a.jpg', toSource: 'share', toPath: '/Archive/a.jpg',
    })
  })

  it('renameItem computes the sibling path from the parent directory', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200 })
    await renameItem('/Photos/old.jpg', 'new.jpg')
    const body = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(body.items[0].toPath).toBe('/Photos/new.jpg')
  })

  it('renameItem works for a top-level item', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200 })
    await renameItem('/old.jpg', 'new.jpg')
    const body = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(body.items[0].toPath).toBe('/new.jpg')
  })

  it('downloadUrl builds a plain GET link', () => {
    expect(downloadUrl('/Photos/a.jpg')).toBe('/api/resources/download?file=%2FPhotos%2Fa.jpg&source=share')
  })
})
