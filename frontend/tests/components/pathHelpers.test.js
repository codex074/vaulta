import { describe, it, expect } from 'vitest'
import { entryPath, selectionKey, parseSelectionKey } from '../../src/components/pathHelpers.js'

describe('entryPath', () => {
  it("uses the entry's own path when it already carries one", () => {
    expect(entryPath({ name: 'c.jpg', path: '/Photos/c.jpg' }, '/wherever')).toBe('/Photos/c.jpg')
  })
  it('builds a path under the current directory when the entry has none', () => {
    expect(entryPath({ name: 'a.jpg' }, '/Photos')).toBe('/Photos/a.jpg')
  })
  it('does not double the slash when the current directory is root', () => {
    expect(entryPath({ name: 'a.jpg' }, '/')).toBe('/a.jpg')
  })
})

describe('selectionKey', () => {
  it('formats as source:path using the default source when the entry carries none', () => {
    expect(selectionKey({ name: 'a.jpg' }, '/Photos', 'share')).toBe('share:/Photos/a.jpg')
  })

  it('uses the entry\'s own source when it has one, ignoring the default', () => {
    expect(selectionKey({ name: 'a.jpg', source: 'home' }, '/Photos', 'share')).toBe('home:/Photos/a.jpg')
  })

  it('uses the entry\'s own path when it already carries one (starred/trash views)', () => {
    expect(selectionKey({ name: 'a.jpg', path: '/Docs/a.jpg', source: 'home' }, '/irrelevant', 'share')).toBe('home:/Docs/a.jpg')
  })

  it('produces distinct keys for the same relative path on two different drives', () => {
    const shareKey = selectionKey({ name: 'a.jpg' }, '/Photos', 'share')
    const homeKey = selectionKey({ name: 'a.jpg', source: 'home' }, '/Photos', 'share')
    expect(shareKey).not.toBe(homeKey)
  })
})

describe('parseSelectionKey', () => {
  it('splits a key back into its source and path', () => {
    expect(parseSelectionKey('share:/Photos/a.jpg')).toEqual({ source: 'share', path: '/Photos/a.jpg' })
  })

  it('does not truncate a path that itself contains a colon', () => {
    expect(parseSelectionKey('home:/Notes/10:30.txt')).toEqual({ source: 'home', path: '/Notes/10:30.txt' })
  })

  it('round-trips through selectionKey', () => {
    const key = selectionKey({ name: 'a.jpg', source: 'home' }, '/Photos', 'share')
    expect(parseSelectionKey(key)).toEqual({ source: 'home', path: '/Photos/a.jpg' })
  })
})
