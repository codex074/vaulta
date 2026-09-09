import { describe, it, expect } from 'vitest'
import {
  EXPIRY_OPTIONS, buildCreateBody, guestUrlFor, parseGuestHash, formatExpiry,
  shareDisplayName, driveLabelFor,
} from '../../src/components/shareLinks.js'

describe('buildCreateBody', () => {
  it('turns a preset into FBQ days and omits an empty password', () => {
    expect(buildCreateBody({ source: 'share', path: '/Docs', expiry: '7d' }))
      .toEqual({ source: 'share', path: '/Docs', expires: '7', unit: 'days' })
  })
  it('omits expires for never and includes a password when given', () => {
    expect(buildCreateBody({ source: 'home', path: '/a.pdf', expiry: 'never', password: 'pw' }))
      .toEqual({ source: 'home', path: '/a.pdf', unit: 'days', password: 'pw' })
  })
  it('defaults to 7 days', () => {
    expect(buildCreateBody({ source: 'share', path: '/x' }).expires).toBe('7')
  })
  it('exposes the four presets in order', () => {
    expect(EXPIRY_OPTIONS.map((o) => o.value)).toEqual(['1d', '7d', '30d', 'never'])
  })
})

describe('guest URLs', () => {
  it('builds the guest URL on the given origin', () => {
    expect(guestUrlFor('abc_-1', 'https://nas.example.com')).toBe('https://nas.example.com/s/abc_-1')
  })
  it('parses a guest hash from the pathname and nothing else', () => {
    expect(parseGuestHash('/s/abc_-1')).toBe('abc_-1')
    expect(parseGuestHash('/s/abc/extra')).toBeNull()
    expect(parseGuestHash('/')).toBeNull()
    expect(parseGuestHash('/s/')).toBeNull()
    expect(parseGuestHash('/s/bad$hash')).toBeNull()
  })
})

describe('formatExpiry', () => {
  const now = Date.UTC(2026, 8, 9, 12, 0, 0)
  it('never for 0', () => expect(formatExpiry(0, now)).toBe('Never'))
  it('expired when in the past', () => expect(formatExpiry(now / 1000 - 5, now)).toBe('Expired'))
  it('minutes, hours and days ahead', () => {
    expect(formatExpiry(now / 1000 + 20 * 60, now)).toBe('in 20 minutes')
    expect(formatExpiry(now / 1000 + 3 * 3600, now)).toBe('in 3 hours')
    expect(formatExpiry(now / 1000 + 6 * 86400 + 3600, now)).toBe('in 6 days')
  })
})

describe('labels', () => {
  it('shows the basename of the scoped path and the drive from the source path', () => {
    expect(shareDisplayName({ path: '/alice/Docs/', source: '/srv/home' })).toBe('Docs')
    expect(shareDisplayName({ path: '/report.pdf', source: '/srv/share' })).toBe('report.pdf')
    expect(driveLabelFor({ source: '/srv/home' })).toBe('My Drive')
    expect(driveLabelFor({ source: '/srv/share' })).toBe('Shared')
    expect(driveLabelFor({ source: 'home' })).toBe('My Drive')
  })
  it('names a whole-drive share after the drive', () => {
    expect(shareDisplayName({ path: '/', source: '/srv/share' })).toBe('Shared')
    expect(shareDisplayName({ path: '/alice/', source: '/srv/home' })).toBe('alice')
  })
})
