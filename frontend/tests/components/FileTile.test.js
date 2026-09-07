import { describe, it, expect } from 'vitest'
import { formatSize, formatRelativeTime } from '../../src/components/fileFormat.js'

describe('file formatting helpers', () => {
  it('formats bytes into human sizes', () => {
    expect(formatSize(500)).toBe('500 B')
    expect(formatSize(2_400_000)).toBe('2.3 MB')
    expect(formatSize(4096)).toBe('4.0 KB')
  })

  it('formats a recent ISO timestamp as relative time', () => {
    const now = new Date('2026-09-06T12:00:00Z')
    expect(formatRelativeTime('2026-09-06T11:59:00Z', now)).toBe('1m ago')
    expect(formatRelativeTime('2026-09-04T12:00:00Z', now)).toBe('2d ago')
    expect(formatRelativeTime('2026-08-30T12:00:00Z', now)).toBe('1w ago')
  })
})
