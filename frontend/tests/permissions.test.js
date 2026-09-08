import { describe, it, expect } from 'vitest'
import { canDeleteEntry, fullPathFor, partitionDeletable } from '../src/permissions.js'

describe('canDeleteEntry', () => {
  it('allows the uploader to delete their own file', () => {
    const entry = { uploadedByUid: '2' }
    const user = { uid: '2', permissions: { admin: false } }
    expect(canDeleteEntry(entry, user)).toBe(true)
  })

  it('blocks a non-owner from deleting someone else\'s file', () => {
    const entry = { uploadedByUid: '2' }
    const user = { uid: '3', permissions: { admin: false } }
    expect(canDeleteEntry(entry, user)).toBe(false)
  })

  it('lets an admin delete any file regardless of owner', () => {
    const entry = { uploadedByUid: '2' }
    const user = { uid: '3', permissions: { admin: true } }
    expect(canDeleteEntry(entry, user)).toBe(true)
  })

  it('allows anyone to delete a file with no known owner', () => {
    const entry = { uploadedByUid: null }
    const user = { uid: '3', permissions: { admin: false } }
    expect(canDeleteEntry(entry, user)).toBe(true)
  })

  it('blocks deletion when there is no signed-in user', () => {
    const entry = { uploadedByUid: '2' }
    expect(canDeleteEntry(entry, null)).toBe(false)
  })
})

describe('fullPathFor', () => {
  it('uses an entry\'s own path when it already has one', () => {
    expect(fullPathFor({ name: 'a.jpg', path: '/Photos/a.jpg' }, '/somewhere/else')).toBe('/Photos/a.jpg')
  })

  it('joins the current directory onto a bare entry lacking a path (browse view)', () => {
    expect(fullPathFor({ name: 'a.jpg' }, '/Photos')).toBe('/Photos/a.jpg')
  })

  it('joins correctly at the root', () => {
    expect(fullPathFor({ name: 'a.jpg' }, '/')).toBe('/a.jpg')
  })
})

describe('partitionDeletable', () => {
  const admin = { uid: '9', permissions: { admin: true } }
  const owner = { uid: '2', permissions: { admin: false } }
  const stranger = { uid: '3', permissions: { admin: false } }

  it('splits browse-view entries (no .path) into allowed and blocked using the current directory', () => {
    const entries = [
      { name: 'mine.jpg', uploadedByUid: '3' },
      { name: 'yours.jpg', uploadedByUid: '2' },
    ]
    const selected = new Set(['share:/Photos/mine.jpg', 'share:/Photos/yours.jpg'])
    const { allowed, blocked } = partitionDeletable(entries, selected, stranger, '/Photos', 'share')
    expect(allowed.map((e) => e.path)).toEqual(['/Photos/mine.jpg'])
    expect(blocked.map((e) => e.path)).toEqual(['/Photos/yours.jpg'])
  })

  it('only considers entries that are actually selected', () => {
    const entries = [{ name: 'a.jpg', uploadedByUid: '3' }, { name: 'b.jpg', uploadedByUid: '3' }]
    const selected = new Set(['share:/Photos/a.jpg'])
    const { allowed, blocked } = partitionDeletable(entries, selected, stranger, '/Photos', 'share')
    expect(allowed).toHaveLength(1)
    expect(blocked).toHaveLength(0)
  })

  it('uses an entry\'s own .path when present (starred/trash views)', () => {
    const entries = [{ name: 'a.jpg', path: '/.trash/1__a.jpg', uploadedByUid: '2' }]
    const selected = new Set(['share:/.trash/1__a.jpg'])
    const { allowed } = partitionDeletable(entries, selected, owner, '/irrelevant', 'share')
    expect(allowed).toHaveLength(1)
  })

  it('lets an admin delete everything selected', () => {
    const entries = [{ name: 'a.jpg', uploadedByUid: '2' }, { name: 'b.jpg', uploadedByUid: '3' }]
    const selected = new Set(['share:/Photos/a.jpg', 'share:/Photos/b.jpg'])
    const { allowed, blocked } = partitionDeletable(entries, selected, admin, '/Photos', 'share')
    expect(allowed).toHaveLength(2)
    expect(blocked).toHaveLength(0)
  })

  it('resolves an entry\'s own source over the default, stamping it onto the returned item', () => {
    const entries = [{ name: 'a.jpg', path: '/a.jpg', source: 'home' }]
    const selected = new Set(['home:/a.jpg'])
    const { allowed } = partitionDeletable(entries, selected, owner, '/irrelevant', 'share')
    expect(allowed).toEqual([{ name: 'a.jpg', path: '/a.jpg', source: 'home' }])
  })

  it('does not confuse two entries with the same relative path on different drives', () => {
    const entries = [
      { name: 'a.jpg' },
      { name: 'a.jpg', source: 'home' },
    ]
    const selected = new Set(['home:/a.jpg'])
    const { allowed } = partitionDeletable(entries, selected, owner, '/', 'share')
    expect(allowed).toHaveLength(1)
    expect(allowed[0].source).toBe('home')
  })
})
