import { describe, it, expect } from 'vitest'
import {
  IDLE_LIMIT_MS, RENEW_MIN_INTERVAL_MS, ACTIVITY_WRITE_INTERVAL_MS, REMEMBER_KEY, LAST_ACTIVITY_KEY,
  readSessionPrefs, writeSessionPrefs, clearSessionPrefs, isIdleExpired, shouldWriteActivity, shouldRenew,
  storageAvailable,
} from '../src/sessionPolicy.js'

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) }
}
const throwingStorage = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }, removeItem() { throw new Error('blocked') } }

describe('constants', () => {
  it('match the spec', () => {
    expect(IDLE_LIMIT_MS).toBe(3_600_000)
    expect(RENEW_MIN_INTERVAL_MS).toBe(300_000)
    expect(ACTIVITY_WRITE_INTERVAL_MS).toBe(30_000)
    expect(REMEMBER_KEY).toBe('vaulta-remember')
    expect(LAST_ACTIVITY_KEY).toBe('vaulta-last-activity')
  })
})

describe('session prefs storage', () => {
  it('round-trips remember and last activity', () => {
    const storage = memoryStorage()
    writeSessionPrefs(storage, { remember: true, lastActivity: 1234 })
    expect(readSessionPrefs(storage)).toEqual({ remember: true, lastActivity: 1234 })
    expect(storage.getItem(REMEMBER_KEY)).toBe('1')
    expect(storage.getItem(LAST_ACTIVITY_KEY)).toBe('1234')
  })
  it('reads defaults when nothing or garbage is stored', () => {
    expect(readSessionPrefs(memoryStorage())).toEqual({ remember: false, lastActivity: null })
    expect(readSessionPrefs(memoryStorage({ [REMEMBER_KEY]: 'yes', [LAST_ACTIVITY_KEY]: 'soon' }))).toEqual({ remember: false, lastActivity: null })
  })
  it('treats a stored empty string for last activity as null', () => {
    expect(readSessionPrefs(memoryStorage({ [LAST_ACTIVITY_KEY]: '' }))).toEqual({ remember: false, lastActivity: null })
  })
  it('never throws when storage is unavailable', () => {
    expect(readSessionPrefs(throwingStorage)).toEqual({ remember: false, lastActivity: null })
    expect(() => writeSessionPrefs(throwingStorage, { remember: true, lastActivity: 1 })).not.toThrow()
    expect(() => clearSessionPrefs(throwingStorage)).not.toThrow()
  })
  it('clears both keys', () => {
    const storage = memoryStorage({ [REMEMBER_KEY]: '1', [LAST_ACTIVITY_KEY]: '5' })
    clearSessionPrefs(storage)
    expect(readSessionPrefs(storage)).toEqual({ remember: false, lastActivity: null })
  })
})

describe('isIdleExpired', () => {
  const now = 10_000_000
  it('expires an unremembered session idle for more than the limit', () => {
    expect(isIdleExpired({ remember: false, lastActivity: now - IDLE_LIMIT_MS - 1 }, now)).toBe(true)
    expect(isIdleExpired({ remember: false, lastActivity: now - IDLE_LIMIT_MS }, now)).toBe(false)
  })
  it('never expires a remembered session or one with no recorded activity', () => {
    expect(isIdleExpired({ remember: true, lastActivity: now - 10 * IDLE_LIMIT_MS }, now)).toBe(false)
    expect(isIdleExpired({ remember: false, lastActivity: null }, now)).toBe(false)
  })
})

describe('storageAvailable', () => {
  it('is true when a probe write/remove succeeds', () => {
    expect(storageAvailable(memoryStorage())).toBe(true)
  })
  it('is false when storage throws', () => {
    expect(storageAvailable(throwingStorage)).toBe(false)
  })
})

describe('throttles', () => {
  it('writes activity only every interval', () => {
    expect(shouldWriteActivity(null, 100)).toBe(true)
    expect(shouldWriteActivity(100, 100 + ACTIVITY_WRITE_INTERVAL_MS - 1)).toBe(false)
    expect(shouldWriteActivity(100, 100 + ACTIVITY_WRITE_INTERVAL_MS)).toBe(true)
  })
  it('renews at most once per interval', () => {
    expect(shouldRenew(null, 100)).toBe(true)
    expect(shouldRenew(100, 100 + RENEW_MIN_INTERVAL_MS - 1)).toBe(false)
    expect(shouldRenew(100, 100 + RENEW_MIN_INTERVAL_MS)).toBe(true)
  })
})
