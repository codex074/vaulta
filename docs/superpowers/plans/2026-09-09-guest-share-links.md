# Guest Share Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Signed-in users create expiring, optionally password-protected read-only links to files/folders; guests open `/s/<hash>` in Vaulta's own UI to browse, preview and download.

**Architecture:** FileBrowser Quantum (FBQ) 1.5.5 already stores shares, enforces scope/expiry/password and serves a hash-keyed public API. Vaulta adds an owner UI (`ShareDialog`, `LinksView`), a thin owner client (`api/share.js`), a guest client (`api/publicShare.js`), a guest SPA entry (`GuestApp` → `GuestShareView`), a `urls` prop on `Lightbox`, and one nginx location proxying `/public/api/`.

**Tech Stack:** Vue 3 `<script setup>`, Pinia, Vite, Vitest + @vue/test-utils (jsdom), nginx. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-09-guest-share-links-design.md` — read it first; every task argues from it.

## Global Constraints

- Work in `/Users/codex074/nas-webui/.worktrees/nas-webui-polish` on branch `nas-webui-polish`. Never touch `/Users/codex074/nas-webui` (main worktree).
- TDD: write the failing test, run it (`cd frontend && npx vitest run <file>`), watch it fail, implement, watch it pass, run the whole suite (`npx vitest run`) before every commit. Suite must stay green (currently 37 files / 290 tests).
- Test style: API tests mock `global.fetch = vi.fn()` and assert URL/headers/body; component tests use `mount` from `@vue/test-utils` with `createPinia()`; modules are mocked with `vi.mock('../../src/api/<x>.js', () => ({ fn: vi.fn() }))`.
- Every fetch client uses `authorizedFetch`/`apiError` from `src/api/http.js` **except** the guest client, which uses plain `fetch` (guests have no session; a 401 must not trigger the app's logout listener).
- Links are always read-only: never send `allowModify`, `allowCreate`, `allowDelete`.
- Guest thumbnails must go through `canRequestThumbnail()` from `src/components/fileFormat.js` (FBQ crashes on PDF thumbnails).
- UI copy in English like the rest of the app, except the two guest strings the spec fixes in Thai: "ลิงก์นี้ใช้ไม่ได้แล้ว" (unavailable) and "รหัสไม่ถูกต้อง" (wrong password).
- Commit after each task with the trailer lines:
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_019wfqFN79ixJCZCCkh4eFVd`.

---

## File map

| File | Responsibility |
|---|---|
| `frontend/src/components/shareLinks.js` (new) | Pure helpers: expiry options, create body, guest URL, hash parsing, expiry/labels |
| `frontend/src/api/share.js` (new) | Owner-side client for `/api/share*` |
| `frontend/src/api/publicShare.js` (new) | Guest client for `/public/api/*` (header-based password) |
| `frontend/src/components/guestMedia.js` (new) | Decides direct URL vs blob for a guest entry; builds `urls` for Lightbox |
| `frontend/src/components/Lightbox.vue` (modify) | Optional `urls` prop |
| `frontend/src/components/ShareDialog.vue` (new) | Create/copy/revoke links for one item |
| `frontend/src/components/ContextMenu.vue` (modify) | "Share link" button → emits `share` |
| `frontend/src/components/LinksView.vue` (new) | All my links (admin: everyone's) |
| `frontend/src/components/Sidebar.vue`, `TopBar.vue`, `UiIcon.vue`, `App.vue` (modify) | "Links" navigation, ShareDialog host |
| `frontend/src/components/GuestFileList.vue`, `GuestShareView.vue`, `GuestApp.vue` (new), `frontend/src/main.js` (modify) | Guest SPA |
| `docker/nginx.conf`, `frontend/vite.config.js`, `README.md`, `AGENTS.md` (modify) | Routing + docs |

---

### Task 1: `shareLinks.js` helpers

**Files:**
- Create: `frontend/src/components/shareLinks.js`
- Test: `frontend/tests/components/shareLinks.test.js`

**Interfaces:**
- Produces:
  - `EXPIRY_OPTIONS: Array<{ value: '1d'|'7d'|'30d'|'never', label: string, days: number }>`
  - `buildCreateBody({ source, path, expiry = '7d', password = '' }) → { source, path, unit: 'days', expires?: string, password?: string }`
  - `guestUrlFor(hash, origin) → string`
  - `parseGuestHash(pathname) → string | null`
  - `formatExpiry(expireUnix, nowMs = Date.now()) → string`
  - `shareDisplayName(share) → string`
  - `driveLabelFor(share) → 'My Drive' | 'Shared'`

- [ ] **Step 1: Write the failing tests**

```js
// frontend/tests/components/shareLinks.test.js
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
```

- [ ] **Step 2: Run the test, confirm it fails with "Failed to resolve import"**

Run: `cd frontend && npx vitest run tests/components/shareLinks.test.js`

- [ ] **Step 3: Implement**

```js
// frontend/src/components/shareLinks.js
export const EXPIRY_OPTIONS = [
  { value: '1d', label: '1 day', days: 1 },
  { value: '7d', label: '7 days', days: 7 },
  { value: '30d', label: '30 days', days: 30 },
  { value: 'never', label: 'Never', days: 0 },
]

// FBQ's POST /api/share takes expires as a string number plus a unit.
// We only ever use days; "never" means leaving expires out entirely.
export function buildCreateBody({ source, path, expiry = '7d', password = '' }) {
  const option = EXPIRY_OPTIONS.find((o) => o.value === expiry) ?? EXPIRY_OPTIONS[1]
  const body = { source, path, unit: 'days' }
  if (option.days > 0) body.expires = String(option.days)
  if (password) body.password = password
  return body
}

export function guestUrlFor(hash, origin = window.location.origin) {
  return `${origin}/s/${hash}`
}

const GUEST_PATH = /^\/s\/([A-Za-z0-9_-]+)\/?$/

export function parseGuestHash(pathname) {
  const match = GUEST_PATH.exec(pathname)
  return match ? match[1] : null
}

export function formatExpiry(expireUnix, nowMs = Date.now()) {
  if (!expireUnix) return 'Never'
  const diffMs = expireUnix * 1000 - nowMs
  if (diffMs <= 0) return 'Expired'
  const minutes = Math.round(diffMs / 60_000)
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? '' : 's'}`
  const hours = Math.round(diffMs / 3_600_000)
  if (hours < 24) return `in ${hours} hour${hours === 1 ? '' : 's'}`
  const days = Math.floor(diffMs / 86_400_000)
  return `in ${days} day${days === 1 ? '' : 's'}`
}

// FBQ reports share.source as the source's disk path (/srv/home) and
// share.path as the index path inside it (which, for home, starts with the
// owner's own folder). Labels only need the last segment.
export function driveLabelFor(share) {
  const source = String(share.source ?? '')
  return source === 'home' || source.endsWith('/home') ? 'My Drive' : 'Shared'
}

export function shareDisplayName(share) {
  const trimmed = String(share.path ?? '').replace(/\/+$/, '')
  const base = trimmed.slice(trimmed.lastIndexOf('/') + 1)
  return base || driveLabelFor(share)
}
```

- [ ] **Step 4: Run the test file, then the whole suite; both green**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/shareLinks.js frontend/tests/components/shareLinks.test.js
git commit -m "Add share link helpers: expiry presets, guest URL, labels"
```

---

### Task 2: Owner share API client

**Files:**
- Create: `frontend/src/api/share.js`
- Test: `frontend/tests/api/share.test.js`

**Interfaces:**
- Consumes: `buildCreateBody` (Task 1), `authorizedFetch`, `apiError` from `src/api/http.js`.
- Produces:
  - `createShare(source, path, { expiry, password }) → Promise<ShareResponse>` (FBQ object with `hash`, `expire`, `hasPassword`, `path`, `source`, `username`)
  - `listShares() → Promise<ShareResponse[]>`
  - `sharesFor(source, path) → Promise<ShareResponse[]>` (`[]` on 404)
  - `deleteShare(hash) → Promise<void>`

- [ ] **Step 1: Write the failing tests**

```js
// frontend/tests/api/share.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createShare, listShares, sharesFor, deleteShare } from '../../src/api/share.js'

describe('share API', () => {
  beforeEach(() => { global.fetch = vi.fn() })

  it('createShare posts the FBQ body and returns the share', async () => {
    const share = { hash: 'h1', expire: 0, hasPassword: false }
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(share) })
    const result = await createShare('share', '/Docs', { expiry: '30d', password: 'pw' })
    const [url, init] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/share')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ source: 'share', path: '/Docs', expires: '30', unit: 'days', password: 'pw' })
    expect(result).toEqual(share)
  })

  it('listShares GETs /api/share/list', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve([{ hash: 'a' }]) })
    expect(await listShares()).toEqual([{ hash: 'a' }])
    expect(global.fetch.mock.calls[0][0]).toBe('/api/share/list')
  })

  it('sharesFor GETs by path and source, and treats 404 as no links', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve([{ hash: 'a' }]) })
    expect(await sharesFor('home', '/Photos/x y')).toEqual([{ hash: 'a' }])
    expect(global.fetch.mock.calls[0][0]).toBe('/api/share?path=%2FPhotos%2Fx+y&source=home')
    global.fetch.mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found', clone() { return this }, json: () => Promise.reject(new Error('no body')) })
    expect(await sharesFor('home', '/none')).toEqual([])
  })

  it('deleteShare DELETEs by hash and throws the server message on failure', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, status: 200 })
    await deleteShare('h1')
    expect(global.fetch.mock.calls[0][0]).toBe('/api/share?hash=h1')
    expect(global.fetch.mock.calls[0][1].method).toBe('DELETE')
    global.fetch.mockResolvedValueOnce({ ok: false, status: 403, statusText: 'Forbidden', clone() { return this }, json: () => Promise.resolve({ message: 'not yours' }) })
    await expect(deleteShare('h2')).rejects.toThrow('not yours')
  })
})
```

- [ ] **Step 2: Run it; fails with "Failed to resolve import"**

- [ ] **Step 3: Implement**

```js
// frontend/src/api/share.js
import { authorizedFetch, apiError } from './http.js'
import { buildCreateBody } from '../components/shareLinks.js'

export async function createShare(source, path, { expiry, password } = {}) {
  const response = await authorizedFetch('/api/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildCreateBody({ source, path, expiry, password })),
  })
  if (!response.ok) throw await apiError(response)
  return response.json()
}

export async function listShares() {
  const response = await authorizedFetch('/api/share/list')
  if (!response.ok) throw await apiError(response)
  return response.json()
}

export async function sharesFor(source, path) {
  const params = new URLSearchParams({ path, source })
  const response = await authorizedFetch(`/api/share?${params.toString()}`)
  if (response.status === 404) return []
  if (!response.ok) throw await apiError(response)
  return response.json()
}

export async function deleteShare(hash) {
  const params = new URLSearchParams({ hash })
  const response = await authorizedFetch(`/api/share?${params.toString()}`, { method: 'DELETE' })
  if (!response.ok) throw await apiError(response)
}
```

- [ ] **Step 4: Run test file + suite; green**
- [ ] **Step 5: Commit** — `git add frontend/src/api/share.js frontend/tests/api/share.test.js && git commit -m "Add owner-side share API client"`

---

### Task 3: Guest public API client

**Files:**
- Create: `frontend/src/api/publicShare.js`
- Test: `frontend/tests/api/publicShare.test.js`

**Interfaces:**
- Consumes: `apiError` from `src/api/http.js` only (plain `fetch`, `credentials: 'omit'`).
- Produces:
  - `getShareInfo(hash) → Promise<{ title, hasPassword, expire, ... }>`
  - `listPublic(hash, path, password = '') → Promise<listing>` (same shape as `/api/resources`: `{ name, type, path, folders: [], files: [] }`)
  - `publicDownloadUrl(hash, file, { inline = false } = {}) → string`
  - `publicPreviewUrl(hash, path, size = 'small') → string`
  - `fetchPublicBlobUrl(hash, file, password = '') → Promise<string>` (object URL)
  - `fetchPublicText(hash, path, password = '') → Promise<string>`
  - Errors: `Error` with `.status` (from `apiError`).

- [ ] **Step 1: Write the failing tests**

```js
// frontend/tests/api/publicShare.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getShareInfo, listPublic, publicDownloadUrl, publicPreviewUrl, fetchPublicBlobUrl, fetchPublicText,
} from '../../src/api/publicShare.js'

describe('public share API', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
    global.URL.createObjectURL = vi.fn(() => 'blob:fake')
  })

  it('getShareInfo GETs share/info without credentials', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ hasPassword: true }) })
    expect(await getShareInfo('h1')).toEqual({ hasPassword: true })
    const [url, init] = global.fetch.mock.calls[0]
    expect(url).toBe('/public/api/share/info?hash=h1')
    expect(init.credentials).toBe('omit')
  })

  it('listPublic sends the password header only when set', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ files: [] }) })
    await listPublic('h1', '/Sub dir', 'secret')
    let [url, init] = global.fetch.mock.calls[0]
    expect(url).toBe('/public/api/resources?hash=h1&path=%2FSub+dir')
    expect(init.headers['X-SHARE-PASSWORD']).toBe('secret')
    await listPublic('h1', '/')
    ;[url, init] = global.fetch.mock.calls[1]
    expect(init.headers).toEqual({})
  })

  it('listPublic surfaces the status on failure', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized', clone() { return this }, json: () => Promise.reject(new Error('x')) })
    await expect(listPublic('h1', '/', 'wrong')).rejects.toMatchObject({ status: 401 })
  })

  it('builds download and preview URLs', () => {
    expect(publicDownloadUrl('h1', '/a b.jpg')).toBe('/public/api/resources/download?hash=h1&file=%2Fa+b.jpg')
    expect(publicDownloadUrl('h1', '/a.pdf', { inline: true })).toBe('/public/api/resources/download?hash=h1&file=%2Fa.pdf&inline=true')
    expect(publicPreviewUrl('h1', '/a.jpg')).toBe('/public/api/resources/preview?hash=h1&path=%2Fa.jpg&size=small')
  })

  it('fetchPublicBlobUrl fetches with the header and returns an object URL', async () => {
    const blob = new Blob(['x'])
    global.fetch.mockResolvedValue({ ok: true, status: 200, blob: () => Promise.resolve(blob) })
    expect(await fetchPublicBlobUrl('h1', '/a.jpg', 'pw')).toBe('blob:fake')
    expect(global.fetch.mock.calls[0][0]).toBe('/public/api/resources/download?hash=h1&file=%2Fa.jpg&inline=true')
    expect(global.fetch.mock.calls[0][1].headers['X-SHARE-PASSWORD']).toBe('pw')
    expect(global.URL.createObjectURL).toHaveBeenCalledWith(blob)
  })

  it('fetchPublicText returns the content field', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ content: 'hello' }) })
    expect(await fetchPublicText('h1', '/n.txt', '')).toBe('hello')
    expect(global.fetch.mock.calls[0][0]).toBe('/public/api/resources?hash=h1&path=%2Fn.txt&content=true')
  })
})
```

- [ ] **Step 2: Run it; fails on import**

- [ ] **Step 3: Implement**

```js
// frontend/src/api/publicShare.js
import { apiError } from './http.js'

// Guests have no session: plain fetch, no cookies, and a 401 here must never
// reach the logged-in app's unauthorized listeners.
function headersFor(password) {
  return password ? { 'X-SHARE-PASSWORD': password } : {}
}

async function publicFetch(url, password = '') {
  const response = await fetch(url, { credentials: 'omit', headers: headersFor(password) })
  if (!response.ok) throw await apiError(response)
  return response
}

export async function getShareInfo(hash) {
  const params = new URLSearchParams({ hash })
  const response = await publicFetch(`/public/api/share/info?${params.toString()}`)
  return response.json()
}

export async function listPublic(hash, path, password = '') {
  const params = new URLSearchParams({ hash, path })
  const response = await publicFetch(`/public/api/resources?${params.toString()}`, password)
  return response.json()
}

export function publicDownloadUrl(hash, file, { inline = false } = {}) {
  const params = new URLSearchParams({ hash, file })
  if (inline) params.set('inline', 'true')
  return `/public/api/resources/download?${params.toString()}`
}

export function publicPreviewUrl(hash, path, size = 'small') {
  const params = new URLSearchParams({ hash, path, size })
  return `/public/api/resources/preview?${params.toString()}`
}

export async function fetchPublicBlobUrl(hash, file, password = '') {
  const response = await publicFetch(publicDownloadUrl(hash, file, { inline: true }), password)
  return URL.createObjectURL(await response.blob())
}

export async function fetchPublicText(hash, path, password = '') {
  const params = new URLSearchParams({ hash, path, content: 'true' })
  const response = await publicFetch(`/public/api/resources?${params.toString()}`, password)
  const data = await response.json()
  return data.content
}
```

- [ ] **Step 4: Run test file + suite; green**
- [ ] **Step 5: Commit** — `git add frontend/src/api/publicShare.js frontend/tests/api/publicShare.test.js && git commit -m "Add guest public-share API client"`

---

### Task 4: `guestMedia.js` — media plan and Lightbox URLs for guests

**Files:**
- Create: `frontend/src/components/guestMedia.js`
- Test: `frontend/tests/components/guestMedia.test.js`

**Interfaces:**
- Consumes: `lightboxKindFor` from `src/components/lightboxKind.js`; `publicDownloadUrl`, `fetchPublicBlobUrl`, `fetchPublicText` from `src/api/publicShare.js`.
- Produces:
  - `mediaPlanFor(entry, { hasPassword }) → { kind: 'image'|'video'|'pdf'|'text'|'other', direct: boolean }` — with a password, `video` becomes `other` (download only).
  - `buildGuestUrls(entry, { hash, password }) → Promise<{ urls: { original, inline, preview, text }, revoke: () => void }>`; `urls` is what `Lightbox`'s `urls` prop (Task 5) accepts. Fields not applicable are `null`.

- [ ] **Step 1: Write the failing tests**

```js
// frontend/tests/components/guestMedia.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mediaPlanFor, buildGuestUrls } from '../../src/components/guestMedia.js'
import { fetchPublicBlobUrl, fetchPublicText } from '../../src/api/publicShare.js'

vi.mock('../../src/api/publicShare.js', () => ({
  publicDownloadUrl: (hash, file, { inline = false } = {}) => `/dl?hash=${hash}&file=${file}${inline ? '&inline=true' : ''}`,
  fetchPublicBlobUrl: vi.fn(),
  fetchPublicText: vi.fn(),
}))

const entry = (name, type) => ({ name, type, path: `/${name}` })

describe('mediaPlanFor', () => {
  it('uses direct URLs when there is no password', () => {
    expect(mediaPlanFor(entry('a.jpg', 'image/jpeg'), { hasPassword: false })).toEqual({ kind: 'image', direct: true })
    expect(mediaPlanFor(entry('a.mp4', 'video/mp4'), { hasPassword: false })).toEqual({ kind: 'video', direct: true })
    expect(mediaPlanFor(entry('a.docx', 'application/octet-stream'), { hasPassword: false })).toEqual({ kind: 'other', direct: true })
  })
  it('with a password, fetches media as blobs and does not stream video', () => {
    expect(mediaPlanFor(entry('a.jpg', 'image/jpeg'), { hasPassword: true })).toEqual({ kind: 'image', direct: false })
    expect(mediaPlanFor(entry('a.pdf', 'application/pdf'), { hasPassword: true })).toEqual({ kind: 'pdf', direct: false })
    expect(mediaPlanFor(entry('a.mp4', 'video/mp4'), { hasPassword: true })).toEqual({ kind: 'other', direct: false })
  })
})

describe('buildGuestUrls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.URL.revokeObjectURL = vi.fn()
  })

  it('direct: original/inline point at the public download URL, text is fetched', async () => {
    fetchPublicText.mockResolvedValue('hi')
    const image = await buildGuestUrls(entry('a.jpg', 'image/jpeg'), { hash: 'h', password: '' })
    expect(image.urls).toEqual({ original: '/dl?hash=h&file=/a.jpg', inline: '/dl?hash=h&file=/a.jpg&inline=true', preview: null, text: null })
    const text = await buildGuestUrls(entry('n.txt', 'text/plain'), { hash: 'h', password: '' })
    expect(text.urls.text).toBe('hi')
    expect(fetchPublicText).toHaveBeenCalledWith('h', '/n.txt', '')
    expect(fetchPublicBlobUrl).not.toHaveBeenCalled()
  })

  it('password: image and pdf become blob URLs that revoke() releases', async () => {
    fetchPublicBlobUrl.mockResolvedValue('blob:one')
    const pdf = await buildGuestUrls(entry('a.pdf', 'application/pdf'), { hash: 'h', password: 'pw' })
    expect(fetchPublicBlobUrl).toHaveBeenCalledWith('h', '/a.pdf', 'pw')
    expect(pdf.urls).toEqual({ original: 'blob:one', inline: 'blob:one', preview: null, text: null })
    pdf.revoke()
    expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:one')
  })

  it('password: text is fetched with the password, nothing to revoke', async () => {
    fetchPublicText.mockResolvedValue('secret text')
    const text = await buildGuestUrls(entry('n.md', 'text/plain'), { hash: 'h', password: 'pw' })
    expect(fetchPublicText).toHaveBeenCalledWith('h', '/n.md', 'pw')
    expect(text.urls.text).toBe('secret text')
    text.revoke()
    expect(global.URL.revokeObjectURL).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it; fails on import**

- [ ] **Step 3: Implement**

```js
// frontend/src/components/guestMedia.js
import { lightboxKindFor } from './lightboxKind.js'
import { publicDownloadUrl, fetchPublicBlobUrl, fetchPublicText } from '../api/publicShare.js'

// A password-protected share can only be satisfied with a request header,
// which <img>/<video>/<iframe> cannot send. Small things (images, PDFs,
// text) are fetched with the header and shown from a blob; video would mean
// downloading the whole file before playing, so it stays download-only.
export function mediaPlanFor(entry, { hasPassword }) {
  let kind = lightboxKindFor(entry, { onlyOfficeAvailable: false })
  if (hasPassword && kind === 'video') kind = 'other'
  return { kind, direct: !hasPassword }
}

export async function buildGuestUrls(entry, { hash, password }) {
  const { kind, direct } = mediaPlanFor(entry, { hasPassword: Boolean(password) })
  const urls = { original: null, inline: null, preview: null, text: null }
  const blobs = []
  if (kind === 'text') {
    urls.text = await fetchPublicText(hash, entry.path, password)
  } else if (direct) {
    urls.original = publicDownloadUrl(hash, entry.path)
    urls.inline = publicDownloadUrl(hash, entry.path, { inline: true })
  } else if (kind === 'image' || kind === 'pdf') {
    const blob = await fetchPublicBlobUrl(hash, entry.path, password)
    blobs.push(blob)
    urls.original = blob
    urls.inline = blob
  }
  return {
    urls,
    revoke() { for (const blob of blobs) URL.revokeObjectURL(blob) },
  }
}
```

- [ ] **Step 4: Run test file + suite; green**
- [ ] **Step 5: Commit** — `git add frontend/src/components/guestMedia.js frontend/tests/components/guestMedia.test.js && git commit -m "Add guest media plan: direct URLs or blobs per share password"`

---

### Task 5: `Lightbox` accepts a `urls` prop

**Files:**
- Modify: `frontend/src/components/Lightbox.vue` (script: props, `src`, `pdfSrc`, `imageSrc`, `onlyOfficeAvailable`, `loadText`; template unchanged)
- Test: `frontend/tests/components/Lightbox.test.js` (add cases; existing three must stay green)

**Interfaces:**
- Consumes: `urls` shape from Task 4: `{ original, inline, preview, text }`.
- Produces: `Lightbox` prop `urls: { type: Object, default: null }`. With `urls`: no `/api` calls at all, no OnlyOffice, image `src = urls.original`, pdf iframe `src = urls.inline`, text `<pre>` shows `urls.text`.

- [ ] **Step 1: Add failing tests** (append inside the existing `describe('Lightbox documents')`, reusing its mocks)

```js
  it('with urls, shows the given image without calling any API', async () => {
    const wrapper = mount(Lightbox, {
      props: {
        entry: { name: 'a.jpg', type: 'image/jpeg', path: '/a.jpg' },
        urls: { original: 'blob:img', inline: null, preview: null, text: null },
      },
    })
    await flushPromises()
    expect(wrapper.get('img').attributes('src')).toBe('blob:img')
    expect(getOnlyOfficeUrl).not.toHaveBeenCalled()
    expect(getFileText).not.toHaveBeenCalled()
  })

  it('with urls, a pdf iframe uses the inline URL and text comes from urls.text', async () => {
    const pdf = mount(Lightbox, {
      props: { entry: { name: 'a.pdf', type: 'application/pdf', path: '/a.pdf' }, urls: { original: 'blob:p', inline: 'blob:p', preview: null, text: null } },
    })
    await flushPromises()
    expect(pdf.get('iframe').attributes('src')).toBe('blob:p')
    const text = mount(Lightbox, {
      props: { entry: { name: 'n.txt', type: 'text/plain', path: '/n.txt' }, urls: { original: null, inline: null, preview: null, text: 'guest text' } },
    })
    await flushPromises()
    expect(text.get('pre').text()).toBe('guest text')
    expect(getFileText).not.toHaveBeenCalled()
  })

  it('with urls, an office document is never sent to OnlyOffice', async () => {
    getOnlyOfficeUrl.mockResolvedValue('https://office.example.com')
    const wrapper = mount(Lightbox, {
      props: { entry: { name: 'r.docx', type: 'application/octet-stream', path: '/r.docx' }, urls: { original: '/dl', inline: '/dl', preview: null, text: null } },
    })
    await flushPromises()
    expect(wrapper.find('.fake-editor').exists()).toBe(false)
    expect(wrapper.get('.fallback a').attributes('href')).toBe('/dl')
  })
```

- [ ] **Step 2: Run `npx vitest run tests/components/Lightbox.test.js`; the three new cases fail**

- [ ] **Step 3: Implement** — edit `Lightbox.vue` script:

```js
const props = defineProps({
  entry: { type: Object, required: true },
  // Guest pages hand in ready-made URLs (direct public URLs or blob URLs);
  // with urls set, this component never touches the authenticated API.
  urls: { type: Object, default: null },
})
```
Replace the OnlyOffice availability probe:
```js
const onlyOfficeAvailable = ref(false)
onMounted(async () => {
  if (props.urls) return
  onlyOfficeAvailable.value = Boolean(await getOnlyOfficeUrl())
})
```
Replace `src`, `pdfSrc`, `imageSrc`:
```js
const src = computed(() => props.urls ? props.urls.original : downloadUrl(source.value, props.entry.path))
const pdfSrc = computed(() => props.urls ? props.urls.inline : downloadUrl(source.value, props.entry.path, { inline: true }))
const imagePreviewFailed = ref(false)
const originalLoaded = ref(false)
const imageSrc = computed(() => {
  if (props.urls) return props.urls.original
  return pickImageSource({
    hasPreview: props.entry.hasPreview,
    previewFailed: imagePreviewFailed.value,
    originalLoaded: originalLoaded.value,
  }) === 'preview'
    ? previewUrl(source.value, props.entry.path, 'large')
    : src.value
})
```
In the original-image preloading `watch`, add `if (props.urls) return` right after the two resets. In `loadText`:
```js
async function loadText(path) {
  textFailed.value = false
  textContent.value = ''
  if (props.urls) {
    textContent.value = props.urls.text ?? ''
    return
  }
  try {
    textContent.value = await getFileText(source.value, path)
  } catch {
    textFailed.value = true
  }
}
```
Template needs no change (the `fallback` div already renders `<a :href="src">Download</a>`).

- [ ] **Step 4: Run the Lightbox tests, then the suite; green**
- [ ] **Step 5: Commit** — `git add frontend/src/components/Lightbox.vue frontend/tests/components/Lightbox.test.js && git commit -m "Lightbox: accept ready-made urls so guest pages can reuse it"`

---

### Task 6: `ShareDialog` + "Share link" in the context menu

**Files:**
- Create: `frontend/src/components/ShareDialog.vue`
- Modify: `frontend/src/components/ContextMenu.vue` (emit `share`), `frontend/src/App.vue` (host the dialog)
- Test: `frontend/tests/components/ShareDialog.test.js`, `frontend/tests/components/ContextMenuShare.test.js`

**Interfaces:**
- Consumes: Task 1 helpers, Task 2 client, `showError` from `src/errorToast.js`, `dialogFocus` directive from `src/components/dialogFocus.js`.
- Produces: `ShareDialog` props `{ entry: Object, source: String, path: String }`, emits `close`. `ContextMenu` emits `share` with `{ entry, source, path }`.

- [ ] **Step 1: Write the failing tests**

```js
// frontend/tests/components/ShareDialog.test.js
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ShareDialog from '../../src/components/ShareDialog.vue'
import { createShare, sharesFor, deleteShare } from '../../src/api/share.js'

vi.mock('../../src/api/share.js', () => ({
  createShare: vi.fn(), sharesFor: vi.fn(), deleteShare: vi.fn(), listShares: vi.fn(),
}))

function mountDialog() {
  return mount(ShareDialog, {
    props: { entry: { name: 'Docs', type: 'directory' }, source: 'share', path: '/Docs' },
    global: { stubs: { teleport: true } },
  })
}

describe('ShareDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sharesFor.mockResolvedValue([])
    Object.defineProperty(window, 'location', { value: { origin: 'https://nas.test' }, writable: true })
  })

  it('creates a 7-day link by default and shows the guest URL', async () => {
    createShare.mockResolvedValue({ hash: 'abc', expire: 0, hasPassword: false, path: '/Docs/', source: '/srv/share' })
    const wrapper = mountDialog()
    await flushPromises()
    await wrapper.get('button.create').trigger('click')
    await flushPromises()
    expect(createShare).toHaveBeenCalledWith('share', '/Docs', { expiry: '7d', password: '' })
    expect(wrapper.get('input.guest-url').element.value).toBe('https://nas.test/s/abc')
  })

  it('passes the chosen expiry and password through', async () => {
    createShare.mockResolvedValue({ hash: 'x', expire: 1, hasPassword: true, path: '/Docs/', source: '/srv/share' })
    const wrapper = mountDialog()
    await flushPromises()
    await wrapper.get('select.expiry').setValue('never')
    await wrapper.get('input.password').setValue('pw')
    await wrapper.get('button.create').trigger('click')
    expect(createShare).toHaveBeenCalledWith('share', '/Docs', { expiry: 'never', password: 'pw' })
  })

  it('lists existing links with expiry and lock, and revokes one', async () => {
    sharesFor.mockResolvedValue([
      { hash: 'old', expire: 0, hasPassword: true, path: '/Docs/', source: '/srv/share' },
    ])
    deleteShare.mockResolvedValue()
    const wrapper = mountDialog()
    await flushPromises()
    const row = wrapper.get('li.share-row')
    expect(row.text()).toContain('Never')
    expect(row.find('.lock').exists()).toBe(true)
    sharesFor.mockResolvedValue([])
    await row.get('button.revoke').trigger('click')
    await flushPromises()
    expect(deleteShare).toHaveBeenCalledWith('old')
    expect(wrapper.find('li.share-row').exists()).toBe(false)
  })

  it('emits close from the Done button', async () => {
    const wrapper = mountDialog()
    await flushPromises()
    await wrapper.get('button.menu-cancel').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
```

```js
// frontend/tests/components/ContextMenuShare.test.js
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ContextMenu from '../../src/components/ContextMenu.vue'
import { useAuthStore } from '../../src/stores/auth.js'

vi.mock('../../src/api/resources.js', () => ({
  renameItem: vi.fn(), moveItem: vi.fn(), transferItem: vi.fn(), downloadUrl: () => '/dl',
}))
vi.mock('../../src/api/trash.js', () => ({ softDelete: vi.fn() }))

describe('ContextMenu share action', () => {
  it('emits share with the entry, source and path', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useAuthStore().user = { id: 1, uid: '1', username: 'u', permissions: { admin: true } }
    const wrapper = mount(ContextMenu, {
      props: { entry: { name: 'a.jpg', type: 'image/jpeg', source: 'home' }, path: '/a.jpg', view: 'browse' },
      global: { plugins: [pinia] },
    })
    await wrapper.get('button.share-link').trigger('click')
    expect(wrapper.emitted('share')[0][0]).toEqual({ entry: { name: 'a.jpg', type: 'image/jpeg', source: 'home' }, source: 'home', path: '/a.jpg' })
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('offers no share button in the trash view', () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useAuthStore().user = { id: 1, uid: '1', username: 'u', permissions: { admin: true } }
    const wrapper = mount(ContextMenu, {
      props: { entry: { name: 'a.jpg', type: 'image/jpeg', source: 'home' }, path: '/.trash/a.jpg', view: 'trash' },
      global: { plugins: [pinia] },
    })
    expect(wrapper.find('button.share-link').exists()).toBe(false)
  })
})
```

- [ ] **Step 2: Run both files; ShareDialog fails on import, ContextMenu fails on missing button**

- [ ] **Step 3: Implement `ShareDialog.vue`**

```vue
<script setup>
import { computed, onMounted, ref } from 'vue'
import { dialogFocus as vDialogFocus } from './dialogFocus.js'
import { createShare, sharesFor, deleteShare } from '../api/share.js'
import { EXPIRY_OPTIONS, formatExpiry, guestUrlFor } from './shareLinks.js'
import { showError } from '../errorToast.js'

const props = defineProps({
  entry: { type: Object, required: true },
  source: { type: String, required: true },
  path: { type: String, required: true },
})
const emit = defineEmits(['close'])

const expiry = ref('7d')
const password = ref('')
const creating = ref(false)
const created = ref(null)
const existing = ref([])
const copied = ref('')

const createdUrl = computed(() => (created.value ? guestUrlFor(created.value.hash) : ''))
const driveLabel = computed(() => (props.source === 'home' ? 'My Drive' : 'Shared'))

async function loadExisting() {
  try {
    existing.value = await sharesFor(props.source, props.path)
  } catch (err) {
    showError(err.message || 'Could not load links.')
  }
}
onMounted(loadExisting)

async function doCreate() {
  creating.value = true
  try {
    created.value = await createShare(props.source, props.path, { expiry: expiry.value, password: password.value })
    password.value = ''
    await loadExisting()
  } catch (err) {
    showError(err.status === 403 ? "This item can't be shared." : err.message || 'Could not create link.')
  } finally {
    creating.value = false
  }
}

async function doRevoke(hash) {
  try {
    await deleteShare(hash)
    if (created.value?.hash === hash) created.value = null
    await loadExisting()
  } catch (err) {
    showError(err.message || 'Could not revoke link.')
  }
}

async function copy(url) {
  try {
    await navigator.clipboard.writeText(url)
    copied.value = url
    setTimeout(() => { if (copied.value === url) copied.value = '' }, 1500)
  } catch {
    showError('Copy failed. Select the link and copy it manually.')
  }
}
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <div class="menu share-dialog" v-dialog-focus="() => emit('close')" role="dialog" aria-modal="true" aria-label="Share link">
      <div class="menu-heading"><strong>{{ entry.displayName ?? entry.name }}</strong><span>{{ driveLabel }}</span></div>

      <label class="field">
        <span>Link expires</span>
        <select class="expiry" v-model="expiry">
          <option v-for="option in EXPIRY_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
      </label>
      <label class="field">
        <span>Password (optional)</span>
        <input class="password" v-model="password" type="password" autocomplete="new-password" placeholder="Leave empty for no password" />
      </label>
      <button class="create" :disabled="creating" @click="doCreate">{{ creating ? 'Creating…' : 'Create link' }}</button>

      <div v-if="created" class="created">
        <input class="guest-url" :value="createdUrl" readonly @focus="$event.target.select()" />
        <button type="button" @click="copy(createdUrl)">{{ copied === createdUrl ? 'Copied' : 'Copy' }}</button>
      </div>

      <p class="section-label">Existing links</p>
      <p v-if="!existing.length" class="hint">No links for this item yet.</p>
      <ul v-else class="share-list">
        <li v-for="share in existing" :key="share.hash" class="share-row">
          <span class="share-expiry">{{ formatExpiry(share.expire) }}</span>
          <span v-if="share.hasPassword" class="lock" title="Password protected">🔒</span>
          <button type="button" @click="copy(guestUrlFor(share.hash))">{{ copied === guestUrlFor(share.hash) ? 'Copied' : 'Copy' }}</button>
          <button type="button" class="danger revoke" @click="doRevoke(share.hash)">Revoke</button>
        </li>
      </ul>

      <button class="menu-cancel" @click="emit('close')">Done</button>
    </div>
  </div>
</template>

<style scoped>
.backdrop { position: fixed; inset: 0; background: rgba(15, 18, 25, 0.45); display: flex; align-items: flex-end; justify-content: center; z-index: 40; }
.menu { width: min(480px, 100%); background: var(--bg-elevated); border-radius: 16px 16px 0 0; padding: 16px; display: flex; flex-direction: column; gap: 10px; max-height: 85dvh; overflow: auto; }
@media (min-width: 641px) { .backdrop { align-items: center; } .menu { border-radius: 16px; } }
.menu-heading { display: flex; flex-direction: column; gap: 2px; margin-bottom: 4px; }
.menu-heading span { font-size: 12px; color: var(--text-muted); }
.field { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--text-muted); }
.field select, .field input, .guest-url { padding: 10px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg); color: var(--text); font-size: 15px; }
.created { display: flex; gap: 8px; }
.created .guest-url { flex: 1; min-width: 0; }
.section-label { margin: 8px 0 0; font-size: 12px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .04em; }
.share-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.share-row { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 10px; }
.share-expiry { flex: 1; font-size: 13px; }
.hint { font-size: 13px; color: var(--text-muted); margin: 0; }
button { min-height: 40px; padding: 0 14px; border-radius: 10px; border: 1px solid var(--border); background: var(--bg); color: var(--text); font-size: 14px; }
button.create { background: var(--accent); color: #fff; border-color: transparent; }
button.danger { color: #d33; }
.menu-cancel { margin-top: 4px; }
</style>
```

- [ ] **Step 4: Wire `ContextMenu.vue`** — change the emits line to `const emit = defineEmits(['close', 'changed', 'share'])`, add:

```js
function doShare() {
  emit('share', { entry: props.entry, source: source.value, path: props.path })
  emit('close')
}
```
and in the `<template v-else>` block insert, right after the Download anchor:
```html
        <button class="share-link" @click="doShare">Share link</button>
```

- [ ] **Step 5: Host it in `App.vue`** — add `import ShareDialog from './components/ShareDialog.vue'`, `const sharing = ref(null)`, on the `<ContextMenu>` add `@share="sharing = $event"`, and after the `<Lightbox …/>` line add:

```html
    <ShareDialog v-if="sharing" :entry="sharing.entry" :source="sharing.source" :path="sharing.path" @close="sharing = null" />
```

- [ ] **Step 6: Run the two test files, then the suite; green**
- [ ] **Step 7: Commit** — `git add frontend/src/components/ShareDialog.vue frontend/src/components/ContextMenu.vue frontend/src/App.vue frontend/tests/components/ShareDialog.test.js frontend/tests/components/ContextMenuShare.test.js && git commit -m "Share dialog: create, copy and revoke guest links from the file menu"`

---

### Task 7: `LinksView` + "Links" navigation

**Files:**
- Create: `frontend/src/components/LinksView.vue`
- Modify: `frontend/src/components/UiIcon.vue` (add `link` glyph), `Sidebar.vue` (nav item), `TopBar.vue` (heading), `App.vue` (view routing)
- Test: `frontend/tests/components/LinksView.test.js`

**Interfaces:**
- Consumes: `listShares`, `deleteShare` (Task 2); `shareDisplayName`, `driveLabelFor`, `formatExpiry`, `guestUrlFor` (Task 1); `useAuthStore().isAdmin`.
- Produces: `LinksView` (no props). `App.vue` view value `'links'`; Sidebar emits `navigate` with `'links'`.

- [ ] **Step 1: Write the failing test**

```js
// frontend/tests/components/LinksView.test.js
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import LinksView from '../../src/components/LinksView.vue'
import { useAuthStore } from '../../src/stores/auth.js'
import { listShares, deleteShare } from '../../src/api/share.js'

vi.mock('../../src/api/share.js', () => ({ listShares: vi.fn(), deleteShare: vi.fn(), createShare: vi.fn(), sharesFor: vi.fn() }))

function mountView(user) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().user = user
  return mount(LinksView, { global: { plugins: [pinia] } })
}

describe('LinksView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'location', { value: { origin: 'https://nas.test' }, writable: true })
  })

  it('lists links with name, drive and expiry; admins also see the owner', async () => {
    listShares.mockResolvedValue([
      { hash: 'a', expire: 0, hasPassword: false, path: '/alice/Photos/', source: '/srv/home', username: 'alice' },
      { hash: 'b', expire: 1, hasPassword: true, path: '/report.pdf', source: '/srv/share', username: 'bob' },
    ])
    const wrapper = mountView({ id: 1, uid: '1', username: 'admin', permissions: { admin: true } })
    await flushPromises()
    const rows = wrapper.findAll('tr.link-row')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('Photos')
    expect(rows[0].text()).toContain('My Drive')
    expect(rows[0].text()).toContain('Never')
    expect(rows[0].text()).toContain('alice')
    expect(rows[1].text()).toContain('Expired')
    expect(rows[1].find('.lock').exists()).toBe(true)
  })

  it('hides the owner column for non-admins and revokes in place', async () => {
    listShares.mockResolvedValue([{ hash: 'a', expire: 0, hasPassword: false, path: '/x/', source: '/srv/share', username: 'me' }])
    deleteShare.mockResolvedValue()
    const wrapper = mountView({ id: 2, uid: '2', username: 'me', permissions: { admin: false } })
    await flushPromises()
    expect(wrapper.find('th.owner').exists()).toBe(false)
    await wrapper.get('button.revoke').trigger('click')
    await flushPromises()
    expect(deleteShare).toHaveBeenCalledWith('a')
    expect(wrapper.find('tr.link-row').exists()).toBe(false)
    expect(wrapper.text()).toContain('No links yet')
  })
})
```

- [ ] **Step 2: Run it; fails on import**

- [ ] **Step 3: Implement `LinksView.vue`**

```vue
<script setup>
import { onMounted, ref } from 'vue'
import { listShares, deleteShare } from '../api/share.js'
import { shareDisplayName, driveLabelFor, formatExpiry, guestUrlFor } from './shareLinks.js'
import { useAuthStore } from '../stores/auth.js'
import { showError } from '../errorToast.js'

const auth = useAuthStore()
const shares = ref([])
const loading = ref(true)
const copied = ref('')

async function load() {
  loading.value = true
  try {
    shares.value = await listShares()
  } catch (err) {
    showError(err.message || 'Could not load links.')
  } finally {
    loading.value = false
  }
}
onMounted(load)

async function revoke(hash) {
  try {
    await deleteShare(hash)
    shares.value = shares.value.filter((s) => s.hash !== hash)
  } catch (err) {
    showError(err.message || 'Could not revoke link.')
  }
}

async function copy(hash) {
  const url = guestUrlFor(hash)
  try {
    await navigator.clipboard.writeText(url)
    copied.value = hash
    setTimeout(() => { if (copied.value === hash) copied.value = '' }, 1500)
  } catch {
    showError('Copy failed.')
  }
}
</script>

<template>
  <section class="links-view" aria-label="Share links">
    <div v-if="loading" class="empty-state" role="status"><span class="loading-spinner"></span><h2>Loading links…</h2></div>
    <div v-else-if="!shares.length" class="empty-state" role="status"><h2>No links yet</h2><p>Use “Share link” on any file or folder to create one.</p></div>
    <div v-else class="table-wrap">
      <table class="links-table">
        <thead>
          <tr>
            <th>Item</th><th>Drive</th><th v-if="auth.isAdmin" class="owner">Owner</th><th>Expires</th><th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="share in shares" :key="share.hash" class="link-row">
            <td class="item">{{ shareDisplayName(share) }} <span v-if="share.hasPassword" class="lock" title="Password protected">🔒</span></td>
            <td>{{ driveLabelFor(share) }}</td>
            <td v-if="auth.isAdmin">{{ share.username }}</td>
            <td>{{ formatExpiry(share.expire) }}</td>
            <td class="actions">
              <button type="button" @click="copy(share.hash)">{{ copied === share.hash ? 'Copied' : 'Copy' }}</button>
              <button type="button" class="revoke danger" @click="revoke(share.hash)">Revoke</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.links-view { padding: 0 16px 16px; }
.table-wrap { overflow-x: auto; }
.links-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.links-table th { text-align: left; font-weight: 600; color: var(--text-muted); font-size: 12px; padding: 8px; border-bottom: 1px solid var(--border); }
.links-table td { padding: 10px 8px; border-bottom: 1px solid var(--border); vertical-align: middle; }
.actions { display: flex; gap: 6px; justify-content: flex-end; }
button { min-height: 36px; padding: 0 12px; border-radius: 10px; border: 1px solid var(--border); background: var(--bg); color: var(--text); }
button.danger { color: #d33; }
.empty-state { text-align: center; padding: 48px 16px; color: var(--text-muted); }
</style>
```

- [ ] **Step 4: Navigation wiring**
  - `UiIcon.vue`: add before the final `</svg>`-side fallbacks (next to the `trash` glyph):
    ```html
    <g v-else-if="name === 'link'">
      <path d="M8.2 11.8a3 3 0 0 0 4.2 0l2.4-2.4a3 3 0 0 0-4.2-4.2l-1 1" />
      <path d="M11.8 8.2a3 3 0 0 0-4.2 0L5.2 10.6a3 3 0 0 0 4.2 4.2l1-1" />
    </g>
    ```
  - `Sidebar.vue`: after the Trash button add:
    ```html
    <button class="sidebar-item" :class="{ active: view === 'links' }" :aria-current="view === 'links' ? 'page' : undefined" @click="emit('navigate', 'links')">
      <span class="sidebar-icon"><UiIcon name="link" /></span>
      <span class="sidebar-label">Links</span>
    </button>
    ```
  - `TopBar.vue` line 17: extend the heading ternary with `props.view === 'links' ? 'Links' :` before the `trash` case.
  - `App.vue`: import `LinksView`; in `onNavigate` the generic branch already sets `view.value = nextView` (nothing to load for `'links'`). In the template, wrap the existing content so the links view replaces the file area: immediately inside `<main class="content" …>` add `<LinksView v-if="view === 'links'" />` and change the following `content-caption` div to `<div v-else class="content-caption">…`, plus make the `empty-state`, `FileGrid` and `FileListView` chain start with `v-else-if` accordingly (the first `empty-state` `v-if` becomes `v-else-if`). `activeEntries` returns `files.entries` for `'links'`, which is fine because nothing renders it.

- [ ] **Step 5: Run the test file and the suite; green. Also `npm run build`.**
- [ ] **Step 6: Commit** — `git add -A frontend/src frontend/tests && git commit -m "Links view: list, copy and revoke my share links from the sidebar"`

---

### Task 8: Guest SPA — `GuestApp`, `GuestShareView`, `GuestFileList`, `main.js`

**Files:**
- Create: `frontend/src/components/GuestFileList.vue`, `frontend/src/components/GuestShareView.vue`, `frontend/src/GuestApp.vue`
- Modify: `frontend/src/main.js`
- Test: `frontend/tests/components/GuestShareView.test.js`

**Interfaces:**
- Consumes: Task 3 client, Task 4 `buildGuestUrls`/`mediaPlanFor`, Task 5 `Lightbox` `urls`, `parseGuestHash` (Task 1), `canRequestThumbnail`/`formatSize`/`formatRelativeTime` (`fileFormat.js`), `FileGlyph`, `VaultaBrand`, `useThemeStore`.
- Produces: `GuestApp` prop `hash`; `GuestShareView` prop `hash`; `GuestFileList` props `{ entries, hash, hasPassword }`, emits `open(entry)`, `download(entry)`.

- [ ] **Step 1: Write the failing test**

```js
// frontend/tests/components/GuestShareView.test.js
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import GuestShareView from '../../src/components/GuestShareView.vue'
import { getShareInfo, listPublic } from '../../src/api/publicShare.js'

vi.mock('../../src/api/publicShare.js', () => ({
  getShareInfo: vi.fn(),
  listPublic: vi.fn(),
  publicDownloadUrl: (hash, file, { inline = false } = {}) => `/public/api/resources/download?hash=${hash}&file=${encodeURIComponent(file)}${inline ? '&inline=true' : ''}`,
  publicPreviewUrl: (hash, path) => `/public/api/resources/preview?hash=${hash}&path=${encodeURIComponent(path)}`,
  fetchPublicBlobUrl: vi.fn(),
  fetchPublicText: vi.fn(),
}))
vi.mock('plyr', () => ({ default: class { destroy() {} } }))
vi.mock('plyr/dist/plyr.css', () => ({}))

const listing = {
  name: 'Docs', type: 'directory', path: '/',
  folders: [{ name: 'Sub', type: 'directory', modified: '2026-09-01T00:00:00Z', size: 0 }],
  files: [
    { name: 'a.jpg', type: 'image/jpeg', size: 1024, modified: '2026-09-01T00:00:00Z', hasPreview: true },
    { name: 'guide.pdf', type: 'application/pdf', size: 2048, modified: '2026-09-01T00:00:00Z', hasPreview: true },
  ],
}

function mountView() {
  const pinia = createPinia()
  setActivePinia(pinia)
  return mount(GuestShareView, { props: { hash: 'h1' }, global: { plugins: [pinia] } })
}

describe('GuestShareView', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows the unavailable screen when the share does not exist', async () => {
    getShareInfo.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }))
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.text()).toContain('ลิงก์นี้ใช้ไม่ได้แล้ว')
    expect(listPublic).not.toHaveBeenCalled()
  })

  it('lists an open share with folders first, thumbnails for images but not PDFs, and download links', async () => {
    getShareInfo.mockResolvedValue({ title: 'Docs', hasPassword: false })
    listPublic.mockResolvedValue(listing)
    const wrapper = mountView()
    await flushPromises()
    expect(listPublic).toHaveBeenCalledWith('h1', '/', '')
    const rows = wrapper.findAll('.guest-row')
    expect(rows.map((r) => r.get('.guest-name').text())).toEqual(['Sub', 'a.jpg', 'guide.pdf'])
    expect(rows[1].find('img.guest-thumb').attributes('src')).toContain('/public/api/resources/preview?hash=h1&path=%2Fa.jpg')
    expect(rows[2].find('img.guest-thumb').exists()).toBe(false)
    expect(rows[1].get('a.guest-download').attributes('href')).toBe('/public/api/resources/download?hash=h1&file=%2Fa.jpg')
  })

  it('navigates into a folder and back with the breadcrumb', async () => {
    getShareInfo.mockResolvedValue({ title: 'Docs', hasPassword: false })
    listPublic.mockResolvedValue(listing)
    const wrapper = mountView()
    await flushPromises()
    await wrapper.findAll('.guest-row')[0].get('button.guest-open').trigger('click')
    await flushPromises()
    expect(listPublic).toHaveBeenLastCalledWith('h1', '/Sub', '')
    await wrapper.get('button.crumb-root').trigger('click')
    await flushPromises()
    expect(listPublic).toHaveBeenLastCalledWith('h1', '/', '')
  })

  it('gates a password share, rejects a wrong password and accepts the right one', async () => {
    getShareInfo.mockResolvedValue({ title: 'Docs', hasPassword: true })
    listPublic.mockRejectedValueOnce(Object.assign(new Error('unauthorized'), { status: 401 }))
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.find('.guest-row').exists()).toBe(false)
    await wrapper.get('input.guest-password').setValue('nope')
    await wrapper.get('form.password-gate').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('รหัสไม่ถูกต้อง')
    listPublic.mockResolvedValue(listing)
    await wrapper.get('input.guest-password').setValue('right')
    await wrapper.get('form.password-gate').trigger('submit')
    await flushPromises()
    expect(listPublic).toHaveBeenLastCalledWith('h1', '/', 'right')
    expect(wrapper.findAll('.guest-row')).toHaveLength(3)
    // password shares never load thumbnails by URL and never expose a plain download href
    expect(wrapper.find('img.guest-thumb').exists()).toBe(false)
    expect(wrapper.find('a.guest-download').exists()).toBe(false)
    expect(wrapper.find('button.guest-download').exists()).toBe(true)
  })
})
```

- [ ] **Step 2: Run it; fails on import**

- [ ] **Step 3: Implement `GuestFileList.vue`**

```vue
<script setup>
import FileGlyph from './FileGlyph.vue'
import { canRequestThumbnail, formatSize, formatRelativeTime } from './fileFormat.js'
import { publicPreviewUrl, publicDownloadUrl } from '../api/publicShare.js'

const props = defineProps({
  entries: { type: Array, required: true },
  hash: { type: String, required: true },
  hasPassword: { type: Boolean, default: false },
})
const emit = defineEmits(['open', 'download'])

function thumbFor(entry) {
  // Thumbnails load by URL, which cannot carry the share password header.
  if (props.hasPassword || !canRequestThumbnail(entry)) return null
  return publicPreviewUrl(props.hash, entry.path, 'small')
}
</script>

<template>
  <ul class="guest-list">
    <li v-for="entry in entries" :key="entry.path" class="guest-row">
      <button type="button" class="guest-open" :aria-label="`Open ${entry.name}`" @click="emit('open', entry)">
        <img v-if="thumbFor(entry)" class="guest-thumb" :src="thumbFor(entry)" :alt="entry.name" loading="lazy" />
        <FileGlyph v-else class="guest-glyph" :entry="entry" />
        <span class="guest-text">
          <span class="guest-name">{{ entry.name }}</span>
          <span class="guest-meta">{{ entry.type === 'directory' ? 'Folder' : formatSize(entry.size) }} · {{ formatRelativeTime(entry.modified) }}</span>
        </span>
      </button>
      <template v-if="entry.type !== 'directory'">
        <a v-if="!hasPassword" class="guest-download" :href="publicDownloadUrl(hash, entry.path)" download>Download</a>
        <button v-else type="button" class="guest-download" @click="emit('download', entry)">Download</button>
      </template>
    </li>
  </ul>
</template>

<style scoped>
.guest-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.guest-row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 12px; background: var(--bg-elevated); }
.guest-open { flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; border: none; background: none; color: inherit; text-align: left; padding: 0; min-height: 44px; }
.guest-thumb { width: 44px; height: 44px; object-fit: cover; border-radius: 8px; flex-shrink: 0; }
.guest-glyph { width: 44px; height: 44px; flex-shrink: 0; }
.guest-text { display: flex; flex-direction: column; min-width: 0; }
.guest-name { font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.guest-meta { font-size: 12px; color: var(--text-muted); }
.guest-download { min-height: 36px; padding: 0 12px; border-radius: 10px; border: 1px solid var(--border); background: var(--bg); color: var(--accent); font-size: 13px; text-decoration: none; display: inline-flex; align-items: center; }
</style>
```

- [ ] **Step 4: Implement `GuestShareView.vue`**

```vue
<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import VaultaBrand from './VaultaBrand.vue'
import GuestFileList from './GuestFileList.vue'
import Lightbox from './Lightbox.vue'
import { getShareInfo, listPublic, fetchPublicBlobUrl } from '../api/publicShare.js'
import { buildGuestUrls, mediaPlanFor } from './guestMedia.js'

const props = defineProps({ hash: { type: String, required: true } })

const state = ref('loading') // loading | password | browse | unavailable | error
const info = ref(null)
const password = ref('')
const passwordInput = ref('')
const passwordError = ref('')
const currentPath = ref('/')
const entries = ref([])
const listingError = ref('')
const previewing = ref(null)
const previewUrls = ref(null)
let revokePreview = () => {}

const hasPassword = computed(() => Boolean(info.value?.hasPassword))
const title = computed(() => info.value?.title || 'Shared with you')
const crumbs = computed(() => currentPath.value.split('/').filter(Boolean))

function withPaths(listing, base) {
  const prefix = base.endsWith('/') ? base : `${base}/`
  const stamp = (e) => ({ ...e, path: `${prefix}${e.name}` })
  return [...(listing.folders || []).map(stamp), ...(listing.files || []).map(stamp)]
}

async function load(path) {
  listingError.value = ''
  try {
    const listing = await listPublic(props.hash, path, password.value)
    currentPath.value = path
    entries.value = withPaths(listing, path)
    state.value = 'browse'
  } catch (err) {
    if (err.status === 401) throw err
    if (err.status === 404) { state.value = 'unavailable'; return }
    listingError.value = err.message || 'Could not load this folder.'
    if (state.value === 'loading') state.value = 'error'
  }
}

async function start() {
  try {
    info.value = await getShareInfo(props.hash)
  } catch (err) {
    state.value = err.status === 404 ? 'unavailable' : 'error'
    return
  }
  if (info.value.hasPassword) { state.value = 'password'; return }
  await load('/')
}
start()

async function submitPassword() {
  passwordError.value = ''
  password.value = passwordInput.value
  try {
    await load('/')
  } catch (err) {
    if (err.status === 401) {
      password.value = ''
      passwordError.value = 'รหัสไม่ถูกต้อง'
      state.value = 'password'
    }
  }
}

function navigateTo(path) { return load(path).catch(() => {}) }
function crumbPath(index) { return `/${crumbs.value.slice(0, index + 1).join('/')}` }

async function openEntry(entry) {
  if (entry.type === 'directory') return navigateTo(entry.path)
  const plan = mediaPlanFor(entry, { hasPassword: hasPassword.value })
  if (plan.kind === 'other') return downloadEntry(entry)
  try {
    const built = await buildGuestUrls(entry, { hash: props.hash, password: password.value })
    revokePreview = built.revoke
    previewUrls.value = built.urls
    previewing.value = entry
  } catch (err) {
    listingError.value = err.message || 'Could not open this file.'
  }
}

function closePreview() {
  previewing.value = null
  previewUrls.value = null
  revokePreview()
  revokePreview = () => {}
}
onBeforeUnmount(closePreview)

async function downloadEntry(entry) {
  try {
    const url = hasPassword.value
      ? await fetchPublicBlobUrl(props.hash, entry.path, password.value)
      : null
    const a = document.createElement('a')
    a.href = url ?? `/public/api/resources/download?${new URLSearchParams({ hash: props.hash, file: entry.path })}`
    a.download = entry.name
    document.body.appendChild(a)
    a.click()
    a.remove()
    if (url) setTimeout(() => URL.revokeObjectURL(url), 10_000)
  } catch (err) {
    listingError.value = err.message || 'Download failed.'
  }
}
</script>

<template>
  <div class="guest-shell">
    <header class="guest-header">
      <VaultaBrand compact />
      <div class="guest-title"><h1>{{ title }}</h1><p>Shared with you · read only</p></div>
    </header>

    <main class="guest-main">
      <div v-if="state === 'loading'" class="guest-status" role="status">Opening…</div>

      <div v-else-if="state === 'unavailable'" class="guest-status">
        <h2>ลิงก์นี้ใช้ไม่ได้แล้ว</h2>
        <p>The link may have expired or been revoked.</p>
        <a href="/">Back to Vaulta</a>
      </div>

      <div v-else-if="state === 'error'" class="guest-status">
        <h2>Something went wrong</h2>
        <p>{{ listingError || 'Please try again.' }}</p>
        <button type="button" @click="start">Retry</button>
      </div>

      <form v-else-if="state === 'password'" class="password-gate" @submit.prevent="submitPassword">
        <label>This link needs a password
          <input class="guest-password" v-model="passwordInput" type="password" autocomplete="off" autofocus />
        </label>
        <p v-if="passwordError" class="gate-error" role="alert">{{ passwordError }}</p>
        <button type="submit">Open</button>
      </form>

      <template v-else>
        <nav class="crumbs" aria-label="Breadcrumb">
          <button type="button" class="crumb-root" @click="navigateTo('/')">{{ title }}</button>
          <template v-for="(crumb, index) in crumbs" :key="index">
            <span class="crumb-sep">/</span>
            <button type="button" class="crumb" @click="navigateTo(crumbPath(index))">{{ crumb }}</button>
          </template>
        </nav>
        <p v-if="listingError" class="gate-error" role="alert">{{ listingError }}</p>
        <p v-if="!entries.length" class="guest-status">This folder is empty.</p>
        <GuestFileList v-else :entries="entries" :hash="hash" :has-password="hasPassword" @open="openEntry" @download="downloadEntry" />
      </template>
    </main>

    <Lightbox v-if="previewing" :entry="previewing" :urls="previewUrls" @close="closePreview" />
  </div>
</template>

<style scoped>
.guest-shell { min-height: 100dvh; background: var(--bg); color: var(--text); display: flex; flex-direction: column; }
.guest-header { display: flex; align-items: center; gap: 14px; padding: max(12px, env(safe-area-inset-top)) 16px 12px; border-bottom: 1px solid var(--border); background: var(--bg-elevated); }
.guest-title h1 { margin: 0; font-size: 18px; }
.guest-title p { margin: 0; font-size: 12px; color: var(--text-muted); }
.guest-main { flex: 1; width: min(760px, 100%); margin: 0 auto; padding: 16px; box-sizing: border-box; }
.guest-status { text-align: center; padding: 48px 16px; color: var(--text-muted); }
.guest-status h2 { color: var(--text); margin: 0 0 8px; }
.password-gate { display: flex; flex-direction: column; gap: 10px; max-width: 360px; margin: 48px auto; }
.password-gate label { display: flex; flex-direction: column; gap: 6px; font-size: 14px; }
.password-gate input { padding: 10px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg-elevated); color: var(--text); font-size: 16px; }
.password-gate button, .guest-status button { min-height: 44px; border-radius: 10px; border: none; background: var(--accent); color: #fff; font-size: 15px; }
.gate-error { color: #d33; font-size: 13px; margin: 0; }
.crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-bottom: 12px; font-size: 14px; }
.crumbs button { border: none; background: none; color: var(--accent); padding: 4px 2px; font-size: inherit; }
.crumb-sep { color: var(--text-muted); }
</style>
```

- [ ] **Step 5: `GuestApp.vue` and `main.js`**

```vue
<!-- frontend/src/GuestApp.vue -->
<script setup>
import { watch } from 'vue'
import { useThemeStore } from './stores/theme.js'
import GuestShareView from './components/GuestShareView.vue'

defineProps({ hash: { type: String, required: true } })
const theme = useThemeStore()
watch(() => theme.current, (value) => {
  document.documentElement.dataset.theme = value
}, { immediate: true })
</script>

<template>
  <div id="guest-app">
    <GuestShareView :hash="hash" />
  </div>
</template>
```

```js
// frontend/src/main.js
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import GuestApp from './GuestApp.vue'
import { parseGuestHash } from './components/shareLinks.js'
import './style.css'
import './vaulta-theme.css'

// /s/<hash> is the guest entry: no login, no user stores, only the public API.
const guestHash = parseGuestHash(window.location.pathname)
const app = guestHash ? createApp(GuestApp, { hash: guestHash }) : createApp(App)
app.use(createPinia()).mount('#app')
```

- [ ] **Step 6: Run the test file, the suite, and `npm run build`; all green**
- [ ] **Step 7: Commit** — `git add frontend/src/main.js frontend/src/GuestApp.vue frontend/src/components/GuestShareView.vue frontend/src/components/GuestFileList.vue frontend/tests/components/GuestShareView.test.js && git commit -m "Guest share page: /s/<hash> browses, previews and downloads via the public API"`

---

### Task 9: Routing, dev proxy, docs, image check

**Files:**
- Modify: `docker/nginx.conf`, `frontend/vite.config.js`, `README.md`, `AGENTS.md`
- Verify: `docker build` + `nginx -t`

- [ ] **Step 1: nginx** — in `docker/nginx.conf`, before `location /nasapi/ {` add:

```nginx
    # Guest share links: only FBQ's hash-keyed public API is exposed. FBQ's
    # own guest UI (/public/share/, /public/static/) stays LAN-only.
    location /public/api/ {
        proxy_pass http://127.0.0.1:30334/public/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        client_max_body_size 0;
    }
```

- [ ] **Step 2: Vite** — `navigateFallbackDenylist: [/^\/api\//, /^\/nasapi\//, /^\/public\//]` and add to `server.proxy`:
```js
      '/public': {
        target: process.env.VITE_API_TARGET || 'http://192.168.1.22:30334',
        changeOrigin: true,
      },
```

- [ ] **Step 3: Docs**
  - `README.md` Features: add `- **Guest links.** Share any file or folder as a read-only link (`/s/<hash>`) with an expiry and an optional password; guests browse, preview and download in Vaulta's own UI without an account. Backed by FBQ's share system.`
  - `README.md` "How it works" diagram: add a line `├── /public/api/*  ──> FileBrowser Quantum (guest share links, no login)`.
  - `AGENTS.md` layout bullet for `frontend/src/api/*.js`: mention `share.js` (owner) and `publicShare.js` (guest, plain fetch + `X-SHARE-PASSWORD`), and a gotcha: `**Password shares can only be read with a request header** — the share token is never given to guests, so `<img>`/`<video>` can't authenticate; `guestMedia.js` fetches blobs instead and video is download-only.`

- [ ] **Step 4: Build and check nginx config**

```bash
cd /Users/codex074/nas-webui/.worktrees/nas-webui-polish
docker build --platform linux/amd64 -f docker/Dockerfile -t nas-webui:local .
docker run --rm --platform linux/amd64 --entrypoint nginx nas-webui:local -t
```
Expected: `syntax is ok` / `test is successful`.

- [ ] **Step 5: Commit** — `git add docker/nginx.conf frontend/vite.config.js README.md AGENTS.md && git commit -m "Route /public/api to FBQ for guest links; document the share feature"`

---

## Deploy & verify (done by the orchestrator, not a subagent)

Follow `AGENTS.md` "Deploy": tests + build → save → scp → pve2 http.server → VM curl → md5 → `docker load` → `docker compose -p ix-nas-webui up -d` → prune → cleanup. Then, with a real account: create a link for a folder in Shared, open `/s/<hash>` in a private window (listing, image, PDF, download); create a password link (wrong password rejected, right one works, video shows Download only); revoke → unavailable screen. Record in `docs/deployments/2026-09-09-guest-share-links.md`.
