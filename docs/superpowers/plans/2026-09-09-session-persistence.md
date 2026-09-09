# Session Persistence + Password Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Keep me signed in" checkbox at login; ticked sessions renew indefinitely, unticked sessions sign out after 1 hour of inactivity; every password field gets a show/hide toggle.

**Architecture:** Pure policy helpers (`sessionPolicy.js`) decide idle/renew; the auth store applies them around FBQ's login/logout/renew endpoints; a small `sessionGuard` wires DOM activity, a minute timer and FBQ's `X-Renew-Token` header to the store; a reusable `PasswordInput` component replaces raw password inputs.

**Tech Stack:** Vue 3 `<script setup>`, Pinia, Vitest + @vue/test-utils (jsdom, `vi.useFakeTimers()` for the guard).

**Spec:** `docs/superpowers/specs/2026-09-09-session-persistence-design.md` — read it first.

## Global Constraints

- Work in `/Users/codex074/nas-webui/.worktrees/nas-webui-polish` on branch `nas-webui-polish`. Never touch `/Users/codex074/nas-webui`.
- TDD: failing test first (watch it fail for the expected reason), implement, pass, whole suite (`cd frontend && npx vitest run`; currently 46 files / 360 tests) before every commit; `npm run build` when a `.vue` file changes.
- Exact constants: `IDLE_LIMIT_MS = 3_600_000`, `RENEW_MIN_INTERVAL_MS = 300_000`, `ACTIVITY_WRITE_INTERVAL_MS = 30_000`; storage keys `vaulta-remember`, `vaulta-last-activity`; sign-out notice text `Signed out after 1 hour of inactivity.`; checkbox label `Keep me signed in`; toggle labels `Show password` / `Hide password`.
- Storage access only via `sessionPolicy.js`, always inside try/catch; the app must never throw because `localStorage` is unavailable.
- Existing tests stay unchanged and green; existing mock responses in `http.test.js` have no `headers` property, so header access must be optional-chained.
- Commit per task; end every commit message with your model's `Co-Authored-By` line and `Claude-Session: https://claude.ai/code/session_019wfqFN79ixJCZCCkh4eFVd`.

---

## File map

| File | Responsibility |
|---|---|
| `frontend/src/sessionPolicy.js` (new) | Pure idle/renew/storage helpers |
| `frontend/src/api/http.js`, `frontend/src/api/auth.js` (modify) | Renew listeners; `renewToken()` |
| `frontend/src/stores/auth.js` (modify) | Remember flag, idle sign-out, renew throttle |
| `frontend/src/sessionGuard.js` (new), `frontend/src/App.vue` (modify) | DOM activity + timer + renew wiring |
| `frontend/src/components/PasswordInput.vue` (new), `UiIcon.vue` (modify), five components (modify) | Show/hide password |
| `frontend/src/components/LoginView.vue` (modify) | Checkbox + notice |
| `README.md`, `AGENTS.md` (modify) | Docs |

---

### Task 1: `sessionPolicy.js`

**Files:** Create `frontend/src/sessionPolicy.js`; Test `frontend/tests/sessionPolicy.test.js`.

**Interfaces — Produces:** `IDLE_LIMIT_MS`, `RENEW_MIN_INTERVAL_MS`, `ACTIVITY_WRITE_INTERVAL_MS`, `REMEMBER_KEY`, `LAST_ACTIVITY_KEY`, `readSessionPrefs(storage)`, `writeSessionPrefs(storage, { remember, lastActivity })`, `clearSessionPrefs(storage)`, `isIdleExpired(prefs, now, limit?)`, `shouldWriteActivity(lastActivity, now, interval?)`, `shouldRenew(lastRenewAt, now, min?)`.

- [ ] **Step 1: Failing tests**

```js
// frontend/tests/sessionPolicy.test.js
import { describe, it, expect } from 'vitest'
import {
  IDLE_LIMIT_MS, RENEW_MIN_INTERVAL_MS, ACTIVITY_WRITE_INTERVAL_MS, REMEMBER_KEY, LAST_ACTIVITY_KEY,
  readSessionPrefs, writeSessionPrefs, clearSessionPrefs, isIdleExpired, shouldWriteActivity, shouldRenew,
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
```

- [ ] **Step 2: Run `cd frontend && npx vitest run tests/sessionPolicy.test.js`; fails on the missing module**

- [ ] **Step 3: Implement**

```js
// frontend/src/sessionPolicy.js
// Client-side session policy. FBQ's token lifetime is server-wide, so the
// 1-hour idle sign-out for "don't keep me signed in" is enforced here.
export const IDLE_LIMIT_MS = 3_600_000
export const RENEW_MIN_INTERVAL_MS = 300_000
export const ACTIVITY_WRITE_INTERVAL_MS = 30_000
export const REMEMBER_KEY = 'vaulta-remember'
export const LAST_ACTIVITY_KEY = 'vaulta-last-activity'

export function readSessionPrefs(storage) {
  try {
    const remember = storage.getItem(REMEMBER_KEY) === '1'
    const raw = storage.getItem(LAST_ACTIVITY_KEY)
    const parsed = raw === null ? NaN : Number(raw)
    return { remember, lastActivity: Number.isFinite(parsed) ? parsed : null }
  } catch {
    return { remember: false, lastActivity: null }
  }
}

export function writeSessionPrefs(storage, { remember, lastActivity }) {
  try {
    storage.setItem(REMEMBER_KEY, remember ? '1' : '0')
    if (lastActivity === null || lastActivity === undefined) storage.removeItem(LAST_ACTIVITY_KEY)
    else storage.setItem(LAST_ACTIVITY_KEY, String(lastActivity))
  } catch {
    // storage unavailable (private mode, quota) — the session simply isn't remembered
  }
}

export function clearSessionPrefs(storage) {
  try {
    storage.removeItem(REMEMBER_KEY)
    storage.removeItem(LAST_ACTIVITY_KEY)
  } catch {
    // nothing to clear
  }
}

export function isIdleExpired({ remember, lastActivity }, now, limit = IDLE_LIMIT_MS) {
  if (remember || lastActivity === null) return false
  return now - lastActivity > limit
}

export function shouldWriteActivity(lastActivity, now, interval = ACTIVITY_WRITE_INTERVAL_MS) {
  return lastActivity === null || now - lastActivity >= interval
}

export function shouldRenew(lastRenewAt, now, min = RENEW_MIN_INTERVAL_MS) {
  return lastRenewAt === null || now - lastRenewAt >= min
}
```

- [ ] **Step 4: Test file green, suite green.** **Step 5: Commit** — `git add frontend/src/sessionPolicy.js frontend/tests/sessionPolicy.test.js && git commit -m "Add session policy helpers: remember flag, idle expiry, renew throttle"`

---

### Task 2: Renew plumbing in `http.js` and `auth.js`

**Files:** Modify `frontend/src/api/http.js`, `frontend/src/api/auth.js`; Test `frontend/tests/api/http.test.js`, `frontend/tests/api/auth.test.js` (append).

**Interfaces — Produces:** `onRenewRequested(callback) → unsubscribe`, `notifyRenewRequested()` in `http.js`; `renewToken() → Promise<void>` in `auth.js`.

- [ ] **Step 1: Failing tests** (append to the respective `describe` blocks; add `onRenewRequested` to the http import and `renewToken` to the auth import)

```js
  // http.test.js
  it('notifies renew listeners when FBQ flags the token for renewal', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, headers: { get: (name) => (name === 'X-Renew-Token' ? 'true' : null) } })
    const callback = vi.fn()
    const off = onRenewRequested(callback)
    await authorizedFetch('/api/resources')
    expect(callback).toHaveBeenCalledTimes(1)
    off()
    await authorizedFetch('/api/resources')
    expect(callback).toHaveBeenCalledTimes(1)
  })
  it('does not notify renew listeners without the header or without headers at all', async () => {
    const callback = vi.fn()
    onRenewRequested(callback)
    global.fetch.mockResolvedValue({ ok: true, status: 200, headers: { get: () => null } })
    await authorizedFetch('/api/resources')
    global.fetch.mockResolvedValue({ ok: true, status: 200 })
    await authorizedFetch('/api/resources')
    expect(callback).not.toHaveBeenCalled()
  })
```
```js
  // auth.test.js (match the file's existing fetch-mock style)
  it('renewToken POSTs /api/auth/renew and throws on failure', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({ ok: true, status: 200 })
    await renewToken()
    expect(global.fetch.mock.calls[0][0]).toBe('/api/auth/renew')
    expect(global.fetch.mock.calls[0][1].method).toBe('POST')
    global.fetch.mockResolvedValueOnce({ ok: false, status: 401, statusText: 'Unauthorized', clone() { return this }, json: () => Promise.reject(new Error('x')) })
    await expect(renewToken()).rejects.toMatchObject({ status: 401 })
  })
```

- [ ] **Step 2: Run both files; the new cases fail (missing exports)**

- [ ] **Step 3: Implement** — `http.js`:
```js
const renewListeners = new Set()

export function onRenewRequested(callback) {
  renewListeners.add(callback)
  return () => renewListeners.delete(callback)
}

export function notifyRenewRequested() {
  for (const callback of renewListeners) callback()
}
```
and in `authorizedFetch`, after the 401 check:
```js
  // FBQ flags a token with under 30 minutes left; the auth store renews it.
  if (response.headers?.get?.('X-Renew-Token') === 'true') notifyRenewRequested()
```
`auth.js`:
```js
export async function renewToken() {
  const response = await authorizedFetch('/api/auth/renew', { method: 'POST' })
  if (!response.ok) throw await apiError(response)
}
```

- [ ] **Step 4: Both files + suite green.** **Step 5: Commit** — `git add frontend/src/api/http.js frontend/src/api/auth.js frontend/tests/api/http.test.js frontend/tests/api/auth.test.js && git commit -m "Surface FBQ's renew signal and add renewToken()"`

---

### Task 3: Auth store — remember, idle sign-out, renew throttle

**Files:** Modify `frontend/src/stores/auth.js`; Test `frontend/tests/stores/auth.test.js` (append; add `renewToken: vi.fn()` to the auth API mock).

**Interfaces — Produces:** store state `signedOutReason`, `lastRenewAt`; actions `signIn(username, password, { remember })`, `checkSession()`, `signOut()`, `recordActivity(now?)`, `enforceIdle(now?) → boolean`, `renewIfDue(now?)`; constant `IDLE_SIGNOUT_MESSAGE = 'Signed out after 1 hour of inactivity.'` exported from the store module.

- [ ] **Step 1: Failing tests** (append inside `describe('auth store')`; the store reads `window.localStorage`, which jsdom provides — clear it in `beforeEach` via `localStorage.clear()`)

```js
  it('signIn stores the remember choice and stamps activity', async () => {
    authApi.getCurrentUser.mockResolvedValue({ id: 1, username: 'u' })
    profilesApi.getMyProfile.mockResolvedValue({})
    const store = useAuthStore()
    await store.signIn('u', 'p', { remember: true })
    expect(localStorage.getItem('vaulta-remember')).toBe('1')
    expect(Number(localStorage.getItem('vaulta-last-activity'))).toBeGreaterThan(0)
    await store.signIn('u', 'p')
    expect(localStorage.getItem('vaulta-remember')).toBe('0')
  })

  it('checkSession signs out a stale unremembered session with a notice', async () => {
    localStorage.setItem('vaulta-remember', '0')
    localStorage.setItem('vaulta-last-activity', String(Date.now() - 2 * 3_600_000))
    authApi.logout.mockResolvedValue()
    const store = useAuthStore()
    await store.checkSession()
    expect(authApi.logout).toHaveBeenCalled()
    expect(authApi.getCurrentUser).not.toHaveBeenCalled()
    expect(store.user).toBeNull()
    expect(store.checked).toBe(true)
    expect(store.signedOutReason).toBe('Signed out after 1 hour of inactivity.')
    expect(localStorage.getItem('vaulta-last-activity')).toBeNull()
  })

  it('checkSession keeps a remembered session however old it is', async () => {
    localStorage.setItem('vaulta-remember', '1')
    localStorage.setItem('vaulta-last-activity', String(Date.now() - 40 * 24 * 3_600_000))
    authApi.getCurrentUser.mockResolvedValue({ id: 1, username: 'u' })
    profilesApi.getMyProfile.mockResolvedValue({})
    const store = useAuthStore()
    await store.checkSession()
    expect(store.user).not.toBeNull()
    expect(authApi.logout).not.toHaveBeenCalled()
  })

  it('enforceIdle signs out only when idle past the limit', async () => {
    authApi.getCurrentUser.mockResolvedValue({ id: 1, username: 'u' })
    profilesApi.getMyProfile.mockResolvedValue({})
    authApi.logout.mockResolvedValue()
    const store = useAuthStore()
    const t0 = 5_000_000_000
    await store.signIn('u', 'p')
    store.recordActivity(t0)
    expect(store.enforceIdle(t0 + 3_600_000)).toBe(false)
    expect(store.user).not.toBeNull()
    expect(store.enforceIdle(t0 + 3_600_001)).toBe(true)
    expect(store.user).toBeNull()
    expect(store.signedOutReason).toBe('Signed out after 1 hour of inactivity.')
  })

  it('recordActivity throttles storage writes', async () => {
    const store = useAuthStore()
    store.recordActivity(1_000)
    store.recordActivity(1_000 + 29_999)
    expect(localStorage.getItem('vaulta-last-activity')).toBe('1000')
    store.recordActivity(1_000 + 30_000)
    expect(localStorage.getItem('vaulta-last-activity')).toBe('31000')
  })

  it('renewIfDue renews at most once per five minutes and only when signed in', async () => {
    authApi.renewToken.mockResolvedValue()
    const store = useAuthStore()
    await store.renewIfDue(1_000)
    expect(authApi.renewToken).not.toHaveBeenCalled()
    store.user = { id: 1 }
    await store.renewIfDue(1_000)
    await store.renewIfDue(1_000 + 299_999)
    expect(authApi.renewToken).toHaveBeenCalledTimes(1)
    await store.renewIfDue(1_000 + 300_000)
    expect(authApi.renewToken).toHaveBeenCalledTimes(2)
  })

  it('renewIfDue swallows a failed renewal', async () => {
    authApi.renewToken.mockRejectedValue(new Error('nope'))
    const store = useAuthStore()
    store.user = { id: 1 }
    await expect(store.renewIfDue(1_000)).resolves.toBeUndefined()
  })

  it('signOut clears the stored prefs', async () => {
    localStorage.setItem('vaulta-remember', '1')
    authApi.logout.mockResolvedValue()
    const store = useAuthStore()
    await store.signOut()
    expect(localStorage.getItem('vaulta-remember')).toBeNull()
  })
```
Also add `localStorage.clear()` to the existing `beforeEach`.

- [ ] **Step 2: Run the file; the new cases fail**

- [ ] **Step 3: Implement** — in `stores/auth.js`:
```js
import { login, logout, getCurrentUser, changePassword as changePasswordApi, renewToken } from '../api/auth.js'
import { getMyProfile, updateMyDisplayName } from '../api/profiles.js'
import { readSessionPrefs, writeSessionPrefs, clearSessionPrefs, isIdleExpired, shouldWriteActivity, shouldRenew } from '../sessionPolicy.js'

export const IDLE_SIGNOUT_MESSAGE = 'Signed out after 1 hour of inactivity.'
const storage = () => window.localStorage
```
state: `{ user: null, checked: false, signedOutReason: '', lastRenewAt: null }`. Actions:
```js
    async checkSession() {
      try {
        if (isIdleExpired(readSessionPrefs(storage()), Date.now())) {
          await this.idleSignOut()
          return
        }
        this.user = await loadIdentity()
        this.recordActivity()
      } catch {
        this.user = null
      } finally {
        this.checked = true
      }
    },
    async signIn(username, password, { remember = false } = {}) {
      await login(username, password)
      writeSessionPrefs(storage(), { remember, lastActivity: Date.now() })
      this.user = await loadIdentity()
      this.signedOutReason = ''
    },
    async signOut() {
      try {
        await logout()
      } finally {
        clearSessionPrefs(storage())
        this.user = null
      }
    },
    async idleSignOut() {
      this.signedOutReason = IDLE_SIGNOUT_MESSAGE
      try {
        await logout()
      } catch {
        // cookie lingers until FBQ expires it; the login screen still shows
      }
      clearSessionPrefs(storage())
      this.user = null
    },
    recordActivity(now = Date.now()) {
      const prefs = readSessionPrefs(storage())
      if (shouldWriteActivity(prefs.lastActivity, now)) writeSessionPrefs(storage(), { remember: prefs.remember, lastActivity: now })
    },
    enforceIdle(now = Date.now()) {
      if (!this.user || !isIdleExpired(readSessionPrefs(storage()), now)) return false
      this.idleSignOut()
      return true
    },
    async renewIfDue(now = Date.now()) {
      if (!this.user || !shouldRenew(this.lastRenewAt, now)) return
      this.lastRenewAt = now
      try {
        await renewToken()
      } catch (err) {
        console.warn('token renewal failed', err)
      }
    },
```
Keep `changePassword`/`updateDisplayName` as they are. Note `enforceIdle` returns synchronously (the test asserts `user` null right after): set `this.user = null` and the reason synchronously *before* awaiting logout — restructure `idleSignOut` so the synchronous part runs first: set `signedOutReason`, `clearSessionPrefs`, `this.user = null`, then `logout().catch(() => {})` without awaiting in `enforceIdle`; `checkSession` may `await` it.

- [ ] **Step 4: File + suite green.** **Step 5: Commit** — `git add frontend/src/stores/auth.js frontend/tests/stores/auth.test.js && git commit -m "Auth store: remember-me flag, one-hour idle sign-out, throttled token renewal"`

---

### Task 4: `sessionGuard.js` + App wiring

**Files:** Create `frontend/src/sessionGuard.js`; Modify `frontend/src/App.vue`; Test `frontend/tests/sessionGuard.test.js`.

**Interfaces — Produces:** `installSessionGuard(auth, { win = window, doc = document } = {}) → () => void`.

- [ ] **Step 1: Failing test**

```js
// frontend/tests/sessionGuard.test.js
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
```

- [ ] **Step 2: Run; fails on the missing module**

- [ ] **Step 3: Implement**

```js
// frontend/src/sessionGuard.js
import { onRenewRequested } from './api/http.js'

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'scroll']
const IDLE_CHECK_INTERVAL_MS = 60_000

// Wires the auth store's session policy to the page: user input counts as
// activity, idleness is checked every minute and whenever the tab comes
// back, and FBQ's renew signal triggers a (throttled) token renewal.
export function installSessionGuard(auth, { win = window, doc = document } = {}) {
  const onActivity = () => auth.recordActivity()
  const onVisibility = () => {
    if (doc.visibilityState !== 'visible') return
    if (!auth.enforceIdle()) auth.recordActivity()
  }
  for (const name of ACTIVITY_EVENTS) win.addEventListener(name, onActivity, { passive: true, capture: true })
  doc.addEventListener('visibilitychange', onVisibility)
  const timer = win.setInterval(() => auth.enforceIdle(), IDLE_CHECK_INTERVAL_MS)
  const offRenew = onRenewRequested(() => auth.renewIfDue())
  return () => {
    for (const name of ACTIVITY_EVENTS) win.removeEventListener(name, onActivity, { capture: true })
    doc.removeEventListener('visibilitychange', onVisibility)
    win.clearInterval(timer)
    offRenew()
  }
}
```
(The visibility test expects `recordActivity` once when visible and `enforceIdle` returned false — matches.)

`App.vue`: import `installSessionGuard` from `'./sessionGuard.js'` and `onBeforeUnmount` from vue; replace `onMounted(() => auth.checkSession())` with
```js
let teardownSessionGuard = () => {}
onMounted(async () => {
  await auth.checkSession()
  teardownSessionGuard = installSessionGuard(auth)
})
onBeforeUnmount(() => teardownSessionGuard())
```

- [ ] **Step 4: File + suite green; `npm run build`.** **Step 5: Commit** — `git add frontend/src/sessionGuard.js frontend/src/App.vue frontend/tests/sessionGuard.test.js && git commit -m "Session guard: activity tracking, idle checks and token renewal wired into the app"`

---

### Task 5: `PasswordInput` component and adoption

**Files:** Create `frontend/src/components/PasswordInput.vue`; Modify `frontend/src/components/UiIcon.vue` (add `eye`, `eye-off`), `LoginView.vue`, `AccountSettingsDialog.vue`, `ManageUsersDialog.vue`, `ShareDialog.vue`, `GuestShareView.vue`; Test `frontend/tests/components/PasswordInput.test.js`. Existing tests for those dialogs use selectors like `input[type="password"]`, `input.password`, `input.guest-password` — keep the same classes on the inner input (attrs forwarded) and keep the initial `type="password"` so those selectors still match; run their tests after the swap.

**Interfaces — Produces:** `PasswordInput` (`v-model`, forwards attrs to the inner input, toggle button `button.toggle-password`).

- [ ] **Step 1: Failing test**

```js
// frontend/tests/components/PasswordInput.test.js
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import PasswordInput from '../../src/components/PasswordInput.vue'

describe('PasswordInput', () => {
  it('starts hidden, forwards attrs, and toggles visibility with an accessible button', async () => {
    const wrapper = mount(PasswordInput, {
      props: { modelValue: 'secret', 'onUpdate:modelValue': (v) => wrapper.setProps({ modelValue: v }) },
      attrs: { placeholder: 'Your password', autocomplete: 'current-password', class: 'password', required: true },
    })
    const input = wrapper.get('input')
    expect(input.attributes('type')).toBe('password')
    expect(input.attributes('placeholder')).toBe('Your password')
    expect(input.attributes('autocomplete')).toBe('current-password')
    expect(input.classes()).toContain('password')
    expect(input.element.value).toBe('secret')
    const toggle = wrapper.get('button.toggle-password')
    expect(toggle.attributes('aria-label')).toBe('Show password')
    expect(toggle.attributes('aria-pressed')).toBe('false')
    expect(toggle.attributes('type')).toBe('button')
    await toggle.trigger('click')
    expect(input.attributes('type')).toBe('text')
    expect(toggle.attributes('aria-label')).toBe('Hide password')
    expect(toggle.attributes('aria-pressed')).toBe('true')
    await input.setValue('changed')
    expect(wrapper.props('modelValue')).toBe('changed')
  })
})
```

- [ ] **Step 2: Run; fails on the missing component**

- [ ] **Step 3: Implement**

```vue
<!-- frontend/src/components/PasswordInput.vue -->
<script setup>
import { ref } from 'vue'
import UiIcon from './UiIcon.vue'

defineOptions({ inheritAttrs: false })
defineProps({ modelValue: { type: String, default: '' } })
const emit = defineEmits(['update:modelValue'])
const visible = ref(false)
</script>

<template>
  <span class="password-field">
    <input
      v-bind="$attrs"
      :type="visible ? 'text' : 'password'"
      :value="modelValue"
      @input="emit('update:modelValue', $event.target.value)"
    />
    <button
      type="button"
      class="toggle-password"
      :aria-label="visible ? 'Hide password' : 'Show password'"
      :aria-pressed="visible ? 'true' : 'false'"
      @mousedown.prevent
      @click="visible = !visible"
    >
      <UiIcon :name="visible ? 'eye-off' : 'eye'" :size="18" />
    </button>
  </span>
</template>

<style scoped>
.password-field { position: relative; display: block; width: 100%; }
.password-field input { width: 100%; padding-right: 44px; box-sizing: border-box; }
.toggle-password { position: absolute; top: 50%; right: 2px; transform: translateY(-50%); width: 40px; height: 40px; border: none; background: none; color: var(--text-muted, #888); display: inline-flex; align-items: center; justify-content: center; border-radius: 8px; cursor: pointer; }
.toggle-password:hover { color: var(--text, inherit); }
</style>
```
`UiIcon.vue` glyphs (add next to `link`):
```html
    <g v-else-if="name === 'eye'">
      <path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10Z" />
      <circle cx="10" cy="10" r="2.4" />
    </g>
    <g v-else-if="name === 'eye-off'">
      <path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10Z" />
      <circle cx="10" cy="10" r="2.4" />
      <path d="M3.5 3.5l13 13" />
    </g>
```
Adoption — replace each `<input … type="password" …>` with `<PasswordInput … />` keeping every other attribute (v-model, class, placeholder, autocomplete, required, autofocus) and importing the component. Since `$attrs` forwards `class`, `input.password` / `input.guest-password` selectors in existing tests keep working. Login styles: `LoginView.vue`'s `.field input` selector must still hit the inner input (it does — descendant selector); the theme's `#app .field input` rules likewise. Verify visually the toggle sits inside the field on the login screen (dark panel) and in the dialogs; add `#app .password-field .toggle-password { color: var(--text-muted); }` to `vaulta-theme.css` if the global `#app button` rule overrides its colour or size.

- [ ] **Step 4: Run `PasswordInput.test.js`, then the dialog tests (`AccountSettingsDialog`, `ShareDialog`, `GuestShareView`, `Lightbox`), then the suite; `npm run build`.** **Step 5: Commit** — `git add -A frontend/src frontend/tests && git commit -m "PasswordInput: show/hide toggle on every password field"`

---

### Task 6: Login checkbox, notice, docs

**Files:** Modify `frontend/src/components/LoginView.vue`, `README.md`, `AGENTS.md`; Test `frontend/tests/components/LoginView.test.js` (new).

- [ ] **Step 1: Failing test**

```js
// frontend/tests/components/LoginView.test.js
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import LoginView from '../../src/components/LoginView.vue'
import { useAuthStore } from '../../src/stores/auth.js'

function mountLogin() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuthStore()
  auth.signIn = vi.fn().mockResolvedValue()
  return { auth, wrapper: mount(LoginView, { global: { plugins: [pinia] } }) }
}

describe('LoginView', () => {
  beforeEach(() => localStorage.clear())

  it('signs in without remembering by default and passes the checkbox through', async () => {
    const { auth, wrapper } = mountLogin()
    await wrapper.get('input[autocomplete="username"]').setValue('alice')
    await wrapper.get('input[type="password"]').setValue('pw')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(auth.signIn).toHaveBeenLastCalledWith('alice', 'pw', { remember: false })
    await wrapper.get('input.remember').setValue(true)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(auth.signIn).toHaveBeenLastCalledWith('alice', 'pw', { remember: true })
  })

  it('shows why the user was signed out', () => {
    const { auth, wrapper } = mountLogin()
    auth.signedOutReason = 'Signed out after 1 hour of inactivity.'
    return wrapper.vm.$nextTick().then(() => {
      expect(wrapper.get('.login-notice').text()).toBe('Signed out after 1 hour of inactivity.')
    })
  })
})
```

- [ ] **Step 2: Run; fails (no `input.remember`, no notice)**

- [ ] **Step 3: Implement** — `LoginView.vue`: add `const remember = ref(false)`; call `auth.signIn(username.value, password.value, { remember: remember.value })`; after the password field add
```html
      <label class="remember-row">
        <input class="remember" v-model="remember" type="checkbox" />
        <span>Keep me signed in</span>
      </label>
      <p v-if="auth.signedOutReason" class="login-notice" role="status">{{ auth.signedOutReason }}</p>
```
with scoped styles `.remember-row { display: flex; align-items: center; gap: 10px; font-size: 14px; color: var(--muted, #b8bec9); min-height: 44px; } .remember-row input { width: 18px; height: 18px; accent-color: var(--accent); } .login-notice { margin: 0; font-size: 13px; color: var(--muted, #b8bec9); }` (match the file's existing colour variables — read its `<style>` first).
- `README.md` Features: `- **Sessions.** "Keep me signed in" at login keeps you signed in (FBQ tokens are renewed as you use the app); otherwise Vaulta signs you out after 1 hour without activity. Every password field has a show/hide toggle.` And in "Configure FileBrowser Quantum" add: `Set \`auth.tokenExpirationHours: 720\` so remembered sessions last; Vaulta renews the token on use.`
- `AGENTS.md` gotcha: `- **Sessions are client-policed.** FBQ has one server-wide token lifetime (\`auth.tokenExpirationHours\`, set to 720 h on the NAS) and flags renewal with \`X-Renew-Token\`; \`sessionGuard.js\` + the auth store renew (throttled 5 min) and enforce the 1-hour idle sign-out for unremembered sessions via \`localStorage\` (\`vaulta-remember\`, \`vaulta-last-activity\`). Never trust those keys server-side; they are UX, not security.`

- [ ] **Step 4: File + suite green; `npm run build`.** **Step 5: Commit** — `git add frontend/src/components/LoginView.vue frontend/tests/components/LoginView.test.js README.md AGENTS.md && git commit -m "Login: keep-me-signed-in checkbox and idle sign-out notice; docs"`

---

## Deploy & verify (controller)

1. FBQ `config.yaml` on the NAS: add
   ```yaml
   auth:
     tokenExpirationHours: 720
   ```
   (top-level `auth:` key; keep existing keys), restart FBQ, confirm healthy.
2. Build/ship the image per AGENTS.md.
3. Verify: login screen shows the checkbox and eye toggle; sign in unticked, set `vaulta-last-activity` to `Date.now()-7200000` in devtools, reload → login screen with the notice; sign in ticked, confirm a request after >90 min still works and `/api/auth/renew` appears when `X-Renew-Token` is present. Record in `docs/deployments/2026-09-09-session-persistence.md`.
