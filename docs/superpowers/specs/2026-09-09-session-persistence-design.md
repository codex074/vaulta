# Session Persistence ("Keep me signed in") + Password Visibility — Design Spec

Date: 2026-09-09. Status: approved in chat (defaults: checkbox unticked; 30-day
FBQ token lifetime; show/hide password added as a second work item).

## Problems

1. Every Vaulta session dies after 2 hours whether or not the user is active:
   FBQ issues a JWT valid for `auth.tokenExpirationHours` (default 2), adds
   `X-Renew-Token: true` to responses when less than 30 minutes remain, and
   offers `POST /api/auth/renew` — but Vaulta never renews.
2. The user wants a login checkbox: ticked → stay signed in indefinitely;
   unticked → sign out automatically after 1 hour without activity.
3. Password fields have no show/hide toggle, so typos cannot be checked.

## Verified FBQ facts (v1.5.5-stable, `backend/http/auth.go`, `middleware.go`)

- Login sets a persistent cookie (`Expires` = token expiry), not a session cookie.
- `POST /api/auth/renew` (needs a valid token) returns a fresh token valid for
  `tokenExpirationHours` and re-sets the cookie. Rate-limited (authenticated tier).
- Every authenticated response carries `X-Renew-Token: true` once the token
  has under 30 minutes left. There is no per-login lifetime; the lifetime is
  the server-wide `auth.tokenExpirationHours` (config.yaml key `auth:`).
- `POST /api/auth/logout` clears the cookie.

## Design

### Server config (deploy step, not code)
`auth.tokenExpirationHours: 720` (30 days) in FBQ's `config.yaml`, FBQ
restarted. "Indefinitely" therefore means: as long as the app is used at
least once every 30 days, each use renews for another 30 days.

Trade-off accepted by the user: an unticked user's cookie is also valid for
30 days on disk; the 1-hour sign-out is enforced client-side (Vaulta calls
logout, which clears the cookie). Previously the same exposure was 2 hours.

### `frontend/src/sessionPolicy.js` (pure, tested)
- `IDLE_LIMIT_MS = 3_600_000`, `RENEW_MIN_INTERVAL_MS = 300_000`,
  `ACTIVITY_WRITE_INTERVAL_MS = 30_000`.
- Storage keys `vaulta-remember` (`'1'`/`'0'`) and `vaulta-last-activity`
  (epoch ms as string).
- `readSessionPrefs(storage) → { remember: boolean, lastActivity: number | null }`
  (missing/garbled → `remember: false`, `lastActivity: null`; storage throwing → same).
- `writeSessionPrefs(storage, { remember, lastActivity })`, `clearSessionPrefs(storage)`.
- `isIdleExpired({ remember, lastActivity }, now, limit = IDLE_LIMIT_MS)` →
  `!remember && lastActivity !== null && now - lastActivity > limit`.
- `shouldWriteActivity(lastActivity, now, interval = ACTIVITY_WRITE_INTERVAL_MS)` →
  `lastActivity === null || now - lastActivity >= interval` (throttles storage writes).
- `shouldRenew(lastRenewAt, now, min = RENEW_MIN_INTERVAL_MS)` →
  `lastRenewAt === null || now - lastRenewAt >= min`.

### `frontend/src/api/http.js`
- New `onRenewRequested(callback)` / `notifyRenewRequested()` mirroring the
  unauthorized listeners. After every `authorizedFetch`, if
  `response.headers?.get?.('X-Renew-Token') === 'true'`, call the renew
  listeners. (Guards keep the existing tests, whose mock responses have no
  `headers`, passing.)

### `frontend/src/api/auth.js`
- `renewToken()` → `POST /api/auth/renew` via `authorizedFetch`; throws
  `apiError` on failure.

### `frontend/src/stores/auth.js`
- State gains `signedOutReason: ''` and (non-persisted) `lastRenewAt: null`.
- `signIn(username, password, { remember = false } = {})`: login, then
  `writeSessionPrefs(storage, { remember, lastActivity: now })`, then load identity.
- `checkSession()`: read prefs; if `isIdleExpired(prefs, now)` → best-effort
  `logout()`, `clearSessionPrefs`, `user = null`,
  `signedOutReason = 'Signed out after 1 hour of inactivity.'`; else load
  identity as today and, on success, record activity `now`.
- `signOut()`: `logout()`, `clearSessionPrefs`, `user = null`.
- `recordActivity(now = Date.now())`: if `shouldWriteActivity(prefs.lastActivity, now)`
  write `lastActivity = now` (keeping `remember`).
- `enforceIdle(now = Date.now())`: if `user` and `isIdleExpired(prefs, now)` →
  same as the expired branch of `checkSession` (returns `true` when it signed out).
- `renewIfDue(now = Date.now())`: if `user` and `shouldRenew(lastRenewAt, now)`
  → `lastRenewAt = now`, `await renewToken()` (errors swallowed: a failed renew
  just means the next 401 shows the login screen).
- Storage is `window.localStorage`, accessed only through `sessionPolicy.js`
  helpers so a throwing storage (private mode) degrades to "remember: false".

### `frontend/src/sessionGuard.js` (tested with fake timers)
`installSessionGuard(auth, { win = window, doc = document } = {}) → teardown`:
- Listens (passive, capture) for `pointerdown`, `keydown`, `scroll`, and
  `visibilitychange` (only when `doc.visibilityState === 'visible'`) →
  `auth.recordActivity()`; on `visibilitychange` visible also `auth.enforceIdle()`
  (a tab coming back after an hour signs out immediately).
- `setInterval(() => auth.enforceIdle(), 60_000)`.
- `onRenewRequested(() => auth.renewIfDue())`.
- Teardown removes listeners, clears the interval, unsubscribes.
`App.vue` installs it `onMounted` (after `checkSession`) and tears it down
`onBeforeUnmount`. The guest app does not install it.

### `frontend/src/components/PasswordInput.vue` (tested)
- `v-model` string; `inheritAttrs: false`, all attrs (placeholder,
  autocomplete, required, class, id) forwarded to the inner `<input>`.
- Toggle button inside the field: `type="button"`, `aria-label` "Show
  password" / "Hide password", `aria-pressed`, 44 px touch target, eye icon
  via `UiIcon` (new `eye` / `eye-off` glyphs); switches `type` between
  `password` and `text`. Does not steal focus from the input (`@mousedown.prevent`).
- Replaces every `type="password"` input: LoginView, AccountSettingsDialog
  (3), ManageUsersDialog (2), ShareDialog (1), GuestShareView (1).

### `frontend/src/components/LoginView.vue`
- Checkbox "Keep me signed in" (`input.remember`, unticked by default) below
  the password field; `auth.signIn(username, password, { remember })`.
- Shows `auth.signedOutReason` in an info line (`p.login-notice`) when set;
  cleared on the next successful sign-in.

### Error handling
- `renewToken` failure: swallowed (logged to console); the next 401 shows login.
- Storage unavailable: `remember` reads as false → idle sign-out applies; the
  app never throws because of storage.
- Logout request failing during idle sign-out: still clear local state and
  show the login screen (cookie may linger until it expires; same as today).

## Non-goals
Server-side per-login lifetimes, multi-device session lists, "sign out
everywhere", biometric unlock, remembering the username.

## Testing
- Vitest: `sessionPolicy.test.js`, `http.test.js` (renew listener on header,
  no call without header), `api/auth.test.js` (`renewToken` URL/method),
  `stores/auth.test.js` (signIn writes prefs; checkSession signs out when
  stale and sets the reason; enforceIdle; renewIfDue throttle; signOut clears
  prefs), `sessionGuard.test.js` (fake timers: interval calls enforceIdle;
  events call recordActivity; visibility triggers enforceIdle; teardown),
  `PasswordInput.test.js` (toggle type/aria, attrs forwarded, v-model),
  `LoginView.test.js` (checkbox → `remember: true`; notice shown).
- Post-deploy: sign in unticked, leave idle 61 min (or set `vaulta-last-activity`
  back by 2 h in devtools and reload) → login screen with the notice; sign in
  ticked, wait >2 h while occasionally using the app → still signed in;
  confirm `X-Renew-Token` triggers `/api/auth/renew` in the network tab.
