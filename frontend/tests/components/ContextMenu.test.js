import { describe, it, expect } from 'vitest'
import { siblingPath } from '../../src/components/pathHelpers.js'

describe('siblingPath', () => {
  it('joins a new name onto the parent of a nested path', () => {
    expect(siblingPath('/Photos/old.jpg', 'new.jpg')).toBe('/Photos/new.jpg')
  })
  it('joins a new name at the root', () => {
    expect(siblingPath('/old.jpg', 'new.jpg')).toBe('/new.jpg')
  })
})
