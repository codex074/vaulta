import { describe, it, expect } from 'vitest'
import { entryPath } from '../../src/components/pathHelpers.js'

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
