# NAS Web UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a custom, Google-Drive-style web UI for the NAS, backed entirely by FileBrowser Quantum's existing REST API, and deploy it as a new TrueNAS App that replaces FileBrowser Quantum's own UI at `https://nas.codex074.com`.

**Architecture:** A Vue 3 + Vite single-page app talks directly to FileBrowser Quantum's REST API (same-origin, via an nginx reverse proxy that forwards `/api/*` to `localhost:30334`). The built static site + nginx are packaged into one Docker image, installed on TrueNAS as a "Custom App" running with `network_mode: host` (same pattern already used by the `nas-cloudflared` app), so it can reach FileBrowser Quantum on `localhost:30334` with no extra Docker networking.

**Tech Stack:** Vue 3 (Composition API), Vite, Pinia (state), Vitest + `@vue/test-utils` (unit tests), plain CSS (design tokens as CSS custom properties — no UI kit, since the whole point is a from-scratch look). Nginx (alpine) for serving + proxying in production.

**Spec:** `docs/superpowers/specs/2026-09-06-nas-webui-design.md`

## Global Constraints

- Palette: light backgrounds, blue accent `#2563eb` (from spec's "Light + Blue" choice). Exact tokens are defined in Task 1.
- File tiles use the "info-dense" style: no drop shadow, thin `1px solid #eef0f3` border, an always-visible `⋮` menu button, and a metadata row showing `size · relative-time`.
- Sidebar is a narrow icon-rail on desktop/tablet, collapsing to a bottom nav bar below 640px width.
- File preview opens as a centered modal (lightbox), not a side panel or page navigation.
- Grid view is the default; list view is a toggle, and the user's last choice persists across visits via `localStorage`.
- FileBrowser Quantum's REST API (verified live this session, running at `http://192.168.1.22:30334`, default source name `share`):
  - `POST /api/auth/login?username=<u>&recaptcha=` — auth via headers `X-Password: <password>` and `X-Secret: <totp-or-empty>` (NOT a JSON body). Sets cookie `filebrowser_quantum_jwt` (`HttpOnly`, so JS never reads it — rely on `credentials: "same-origin"` on every fetch).
  - `GET /api/resources?path=<path>&source=share` — list a directory. Response: `{ name, size, modified, type, hidden, hasPreview, path, source, folders?: [...], files?: [...] }`. Each entry in `folders`/`files` has the same shape minus the `folders`/`files`/`path`/`source` keys; a file's `type` is its MIME string, a directory's `type` is the literal string `"directory"`.
  - `POST /api/resources?path=<path>&source=share&override=false` — create. Add `&isDir=true` to make a directory (creates all missing parent segments in one call — verified live, no client-side path-splitting needed). Without `isDir`, the request body is the raw file bytes (NOT `multipart/form-data`) with `Content-Type` set to the file's real MIME type; upload progress is tracked via `XMLHttpRequest.upload.onprogress` (fetch cannot report upload progress).
  - `DELETE /api/resources?path=<path>&source=share` — delete one item.
  - `DELETE /api/resources/bulk` — body: JSON array `[{ source: "share", path: "/a" }, ...]`. Response: `{ succeeded: [...], failed: [...] }`.
  - `PATCH /api/resources` — move, copy, or rename. Body: `{ items: [{ fromSource, fromPath, toSource, toPath }], action: "move" | "copy", overwrite: false, rename: false }`. Rename is a `"move"` where `fromPath`'s parent equals `toPath`'s parent.
  - `GET /api/resources/download?path=<path>&source=share` — direct download link (use as an `<a href>`, browser handles it; no special JS needed for single files).
  - A `401` on any of the above means the session expired — the frontend must redirect to the login screen when it sees one.

---

## Task 1: Scaffold the Vite + Vue project with design tokens

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.js`
- Create: `frontend/index.html`
- Create: `frontend/src/main.js`
- Create: `frontend/src/App.vue`
- Create: `frontend/src/style.css`
- Create: `frontend/.gitignore`

**Interfaces:**
- Produces: CSS custom properties on `:root` (`--bg`, `--bg-secondary`, `--border`, `--accent`, `--accent-contrast`, `--text`, `--text-muted`) that every later component uses instead of hardcoded colors.

- [ ] **Step 1: Scaffold the project**

```bash
cd /Users/codex074/nas-webui
npm create vite@latest frontend -- --template vue
cd frontend
npm install
npm install pinia
npm install -D vitest @vue/test-utils jsdom
```

- [ ] **Step 2: Replace `frontend/src/style.css` with the design tokens**

```css
:root {
  --bg: #f6f7f9;
  --bg-elevated: #ffffff;
  --border: #eef0f3;
  --accent: #2563eb;
  --accent-contrast: #ffffff;
  --text: #1f2430;
  --text-muted: #9aa1ab;
  --radius: 10px;
  --sidebar-width: 64px;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}

button {
  font-family: inherit;
  cursor: pointer;
}
```

- [ ] **Step 3: Wire `frontend/src/main.js` to use Pinia and the stylesheet**

```javascript
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './style.css'

createApp(App).use(createPinia()).mount('#app')
```

- [ ] **Step 4: Replace `frontend/src/App.vue` with a placeholder shell**

```vue
<script setup>
</script>

<template>
  <div id="app-shell">
    <h1>NAS UI scaffold OK</h1>
  </div>
</template>
```

- [ ] **Step 5: Add `frontend/vite.config.js` with a Vitest config block and API proxy for local dev**

```javascript
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      '/api': {
        target: 'http://192.168.1.22:30334',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
```

- [ ] **Step 6: Add a test script to `frontend/package.json`**

Add to the `"scripts"` block: `"test": "vitest run"`.

- [ ] **Step 7: Verify the dev server boots**

Run: `cd /Users/codex074/nas-webui/frontend && npm run dev -- --port 5173 &` then `curl -s http://localhost:5173 | grep -o '<title>[^<]*'`, then kill the dev server.
Expected: prints the page `<title>` tag (confirms Vite served the page).

- [ ] **Step 8: Commit**

```bash
cd /Users/codex074/nas-webui
git add frontend
git commit -m "Scaffold Vite+Vue frontend with design tokens"
```

---

## Task 2: API client — auth module

**Files:**
- Create: `frontend/src/api/auth.js`
- Test: `frontend/tests/api/auth.test.js`

**Interfaces:**
- Produces: `login(username, password) -> Promise<void>` (throws on failure with `.status` set), `logout() -> Promise<void>`, `getCurrentUser() -> Promise<object>` (calls `GET /api/users?id=self`, throws with `.status = 401` if not logged in).
- Consumes: nothing from other tasks.

- [ ] **Step 1: Write the failing tests**

```javascript
// frontend/tests/api/auth.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { login, logout, getCurrentUser } from '../../src/api/auth.js'

describe('auth API', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  it('login sends X-Password header and username as a query param', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve('token') })
    await login('codex', 'hunter2')
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toContain('/api/auth/login')
    expect(url).toContain('username=codex')
    expect(opts.headers['X-Password']).toBe('hunter2')
    expect(opts.credentials).toBe('same-origin')
  })

  it('login throws with status on failure', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 401, text: () => Promise.resolve('bad creds') })
    await expect(login('codex', 'wrong')).rejects.toMatchObject({ status: 401 })
  })

  it('getCurrentUser returns parsed JSON on success', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ username: 'codex' }) })
    const user = await getCurrentUser()
    expect(user.username).toBe('codex')
  })

  it('getCurrentUser throws with status 401 when not logged in', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 401, json: () => Promise.resolve({}) })
    await expect(getCurrentUser()).rejects.toMatchObject({ status: 401 })
  })

  it('logout calls POST /api/auth/logout', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200 })
    await logout()
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toContain('/api/auth/logout')
    expect(opts.method).toBe('POST')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/codex074/nas-webui/frontend && npm test -- tests/api/auth.test.js`
Expected: FAIL — `Cannot find module '../../src/api/auth.js'`

- [ ] **Step 3: Implement `frontend/src/api/auth.js`**

```javascript
async function apiError(response) {
  const err = new Error(response.statusText || 'Request failed')
  err.status = response.status
  return err
}

export async function login(username, password) {
  const url = `/api/auth/login?username=${encodeURIComponent(username)}&recaptcha=`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'X-Password': password, 'X-Secret': '' },
    credentials: 'same-origin',
  })
  if (!response.ok) throw await apiError(response)
}

export async function logout() {
  const response = await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
  })
  if (!response.ok) throw await apiError(response)
}

export async function getCurrentUser() {
  const response = await fetch('/api/users?id=self', { credentials: 'same-origin' })
  if (!response.ok) throw await apiError(response)
  return response.json()
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/codex074/nas-webui/frontend && npm test -- tests/api/auth.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
cd /Users/codex074/nas-webui
git add frontend/src/api/auth.js frontend/tests/api/auth.test.js
git commit -m "Add auth API client with tests"
```

---

## Task 3: API client — resources module

**Files:**
- Create: `frontend/src/api/resources.js`
- Test: `frontend/tests/api/resources.test.js`

**Interfaces:**
- Produces: `listDirectory(path) -> Promise<{name,size,modified,type,path,source,folders,files}>`, `makeDirectory(path) -> Promise<void>`, `uploadFile(path, file, onProgress) -> Promise<void>`, `deleteItem(path) -> Promise<void>`, `bulkDelete(paths: string[]) -> Promise<{succeeded, failed}>`, `moveItem(fromPath, toPath) -> Promise<void>`, `renameItem(path, newName) -> Promise<void>` (computes the sibling `toPath` from `path`'s parent dir + `newName` and calls the same move logic), `downloadUrl(path) -> string`.
- Consumes: nothing from other tasks (uses `fetch` directly, same-origin cookie auth like Task 2).

- [ ] **Step 1: Write the failing tests**

```javascript
// frontend/tests/api/resources.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  listDirectory, makeDirectory, deleteItem, bulkDelete,
  moveItem, renameItem, downloadUrl,
} from '../../src/api/resources.js'

describe('resources API', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  it('listDirectory calls GET with source=share and returns JSON', async () => {
    const body = { name: 'share', path: '/', source: 'share', folders: [], files: [] }
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(body) })
    const result = await listDirectory('/')
    expect(global.fetch.mock.calls[0][0]).toContain('/api/resources?path=%2F&source=share')
    expect(result).toEqual(body)
  })

  it('makeDirectory POSTs with isDir=true and does not split nested paths', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200 })
    await makeDirectory('/Photos/2026')
    expect(global.fetch).toHaveBeenCalledTimes(1)
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toContain('path=%2FPhotos%2F2026')
    expect(url).toContain('isDir=true')
    expect(opts.method).toBe('POST')
  })

  it('deleteItem calls DELETE with the item path', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200 })
    await deleteItem('/Photos/a.jpg')
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toContain('path=%2FPhotos%2Fa.jpg')
    expect(opts.method).toBe('DELETE')
  })

  it('bulkDelete posts an array of {source,path} to /api/resources/bulk', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ succeeded: [], failed: [] }) })
    await bulkDelete(['/a.jpg', '/b.jpg'])
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toContain('/api/resources/bulk')
    expect(opts.method).toBe('DELETE')
    const body = JSON.parse(opts.body)
    expect(body).toEqual([
      { source: 'share', path: '/a.jpg' },
      { source: 'share', path: '/b.jpg' },
    ])
  })

  it('moveItem PATCHes with a move action', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200 })
    await moveItem('/Photos/a.jpg', '/Archive/a.jpg')
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toContain('/api/resources')
    expect(opts.method).toBe('PATCH')
    const body = JSON.parse(opts.body)
    expect(body.action).toBe('move')
    expect(body.items[0]).toEqual({
      fromSource: 'share', fromPath: '/Photos/a.jpg', toSource: 'share', toPath: '/Archive/a.jpg',
    })
  })

  it('renameItem computes the sibling path from the parent directory', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200 })
    await renameItem('/Photos/old.jpg', 'new.jpg')
    const body = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(body.items[0].toPath).toBe('/Photos/new.jpg')
  })

  it('renameItem works for a top-level item', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200 })
    await renameItem('/old.jpg', 'new.jpg')
    const body = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(body.items[0].toPath).toBe('/new.jpg')
  })

  it('downloadUrl builds a plain GET link', () => {
    expect(downloadUrl('/Photos/a.jpg')).toBe('/api/resources/download?path=%2FPhotos%2Fa.jpg&source=share')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/codex074/nas-webui/frontend && npm test -- tests/api/resources.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `frontend/src/api/resources.js`**

```javascript
const SOURCE = 'share'

async function apiError(response) {
  const err = new Error(response.statusText || 'Request failed')
  err.status = response.status
  return err
}

function resourcesUrl(path, extraParams = {}) {
  const params = new URLSearchParams({ path, source: SOURCE, ...extraParams })
  return `/api/resources?${params.toString()}`
}

export async function listDirectory(path) {
  const response = await fetch(resourcesUrl(path), { credentials: 'same-origin' })
  if (!response.ok) throw await apiError(response)
  return response.json()
}

export async function makeDirectory(path) {
  const response = await fetch(resourcesUrl(path, { override: 'false', isDir: 'true' }), {
    method: 'POST',
    credentials: 'same-origin',
  })
  if (!response.ok) throw await apiError(response)
}

export function uploadFile(path, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', resourcesUrl(path, { override: 'false' }), true)
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    xhr.withCredentials = true
    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100))
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(Object.assign(new Error('Upload failed'), { status: xhr.status }))
    }
    xhr.onerror = () => reject(new Error('Network error during upload'))
    xhr.send(file)
  })
}

export async function deleteItem(path) {
  const response = await fetch(resourcesUrl(path), { method: 'DELETE', credentials: 'same-origin' })
  if (!response.ok) throw await apiError(response)
}

export async function bulkDelete(paths) {
  const response = await fetch('/api/resources/bulk', {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(paths.map((path) => ({ source: SOURCE, path }))),
  })
  if (!response.ok) throw await apiError(response)
  return response.json()
}

export async function moveItem(fromPath, toPath, action = 'move') {
  const response = await fetch('/api/resources', {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: [{ fromSource: SOURCE, fromPath, toSource: SOURCE, toPath }],
      action,
      overwrite: false,
      rename: false,
    }),
  })
  if (!response.ok) throw await apiError(response)
}

export async function copyItem(fromPath, toPath) {
  return moveItem(fromPath, toPath, 'copy')
}

export async function renameItem(path, newName) {
  const lastSlash = path.lastIndexOf('/')
  const parent = lastSlash <= 0 ? '' : path.slice(0, lastSlash)
  const toPath = `${parent}/${newName}`
  return moveItem(path, toPath)
}

export function downloadUrl(path) {
  const params = new URLSearchParams({ path, source: SOURCE })
  return `/api/resources/download?${params.toString()}`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/codex074/nas-webui/frontend && npm test -- tests/api/resources.test.js`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
cd /Users/codex074/nas-webui
git add frontend/src/api/resources.js frontend/tests/api/resources.test.js
git commit -m "Add resources API client with tests"
```

---

## Task 4: File browser store (Pinia)

**Files:**
- Create: `frontend/src/stores/files.js`
- Test: `frontend/tests/stores/files.test.js`

**Interfaces:**
- Consumes: `listDirectory`, `deleteItem`, `bulkDelete` from `../api/resources.js` (Task 3).
- Produces: a Pinia store `useFilesStore()` exposing reactive state `currentPath`, `entries` (merged folders+files, folders first), `viewMode` (`'grid' | 'list'`, persisted to `localStorage` key `nas-view-mode`), `selected` (`Set` of paths), and actions `loadDirectory(path)`, `toggleViewMode()`, `toggleSelect(path)`, `clearSelection()`, `deleteSelected()`.

- [ ] **Step 1: Write the failing tests**

```javascript
// frontend/tests/stores/files.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFilesStore } from '../../src/stores/files.js'
import * as resources from '../../src/api/resources.js'

vi.mock('../../src/api/resources.js', () => ({
  listDirectory: vi.fn(),
  bulkDelete: vi.fn(),
}))

describe('files store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('loadDirectory stores folders before files, both alphabetized', async () => {
    resources.listDirectory.mockResolvedValue({
      path: '/', source: 'share',
      folders: [{ name: 'Zeta', type: 'directory' }, { name: 'Alpha', type: 'directory' }],
      files: [{ name: 'b.txt', type: 'text/plain' }, { name: 'a.txt', type: 'text/plain' }],
    })
    const store = useFilesStore()
    await store.loadDirectory('/')
    expect(store.entries.map((e) => e.name)).toEqual(['Alpha', 'Zeta', 'a.txt', 'b.txt'])
    expect(store.currentPath).toBe('/')
  })

  it('defaults to grid view and toggles to list, persisting the choice', () => {
    const store = useFilesStore()
    expect(store.viewMode).toBe('grid')
    store.toggleViewMode()
    expect(store.viewMode).toBe('list')
    expect(localStorage.getItem('nas-view-mode')).toBe('list')
  })

  it('restores the persisted view mode on store creation', () => {
    localStorage.setItem('nas-view-mode', 'list')
    const store = useFilesStore()
    expect(store.viewMode).toBe('list')
  })

  it('toggleSelect adds and removes paths from the selection set', () => {
    const store = useFilesStore()
    store.toggleSelect('/a.jpg')
    expect(store.selected.has('/a.jpg')).toBe(true)
    store.toggleSelect('/a.jpg')
    expect(store.selected.has('/a.jpg')).toBe(false)
  })

  it('deleteSelected calls bulkDelete with selected paths and clears selection on success', async () => {
    resources.bulkDelete.mockResolvedValue({ succeeded: ['/a.jpg'], failed: [] })
    resources.listDirectory.mockResolvedValue({ path: '/', source: 'share', folders: [], files: [] })
    const store = useFilesStore()
    store.currentPath = '/'
    store.toggleSelect('/a.jpg')
    await store.deleteSelected()
    expect(resources.bulkDelete).toHaveBeenCalledWith(['/a.jpg'])
    expect(store.selected.size).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/codex074/nas-webui/frontend && npm test -- tests/stores/files.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `frontend/src/stores/files.js`**

```javascript
import { defineStore } from 'pinia'
import { listDirectory, bulkDelete } from '../api/resources.js'

const VIEW_MODE_KEY = 'nas-view-mode'

export const useFilesStore = defineStore('files', {
  state: () => ({
    currentPath: '/',
    entries: [],
    viewMode: localStorage.getItem(VIEW_MODE_KEY) === 'list' ? 'list' : 'grid',
    selected: new Set(),
    loading: false,
    error: null,
  }),
  actions: {
    async loadDirectory(path) {
      this.loading = true
      this.error = null
      try {
        const result = await listDirectory(path)
        const folders = [...(result.folders || [])].sort((a, b) => a.name.localeCompare(b.name))
        const files = [...(result.files || [])].sort((a, b) => a.name.localeCompare(b.name))
        this.entries = [...folders, ...files]
        this.currentPath = path
        this.selected = new Set()
      } catch (err) {
        this.error = err
        throw err
      } finally {
        this.loading = false
      }
    },
    toggleViewMode() {
      this.viewMode = this.viewMode === 'grid' ? 'list' : 'grid'
      localStorage.setItem(VIEW_MODE_KEY, this.viewMode)
    },
    toggleSelect(path) {
      const next = new Set(this.selected)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      this.selected = next
    },
    clearSelection() {
      this.selected = new Set()
    },
    async deleteSelected() {
      const paths = Array.from(this.selected)
      await bulkDelete(paths)
      await this.loadDirectory(this.currentPath)
    },
  },
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/codex074/nas-webui/frontend && npm test -- tests/stores/files.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
cd /Users/codex074/nas-webui
git add frontend/src/stores/files.js frontend/tests/stores/files.test.js
git commit -m "Add files store with grid/list persistence and selection"
```

---

## Task 5: Login view + session bootstrapping

**Files:**
- Create: `frontend/src/stores/auth.js`
- Create: `frontend/src/components/LoginView.vue`
- Modify: `frontend/src/App.vue`
- Test: `frontend/tests/stores/auth.test.js`

**Interfaces:**
- Consumes: `login`, `logout`, `getCurrentUser` from `../api/auth.js` (Task 2).
- Produces: `useAuthStore()` with state `user` (`null` until loaded), `checked` (`bool`, whether the initial session check has run), actions `checkSession()`, `signIn(username, password)`, `signOut()`.

- [ ] **Step 1: Write the failing test**

```javascript
// frontend/tests/stores/auth.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '../../src/stores/auth.js'
import * as authApi from '../../src/api/auth.js'

vi.mock('../../src/api/auth.js', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  getCurrentUser: vi.fn(),
}))

describe('auth store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('checkSession sets user on success', async () => {
    authApi.getCurrentUser.mockResolvedValue({ username: 'codex' })
    const store = useAuthStore()
    await store.checkSession()
    expect(store.user.username).toBe('codex')
    expect(store.checked).toBe(true)
  })

  it('checkSession leaves user null on 401', async () => {
    authApi.getCurrentUser.mockRejectedValue({ status: 401 })
    const store = useAuthStore()
    await store.checkSession()
    expect(store.user).toBeNull()
    expect(store.checked).toBe(true)
  })

  it('signIn logs in then refreshes the current user', async () => {
    authApi.login.mockResolvedValue()
    authApi.getCurrentUser.mockResolvedValue({ username: 'codex' })
    const store = useAuthStore()
    await store.signIn('codex', '571010074')
    expect(authApi.login).toHaveBeenCalledWith('codex', '571010074')
    expect(store.user.username).toBe('codex')
  })

  it('signOut clears user', async () => {
    authApi.logout.mockResolvedValue()
    const store = useAuthStore()
    store.user = { username: 'codex' }
    await store.signOut()
    expect(store.user).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/codex074/nas-webui/frontend && npm test -- tests/stores/auth.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `frontend/src/stores/auth.js`**

```javascript
import { defineStore } from 'pinia'
import { login, logout, getCurrentUser } from '../api/auth.js'

export const useAuthStore = defineStore('auth', {
  state: () => ({ user: null, checked: false }),
  actions: {
    async checkSession() {
      try {
        this.user = await getCurrentUser()
      } catch {
        this.user = null
      } finally {
        this.checked = true
      }
    },
    async signIn(username, password) {
      await login(username, password)
      this.user = await getCurrentUser()
    },
    async signOut() {
      await logout()
      this.user = null
    },
  },
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/codex074/nas-webui/frontend && npm test -- tests/stores/auth.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Create `frontend/src/components/LoginView.vue`**

```vue
<script setup>
import { ref } from 'vue'
import { useAuthStore } from '../stores/auth.js'

const auth = useAuthStore()
const username = ref('')
const password = ref('')
const errorMessage = ref('')
const submitting = ref(false)

async function onSubmit() {
  errorMessage.value = ''
  submitting.value = true
  try {
    await auth.signIn(username.value, password.value)
  } catch (err) {
    errorMessage.value = err.status === 401 ? 'Wrong username or password.' : 'Sign-in failed.'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="login-screen">
    <form class="login-card" @submit.prevent="onSubmit">
      <h1>NAS</h1>
      <input v-model="username" placeholder="Username" autocomplete="username" />
      <input v-model="password" type="password" placeholder="Password" autocomplete="current-password" />
      <p v-if="errorMessage" class="login-error">{{ errorMessage }}</p>
      <button type="submit" :disabled="submitting">{{ submitting ? 'Signing in…' : 'Sign in' }}</button>
    </form>
  </div>
</template>

<style scoped>
.login-screen { min-height: 100vh; display: flex; align-items: center; justify-content: center; }
.login-card { background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius); padding: 32px; width: 280px; display: flex; flex-direction: column; gap: 12px; }
.login-card input { padding: 10px; border: 1px solid var(--border); border-radius: 8px; }
.login-card button { background: var(--accent); color: var(--accent-contrast); border: none; border-radius: 8px; padding: 10px; }
.login-error { color: #d92d20; font-size: 13px; margin: 0; }
</style>
```

- [ ] **Step 6: Wire session bootstrapping into `frontend/src/App.vue`**

```vue
<script setup>
import { onMounted } from 'vue'
import { useAuthStore } from './stores/auth.js'
import LoginView from './components/LoginView.vue'

const auth = useAuthStore()
onMounted(() => auth.checkSession())
</script>

<template>
  <LoginView v-if="auth.checked && !auth.user" />
  <div v-else-if="auth.checked" id="app-shell">
    <p>Signed in as {{ auth.user.username }} — browser UI comes in later tasks.</p>
  </div>
</template>
```

- [ ] **Step 7: Commit**

```bash
cd /Users/codex074/nas-webui
git add frontend/src/stores/auth.js frontend/src/components/LoginView.vue frontend/src/App.vue frontend/tests/stores/auth.test.js
git commit -m "Add auth store, login view, and session bootstrap"
```

---

## Task 6: Sidebar + TopBar shell

**Files:**
- Create: `frontend/src/components/Sidebar.vue`
- Create: `frontend/src/components/TopBar.vue`
- Modify: `frontend/src/App.vue`

**Interfaces:**
- Consumes: `useAuthStore()` (Task 5) for the avatar/logout control; `useFilesStore()` (Task 4) for `currentPath` (to render the breadcrumb) and `viewMode`/`toggleViewMode`.
- Produces: `TopBar` emits `new-folder` (no payload) and `search` (`string` query text) events that later tasks (7, 10) will listen for.

- [ ] **Step 1: Create `frontend/src/components/Sidebar.vue`**

```vue
<script setup>
import { useAuthStore } from '../stores/auth.js'

const auth = useAuthStore()
</script>

<template>
  <nav class="sidebar">
    <button class="sidebar-icon active" title="My Files">🗂️</button>
    <div class="sidebar-spacer"></div>
    <button class="sidebar-icon" title="Sign out" @click="auth.signOut()">👤</button>
  </nav>
</template>

<style scoped>
.sidebar {
  width: var(--sidebar-width);
  background: var(--bg-elevated);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 0;
  gap: 8px;
}
.sidebar-spacer { flex: 1; }
.sidebar-icon {
  width: 40px; height: 40px;
  border: none; background: transparent; border-radius: 8px; font-size: 18px;
}
.sidebar-icon.active { background: var(--border); }

@media (max-width: 640px) {
  .sidebar {
    width: 100%; height: 56px; flex-direction: row;
    border-right: none; border-top: 1px solid var(--border);
    order: 2;
  }
}
</style>
```

- [ ] **Step 2: Create `frontend/src/components/TopBar.vue`**

```vue
<script setup>
import { computed } from 'vue'
import { useFilesStore } from '../stores/files.js'

const emit = defineEmits(['new-folder', 'search'])
const files = useFilesStore()

const crumbs = computed(() => {
  const parts = files.currentPath.split('/').filter(Boolean)
  const result = [{ label: 'Home', path: '/' }]
  let acc = ''
  for (const part of parts) {
    acc += `/${part}`
    result.push({ label: part, path: acc })
  }
  return result
})

function goTo(path) {
  files.loadDirectory(path)
}
</script>

<template>
  <header class="topbar">
    <nav class="breadcrumb">
      <span v-for="(crumb, i) in crumbs" :key="crumb.path">
        <button class="crumb" @click="goTo(crumb.path)">{{ crumb.label }}</button>
        <span v-if="i < crumbs.length - 1"> / </span>
      </span>
    </nav>
    <input class="search" placeholder="Search" @input="emit('search', $event.target.value)" />
    <button @click="files.toggleViewMode()">{{ files.viewMode === 'grid' ? '☰ List' : '▦ Grid' }}</button>
    <button @click="emit('new-folder')">+ New folder</button>
  </header>
</template>

<style scoped>
.topbar { display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--border); background: var(--bg-elevated); }
.breadcrumb { flex: 1; }
.crumb { border: none; background: none; color: var(--text); font-weight: 600; padding: 4px; }
.crumb:hover { color: var(--accent); }
.search { padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; width: 200px; }
.topbar button { border: 1px solid var(--border); background: var(--bg-elevated); border-radius: 8px; padding: 8px 12px; }
</style>
```

- [ ] **Step 3: Wire both into `frontend/src/App.vue`, loading the root directory once signed in**

```vue
<script setup>
import { onMounted, watch } from 'vue'
import { useAuthStore } from './stores/auth.js'
import { useFilesStore } from './stores/files.js'
import LoginView from './components/LoginView.vue'
import Sidebar from './components/Sidebar.vue'
import TopBar from './components/TopBar.vue'

const auth = useAuthStore()
const files = useFilesStore()

onMounted(() => auth.checkSession())
watch(() => auth.user, (user) => { if (user) files.loadDirectory('/') })
</script>

<template>
  <LoginView v-if="auth.checked && !auth.user" />
  <div v-else-if="auth.checked" id="app-shell">
    <Sidebar />
    <div class="main">
      <TopBar />
      <div class="content">
        <p>{{ files.entries.length }} item(s) in {{ files.currentPath }} — grid/list rendering comes in Task 7.</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
#app-shell { display: flex; min-height: 100vh; }
.main { flex: 1; display: flex; flex-direction: column; }
.content { padding: 20px; flex: 1; }

@media (max-width: 640px) {
  #app-shell { flex-direction: column; }
}
</style>
```

- [ ] **Step 4: Manually verify in the browser**

Run: `cd /Users/codex074/nas-webui/frontend && npm run dev` (proxies `/api` to the live NAS per Task 1's `vite.config.js`), open `http://localhost:5173`, log in with `codex` / `571010074`.
Expected: sidebar + breadcrumb ("Home") + search box + view-toggle button all render; breadcrumb click on "Home" doesn't error.

- [ ] **Step 5: Commit**

```bash
cd /Users/codex074/nas-webui
git add frontend/src/components/Sidebar.vue frontend/src/components/TopBar.vue frontend/src/App.vue
git commit -m "Add sidebar and top bar shell"
```

---

## Task 7: File tiles (grid) and list view

**Files:**
- Create: `frontend/src/components/FileTile.vue`
- Create: `frontend/src/components/FileGrid.vue`
- Create: `frontend/src/components/FileListView.vue`
- Test: `frontend/tests/components/FileTile.test.js`
- Modify: `frontend/src/App.vue`

**Interfaces:**
- Consumes: `useFilesStore()` (Task 4) for `entries`, `viewMode`, `selected`, `toggleSelect`, `loadDirectory`.
- Produces: `FileTile` emits `open` (entry object, for the lightbox in Task 12) and `menu` (entry object + click coordinates, for the context menu in Task 11).

- [ ] **Step 1: Write the failing test for the relative-time/size formatting helper**

```javascript
// frontend/tests/components/FileTile.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/codex074/nas-webui/frontend && npm test -- tests/components/FileTile.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `frontend/src/components/fileFormat.js`**

```javascript
export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = -1
  do {
    value /= 1024
    unitIndex += 1
  } while (value >= 1024 && unitIndex < units.length - 1)
  return `${value.toFixed(1)} ${units[unitIndex]}`
}

export function formatRelativeTime(isoString, now = new Date()) {
  const then = new Date(isoString)
  const diffMs = now - then
  const minute = 60_000, hour = 3_600_000, day = 86_400_000, week = 7 * day
  if (diffMs < hour) return `${Math.max(1, Math.round(diffMs / minute))}m ago`
  if (diffMs < day) return `${Math.round(diffMs / hour)}h ago`
  if (diffMs < week) return `${Math.round(diffMs / day)}d ago`
  return `${Math.round(diffMs / week)}w ago`
}

export function iconFor(entry) {
  if (entry.type === 'directory') return '📁'
  if (entry.type.startsWith('image/')) return '🖼️'
  if (entry.type.startsWith('video/')) return '🎞️'
  if (entry.type === 'application/pdf') return '📕'
  return '📄'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/codex074/nas-webui/frontend && npm test -- tests/components/FileTile.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Create `frontend/src/components/FileTile.vue`**

```vue
<script setup>
import { computed } from 'vue'
import { useFilesStore } from '../stores/files.js'
import { formatSize, formatRelativeTime, iconFor } from './fileFormat.js'

const props = defineProps({ entry: { type: Object, required: true } })
const emit = defineEmits(['open', 'menu'])
const files = useFilesStore()

const fullPath = computed(() => `${files.currentPath}${files.currentPath.endsWith('/') ? '' : '/'}${props.entry.name}`)
const isSelected = computed(() => files.selected.has(fullPath.value))

function onClick() {
  if (props.entry.type === 'directory') files.loadDirectory(fullPath.value)
  else emit('open', { ...props.entry, path: fullPath.value })
}
</script>

<template>
  <div class="tile" :class="{ selected: isSelected }">
    <button class="dots" @click.stop="emit('menu', { entry, path: fullPath })">⋮</button>
    <div class="thumb" @click="onClick">{{ iconFor(entry) }}</div>
    <div class="name" :title="entry.name">{{ entry.name }}</div>
    <div class="meta">
      <span>{{ entry.type === 'directory' ? '—' : formatSize(entry.size) }}</span>
      <span>{{ formatRelativeTime(entry.modified) }}</span>
    </div>
  </div>
</template>

<style scoped>
.tile {
  position: relative;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tile.selected { border-color: var(--accent); background: #eaf1ff; }
.thumb { aspect-ratio: 1; display: flex; align-items: center; justify-content: center; font-size: 40px; background: var(--bg); border-radius: 8px; cursor: pointer; }
.name { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.meta { display: flex; justify-content: space-between; font-size: 10px; color: var(--text-muted); }
.dots { position: absolute; top: 6px; right: 6px; border: none; background: transparent; color: var(--text-muted); font-size: 14px; }
</style>
```

- [ ] **Step 6: Create `frontend/src/components/FileGrid.vue`**

```vue
<script setup>
defineProps({ entries: { type: Array, required: true } })
defineEmits(['open', 'menu'])
</script>

<template>
  <div class="grid">
    <FileTile
      v-for="entry in entries"
      :key="entry.name"
      :entry="entry"
      @open="$emit('open', $event)"
      @menu="$emit('menu', $event)"
    />
  </div>
</template>

<script>
import FileTile from './FileTile.vue'
export default { components: { FileTile } }
</script>

<style scoped>
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 14px; padding: 20px; }
@media (max-width: 640px) { .grid { grid-template-columns: repeat(2, 1fr); } }
</style>
```

- [ ] **Step 7: Create `frontend/src/components/FileListView.vue`**

```vue
<script setup>
import { useFilesStore } from '../stores/files.js'
import { formatSize, formatRelativeTime, iconFor } from './fileFormat.js'

defineProps({ entries: { type: Array, required: true } })
const emit = defineEmits(['open', 'menu'])
const files = useFilesStore()

function fullPath(entry) {
  return `${files.currentPath}${files.currentPath.endsWith('/') ? '' : '/'}${entry.name}`
}
function onClick(entry) {
  if (entry.type === 'directory') files.loadDirectory(fullPath(entry))
  else emit('open', { ...entry, path: fullPath(entry) })
}
</script>

<template>
  <table class="list">
    <thead><tr><th>Name</th><th>Size</th><th>Modified</th><th></th></tr></thead>
    <tbody>
      <tr v-for="entry in entries" :key="entry.name">
        <td @click="onClick(entry)">{{ iconFor(entry) }} {{ entry.name }}</td>
        <td>{{ entry.type === 'directory' ? '—' : formatSize(entry.size) }}</td>
        <td>{{ formatRelativeTime(entry.modified) }}</td>
        <td><button @click.stop="emit('menu', { entry, path: fullPath(entry) })">⋮</button></td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
.list { width: 100%; border-collapse: collapse; }
.list th { text-align: left; font-size: 11px; color: var(--text-muted); border-bottom: 1px solid var(--border); padding: 8px 16px; }
.list td { padding: 8px 16px; border-bottom: 1px solid var(--border); font-size: 13px; }
.list td:first-child { cursor: pointer; }
.list button { border: none; background: none; color: var(--text-muted); }
</style>
```

- [ ] **Step 8: Wire grid/list into `frontend/src/App.vue`'s content area**

Replace the `<div class="content">` block from Task 6 Step 3 with:

```vue
<div class="content">
  <FileGrid v-if="files.viewMode === 'grid'" :entries="files.entries" />
  <FileListView v-else :entries="files.entries" />
</div>
```

And add to the `<script setup>` imports: `import FileGrid from './components/FileGrid.vue'` and `import FileListView from './components/FileListView.vue'`.

- [ ] **Step 9: Manually verify**

Run: `cd /Users/codex074/nas-webui/frontend && npm run dev`, log in, confirm the "Photos" folder (created earlier this session) renders as a tile, click it, confirm the breadcrumb updates and it navigates in.

- [ ] **Step 10: Commit**

```bash
cd /Users/codex074/nas-webui
git add frontend/src/components/FileTile.vue frontend/src/components/FileGrid.vue frontend/src/components/FileListView.vue frontend/src/components/fileFormat.js frontend/tests/components/FileTile.test.js frontend/src/App.vue
git commit -m "Add grid and list file views with formatting helpers"
```

---

## Task 8: New folder dialog (nested paths)

**Files:**
- Create: `frontend/src/components/NewFolderDialog.vue`
- Modify: `frontend/src/App.vue`

**Interfaces:**
- Consumes: `makeDirectory` from `../api/resources.js` (Task 3), `useFilesStore()` for `currentPath` and `loadDirectory` (Task 4), the `new-folder` event emitted by `TopBar` (Task 6).

- [ ] **Step 1: Create `frontend/src/components/NewFolderDialog.vue`**

```vue
<script setup>
import { ref } from 'vue'
import { makeDirectory } from '../api/resources.js'
import { useFilesStore } from '../stores/files.js'

const emit = defineEmits(['close'])
const files = useFilesStore()
const name = ref('')
const errorMessage = ref('')
const submitting = ref(false)

async function onSubmit() {
  if (!name.value.trim()) return
  submitting.value = true
  errorMessage.value = ''
  const base = files.currentPath.endsWith('/') ? files.currentPath : `${files.currentPath}/`
  try {
    await makeDirectory(`${base}${name.value.trim()}`)
    await files.loadDirectory(files.currentPath)
    emit('close')
  } catch (err) {
    errorMessage.value = 'Could not create folder.'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <form class="dialog" @submit.prevent="onSubmit">
      <h3>New folder</h3>
      <p class="hint">You can type a path like <code>Photos/2026</code> to create nested folders at once.</p>
      <input v-model="name" placeholder="Folder name" autofocus />
      <p v-if="errorMessage" class="error">{{ errorMessage }}</p>
      <div class="actions">
        <button type="button" @click="emit('close')">Cancel</button>
        <button type="submit" :disabled="submitting">Create</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.backdrop { position: fixed; inset: 0; background: rgba(20, 25, 35, 0.4); display: flex; align-items: center; justify-content: center; z-index: 10; }
.dialog { background: var(--bg-elevated); border-radius: var(--radius); padding: 24px; width: 320px; display: flex; flex-direction: column; gap: 10px; }
.hint { font-size: 12px; color: var(--text-muted); margin: 0; }
.dialog input { padding: 10px; border: 1px solid var(--border); border-radius: 8px; }
.actions { display: flex; justify-content: flex-end; gap: 8px; }
.error { color: #d92d20; font-size: 13px; margin: 0; }
</style>
```

- [ ] **Step 2: Wire it into `frontend/src/App.vue`**

Add `import NewFolderDialog from './components/NewFolderDialog.vue'` and a `const showNewFolder = ref(false)` (add `ref` to the Vue import). Change `<TopBar />` to `<TopBar @new-folder="showNewFolder = true" />` and add right after the `.content` div:

```vue
<NewFolderDialog v-if="showNewFolder" @close="showNewFolder = false" />
```

- [ ] **Step 3: Manually verify**

Run the dev server, click "+ New folder", type `Test/Nested`, submit. Confirm both levels appear when you navigate into the created folder, then delete them via the FileBrowser Quantum UI at `http://192.168.1.22:30334` (context menu for delete isn't built until Task 11) to keep the NAS clean.

- [ ] **Step 4: Commit**

```bash
cd /Users/codex074/nas-webui
git add frontend/src/components/NewFolderDialog.vue frontend/src/App.vue
git commit -m "Add new folder dialog with nested-path support"
```

---

## Task 9: Drag-and-drop upload with progress toasts

**Files:**
- Create: `frontend/src/components/UploadToast.vue`
- Modify: `frontend/src/App.vue`

**Interfaces:**
- Consumes: `uploadFile` from `../api/resources.js` (Task 3), `useFilesStore()` for `currentPath` and `loadDirectory` (Task 4).
- Produces: nothing consumed elsewhere — this is the last piece of the upload flow.

- [ ] **Step 1: Create `frontend/src/components/UploadToast.vue`**

```vue
<script setup>
defineProps({ uploads: { type: Array, required: true } })
</script>

<template>
  <div v-if="uploads.length" class="tray">
    <div v-for="u in uploads" :key="u.id" class="row">
      <span class="name">{{ u.name }}</span>
      <div class="bar"><div class="fill" :style="{ width: u.progress + '%' }"></div></div>
      <span class="pct">{{ u.error ? 'Failed' : u.progress + '%' }}</span>
    </div>
  </div>
</template>

<style scoped>
.tray { position: fixed; bottom: 16px; right: 16px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; width: 260px; box-shadow: 0 8px 24px rgba(0,0,0,0.12); z-index: 20; }
.row { display: flex; align-items: center; gap: 8px; font-size: 12px; padding: 4px 0; }
.name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar { width: 60px; height: 6px; background: var(--border); border-radius: 3px; overflow: hidden; }
.fill { height: 100%; background: var(--accent); }
</style>
```

- [ ] **Step 2: Add upload state and drag/drop handlers to `frontend/src/App.vue`**

Add to `<script setup>`:

```javascript
import { ref, reactive } from 'vue'
import { uploadFile } from './api/resources.js'
import UploadToast from './components/UploadToast.vue'

const uploads = reactive([])
let uploadId = 0

async function handleFiles(fileList) {
  const base = files.currentPath.endsWith('/') ? files.currentPath : `${files.currentPath}/`
  for (const file of Array.from(fileList)) {
    const entry = reactive({ id: uploadId++, name: file.name, progress: 0, error: false })
    uploads.push(entry)
    try {
      await uploadFile(`${base}${file.name}`, file, (pct) => { entry.progress = pct })
    } catch {
      entry.error = true
    }
  }
  await files.loadDirectory(files.currentPath)
  setTimeout(() => uploads.splice(0, uploads.length), 2000)
}

function onDrop(event) {
  event.preventDefault()
  if (event.dataTransfer.files.length) handleFiles(event.dataTransfer.files)
}
```

(`ref` is already imported from Task 6/8 — merge into the existing import line rather than duplicating it.)

- [ ] **Step 3: Wire drop handlers and the toast into the template**

Change the `.content` wrapper div to:

```vue
<div class="content" @dragover.prevent @drop="onDrop">
```

And add right before the closing `</div>` of `#app-shell`:

```vue
<UploadToast :uploads="uploads" />
```

- [ ] **Step 4: Manually verify**

Run the dev server, drag a small file from the desktop onto the content area, confirm the toast shows a progress bar reaching 100% and the file appears in the grid afterward.

- [ ] **Step 5: Commit**

```bash
cd /Users/codex074/nas-webui
git add frontend/src/components/UploadToast.vue frontend/src/App.vue
git commit -m "Add drag-and-drop upload with progress toasts"
```

---

## Task 10: Wire search filtering

**Files:**
- Modify: `frontend/src/App.vue`

**Interfaces:**
- Consumes: the `search` event from `TopBar` (Task 6), `files.entries` (Task 4).

- [ ] **Step 1: Add client-side filtering**

Add to `<script setup>` in `App.vue`:

```javascript
const searchQuery = ref('')
const filteredEntries = computed(() =>
  !searchQuery.value
    ? files.entries
    : files.entries.filter((e) => e.name.toLowerCase().includes(searchQuery.value.toLowerCase()))
)
```

(add `computed` to the existing `vue` import.) Change `<TopBar />` to `<TopBar @new-folder="showNewFolder = true" @search="searchQuery = $event" />`, and pass `:entries="filteredEntries"` instead of `:entries="files.entries"` to both `FileGrid` and `FileListView`.

- [ ] **Step 2: Manually verify**

Type into the search box, confirm the grid narrows to matching names and clears back to the full list when the box is emptied.

- [ ] **Step 3: Commit**

```bash
cd /Users/codex074/nas-webui
git add frontend/src/App.vue
git commit -m "Wire client-side name search"
```

---

## Task 11: Context menu (rename, move, delete, download)

**Files:**
- Create: `frontend/src/components/ContextMenu.vue`
- Modify: `frontend/src/App.vue`
- Test: `frontend/tests/components/ContextMenu.test.js`

**Interfaces:**
- Consumes: `deleteItem`, `renameItem`, `moveItem`, `downloadUrl` from `../api/resources.js` (Task 3); `useFilesStore()` for `loadDirectory`, `selected`, `deleteSelected` (Task 4); the `menu` event from `FileTile`/`FileListView` (Task 7).

- [ ] **Step 1: Write the failing test for the destination-path helper**

```javascript
// frontend/tests/components/ContextMenu.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/codex074/nas-webui/frontend && npm test -- tests/components/ContextMenu.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `frontend/src/components/pathHelpers.js`**

```javascript
export function siblingPath(path, newName) {
  const lastSlash = path.lastIndexOf('/')
  const parent = lastSlash <= 0 ? '' : path.slice(0, lastSlash)
  return `${parent}/${newName}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/codex074/nas-webui/frontend && npm test -- tests/components/ContextMenu.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Create `frontend/src/components/ContextMenu.vue`**

```vue
<script setup>
import { ref } from 'vue'
import { deleteItem, renameItem, moveItem, downloadUrl } from '../api/resources.js'
import { useFilesStore } from '../stores/files.js'

const props = defineProps({ entry: { type: Object, required: true }, path: { type: String, required: true } })
const emit = defineEmits(['close'])
const files = useFilesStore()
const renaming = ref(false)
const moving = ref(false)
const newName = ref(props.entry.name)
const destination = ref('')
const errorMessage = ref('')

async function doRename() {
  errorMessage.value = ''
  try {
    await renameItem(props.path, newName.value)
    await files.loadDirectory(files.currentPath)
    emit('close')
  } catch (err) {
    errorMessage.value = err.message || 'Rename failed.'
  }
}
async function doMove() {
  errorMessage.value = ''
  try {
    await moveItem(props.path, destination.value)
    await files.loadDirectory(files.currentPath)
    emit('close')
  } catch (err) {
    errorMessage.value = err.message || 'Move failed.'
  }
}
async function doDelete() {
  errorMessage.value = ''
  try {
    await deleteItem(props.path)
    await files.loadDirectory(files.currentPath)
    emit('close')
  } catch (err) {
    errorMessage.value = err.message || 'Delete failed.'
  }
}
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <div class="menu">
      <template v-if="renaming">
        <input v-model="newName" autofocus @keyup.enter="doRename" />
        <button @click="doRename">Save</button>
      </template>
      <template v-else-if="moving">
        <input v-model="destination" placeholder="/NewFolder/name.ext" autofocus @keyup.enter="doMove" />
        <button @click="doMove">Move</button>
      </template>
      <template v-else>
        <button @click="renaming = true">Rename</button>
        <button @click="moving = true">Move</button>
        <a :href="downloadUrl(path)" target="_blank">Download</a>
        <button class="danger" @click="doDelete">Delete</button>
      </template>
      <p v-if="errorMessage" class="error">{{ errorMessage }}</p>
    </div>
  </div>
</template>

<style scoped>
.backdrop { position: fixed; inset: 0; z-index: 15; }
.menu { position: absolute; top: 80px; right: 40px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.12); display: flex; flex-direction: column; padding: 6px; min-width: 160px; }
.menu button, .menu a { text-align: left; border: none; background: none; padding: 8px 10px; border-radius: 6px; color: var(--text); text-decoration: none; }
.menu button:hover, .menu a:hover { background: var(--bg); }
.menu .danger { color: #d92d20; }
.menu input { margin: 6px; padding: 8px; border: 1px solid var(--border); border-radius: 6px; }
.menu .error { color: #d92d20; font-size: 12px; margin: 6px; }
</style>
```

- [ ] **Step 6: Wire it into `frontend/src/App.vue`**

Add `import ContextMenu from './components/ContextMenu.vue'` and `const activeMenu = ref(null)`. Add `@menu="activeMenu = $event"` to both `<FileGrid>` and `<FileListView>`, and place at the end of the template (inside `#app-shell`):

```vue
<ContextMenu v-if="activeMenu" :entry="activeMenu.entry" :path="activeMenu.path" @close="activeMenu = null" />
```

- [ ] **Step 7: Manually verify**

Upload a test file (Task 9), open its ⋮ menu, rename it, confirm the new name appears in the grid; delete it and confirm it disappears.

- [ ] **Step 8: Commit**

```bash
cd /Users/codex074/nas-webui
git add frontend/src/components/ContextMenu.vue frontend/src/components/pathHelpers.js frontend/tests/components/ContextMenu.test.js frontend/src/App.vue
git commit -m "Add per-file context menu (rename, move, delete, download)"
```

---

## Task 12: Lightbox preview

**Files:**
- Create: `frontend/src/components/Lightbox.vue`
- Modify: `frontend/src/App.vue`

**Interfaces:**
- Consumes: `downloadUrl` from `../api/resources.js` (Task 3), the `open` event from `FileTile`/`FileListView` (Task 7).

- [ ] **Step 1: Create `frontend/src/components/Lightbox.vue`**

```vue
<script setup>
import { computed } from 'vue'
import { downloadUrl } from '../api/resources.js'

const props = defineProps({ entry: { type: Object, required: true } })
defineEmits(['close'])

const kind = computed(() => {
  if (props.entry.type.startsWith('image/')) return 'image'
  if (props.entry.type.startsWith('video/')) return 'video'
  if (props.entry.type === 'application/pdf') return 'pdf'
  return 'other'
})
const src = computed(() => downloadUrl(props.entry.path))
</script>

<template>
  <div class="backdrop" @click.self="$emit('close')">
    <div class="frame">
      <button class="close" @click="$emit('close')">✕</button>
      <img v-if="kind === 'image'" :src="src" :alt="entry.name" />
      <video v-else-if="kind === 'video'" :src="src" controls autoplay />
      <iframe v-else-if="kind === 'pdf'" :src="src" title="PDF preview" />
      <div v-else class="fallback">
        <p>{{ entry.name }}</p>
        <a :href="src" target="_blank">Download</a>
      </div>
    </div>
  </div>
</template>

<style scoped>
.backdrop { position: fixed; inset: 0; background: rgba(15, 18, 25, 0.75); display: flex; align-items: center; justify-content: center; z-index: 30; }
.frame { position: relative; max-width: 85vw; max-height: 85vh; background: var(--bg-elevated); border-radius: var(--radius); padding: 20px; display: flex; align-items: center; justify-content: center; }
.frame img, .frame video { max-width: 100%; max-height: 75vh; }
.frame iframe { width: 70vw; height: 80vh; border: none; }
.close { position: absolute; top: 8px; right: 8px; border: none; background: none; font-size: 18px; }
.fallback { text-align: center; }
</style>
```

- [ ] **Step 2: Wire it into `frontend/src/App.vue`**

Add `import Lightbox from './components/Lightbox.vue'` and `const previewing = ref(null)`. Add `@open="previewing = $event"` to both `<FileGrid>` and `<FileListView>`, and add at the end of the template:

```vue
<Lightbox v-if="previewing" :entry="previewing" @close="previewing = null" />
```

- [ ] **Step 3: Manually verify**

Upload a small image (Task 9), click its tile, confirm the lightbox opens centered with a dimmed backdrop and closes on the ✕ or a backdrop click.

- [ ] **Step 4: Commit**

```bash
cd /Users/codex074/nas-webui
git add frontend/src/components/Lightbox.vue frontend/src/App.vue
git commit -m "Add centered lightbox preview for images, video, and PDF"
```

---

## Task 13: Multi-select and bulk delete

**Files:**
- Modify: `frontend/src/components/FileTile.vue`
- Modify: `frontend/src/App.vue`

**Interfaces:**
- Consumes: `files.toggleSelect`, `files.selected`, `files.deleteSelected` (Task 4, already implemented — this task is purely UI wiring).

- [ ] **Step 1: Add a hover/selection checkbox to `FileTile.vue`**

In `frontend/src/components/FileTile.vue`, add inside `.tile`, right before `.dots`:

```vue
<input
  type="checkbox"
  class="select-box"
  :checked="isSelected"
  @click.stop="files.toggleSelect(fullPath)"
/>
```

And in the `<style scoped>` block:

```css
.select-box { position: absolute; top: 6px; left: 6px; opacity: 0; }
.tile:hover .select-box, .tile.selected .select-box { opacity: 1; }
```

- [ ] **Step 2: Add a bulk-action bar to `frontend/src/App.vue`**

Add to `<script setup>`:

```javascript
const bulkError = ref('')
async function onBulkDelete() {
  bulkError.value = ''
  try {
    await files.deleteSelected()
  } catch (err) {
    bulkError.value = err.message || 'Some items could not be deleted.'
  }
}
```

Add right before the `.content` div (inside `.main`):

```vue
<div v-if="files.selected.size" class="bulk-bar">
  <span>{{ files.selected.size }} selected</span>
  <button @click="onBulkDelete">Delete</button>
  <button @click="files.clearSelection()">Clear</button>
  <span v-if="bulkError" class="bulk-error">{{ bulkError }}</span>
</div>
```

And in the `<style scoped>` block:

```css
.bulk-bar { display: flex; gap: 12px; align-items: center; padding: 8px 16px; background: #eaf1ff; border-bottom: 1px solid var(--border); font-size: 13px; }
.bulk-error { color: #d92d20; }
```

- [ ] **Step 3: Manually verify**

Upload two small test files, hover a tile to reveal its checkbox, select both, confirm the bulk bar shows "2 selected", click Delete, confirm both disappear.

- [ ] **Step 4: Commit**

```bash
cd /Users/codex074/nas-webui
git add frontend/src/components/FileTile.vue frontend/src/App.vue
git commit -m "Add multi-select checkboxes and bulk delete bar"
```

---

## Task 14: 401 handling (session expiry)

**Files:**
- Create: `frontend/src/api/http.js`
- Modify: `frontend/src/api/auth.js`
- Modify: `frontend/src/api/resources.js`
- Test: `frontend/tests/api/http.test.js`

**Interfaces:**
- Produces: `onUnauthorized(callback)` (registers a callback invoked whenever any API call gets a 401) and `authorizedFetch(url, options)` (a `fetch` wrapper every other API module should use instead of calling `fetch` directly, so 401 handling is centralized).

- [ ] **Step 1: Write the failing test**

```javascript
// frontend/tests/api/http.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { authorizedFetch, onUnauthorized } from '../../src/api/http.js'

describe('authorizedFetch', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  it('passes through successful responses unchanged', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200 })
    const response = await authorizedFetch('/api/resources')
    expect(response.status).toBe(200)
  })

  it('invokes registered callbacks on a 401 without throwing an extra error', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 401 })
    const callback = vi.fn()
    onUnauthorized(callback)
    const response = await authorizedFetch('/api/resources')
    expect(callback).toHaveBeenCalled()
    expect(response.status).toBe(401)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/codex074/nas-webui/frontend && npm test -- tests/api/http.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `frontend/src/api/http.js`**

```javascript
const listeners = new Set()

export function onUnauthorized(callback) {
  listeners.add(callback)
  return () => listeners.delete(callback)
}

export async function authorizedFetch(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', ...options })
  if (response.status === 401) {
    for (const callback of listeners) callback()
  }
  return response
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/codex074/nas-webui/frontend && npm test -- tests/api/http.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Switch `auth.js` and `resources.js` to use `authorizedFetch`**

Replace the full contents of `frontend/src/api/auth.js` with:

```javascript
import { authorizedFetch } from './http.js'

async function apiError(response) {
  const err = new Error(response.statusText || 'Request failed')
  err.status = response.status
  return err
}

export async function login(username, password) {
  const url = `/api/auth/login?username=${encodeURIComponent(username)}&recaptcha=`
  const response = await authorizedFetch(url, {
    method: 'POST',
    headers: { 'X-Password': password, 'X-Secret': '' },
  })
  if (!response.ok) throw await apiError(response)
}

export async function logout() {
  const response = await authorizedFetch('/api/auth/logout', { method: 'POST' })
  if (!response.ok) throw await apiError(response)
}

export async function getCurrentUser() {
  const response = await authorizedFetch('/api/users?id=self')
  if (!response.ok) throw await apiError(response)
  return response.json()
}
```

Replace the full contents of `frontend/src/api/resources.js` with:

```javascript
import { authorizedFetch } from './http.js'

const SOURCE = 'share'

async function apiError(response) {
  const err = new Error(response.statusText || 'Request failed')
  err.status = response.status
  return err
}

function resourcesUrl(path, extraParams = {}) {
  const params = new URLSearchParams({ path, source: SOURCE, ...extraParams })
  return `/api/resources?${params.toString()}`
}

export async function listDirectory(path) {
  const response = await authorizedFetch(resourcesUrl(path))
  if (!response.ok) throw await apiError(response)
  return response.json()
}

export async function makeDirectory(path) {
  const response = await authorizedFetch(resourcesUrl(path, { override: 'false', isDir: 'true' }), {
    method: 'POST',
  })
  if (!response.ok) throw await apiError(response)
}

export function uploadFile(path, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', resourcesUrl(path, { override: 'false' }), true)
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    xhr.withCredentials = true
    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100))
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(Object.assign(new Error('Upload failed'), { status: xhr.status }))
    }
    xhr.onerror = () => reject(new Error('Network error during upload'))
    xhr.send(file)
  })
}

export async function deleteItem(path) {
  const response = await authorizedFetch(resourcesUrl(path), { method: 'DELETE' })
  if (!response.ok) throw await apiError(response)
}

export async function bulkDelete(paths) {
  const response = await authorizedFetch('/api/resources/bulk', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(paths.map((path) => ({ source: SOURCE, path }))),
  })
  if (!response.ok) throw await apiError(response)
  return response.json()
}

export async function moveItem(fromPath, toPath, action = 'move') {
  const response = await authorizedFetch('/api/resources', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: [{ fromSource: SOURCE, fromPath, toSource: SOURCE, toPath }],
      action,
      overwrite: false,
      rename: false,
    }),
  })
  if (!response.ok) throw await apiError(response)
}

export async function copyItem(fromPath, toPath) {
  return moveItem(fromPath, toPath, 'copy')
}

export async function renameItem(path, newName) {
  const lastSlash = path.lastIndexOf('/')
  const parent = lastSlash <= 0 ? '' : path.slice(0, lastSlash)
  const toPath = `${parent}/${newName}`
  return moveItem(path, toPath)
}

export function downloadUrl(path) {
  const params = new URLSearchParams({ path, source: SOURCE })
  return `/api/resources/download?${params.toString()}`
}
```

(`uploadFile` keeps using raw `XMLHttpRequest` directly rather than `authorizedFetch`, since `authorizedFetch` wraps the `fetch` API and `fetch` cannot report upload progress — this is unchanged from Task 3, just carried forward here for completeness since the whole file is being replaced.)

- [ ] **Step 6: Run the full existing test suite to confirm nothing broke**

Run: `cd /Users/codex074/nas-webui/frontend && npm test`
Expected: PASS (all tests from Tasks 2–4, 7, 11, 14)

- [ ] **Step 7: Wire a redirect-to-login on unauthorized in `frontend/src/App.vue`**

Add to `<script setup>`:

```javascript
import { onUnauthorized } from './api/http.js'

onUnauthorized(() => { auth.user = null })
```

- [ ] **Step 8: Manually verify**

With the dev server running and logged in, delete the `filebrowser_quantum_jwt` cookie via browser devtools, then click any folder. Confirm the app falls back to the login screen instead of showing an empty/broken file list.

- [ ] **Step 9: Commit**

```bash
cd /Users/codex074/nas-webui
git add frontend/src/api/http.js frontend/src/api/auth.js frontend/src/api/resources.js frontend/tests/api/http.test.js frontend/src/App.vue
git commit -m "Centralize 401 handling and redirect to login on session expiry"
```

---

## Task 15: Dockerize (nginx reverse proxy) and verify the image locally

**Files:**
- Create: `docker/Dockerfile`
- Create: `docker/nginx.conf`

**Interfaces:**
- Produces: a Docker image tagged `nas-webui:local` that serves the built SPA on port 8090 and proxies `/api/*` to `localhost:30334`.

- [ ] **Step 1: Create `docker/nginx.conf`**

```nginx
server {
    listen 8090;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:30334/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        client_max_body_size 0;
        proxy_request_buffering off;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

(`client_max_body_size 0` and `proxy_request_buffering off` matter here specifically because Task 3's upload sends large raw file bodies — without them nginx would buffer the whole upload to disk first or reject big files outright.)

- [ ] **Step 2: Create `docker/Dockerfile`**

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8090
```

- [ ] **Step 3: Build the image locally**

Run: `cd /Users/codex074/nas-webui && docker build -f docker/Dockerfile -t nas-webui:local .`
Expected: build completes with no errors, ending in a message like `Successfully tagged nas-webui:local` (or the buildkit equivalent `naming to docker.io/library/nas-webui:local`).

- [ ] **Step 4: Run it locally against the live NAS to sanity-check the proxy**

Run: `docker run --rm -d --name nas-webui-test --network host nas-webui:local` (host networking so `127.0.0.1:30334` in `nginx.conf` reaches nothing locally — see Step 5 note) then `curl -s http://localhost:8090/api/resources?path=/&source=share` — this is expected to fail locally (there's no FileBrowser Quantum on this machine's `localhost:30334`); the real proxy target only exists on the TrueNAS host itself. Confirm instead that `curl -sI http://localhost:8090/` returns the built `index.html` (HTTP 200), which proves the image built and serves correctly. Then `docker stop nas-webui-test`.

- [ ] **Step 5: Commit**

```bash
cd /Users/codex074/nas-webui
git add docker/Dockerfile docker/nginx.conf
git commit -m "Add Docker image (nginx + static build + API reverse proxy)"
```

---

## Task 16: Deploy to TrueNAS and retarget the Cloudflare Tunnel

**Files:** none (infrastructure task — no repo files change)

**Interfaces:** none — this is the final deployment step, consuming the image built in Task 15.

- [ ] **Step 1: Get the built image onto the TrueNAS host**

From this machine:
```bash
cd /Users/codex074/nas-webui
docker save nas-webui:local | gzip > /tmp/nas-webui.tar.gz
scp /tmp/nas-webui.tar.gz root@100.71.13.117:/root/tank-migration/
ssh root@100.71.13.117 "scp /root/tank-migration/nas-webui.tar.gz truenas_admin@192.168.1.22:/tmp/"
ssh root@100.71.13.117 "ssh truenas_admin@192.168.1.22 'echo 571010074 | sudo -S sh -c \"gunzip -c /tmp/nas-webui.tar.gz | docker load\"'"
```
Expected: the final command prints `Loaded image: nas-webui:local`.

- [ ] **Step 2: Install it as a TrueNAS Custom App via the API**

```bash
ssh root@100.71.13.117 "curl -sk -u 'truenas_admin:truenasmigrate2026x' -X POST https://192.168.1.22/api/v2.0/app \
  -H 'Content-Type: application/json' \
  -d '{
    \"app_name\": \"nas-webui\",
    \"custom_app\": true,
    \"custom_compose_config_string\": \"services:\\n  nas-webui:\\n    image: nas-webui:local\\n    network_mode: host\\n    restart: unless-stopped\\n\"
  }'"
```
Expected: returns a job id (integer).

- [ ] **Step 3: Poll until the app is running**

```bash
ssh root@100.71.13.117 "curl -sk -u 'truenas_admin:truenasmigrate2026x' https://192.168.1.22/api/v2.0/app/id/nas-webui | python3 -c \"import json,sys; print(json.load(sys.stdin).get('state'))\""
```
Expected: `RUNNING` (retry a few times a few seconds apart if it briefly shows `DEPLOYING`).

- [ ] **Step 4: Verify the proxy works end-to-end from the TrueNAS LAN**

```bash
ssh root@100.71.13.117 "curl -s 'http://192.168.1.22:8090/api/resources?path=/&source=share' -H 'Cookie: filebrowser_quantum_jwt=INVALID' -w '\\nHTTP %{http_code}\\n'"
```
Expected: `HTTP 401` (proves nginx successfully proxied the request through to FileBrowser Quantum, which correctly rejected the bad cookie — a 401 here is success, not failure).

- [ ] **Step 5: Hand off the Cloudflare Tunnel retarget to the user (cannot be automated — no reusable Cloudflare API token exists in this environment)**

Tell the user: open the Cloudflare Zero Trust dashboard, find the tunnel whose public hostname is `nas.codex074.com`, and change its ingress rule's service from `http://localhost:30334` to `http://localhost:8090`. Wait for their confirmation before proceeding to Step 6.

- [ ] **Step 6: Verify externally**

Run: `curl -s https://nas.codex074.com | grep -o '<title>[^<]*'`
Expected: shows this project's own `index.html` title (from Task 1's Vite scaffold, e.g. "Vite App" unless changed), not FileBrowser Quantum's `<title>"FileBrowser Quantum"</title>`.

- [ ] **Step 7: Full manual walkthrough on desktop**

Open `https://nas.codex074.com` in a desktop browser: log in as `codex` / `571010074` → create a nested folder `Test/Nested` → drag-and-drop upload a small file into it → click the file to open the lightbox → rename it via the ⋮ menu → delete it → delete the `Test` folder too (via its ⋮ menu) to leave the NAS clean.
Expected: every step succeeds with no console errors.

- [ ] **Step 8: Full manual walkthrough on a real mobile device**

Repeat Step 7's flow on an actual phone (not a resized desktop window), connected over cellular or a different Wi-Fi network than the home LAN, to confirm the tunnel and the mobile bottom-nav layout both work from truly outside the house.
Expected: bottom nav bar renders instead of a left sidebar, grid shows 2–3 columns, lightbox is full-screen, drag-and-drop is replaced naturally by the Upload button's native file picker (no drag-and-drop gesture exists on mobile — this is expected, not a bug).

- [ ] **Step 9: Confirm FileBrowser Quantum's own UI is still reachable as the LAN admin fallback**

Run: `curl -s http://192.168.1.22:30334/ -o /dev/null -w '%{http_code}\n'`
Expected: `200` (unchanged, still directly reachable on the LAN — only the public tunnel now points elsewhere).
