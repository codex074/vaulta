import { describe, it, expect, vi, beforeEach } from 'vitest'
import { dragPaths, beginDrag, selectionToDrag, isValidDropTarget, hasDragPayload, isWithin, moveInto } from '../../src/components/dragMove.js'

function fakeDataTransfer() {
  const store = {}
  return {
    effectAllowed: null,
    types: [],
    setData(type, value) {
      store[type] = value
      if (!this.types.includes(type)) this.types.push(type)
    },
    getData: (type) => store[type] ?? '',
  }
}

describe('selectionToDrag', () => {
  it('drags the whole selection when the dragged item is part of a multi-selection', () => {
    const selected = new Set(['/a.jpg', '/b.jpg'])
    expect(selectionToDrag('/a.jpg', selected).sort()).toEqual(['/a.jpg', '/b.jpg'])
  })

  it('drags only the single item when it is not part of the current selection', () => {
    const selected = new Set(['/other.jpg'])
    expect(selectionToDrag('/a.jpg', selected)).toEqual(['/a.jpg'])
  })

  it('drags only the single item when nothing else is selected alongside it', () => {
    const selected = new Set(['/a.jpg'])
    expect(selectionToDrag('/a.jpg', selected)).toEqual(['/a.jpg'])
  })
})

describe('beginDrag / dragPaths', () => {
  it('round-trips the dragged paths through a DataTransfer-like object', () => {
    const dt = fakeDataTransfer()
    beginDrag({ dataTransfer: dt }, ['/a.jpg', '/b.jpg'])
    expect(dt.effectAllowed).toBe('move')
    expect(dragPaths({ dataTransfer: dt })).toEqual(['/a.jpg', '/b.jpg'])
  })

  it('returns an empty array when there is no drag payload', () => {
    const dt = fakeDataTransfer()
    expect(dragPaths({ dataTransfer: dt })).toEqual([])
  })
})

describe('hasDragPayload', () => {
  it('is true once a drag has begun, before drop-time data is readable', () => {
    const dt = fakeDataTransfer()
    beginDrag({ dataTransfer: dt }, ['/a.jpg'])
    expect(hasDragPayload({ dataTransfer: dt })).toBe(true)
  })

  it('is false for a drag carrying no nas-webui payload (e.g. an OS file drag)', () => {
    const dt = fakeDataTransfer()
    dt.types = ['Files']
    expect(hasDragPayload({ dataTransfer: dt })).toBe(false)
  })
})

describe('isValidDropTarget', () => {
  it('rejects files as drop targets', () => {
    expect(isValidDropTarget('/Photos', false, ['/a.jpg'])).toBe(false)
  })

  it('rejects dropping an item onto itself', () => {
    expect(isValidDropTarget('/Photos', true, ['/Photos'])).toBe(false)
  })

  it('rejects dropping when the target is among the dragged items', () => {
    expect(isValidDropTarget('/Photos', true, ['/a.jpg', '/Photos'])).toBe(false)
  })

  it('accepts a directory that is not one of the dragged items', () => {
    expect(isValidDropTarget('/Archive', true, ['/a.jpg'])).toBe(true)
  })
})

describe('isWithin', () => {
  it('is true when the path equals the ancestor', () => {
    expect(isWithin('/dnd-test-dst', '/dnd-test-dst')).toBe(true)
  })

  it('is true when the path is nested under the ancestor', () => {
    expect(isWithin('/Photos/2026', '/Photos')).toBe(true)
  })

  it('is true for anything under the root, without a doubled slash', () => {
    expect(isWithin('/dnd-test-dst', '/')).toBe(true)
    expect(isWithin('/', '/')).toBe(true)
  })

  it('is false for a sibling that merely shares a name prefix', () => {
    expect(isWithin('/Photos2026', '/Photos')).toBe(false)
  })

  it('is false when the path is an ancestor of, not nested under, the target', () => {
    expect(isWithin('/Photos', '/Photos/2026')).toBe(false)
  })
})

describe('moveInto', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  it('moves each dragged path under the target directory', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200 })
    await moveInto(['/Photos/a.jpg', '/Photos/b.jpg'], '/Archive')
    expect(global.fetch).toHaveBeenCalledTimes(2)
    const bodies = global.fetch.mock.calls.map(([, opts]) => JSON.parse(opts.body))
    expect(bodies[0].items[0]).toMatchObject({ fromPath: '/Photos/a.jpg', toPath: '/Archive/a.jpg' })
    expect(bodies[1].items[0]).toMatchObject({ fromPath: '/Photos/b.jpg', toPath: '/Archive/b.jpg' })
  })

  it('moves into the root directory without a doubled slash', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200 })
    await moveInto(['/Photos/a.jpg'], '/')
    const [, opts] = global.fetch.mock.calls[0]
    expect(JSON.parse(opts.body).items[0].toPath).toBe('/a.jpg')
  })

  it('collects failures across items and throws a combined error, still attempting the rest', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: false, status: 409, statusText: 'Conflict', clone: () => ({ json: () => Promise.resolve({}) }) })
      .mockResolvedValueOnce({ ok: true, status: 200 })
    await expect(moveInto(['/a.jpg', '/b.jpg'], '/Archive')).rejects.toThrow('/a.jpg')
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })
})
