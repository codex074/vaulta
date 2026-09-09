import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installSessionGuard } from '../src/sessionGuard.js'
import { notifyRenewRequested } from '../src/api/http.js'

function fakeAuth() {
  return { recordActivity: vi.fn(), enforceIdle: vi.fn(() => false), renewIfDue: vi.fn() }
}

describe('installSessionGuard', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('records activity on user input and checks idleness every minute', () => {
    const auth = fakeAuth()
    const teardown = installSessionGuard(auth)
    window.dispatchEvent(new Event('pointerdown'))
    window.dispatchEvent(new Event('keydown'))
    window.dispatchEvent(new Event('scroll'))
    expect(auth.recordActivity).toHaveBeenCalledTimes(3)
    vi.advanceTimersByTime(60_000)
    expect(auth.enforceIdle).toHaveBeenCalledTimes(1)
    teardown()
    window.dispatchEvent(new Event('pointerdown'))
    vi.advanceTimersByTime(60_000)
    expect(auth.recordActivity).toHaveBeenCalledTimes(3)
    expect(auth.enforceIdle).toHaveBeenCalledTimes(1)
  })

  it('checks idleness immediately when the tab becomes visible again', () => {
    const auth = fakeAuth()
    const teardown = installSessionGuard(auth)
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(auth.enforceIdle).toHaveBeenCalledTimes(1)
    expect(auth.recordActivity).toHaveBeenCalledTimes(1)
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(auth.enforceIdle).toHaveBeenCalledTimes(1)
    teardown()
  })

  it('renews when FBQ asks, until torn down', () => {
    const auth = fakeAuth()
    const teardown = installSessionGuard(auth)
    notifyRenewRequested()
    expect(auth.renewIfDue).toHaveBeenCalledTimes(1)
    teardown()
    notifyRenewRequested()
    expect(auth.renewIfDue).toHaveBeenCalledTimes(1)
  })
})
