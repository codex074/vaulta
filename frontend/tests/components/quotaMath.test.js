import { describe, it, expect } from 'vitest'
import { quotaPercent, quotaFillColor, quotaLabel, driveStatus } from '../../src/components/quotaMath.js'

const GIB = 1024 ** 3

describe('quotaPercent', () => {
  it('computes a rounded percentage of used against the limit', () => {
    expect(quotaPercent(2.5 * GIB, 5 * GIB)).toBe(50)
    expect(quotaPercent(GIB, 3 * GIB)).toBe(33)
  })

  it('clamps at 100 even if usage somehow exceeds the limit', () => {
    expect(quotaPercent(6 * GIB, 5 * GIB)).toBe(100)
  })

  it('is 0 when there is no limit set (avoids dividing by zero)', () => {
    expect(quotaPercent(GIB, 0)).toBe(0)
  })
})

describe('quotaFillColor', () => {
  it('is the accent color below the warning threshold', () => {
    expect(quotaFillColor(0)).toBe('var(--accent)')
    expect(quotaFillColor(74)).toBe('var(--accent)')
  })

  it('is the warning color at and above 75%', () => {
    expect(quotaFillColor(75)).toBe('var(--warning)')
    expect(quotaFillColor(89)).toBe('var(--warning)')
  })

  it('is the danger color at and above 90%', () => {
    expect(quotaFillColor(90)).toBe('var(--danger)')
    expect(quotaFillColor(100)).toBe('var(--danger)')
  })
})

describe('quotaLabel', () => {
  it('is empty when the user has no drive at all', () => {
    expect(quotaLabel({ hasDrive: false, unlimited: false, limitBytes: 0, usedBytes: 0 })).toBe('')
  })

  it('reports "No quota set" when there is a drive but no admin-set limit', () => {
    expect(quotaLabel({ hasDrive: true, unlimited: false, limitBytes: 0, usedBytes: GIB })).toBe('No quota set — ask an admin')
  })

  it('reports used-of-limit in human sizes when a limit is set', () => {
    expect(quotaLabel({ hasDrive: true, unlimited: false, limitBytes: 5 * GIB, usedBytes: GIB })).toBe('1.0 GB of 5.0 GB used')
  })

  it('reports just usage for an unlimited (admin) drive', () => {
    expect(quotaLabel({ hasDrive: true, unlimited: true, limitBytes: 0, usedBytes: 2 * GIB })).toBe('2.0 GB used')
  })
})

describe('driveStatus', () => {
  const alice = { username: 'alice', permissions: { admin: false }, scopes: [{ name: 'share', scope: '/' }, { name: 'home', scope: '/alice' }] }

  it('reports a correctly scoped non-admin drive as ok', () => {
    expect(driveStatus(alice)).toEqual({ hasScope: true, scope: '/alice', expected: '/alice', ok: true })
  })

  it('flags a missing home scope', () => {
    expect(driveStatus({ ...alice, scopes: [{ name: 'share', scope: '/' }] })).toEqual({ hasScope: false, scope: null, expected: '/alice', ok: false })
  })

  it('flags a non-admin whose home scope is the shared root (FBQ defaultEnabled merge)', () => {
    const merged = { ...alice, scopes: [{ name: 'share', scope: '/' }, { name: 'home', scope: '/' }] }
    expect(driveStatus(merged)).toEqual({ hasScope: true, scope: '/', expected: '/alice', ok: false })
  })

  it('accepts any home scope for an admin, but still reports a missing one', () => {
    const admin = { username: 'root', permissions: { admin: true }, scopes: [{ name: 'home', scope: '/' }] }
    expect(driveStatus(admin)).toEqual({ hasScope: true, scope: '/', expected: '/', ok: true })
    expect(driveStatus({ ...admin, scopes: [] })).toEqual({ hasScope: false, scope: null, expected: '/', ok: false })
  })
})
