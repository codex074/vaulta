# NAS Web UI — Starred, Trash, Storage Bar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Starred view, a Trash bin, and a live storage-usage bar to the existing `nas-webui` app, matching Google Drive's sidebar, without changing FileBrowser Quantum (the backend it fronts) at all.

**Architecture:** Starring uses FileBrowser Quantum's existing (undocumented-but-live) pin API directly. Trash is implemented entirely client-side by moving deleted items into a hidden `/.trash` folder with a small JSON sidecar per item recording where it came from — no backend change. The storage bar is powered by a new ~30-line Go binary (`nasapi`) added as a second process inside the *same* `nas-webui` Docker image, reading real disk stats via `syscall.Statfs` on a newly-added read-only bind mount of the share, and reverse-proxied by the existing nginx alongside the current `/api/` block.

**Tech Stack:** Same as the existing app — Vue 3 (Composition API), Pinia, Vitest + plain `global.fetch` mocking for API/store tests (this codebase does not mount components with `@vue/test-utils` for `.vue` files — only pure JS modules get dedicated test files; see `frontend/tests/`). New: a single-file Go 1.22 stdlib-only HTTP server for `nasapi`.

**Spec:** `docs/superpowers/specs/2026-09-07-nas-webui-drive-features-design.md`

## Global Constraints

- **Starring (verified live against FileBrowser Quantum v1.5.5-stable, source `share`):**
  - `PATCH /api/users/pinnedItems?action=add|remove` — body `{"name": "<basename>", "path": "<parent dir>", "source": "share"}` — `204` on success.
  - Every `GET /api/resources` directory-listing response includes a `pinnedItems: string[]` field naming which of *that folder's own* entries are pinned. There is no endpoint for the global flat list — it must be assembled by walking the tree.
- **Trash convention (this plan's own design, not a backend feature):**
  - Deleting `<originalPath>` moves it to `/.trash/<unixMs>__<basename>` via the existing `PATCH /api/resources` move action, then uploads a sidecar `/.trash/<unixMs>__<basename>.trashmeta` containing `{"originalPath": "<originalPath>", "deletedAt": <unixMs>}` via the existing raw-body upload (`POST /api/resources`).
  - `/.trash` is automatically excluded from its parent's listing (confirmed live) — no client-side hidden-folder filtering is needed anywhere.
  - Reading a sidecar's content: `GET /api/resources?path=<path>&source=share&content=true` returns the file's text in a `content` field of the JSON response (confirmed live).
- **Storage bar (`nasapi`, new in this plan):**
  - New Go binary, statically built, added to the existing multi-stage `docker/Dockerfile`, listens on `127.0.0.1:9190` (override via `NASAPI_PORT`), serves `GET /storage` → `{"usedBytes": <uint64>, "totalBytes": <uint64>}` computed from `syscall.Statfs` on `/srv/share` (override via `NASAPI_STAT_PATH`).
  - nginx gets a new `location /nasapi/ { proxy_pass http://127.0.0.1:9190/; }` block alongside the existing `/api/` one — the trailing slash on `proxy_pass` strips the `/nasapi` prefix so `GET /nasapi/storage` reaches nasapi's `/storage` route.
  - The `nas-webui` container currently has **no volume mounts** (`network_mode: host`, nothing else) — this plan adds one read-only bind mount, `/mnt/tank/share:/srv/share:ro` (the same host path FileBrowser Quantum itself already mounts, confirmed via `GET /api/v2.0/app/id/filebrowser-quantum`).
  - Both nginx and `nasapi` run in the one container via a small `docker/entrypoint.sh` (this image currently has no supervisor — nginx is the direct entrypoint).
- **Existing FileBrowser Quantum API used unchanged by this plan (from the prior plan, still true):** `GET/POST/PATCH/DELETE /api/resources` with `source=share`; `X-Password` header login; `401` → session-expired handling via `onUnauthorized`/`notifyUnauthorized` in `frontend/src/api/http.js`.
- **Deploy target:** TrueNAS SCALE REST API at `https://192.168.1.22`, basic auth `truenas_admin:truenasmigrate2026x` (already used successfully for the original deploy — see `docs/superpowers/plans/2026-09-06-nas-webui-implementation.md` Task 16). Updating a running custom app: `PUT https://192.168.1.22/api/v2.0/app/id/nas-webui` with JSON body `{"custom_compose_config_string": "<yaml>"}`; this returns a job id, and updating a non-stopped app automatically triggers a redeploy (confirmed via the API's own source: `update_internal(..., trigger_compose=app['state'] != 'STOPPED')`).
- **Testing convention (follow exactly, don't introduce a new pattern):** every new/modified file under `frontend/src/api/` and `frontend/src/stores/` gets a Vitest file that mocks `global.fetch` (for API modules) or mocks the API module it depends on (for stores), matching `frontend/tests/api/resources.test.js` and `frontend/tests/stores/files.test.js`. `.vue` files are **not** unit-tested in this codebase (confirmed: `tests/components/FileTile.test.js` and `ContextMenu.test.js` only test the plain-JS helpers those components import, not the components themselves) — verify `.vue` changes by manual walkthrough in Task 14 instead.
- All work happens in the `nas-webui-impl` git worktree/branch at `/Users/codex074/nas-webui/.worktrees/nas-webui-impl` (same branch the original build used), **not** on `main` (which holds only `docs/`).

---

## Task 1: `getFileText` — read a small file's content via the resources API

**Files:**
- Modify: `frontend/src/api/resources.js`
- Test: `frontend/tests/api/resources.test.js`

**Interfaces:**
- Produces: `getFileText(path: string): Promise<string>` — used by Task 4's `trash.js` to read `.trashmeta` sidecars.

- [ ] **Step 1: Write the failing test**

Add to `frontend/tests/api/resources.test.js` (append inside the existing `describe('resources API', ...)` block, after the `downloadUrl` test):

```js
  it('getFileText requests content=true and returns the content field', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ name: 'x.trashmeta', content: '{"originalPath":"/a.txt"}' }),
    })
    const text = await getFileText('/.trash/x.trashmeta')
    expect(global.fetch.mock.calls[0][0]).toContain('path=%2F.trash%2Fx.trashmeta')
    expect(global.fetch.mock.calls[0][0]).toContain('content=true')
    expect(text).toBe('{"originalPath":"/a.txt"}')
  })
```

Also update the import line at the top of the file to include the new function:

```js
import {
  listDirectory, makeDirectory, deleteItem, bulkDelete,
  moveItem, renameItem, downloadUrl, uploadFile, getFileText,
} from '../../src/api/resources.js'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/codex074/nas-webui/.worktrees/nas-webui-impl/frontend && npm test -- resources`
Expected: FAIL — `getFileText is not a function` (or similar import error).

- [ ] **Step 3: Add `getFileText` to `resources.js`**

Append to `frontend/src/api/resources.js` (after the existing `downloadUrl` function, keeping everything else in the file unchanged):

```js
export async function getFileText(path) {
  const response = await authorizedFetch(resourcesUrl(path, { content: 'true' }))
  if (!response.ok) throw await apiError(response)
  const data = await response.json()
  return data.content
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/codex074/nas-webui/.worktrees/nas-webui-impl/frontend && npm test -- resources`
Expected: PASS, all tests in the file green.

- [ ] **Step 5: Commit**

```bash
cd /Users/codex074/nas-webui/.worktrees/nas-webui-impl
git add frontend/src/api/resources.js frontend/tests/api/resources.test.js
git commit -m "feat: add getFileText for reading small file contents via the resources API"
```

---

## Task 2: Star toggle API client

**Files:**
- Create: `frontend/src/api/pinned.js`
- Test: `frontend/tests/api/pinned.test.js`

**Interfaces:**
- Produces: `togglePinned({name, path, source}: {name: string, path: string, source: string}, action?: 'add'|'remove'): Promise<void>` — used by Task 3's `files.js` store.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/api/pinned.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { togglePinned } from '../../src/api/pinned.js'

describe('pinned API', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  it('PATCHes /api/users/pinnedItems with action=add by default', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 204 })
    await togglePinned({ name: 'Photos', path: '/', source: 'share' })
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/users/pinnedItems?action=add')
    expect(opts.method).toBe('PATCH')
    expect(JSON.parse(opts.body)).toEqual({ name: 'Photos', path: '/', source: 'share' })
  })

  it('uses action=remove when passed explicitly', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 204 })
    await togglePinned({ name: 'Photos', path: '/', source: 'share' }, 'remove')
    const [url] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/users/pinnedItems?action=remove')
  })

  it('throws the API error message on failure', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      clone() { return this },
      json: () => Promise.resolve({ message: 'not allowed' }),
    })
    await expect(togglePinned({ name: 'a', path: '/', source: 'share' })).rejects.toThrow('not allowed')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/codex074/nas-webui/.worktrees/nas-webui-impl/frontend && npm test -- pinned`
Expected: FAIL — module `../../src/api/pinned.js` does not exist.

- [ ] **Step 3: Create `frontend/src/api/pinned.js`**

```js
import { authorizedFetch, apiError } from './http.js'

export async function togglePinned({ name, path, source }, action = 'add') {
  const response = await authorizedFetch(`/api/users/pinnedItems?action=${action}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, path, source }),
  })
  if (!response.ok) throw await apiError(response)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/codex074/nas-webui/.worktrees/nas-webui-impl/frontend && npm test -- pinned`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/codex074/nas-webui/.worktrees/nas-webui-impl
git add frontend/src/api/pinned.js frontend/tests/api/pinned.test.js
git commit -m "feat: add pinned-items API client for starring"
```

---

## Task 3: Files store — track and toggle stars

**Files:**
- Modify: `frontend/src/stores/files.js`
- Test: `frontend/tests/stores/files.test.js`

**Interfaces:**
- Consumes: `togglePinned` from Task 2 (`../api/pinned.js`).
- Produces: `filesStore.pinnedNames: Set<string>` (names pinned in the currently-loaded folder) and `filesStore.toggleStar(entry: {name: string}): Promise<void>`, both used by Task 9's `FileTile.vue`/`FileListView.vue`.

- [ ] **Step 1: Write the failing tests**

In `frontend/tests/stores/files.test.js`, add the import and mock for `pinned.js` at the top:

```js
import * as pinned from '../../src/api/pinned.js'
```

and extend the existing `vi.mock` block to also mock `pinned.js`:

```js
vi.mock('../../src/api/resources.js', () => ({
  listDirectory: vi.fn(),
  bulkDelete: vi.fn(),
}))
vi.mock('../../src/api/pinned.js', () => ({
  togglePinned: vi.fn(),
}))
```

Add these tests inside the existing `describe('files store', ...)` block:

```js
  it('loadDirectory captures pinnedItems from the response into pinnedNames', async () => {
    resources.listDirectory.mockResolvedValue({
      path: '/', source: 'share', folders: [], files: [{ name: 'a.txt', type: 'text/plain' }],
      pinnedItems: ['a.txt'],
    })
    const store = useFilesStore()
    await store.loadDirectory('/')
    expect(store.pinnedNames).toEqual(new Set(['a.txt']))
  })

  it('loadDirectory defaults pinnedNames to empty when the response omits pinnedItems', async () => {
    resources.listDirectory.mockResolvedValue({ path: '/', source: 'share', folders: [], files: [] })
    const store = useFilesStore()
    await store.loadDirectory('/')
    expect(store.pinnedNames).toEqual(new Set())
  })

  it('toggleStar pins an unpinned item and updates pinnedNames', async () => {
    pinned.togglePinned.mockResolvedValue(undefined)
    const store = useFilesStore()
    store.currentPath = '/'
    await store.toggleStar({ name: 'a.txt' })
    expect(pinned.togglePinned).toHaveBeenCalledWith({ name: 'a.txt', path: '/', source: 'share' }, 'add')
    expect(store.pinnedNames.has('a.txt')).toBe(true)
  })

  it('toggleStar unpins an already-pinned item', async () => {
    pinned.togglePinned.mockResolvedValue(undefined)
    const store = useFilesStore()
    store.currentPath = '/'
    store.pinnedNames = new Set(['a.txt'])
    await store.toggleStar({ name: 'a.txt' })
    expect(pinned.togglePinned).toHaveBeenCalledWith({ name: 'a.txt', path: '/', source: 'share' }, 'remove')
    expect(store.pinnedNames.has('a.txt')).toBe(false)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/codex074/nas-webui/.worktrees/nas-webui-impl/frontend && npm test -- files`
Expected: FAIL — `store.pinnedNames` is `undefined`, `store.toggleStar is not a function`.

- [ ] **Step 3: Update `frontend/src/stores/files.js`**

Replace the file's contents entirely with:

```js
import { defineStore } from 'pinia'
import { listDirectory, bulkDelete } from '../api/resources.js'
import { togglePinned } from '../api/pinned.js'

const VIEW_MODE_KEY = 'nas-view-mode'

export const useFilesStore = defineStore('files', {
  state: () => ({
    currentPath: '/',
    entries: [],
    pinnedNames: new Set(),
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
        this.pinnedNames = new Set(result.pinnedItems || [])
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
    async toggleStar(entry) {
      const isPinned = this.pinnedNames.has(entry.name)
      await togglePinned({ name: entry.name, path: this.currentPath, source: 'share' }, isPinned ? 'remove' : 'add')
      const next = new Set(this.pinnedNames)
      if (isPinned) next.delete(entry.name)
      else next.add(entry.name)
      this.pinnedNames = next
    },
    async deleteSelected() {
      const paths = Array.from(this.selected)
      const result = await bulkDelete(paths)
      await this.loadDirectory(this.currentPath)
      const failed = result && Array.isArray(result.failed) ? result.failed : []
      if (failed.length) {
        const names = failed.map((f) => (typeof f === 'string' ? f : f.path || JSON.stringify(f))).join(', ')
        throw new Error(`Could not delete: ${names}`)
      }
    },
  },
})
```

(This is the exact previous file plus `pinnedNames` state, its population in `loadDirectory`, and the new `toggleStar` action. `deleteSelected` is deliberately left as-is here — Task 7 replaces it.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/codex074/nas-webui/.worktrees/nas-webui-impl/frontend && npm test -- files`
Expected: PASS, all tests in the file green (including the pre-existing ones).

- [ ] **Step 5: Commit**

```bash
cd /Users/codex074/nas-webui/.worktrees/nas-webui-impl
git add frontend/src/stores/files.js frontend/tests/stores/files.test.js
git commit -m "feat: track pinned/starred items in the files store"
```

---

## Task 4: Trash API — move-to-.trash convention

**Files:**
- Create: `frontend/src/api/trash.js`
- Test: `frontend/tests/api/trash.test.js`

**Interfaces:**
- Consumes: `moveItem`, `uploadFile`, `getFileText`, `deleteItem`, `listDirectory` from `../api/resources.js` (all pre-existing except `getFileText`, added in Task 1).
- Produces: `softDelete(originalPath: string): Promise<void>`, `listTrash(): Promise<Array<{name, type, size, modified, trashPath, path, originalPath: string|null, deletedAt: number|null}>>`, `restoreFromTrash(item): Promise<void>`, `deleteForever(item): Promise<void>`, `emptyTrash(): Promise<void>` — used by Task 5's `trash.js` store, Task 7's `files.js`, and Task 10's `ContextMenu.vue`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/api/trash.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  trashPathFor, metaPathFor, softDelete, listTrash, restoreFromTrash, deleteForever, emptyTrash,
} from '../../src/api/trash.js'
import * as resources from '../../src/api/resources.js'

vi.mock('../../src/api/resources.js', () => ({
  moveItem: vi.fn(),
  uploadFile: vi.fn(),
  getFileText: vi.fn(),
  deleteItem: vi.fn(),
  listDirectory: vi.fn(),
}))

describe('trash API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('trashPathFor prefixes the basename with a timestamp under /.trash', () => {
    expect(trashPathFor('/Photos/a.jpg', 1700000000000)).toBe('/.trash/1700000000000__a.jpg')
    expect(trashPathFor('/a.jpg', 1700000000000)).toBe('/.trash/1700000000000__a.jpg')
  })

  it('metaPathFor appends .trashmeta to a trash path', () => {
    expect(metaPathFor('/.trash/1__a.jpg')).toBe('/.trash/1__a.jpg.trashmeta')
  })

  it('softDelete moves the item into /.trash and uploads a sidecar', async () => {
    resources.moveItem.mockResolvedValue(undefined)
    resources.uploadFile.mockResolvedValue(undefined)
    await softDelete('/Photos/a.jpg')
    expect(resources.moveItem).toHaveBeenCalledTimes(1)
    const [from, to] = resources.moveItem.mock.calls[0]
    expect(from).toBe('/Photos/a.jpg')
    expect(to).toMatch(/^\/\.trash\/\d+__a\.jpg$/)
    expect(resources.uploadFile).toHaveBeenCalledTimes(1)
    const [metaPath, blob] = resources.uploadFile.mock.calls[0]
    expect(metaPath).toBe(`${to}.trashmeta`)
    const text = await blob.text()
    const meta = JSON.parse(text)
    expect(meta.originalPath).toBe('/Photos/a.jpg')
    expect(typeof meta.deletedAt).toBe('number')
  })

  it('softDelete surfaces a clear error when the sidecar upload fails after a successful move', async () => {
    resources.moveItem.mockResolvedValue(undefined)
    resources.uploadFile.mockRejectedValue(new Error('disk full'))
    await expect(softDelete('/a.jpg')).rejects.toThrow("Moved to trash, but couldn't save its restore info: disk full")
  })

  it('listTrash pairs each item with its parsed sidecar and skips .trashmeta files themselves', async () => {
    resources.listDirectory.mockResolvedValue({
      path: '/.trash', source: 'share',
      folders: [],
      files: [
        { name: '1__a.jpg', type: 'image/jpeg', size: 10, modified: '2026-09-07T00:00:00Z' },
        { name: '1__a.jpg.trashmeta', type: 'text/plain', size: 40, modified: '2026-09-07T00:00:00Z' },
      ],
    })
    resources.getFileText.mockResolvedValue('{"originalPath":"/Photos/a.jpg","deletedAt":1}')
    const items = await listTrash()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      name: '1__a.jpg',
      trashPath: '/.trash/1__a.jpg',
      originalPath: '/Photos/a.jpg',
      deletedAt: 1,
    })
  })

  it('listTrash leaves originalPath/deletedAt null when a sidecar is missing', async () => {
    resources.listDirectory.mockResolvedValue({
      path: '/.trash', source: 'share',
      folders: [],
      files: [{ name: '2__b.jpg', type: 'image/jpeg', size: 10, modified: '2026-09-07T00:00:00Z' }],
    })
    const items = await listTrash()
    expect(items[0].originalPath).toBeNull()
    expect(items[0].deletedAt).toBeNull()
  })

  it('restoreFromTrash moves the item back and deletes its sidecar', async () => {
    resources.moveItem.mockResolvedValue(undefined)
    resources.deleteItem.mockResolvedValue(undefined)
    await restoreFromTrash({ trashPath: '/.trash/1__a.jpg', originalPath: '/Photos/a.jpg' })
    expect(resources.moveItem).toHaveBeenCalledWith('/.trash/1__a.jpg', '/Photos/a.jpg')
    expect(resources.deleteItem).toHaveBeenCalledWith('/.trash/1__a.jpg.trashmeta')
  })

  it('restoreFromTrash refuses to restore an item with no known original path', async () => {
    await expect(restoreFromTrash({ trashPath: '/.trash/2__b.jpg', originalPath: null }))
      .rejects.toThrow('Missing restore information for this item.')
    expect(resources.moveItem).not.toHaveBeenCalled()
  })

  it('deleteForever deletes both the item and its sidecar', async () => {
    resources.deleteItem.mockResolvedValue(undefined)
    await deleteForever({ trashPath: '/.trash/1__a.jpg', originalPath: '/Photos/a.jpg' })
    expect(resources.deleteItem).toHaveBeenCalledWith('/.trash/1__a.jpg')
    expect(resources.deleteItem).toHaveBeenCalledWith('/.trash/1__a.jpg.trashmeta')
  })

  it('deleteForever skips the sidecar delete when there was no sidecar', async () => {
    resources.deleteItem.mockResolvedValue(undefined)
    await deleteForever({ trashPath: '/.trash/2__b.jpg', originalPath: null })
    expect(resources.deleteItem).toHaveBeenCalledTimes(1)
    expect(resources.deleteItem).toHaveBeenCalledWith('/.trash/2__b.jpg')
  })

  it('emptyTrash deletes every listed item and collects failures into one error', async () => {
    resources.listDirectory.mockResolvedValue({
      path: '/.trash', source: 'share',
      folders: [],
      files: [
        { name: '1__a.jpg', type: 'image/jpeg', size: 1, modified: '2026-09-07T00:00:00Z' },
        { name: '2__b.jpg', type: 'image/jpeg', size: 1, modified: '2026-09-07T00:00:00Z' },
      ],
    })
    resources.deleteItem.mockImplementation((path) =>
      path === '/.trash/2__b.jpg' ? Promise.reject(new Error('locked')) : Promise.resolve()
    )
    await expect(emptyTrash()).rejects.toThrow('/.trash/2__b.jpg')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/codex074/nas-webui/.worktrees/nas-webui-impl/frontend && npm test -- trash`
Expected: FAIL — module `../../src/api/trash.js` does not exist.

- [ ] **Step 3: Create `frontend/src/api/trash.js`**

```js
import { moveItem, uploadFile, getFileText, deleteItem, listDirectory } from './resources.js'

function basename(path) {
  const idx = path.lastIndexOf('/')
  return idx === -1 ? path : path.slice(idx + 1)
}

export function trashPathFor(originalPath, ts = Date.now()) {
  return `/.trash/${ts}__${basename(originalPath)}`
}

export function metaPathFor(trashPath) {
  return `${trashPath}.trashmeta`
}

export async function softDelete(originalPath) {
  const ts = Date.now()
  const trashPath = trashPathFor(originalPath, ts)
  await moveItem(originalPath, trashPath)
  try {
    const meta = { originalPath, deletedAt: ts }
    const blob = new Blob([JSON.stringify(meta)], { type: 'application/json' })
    await uploadFile(metaPathFor(trashPath), blob)
  } catch (err) {
    throw new Error(`Moved to trash, but couldn't save its restore info: ${err.message}`)
  }
}

export async function listTrash() {
  const result = await listDirectory('/.trash')
  const allEntries = [...(result.folders || []), ...(result.files || [])]
  const metaNames = new Set(allEntries.filter((e) => e.name.endsWith('.trashmeta')).map((e) => e.name))
  const itemEntries = allEntries.filter((e) => !e.name.endsWith('.trashmeta'))

  const items = []
  for (const entry of itemEntries) {
    const trashPath = `/.trash/${entry.name}`
    let originalPath = null
    let deletedAt = null
    if (metaNames.has(`${entry.name}.trashmeta`)) {
      try {
        const text = await getFileText(metaPathFor(trashPath))
        const parsed = JSON.parse(text)
        originalPath = parsed.originalPath
        deletedAt = parsed.deletedAt
      } catch {
        // corrupt or unreadable sidecar — still show the item, just without restore info
      }
    }
    items.push({ ...entry, path: trashPath, trashPath, originalPath, deletedAt })
  }
  return items
}

export async function restoreFromTrash(item) {
  if (!item.originalPath) throw new Error('Missing restore information for this item.')
  await moveItem(item.trashPath, item.originalPath)
  try {
    await deleteItem(metaPathFor(item.trashPath))
  } catch (err) {
    throw new Error(`Restored, but couldn't remove its trash record: ${err.message}`)
  }
}

export async function deleteForever(item) {
  await deleteItem(item.trashPath)
  if (!item.originalPath) return
  try {
    await deleteItem(metaPathFor(item.trashPath))
  } catch (err) {
    throw new Error(`Deleted, but couldn't remove its trash record: ${err.message}`)
  }
}

export async function emptyTrash() {
  const items = await listTrash()
  const failed = []
  for (const item of items) {
    try {
      await deleteForever(item)
    } catch (err) {
      failed.push({ path: item.trashPath, message: err.message })
    }
  }
  if (failed.length) {
    throw new Error(`Could not delete: ${failed.map((f) => f.path).join(', ')}`)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/codex074/nas-webui/.worktrees/nas-webui-impl/frontend && npm test -- trash`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/codex074/nas-webui/.worktrees/nas-webui-impl
git add frontend/src/api/trash.js frontend/tests/api/trash.test.js
git commit -m "feat: implement move-to-.trash soft delete on top of the existing resources API"
```

---

## Task 5: Trash Pinia store

**Files:**
- Create: `frontend/src/stores/trash.js`
- Test: `frontend/tests/stores/trash.test.js`

**Interfaces:**
- Consumes: `listTrash`, `restoreFromTrash`, `deleteForever`, `emptyTrash` from Task 4 (`../api/trash.js`).
- Produces: `trashStore.entries`, `trashStore.loading`, `trashStore.loadTrash()`, `trashStore.restore(item)`, `trashStore.deleteForeverItem(item)`, `trashStore.emptyAll()` — used by Task 10's `ContextMenu.vue` and Task 12's `App.vue`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/stores/trash.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTrashStore } from '../../src/stores/trash.js'
import * as trashApi from '../../src/api/trash.js'

vi.mock('../../src/api/trash.js', () => ({
  listTrash: vi.fn(),
  restoreFromTrash: vi.fn(),
  deleteForever: vi.fn(),
  emptyTrash: vi.fn(),
}))

describe('trash store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('loadTrash populates entries from listTrash', async () => {
    trashApi.listTrash.mockResolvedValue([{ name: 'a.jpg', trashPath: '/.trash/1__a.jpg' }])
    const store = useTrashStore()
    await store.loadTrash()
    expect(store.entries).toEqual([{ name: 'a.jpg', trashPath: '/.trash/1__a.jpg' }])
    expect(store.loading).toBe(false)
  })

  it('loadTrash sets and clears the error state on failure', async () => {
    trashApi.listTrash.mockRejectedValue(new Error('boom'))
    const store = useTrashStore()
    await expect(store.loadTrash()).rejects.toThrow('boom')
    expect(store.error).toBeInstanceOf(Error)
    expect(store.loading).toBe(false)
  })

  it('restore calls restoreFromTrash then reloads the trash list', async () => {
    trashApi.restoreFromTrash.mockResolvedValue(undefined)
    trashApi.listTrash.mockResolvedValue([])
    const store = useTrashStore()
    const item = { trashPath: '/.trash/1__a.jpg', originalPath: '/a.jpg' }
    await store.restore(item)
    expect(trashApi.restoreFromTrash).toHaveBeenCalledWith(item)
    expect(trashApi.listTrash).toHaveBeenCalledTimes(1)
  })

  it('deleteForeverItem calls deleteForever then reloads the trash list', async () => {
    trashApi.deleteForever.mockResolvedValue(undefined)
    trashApi.listTrash.mockResolvedValue([])
    const store = useTrashStore()
    const item = { trashPath: '/.trash/1__a.jpg', originalPath: '/a.jpg' }
    await store.deleteForeverItem(item)
    expect(trashApi.deleteForever).toHaveBeenCalledWith(item)
    expect(trashApi.listTrash).toHaveBeenCalledTimes(1)
  })

  it('emptyAll calls emptyTrash then reloads the trash list', async () => {
    trashApi.emptyTrash.mockResolvedValue(undefined)
    trashApi.listTrash.mockResolvedValue([])
    const store = useTrashStore()
    await store.emptyAll()
    expect(trashApi.emptyTrash).toHaveBeenCalledTimes(1)
    expect(trashApi.listTrash).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/codex074/nas-webui/.worktrees/nas-webui-impl/frontend && npm test -- stores/trash`
Expected: FAIL — module `../../src/stores/trash.js` does not exist.

- [ ] **Step 3: Create `frontend/src/stores/trash.js`**

```js
import { defineStore } from 'pinia'
import { listTrash, restoreFromTrash, deleteForever, emptyTrash } from '../api/trash.js'

export const useTrashStore = defineStore('trash', {
  state: () => ({ entries: [], loading: false, error: null }),
  actions: {
    async loadTrash() {
      this.loading = true
      this.error = null
      try {
        this.entries = await listTrash()
      } catch (err) {
        this.error = err
        throw err
      } finally {
        this.loading = false
      }
    },
    async restore(item) {
      await restoreFromTrash(item)
      await this.loadTrash()
    },
    async deleteForeverItem(item) {
      await deleteForever(item)
      await this.loadTrash()
    },
    async emptyAll() {
      await emptyTrash()
      await this.loadTrash()
    },
  },
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/codex074/nas-webui/.worktrees/nas-webui-impl/frontend && npm test -- stores/trash`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/codex074/nas-webui/.worktrees/nas-webui-impl
git add frontend/src/stores/trash.js frontend/tests/stores/trash.test.js
git commit -m "feat: add trash Pinia store"
```

---

## Task 6: Starred Pinia store — recursive walk

**Files:**
- Create: `frontend/src/stores/starred.js`
- Test: `frontend/tests/stores/starred.test.js`

**Interfaces:**
- Consumes: `listDirectory` from `../api/resources.js` (pre-existing).
- Produces: `starredStore.entries`, `starredStore.loading`, `starredStore.loadStarred()` — used by Task 12's `App.vue`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/stores/starred.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useStarredStore } from '../../src/stores/starred.js'
import * as resources from '../../src/api/resources.js'

vi.mock('../../src/api/resources.js', () => ({
  listDirectory: vi.fn(),
}))

describe('starred store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('loadStarred collects pinned entries from the root folder', async () => {
    resources.listDirectory.mockResolvedValue({
      path: '/', source: 'share',
      folders: [],
      files: [
        { name: 'a.txt', type: 'text/plain', size: 1, modified: '2026-09-07T00:00:00Z' },
        { name: 'b.txt', type: 'text/plain', size: 1, modified: '2026-09-07T00:00:00Z' },
      ],
      pinnedItems: ['a.txt'],
    })
    const store = useStarredStore()
    await store.loadStarred()
    expect(store.entries).toEqual([
      { name: 'a.txt', type: 'text/plain', size: 1, modified: '2026-09-07T00:00:00Z', path: '/a.txt' },
    ])
  })

  it('loadStarred recurses into subfolders and skips /.trash', async () => {
    resources.listDirectory.mockImplementation((path) => {
      if (path === '/') {
        return Promise.resolve({
          path: '/', source: 'share',
          folders: [{ name: 'Photos', type: 'directory', size: 4096, modified: '2026-09-07T00:00:00Z' }],
          files: [],
          pinnedItems: [],
        })
      }
      if (path === '/Photos') {
        return Promise.resolve({
          path: '/Photos', source: 'share',
          folders: [],
          files: [{ name: 'c.jpg', type: 'image/jpeg', size: 2, modified: '2026-09-07T00:00:00Z' }],
          pinnedItems: ['c.jpg'],
        })
      }
      throw new Error(`unexpected path ${path}`)
    })
    const store = useStarredStore()
    await store.loadStarred()
    expect(store.entries).toEqual([
      { name: 'c.jpg', type: 'image/jpeg', size: 2, modified: '2026-09-07T00:00:00Z', path: '/Photos/c.jpg' },
    ])
    expect(resources.listDirectory).not.toHaveBeenCalledWith('/.trash')
  })

  it('loadStarred sets loading and error state correctly on failure', async () => {
    resources.listDirectory.mockRejectedValue(new Error('boom'))
    const store = useStarredStore()
    await expect(store.loadStarred()).rejects.toThrow('boom')
    expect(store.error).toBeInstanceOf(Error)
    expect(store.loading).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/codex074/nas-webui/.worktrees/nas-webui-impl/frontend && npm test -- stores/starred`
Expected: FAIL — module `../../src/stores/starred.js` does not exist.

- [ ] **Step 3: Create `frontend/src/stores/starred.js`**

```js
import { defineStore } from 'pinia'
import { listDirectory } from '../api/resources.js'

async function walk(path) {
  const result = await listDirectory(path)
  const folders = result.folders || []
  const files = result.files || []
  const pinned = new Set(result.pinnedItems || [])
  const base = path.endsWith('/') ? path : `${path}/`

  const found = [...folders, ...files]
    .filter((entry) => pinned.has(entry.name))
    .map((entry) => ({ ...entry, path: `${base}${entry.name}` }))

  for (const folder of folders) {
    if (folder.name === '.trash') continue
    const childPath = `${base}${folder.name}`
    found.push(...(await walk(childPath)))
  }
  return found
}

export const useStarredStore = defineStore('starred', {
  state: () => ({ entries: [], loading: false, error: null }),
  actions: {
    async loadStarred() {
      this.loading = true
      this.error = null
      try {
        this.entries = await walk('/')
      } catch (err) {
        this.error = err
        throw err
      } finally {
        this.loading = false
      }
    },
  },
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/codex074/nas-webui/.worktrees/nas-webui-impl/frontend && npm test -- stores/starred`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/codex074/nas-webui/.worktrees/nas-webui-impl
git add frontend/src/stores/starred.js frontend/tests/stores/starred.test.js
git commit -m "feat: add starred Pinia store with a recursive pinned-items walk"
```

---

## Task 7: Route deletes through Trash; remove the now-dead bulk-delete API

**Files:**
- Modify: `frontend/src/stores/files.js`
- Modify: `frontend/src/api/resources.js` (remove `bulkDelete` — no longer called anywhere after this task)
- Test: `frontend/tests/stores/files.test.js`
- Test: `frontend/tests/api/resources.test.js` (remove the now-obsolete `bulkDelete` tests)

**Interfaces:**
- Consumes: `softDelete` from Task 4 (`../api/trash.js`).
- Produces: `filesStore.deleteSelected()` now soft-deletes (moves to trash) instead of permanently deleting.

- [ ] **Step 1: Write the failing tests**

In `frontend/tests/stores/files.test.js`, replace the `vi.mock('../../src/api/resources.js', ...)` block and add a new mock/import for `trash.js`:

```js
vi.mock('../../src/api/resources.js', () => ({
  listDirectory: vi.fn(),
}))
vi.mock('../../src/api/pinned.js', () => ({
  togglePinned: vi.fn(),
}))
vi.mock('../../src/api/trash.js', () => ({
  softDelete: vi.fn(),
}))
```

Add the import at the top alongside the existing ones:

```js
import * as trash from '../../src/api/trash.js'
```

Replace the two existing `deleteSelected` tests (`'deleteSelected calls bulkDelete with selected paths and clears selection on success'` and `'deleteSelected throws when some deletes fail'`) with:

```js
  it('deleteSelected calls softDelete for each selected path and clears selection', async () => {
    trash.softDelete.mockResolvedValue(undefined)
    const store = useFilesStore()
    store.toggleSelect('/a.jpg')
    store.toggleSelect('/b.jpg')
    await store.deleteSelected()
    expect(trash.softDelete).toHaveBeenCalledWith('/a.jpg')
    expect(trash.softDelete).toHaveBeenCalledWith('/b.jpg')
    expect(store.selected.size).toBe(0)
  })

  it('deleteSelected throws listing the paths that failed, but still clears selection', async () => {
    trash.softDelete.mockImplementation((path) =>
      path === '/bad.jpg' ? Promise.reject(new Error('boom')) : Promise.resolve()
    )
    const store = useFilesStore()
    store.toggleSelect('/bad.jpg')
    await expect(store.deleteSelected()).rejects.toThrow('/bad.jpg')
    expect(store.selected.size).toBe(0)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/codex074/nas-webui/.worktrees/nas-webui-impl/frontend && npm test -- files`
Expected: FAIL — `deleteSelected` still calls the (now-unmocked, since it's not in the returned object) `bulkDelete`, throwing.

- [ ] **Step 3: Update `frontend/src/stores/files.js`**

Change the import line from:

```js
import { listDirectory, bulkDelete } from '../api/resources.js'
import { togglePinned } from '../api/pinned.js'
```

to:

```js
import { listDirectory } from '../api/resources.js'
import { togglePinned } from '../api/pinned.js'
import { softDelete } from '../api/trash.js'
```

Replace the `deleteSelected` action from:

```js
    async deleteSelected() {
      const paths = Array.from(this.selected)
      const result = await bulkDelete(paths)
      await this.loadDirectory(this.currentPath)
      const failed = result && Array.isArray(result.failed) ? result.failed : []
      if (failed.length) {
        const names = failed.map((f) => (typeof f === 'string' ? f : f.path || JSON.stringify(f))).join(', ')
        throw new Error(`Could not delete: ${names}`)
      }
    },
```

to:

```js
    async deleteSelected() {
      const paths = Array.from(this.selected)
      const failed = []
      for (const path of paths) {
        try {
          await softDelete(path)
        } catch (err) {
          failed.push({ path, message: err.message })
        }
      }
      this.selected = new Set()
      if (failed.length) {
        const names = failed.map((f) => f.path).join(', ')
        throw new Error(`Could not delete: ${names}`)
      }
    },
```

Note this action no longer reloads the folder itself — the caller (Task 12's `App.vue`) now does that explicitly, since after this change the right thing to reload differs by which view is active (browse vs. starred).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/codex074/nas-webui/.worktrees/nas-webui-impl/frontend && npm test -- files`
Expected: PASS.

- [ ] **Step 5: Remove the now-dead `bulkDelete` from `resources.js`**

In `frontend/src/api/resources.js`, delete this function entirely:

```js
export async function bulkDelete(paths) {
  const response = await authorizedFetch('/api/resources/bulk', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(paths.map((path) => ({ source: SOURCE, path }))),
  })
  if (!response.ok) throw await apiError(response)
  return response.json()
}
```

In `frontend/tests/api/resources.test.js`: remove its `import` from the destructured list at the top, and delete the `'bulkDelete posts an array of {source,path} to /api/resources/bulk'` test.

- [ ] **Step 6: Run the full frontend test suite**

Run: `cd /Users/codex074/nas-webui/.worktrees/nas-webui-impl/frontend && npm test`
Expected: PASS, no references to `bulkDelete` remain anywhere (confirm with `grep -rn bulkDelete frontend/src frontend/tests` returning nothing).

- [ ] **Step 7: Commit**

```bash
cd /Users/codex074/nas-webui/.worktrees/nas-webui-impl
git add frontend/src/stores/files.js frontend/src/api/resources.js frontend/tests/stores/files.test.js frontend/tests/api/resources.test.js
git commit -m "feat: route deletes through trash instead of permanent bulk-delete"
```

---

## Task 8: Storage usage API client

**Files:**
- Create: `frontend/src/api/storage.js`
- Test: `frontend/tests/api/storage.test.js`

**Interfaces:**
- Produces: `getStorageUsage(): Promise<{usedBytes: number, totalBytes: number}>` — used by Task 11's `Sidebar.vue`. Talks to `/nasapi/storage`, built in Task 13.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/api/storage.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getStorageUsage } from '../../src/api/storage.js'

describe('storage API', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  it('fetches /nasapi/storage and returns the parsed JSON', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ usedBytes: 100, totalBytes: 1000 }),
    })
    const usage = await getStorageUsage()
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toBe('/nasapi/storage')
    expect(opts.credentials).toBe('same-origin')
    expect(usage).toEqual({ usedBytes: 100, totalBytes: 1000 })
  })

  it('throws with the response status when the request fails', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 502 })
    await expect(getStorageUsage()).rejects.toThrow('Could not load storage usage (502)')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/codex074/nas-webui/.worktrees/nas-webui-impl/frontend && npm test -- storage`
Expected: FAIL — module `../../src/api/storage.js` does not exist.

- [ ] **Step 3: Create `frontend/src/api/storage.js`**

```js
export async function getStorageUsage() {
  const response = await fetch('/nasapi/storage', { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`Could not load storage usage (${response.status})`)
  return response.json()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/codex074/nas-webui/.worktrees/nas-webui-impl/frontend && npm test -- storage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/codex074/nas-webui/.worktrees/nas-webui-impl
git add frontend/src/api/storage.js frontend/tests/api/storage.test.js
git commit -m "feat: add storage usage API client for the new nasapi endpoint"
```

---

## Task 9: Star button, path-aware tiles, and trash-view click guard in FileTile/FileListView/FileGrid

**Files:**
- Modify: `frontend/src/components/FileTile.vue`
- Modify: `frontend/src/components/FileListView.vue`
- Modify: `frontend/src/components/FileGrid.vue`

**Interfaces:**
- Consumes: `filesStore.pinnedNames` and `filesStore.toggleStar` from Task 3.
- Produces: a `disableOpen` prop on `FileTile`/`FileListView`/`FileGrid` (used by Task 12's `App.vue` to disable navigation/preview while viewing Trash); both components now prefer `entry.path` (set by Task 4's `listTrash` and Task 6's `walk`) over deriving a path from `filesStore.currentPath`, so they render correctly for Starred/Trash entries that live outside the currently-browsed folder.

No dedicated test file for this task — per the Global Constraints testing convention, `.vue` files in this codebase aren't unit-tested (`FileTile.test.js`/`ContextMenu.test.js` only cover the plain-JS helpers they import). This is verified manually in Task 14.

- [ ] **Step 1: Replace `frontend/src/components/FileTile.vue`**

```vue
<script setup>
import { computed } from 'vue'
import { useFilesStore } from '../stores/files.js'
import { formatSize, formatRelativeTime, iconFor } from './fileFormat.js'
import { showError } from '../errorToast.js'

const props = defineProps({
  entry: { type: Object, required: true },
  disableOpen: { type: Boolean, default: false },
})
const emit = defineEmits(['open', 'menu'])
const files = useFilesStore()

const fullPath = computed(() =>
  props.entry.path || `${files.currentPath}${files.currentPath.endsWith('/') ? '' : '/'}${props.entry.name}`
)
const isSelected = computed(() => files.selected.has(fullPath.value))
const isStarred = computed(() => files.pinnedNames.has(props.entry.name))

async function onClick() {
  if (props.disableOpen) return
  if (props.entry.type === 'directory') {
    try {
      await files.loadDirectory(fullPath.value)
    } catch (err) {
      showError(err.message || 'Could not open folder.')
    }
  } else {
    emit('open', { ...props.entry, path: fullPath.value })
  }
}

async function onStarClick() {
  try {
    await files.toggleStar(props.entry)
  } catch (err) {
    showError(err.message || 'Could not update star.')
  }
}
</script>

<template>
  <div class="tile" :class="{ selected: isSelected }">
    <input
      type="checkbox"
      class="select-box"
      :checked="isSelected"
      @click.stop="files.toggleSelect(fullPath)"
    />
    <button class="dots" @click.stop="emit('menu', { entry, path: fullPath })">⋮</button>
    <button v-if="!disableOpen" class="star" :class="{ starred: isStarred }" @click.stop="onStarClick">
      {{ isStarred ? '⭐' : '☆' }}
    </button>
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
.select-box { position: absolute; top: 6px; left: 6px; opacity: 0; }
.tile:hover .select-box, .tile.selected .select-box { opacity: 1; }
.star { position: absolute; bottom: 6px; right: 6px; border: none; background: transparent; font-size: 14px; opacity: 0; }
.tile:hover .star, .star.starred { opacity: 1; }
@media (hover: none) {
  .select-box { opacity: 1; }
  .star { opacity: 1; }
}
</style>
```

- [ ] **Step 2: Replace `frontend/src/components/FileListView.vue`**

```vue
<script setup>
import { useFilesStore } from '../stores/files.js'
import { formatSize, formatRelativeTime, iconFor } from './fileFormat.js'
import { showError } from '../errorToast.js'

const props = defineProps({
  entries: { type: Array, required: true },
  disableOpen: { type: Boolean, default: false },
})
const emit = defineEmits(['open', 'menu'])
const files = useFilesStore()

function fullPath(entry) {
  return entry.path || `${files.currentPath}${files.currentPath.endsWith('/') ? '' : '/'}${entry.name}`
}
async function onClick(entry) {
  if (props.disableOpen) return
  if (entry.type === 'directory') {
    try {
      await files.loadDirectory(fullPath(entry))
    } catch (err) {
      showError(err.message || 'Could not open folder.')
    }
  } else {
    emit('open', { ...entry, path: fullPath(entry) })
  }
}
async function onStarClick(entry) {
  try {
    await files.toggleStar(entry)
  } catch (err) {
    showError(err.message || 'Could not update star.')
  }
}
</script>

<template>
  <table class="list">
    <thead><tr><th></th><th></th><th>Name</th><th>Size</th><th>Modified</th><th></th></tr></thead>
    <tbody>
      <tr v-for="entry in entries" :key="entry.path || entry.name">
        <td class="select-col">
          <input
            type="checkbox"
            :checked="files.selected.has(fullPath(entry))"
            @click.stop="files.toggleSelect(fullPath(entry))"
          />
        </td>
        <td class="star-col">
          <button v-if="!disableOpen" class="star" @click.stop="onStarClick(entry)">
            {{ files.pinnedNames.has(entry.name) ? '⭐' : '☆' }}
          </button>
        </td>
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
.list td:nth-child(3) { cursor: pointer; }
.list button { border: none; background: none; color: var(--text-muted); }
.select-col, .star-col { width: 32px; }
.star { font-size: 13px; }
</style>
```

- [ ] **Step 3: Replace `frontend/src/components/FileGrid.vue`**

```vue
<script setup>
defineProps({
  entries: { type: Array, required: true },
  disableOpen: { type: Boolean, default: false },
})
defineEmits(['open', 'menu'])
</script>

<template>
  <div class="grid">
    <FileTile
      v-for="entry in entries"
      :key="entry.path || entry.name"
      :entry="entry"
      :disable-open="disableOpen"
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

- [ ] **Step 4: Run the full test suite to confirm nothing broke**

Run: `cd /Users/codex074/nas-webui/.worktrees/nas-webui-impl/frontend && npm test`
Expected: PASS (these three files have no dedicated tests, but this confirms no other test imports something now missing).

- [ ] **Step 5: Commit**

```bash
cd /Users/codex074/nas-webui/.worktrees/nas-webui-impl
git add frontend/src/components/FileTile.vue frontend/src/components/FileListView.vue frontend/src/components/FileGrid.vue
git commit -m "feat: add star button and path-aware, trash-view-safe rendering to file tiles/rows"
```

---

## Task 10: View-aware context menu (Restore / Delete forever in Trash)

**Files:**
- Modify: `frontend/src/components/ContextMenu.vue`

**Interfaces:**
- Consumes: `softDelete` from Task 4, `useTrashStore` from Task 5.
- Produces: a `view` prop (`'browse' | 'starred' | 'trash'`, default `'browse'`) and a `changed` event (emitted after any successful mutating action, replacing the old direct `files.loadDirectory` call so Task 12's `App.vue` can decide what to refresh based on the active view).

No dedicated test file — same rationale as Task 9 (`.vue` files aren't unit-tested here; verified manually in Task 14).

- [ ] **Step 1: Replace `frontend/src/components/ContextMenu.vue`**

```vue
<script setup>
import { ref } from 'vue'
import { renameItem, moveItem, downloadUrl } from '../api/resources.js'
import { softDelete } from '../api/trash.js'
import { useTrashStore } from '../stores/trash.js'
import { showError } from '../errorToast.js'

const props = defineProps({
  entry: { type: Object, required: true },
  path: { type: String, required: true },
  view: { type: String, default: 'browse' },
})
const emit = defineEmits(['close', 'changed'])
const trash = useTrashStore()
const renaming = ref(false)
const moving = ref(false)
const newName = ref(props.entry.name)
const destination = ref('')

async function refreshAfter(action) {
  try {
    await action()
  } catch (err) {
    showError(err.message || 'Action failed.')
    return
  }
  emit('close')
  emit('changed')
}

function doRename() {
  return refreshAfter(() => renameItem(props.path, newName.value))
}
function doMove() {
  return refreshAfter(() => moveItem(props.path, destination.value))
}
function doDelete() {
  return refreshAfter(() => softDelete(props.path))
}
function doRestore() {
  return refreshAfter(() => trash.restore(props.entry))
}
function doDeleteForever() {
  return refreshAfter(() => trash.deleteForeverItem(props.entry))
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
      <template v-else-if="view === 'trash'">
        <button @click="doRestore">Restore</button>
        <button class="danger" @click="doDeleteForever">Delete forever</button>
      </template>
      <template v-else>
        <button @click="renaming = true">Rename</button>
        <button @click="moving = true">Move</button>
        <a :href="downloadUrl(path)" target="_blank" rel="noopener noreferrer">Download</a>
        <button class="danger" @click="doDelete">Delete</button>
      </template>
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
</style>
```

- [ ] **Step 2: Run the full test suite to confirm nothing broke**

Run: `cd /Users/codex074/nas-webui/.worktrees/nas-webui-impl/frontend && npm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/codex074/nas-webui/.worktrees/nas-webui-impl
git add frontend/src/components/ContextMenu.vue
git commit -m "feat: make context menu view-aware (Restore/Delete forever in Trash)"
```

---

## Task 11: Sidebar redesign — Drive-style nav and storage bar

**Files:**
- Modify: `frontend/src/components/Sidebar.vue`

**Interfaces:**
- Consumes: `getStorageUsage` from Task 8, `formatSize` from `./fileFormat.js` (pre-existing).
- Produces: a `view` prop (for highlighting the active nav item) and a `navigate` event (payload: `'browse' | 'starred' | 'trash'`), consumed by Task 12's `App.vue`.

No dedicated test file — same rationale as Task 9.

- [ ] **Step 1: Replace `frontend/src/components/Sidebar.vue`**

```vue
<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useAuthStore } from '../stores/auth.js'
import { getStorageUsage } from '../api/storage.js'
import { formatSize } from './fileFormat.js'

defineProps({ view: { type: String, required: true } })
const emit = defineEmits(['upload', 'navigate'])
const auth = useAuthStore()

const usedBytes = ref(0)
const totalBytes = ref(0)
const storageError = ref(false)
const usagePercent = computed(() => {
  if (!totalBytes.value) return 0
  return Math.min(100, Math.round((usedBytes.value / totalBytes.value) * 100))
})

let intervalId = null
async function refreshStorage() {
  try {
    const usage = await getStorageUsage()
    usedBytes.value = usage.usedBytes
    totalBytes.value = usage.totalBytes
    storageError.value = false
  } catch {
    storageError.value = true
  }
}

onMounted(() => {
  refreshStorage()
  intervalId = setInterval(refreshStorage, 60000)
})
onUnmounted(() => {
  if (intervalId) clearInterval(intervalId)
})
</script>

<template>
  <nav class="sidebar">
    <button class="sidebar-icon" :class="{ active: view === 'browse' }" title="หน้าแรก" @click="emit('navigate', 'browse')">🏠</button>
    <button class="sidebar-icon" :class="{ active: view === 'starred' }" title="ที่ติดดาว" @click="emit('navigate', 'starred')">⭐</button>
    <button class="sidebar-icon" :class="{ active: view === 'trash' }" title="ถังขยะ" @click="emit('navigate', 'trash')">🗑️</button>
    <button class="sidebar-icon" title="Upload" @click="emit('upload')">⬆️</button>
    <div class="sidebar-spacer"></div>
    <div v-if="!storageError" class="storage" title="พื้นที่เก็บข้อมูล">
      <div class="storage-bar"><div class="storage-fill" :style="{ width: usagePercent + '%' }"></div></div>
      <div class="storage-label">{{ formatSize(usedBytes) }} / {{ formatSize(totalBytes) }}</div>
    </div>
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
.storage { width: 52px; display: flex; flex-direction: column; align-items: center; gap: 4px; margin-bottom: 4px; }
.storage-bar { width: 100%; height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; }
.storage-fill { height: 100%; background: var(--accent); }
.storage-label { font-size: 8px; color: var(--text-muted); text-align: center; line-height: 1.2; }

@media (max-width: 640px) {
  .sidebar {
    width: 100%; height: 56px; flex-direction: row;
    border-right: none; border-top: 1px solid var(--border);
    order: 2;
  }
  .storage { display: none; }
}
</style>
```

- [ ] **Step 2: Run the full test suite to confirm nothing broke**

Run: `cd /Users/codex074/nas-webui/.worktrees/nas-webui-impl/frontend && npm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/codex074/nas-webui/.worktrees/nas-webui-impl
git add frontend/src/components/Sidebar.vue
git commit -m "feat: redesign sidebar with Drive-style nav and a live storage bar"
```

---

## Task 12: Wire it all together in App.vue

**Files:**
- Modify: `frontend/src/App.vue`

**Interfaces:**
- Consumes: `useStarredStore` (Task 6), `useTrashStore` (Task 5), the `view`/`navigate` contract of `Sidebar.vue` (Task 11), the `disableOpen` prop of `FileGrid`/`FileListView` (Task 9), the `view`/`changed` contract of `ContextMenu.vue` (Task 10).
- Produces: the fully wired app — this is the last frontend task; after this, Starred/Trash/Storage are usable end-to-end against the currently-deployed backend for everything except the storage bar (which needs Task 13 + Task 14 deployed to return real numbers instead of erroring).

No dedicated test file — same rationale as Task 9.

- [ ] **Step 1: Replace `frontend/src/App.vue`**

```vue
<script setup>
import { onMounted, watch, ref, reactive, computed } from 'vue'
import { useAuthStore } from './stores/auth.js'
import { useFilesStore } from './stores/files.js'
import { useStarredStore } from './stores/starred.js'
import { useTrashStore } from './stores/trash.js'
import { uploadFile } from './api/resources.js'
import { onUnauthorized } from './api/http.js'
import { showError } from './errorToast.js'
import LoginView from './components/LoginView.vue'
import Sidebar from './components/Sidebar.vue'
import TopBar from './components/TopBar.vue'
import FileGrid from './components/FileGrid.vue'
import FileListView from './components/FileListView.vue'
import NewFolderDialog from './components/NewFolderDialog.vue'
import UploadToast from './components/UploadToast.vue'
import ErrorToast from './components/ErrorToast.vue'
import ContextMenu from './components/ContextMenu.vue'
import Lightbox from './components/Lightbox.vue'

const auth = useAuthStore()
const files = useFilesStore()
const starred = useStarredStore()
const trash = useTrashStore()
const showNewFolder = ref(false)
const activeMenu = ref(null)
const previewing = ref(null)
const uploads = reactive([])
const searchQuery = ref('')
const view = ref('browse')

const activeEntries = computed(() => {
  const source = view.value === 'starred' ? starred.entries : view.value === 'trash' ? trash.entries : files.entries
  if (!searchQuery.value) return source
  return source.filter((e) => e.name.toLowerCase().includes(searchQuery.value.toLowerCase()))
})

let uploadId = 0
const fileInputEl = ref(null)

function triggerFilePicker() {
  fileInputEl.value?.click()
}

function onFileInputChange(event) {
  if (event.target.files.length) handleFiles(event.target.files)
  event.target.value = ''
}

onMounted(() => auth.checkSession())
watch(() => auth.user, (user) => {
  if (user) {
    files.loadDirectory('/').catch((err) => showError(err.message || 'Could not load files.'))
  }
})

onUnauthorized(() => { auth.user = null })

async function onNavigate(nextView) {
  view.value = nextView
  searchQuery.value = ''
  try {
    if (nextView === 'starred') await starred.loadStarred()
    else if (nextView === 'trash') await trash.loadTrash()
  } catch (err) {
    showError(err.message || 'Could not load.')
  }
}

async function onEntryChanged() {
  try {
    if (view.value === 'browse') await files.loadDirectory(files.currentPath)
    else if (view.value === 'starred') await starred.loadStarred()
  } catch (err) {
    showError(err.message || 'Could not refresh.')
  }
}

async function handleFiles(fileList) {
  const base = files.currentPath.endsWith('/') ? files.currentPath : `${files.currentPath}/`
  for (const file of Array.from(fileList)) {
    const entry = reactive({ id: uploadId++, name: file.name, progress: 0, error: false, message: '' })
    uploads.push(entry)
    try {
      await uploadFile(`${base}${file.name}`, file, (pct) => { entry.progress = pct })
    } catch (err) {
      entry.error = true
      entry.message = err.message || 'Failed'
    }
  }
  await files.loadDirectory(files.currentPath)
  setTimeout(() => uploads.splice(0, uploads.length), 2000)
}

function onDrop(event) {
  event.preventDefault()
  if (event.dataTransfer.files.length) handleFiles(event.dataTransfer.files)
}

const bulkError = ref('')
async function onBulkDelete() {
  bulkError.value = ''
  try {
    if (view.value === 'trash') {
      const items = trash.entries.filter((e) => files.selected.has(e.path))
      for (const item of items) {
        await trash.deleteForeverItem(item)
      }
      files.clearSelection()
    } else {
      await files.deleteSelected()
      if (view.value === 'starred') await starred.loadStarred()
      else await files.loadDirectory(files.currentPath)
    }
  } catch (err) {
    bulkError.value = err.message || 'Some items could not be deleted.'
  }
}

async function onEmptyTrash() {
  try {
    await trash.emptyAll()
  } catch (err) {
    showError(err.message || 'Could not empty trash.')
  }
}
</script>

<template>
  <LoginView v-if="auth.checked && !auth.user" />
  <div v-else-if="auth.checked" id="app-shell">
    <input ref="fileInputEl" type="file" multiple style="display: none" @change="onFileInputChange" />
    <Sidebar :view="view" @upload="triggerFilePicker" @navigate="onNavigate" />
    <div class="main">
      <TopBar @new-folder="showNewFolder = true" @search="searchQuery = $event" @upload="triggerFilePicker" />
      <div v-if="view === 'trash'" class="trash-bar">
        <button @click="onEmptyTrash">Empty trash</button>
      </div>
      <div v-if="files.selected.size" class="bulk-bar">
        <span>{{ files.selected.size }} selected</span>
        <button @click="onBulkDelete">{{ view === 'trash' ? 'Delete forever' : 'Delete' }}</button>
        <button @click="files.clearSelection()">Clear</button>
        <span v-if="bulkError" class="bulk-error">{{ bulkError }}</span>
      </div>
      <div class="content" @dragover.prevent @drop="onDrop">
        <FileGrid
          v-if="files.viewMode === 'grid'"
          :entries="activeEntries"
          :disable-open="view === 'trash'"
          @menu="activeMenu = $event"
          @open="previewing = $event"
        />
        <FileListView
          v-else
          :entries="activeEntries"
          :disable-open="view === 'trash'"
          @menu="activeMenu = $event"
          @open="previewing = $event"
        />
      </div>
    </div>
    <NewFolderDialog v-if="showNewFolder" @close="showNewFolder = false" />
    <UploadToast :uploads="uploads" />
    <ErrorToast />
    <ContextMenu
      v-if="activeMenu"
      :entry="activeMenu.entry"
      :path="activeMenu.path"
      :view="view"
      @close="activeMenu = null"
      @changed="onEntryChanged"
    />
    <Lightbox v-if="previewing" :entry="previewing" @close="previewing = null" />
  </div>
</template>

<style scoped>
#app-shell { display: flex; min-height: 100vh; }
.main { flex: 1; display: flex; flex-direction: column; }
.content { padding: 20px; flex: 1; }
.bulk-bar { display: flex; gap: 12px; align-items: center; padding: 8px 16px; background: #eaf1ff; border-bottom: 1px solid var(--border); font-size: 13px; }
.bulk-error { color: #d92d20; }
.trash-bar { display: flex; justify-content: flex-end; padding: 8px 16px; border-bottom: 1px solid var(--border); }
.trash-bar button { border: 1px solid var(--border); background: var(--bg-elevated); border-radius: 8px; padding: 6px 12px; }

@media (max-width: 640px) {
  #app-shell { flex-direction: column; }
}
</style>
```

Note (deliberate v1 simplification, not a bug): the "New folder"/"Upload" TopBar actions always act against `files.currentPath` regardless of which view is showing. Using them while viewing Starred or Trash uploads/creates into whatever folder was last browsed, not into a visible location — an unlikely-but-possible point of confusion the spec didn't ask to solve, left as-is rather than adding view-gating that wasn't requested.

- [ ] **Step 2: Run the full test suite**

Run: `cd /Users/codex074/nas-webui/.worktrees/nas-webui-impl/frontend && npm test`
Expected: PASS, all tests across the whole suite green.

- [ ] **Step 3: Manual smoke test with the dev server against the live backend**

```bash
cd /Users/codex074/nas-webui/.worktrees/nas-webui-impl/frontend
npm run dev
```

Open the printed local URL, log in as `codex` / `571010074`, and confirm: the sidebar shows หน้าแรก/ที่ติดดาว/ถังขยะ with a storage area at the bottom (it will show an error/blank state — Task 13/14 haven't deployed `nasapi` yet, that's expected here); clicking a star icon on a file toggles it and persists across a reload; deleting a file makes it vanish from the folder and appear under ถังขยะ; restoring it from there puts it back. Stop the dev server (Ctrl-C) when done.

- [ ] **Step 4: Commit**

```bash
cd /Users/codex074/nas-webui/.worktrees/nas-webui-impl
git add frontend/src/App.vue
git commit -m "feat: wire Starred/Trash views and storage bar into the app shell"
```

---

## Task 13: `nasapi` binary and Docker image changes

**Files:**
- Create: `docker/nasapi/go.mod`
- Create: `docker/nasapi/main.go`
- Create: `docker/entrypoint.sh`
- Modify: `docker/Dockerfile`
- Modify: `docker/nginx.conf`

**Interfaces:**
- Produces: `GET /nasapi/storage` (via nginx, in the built image) → `{"usedBytes": <uint64>, "totalBytes": <uint64>}`, consumed by Task 8's frontend client (already built and tested against this exact contract).

- [ ] **Step 1: Create `docker/nasapi/go.mod`**

```
module nasapi

go 1.22
```

- [ ] **Step 2: Create `docker/nasapi/main.go`**

```go
package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"syscall"
)

type storageResponse struct {
	UsedBytes  uint64 `json:"usedBytes"`
	TotalBytes uint64 `json:"totalBytes"`
}

func main() {
	statPath := os.Getenv("NASAPI_STAT_PATH")
	if statPath == "" {
		statPath = "/srv/share"
	}
	port := os.Getenv("NASAPI_PORT")
	if port == "" {
		port = "9190"
	}

	http.HandleFunc("/storage", func(w http.ResponseWriter, r *http.Request) {
		var stat syscall.Statfs_t
		if err := syscall.Statfs(statPath, &stat); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		total := stat.Blocks * uint64(stat.Bsize)
		free := stat.Bavail * uint64(stat.Bsize)
		resp := storageResponse{UsedBytes: total - free, TotalBytes: total}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	})

	addr := "127.0.0.1:" + port
	log.Printf("nasapi listening on %s, stat path %s", addr, statPath)
	log.Fatal(http.ListenAndServe(addr, nil))
}
```

- [ ] **Step 3: Verify it builds and reports real numbers locally (sanity check before wiring into the multi-stage Dockerfile)**

```bash
cd /Users/codex074/nas-webui/.worktrees/nas-webui-impl/docker/nasapi
go build -o /tmp/nasapi-test .
NASAPI_STAT_PATH=/tmp NASAPI_PORT=9191 /tmp/nasapi-test &
sleep 1
curl -s http://127.0.0.1:9190/storage 2>&1; echo
curl -s http://127.0.0.1:9191/storage; echo
kill %1
```

Expected: the first `curl` (wrong port) fails to connect; the second prints `{"usedBytes":<some number>,"totalBytes":<some number>}` reflecting `/tmp`'s real filesystem.

- [ ] **Step 4: Create `docker/entrypoint.sh`**

```sh
#!/bin/sh
set -e
/usr/local/bin/nasapi &
exec nginx -g 'daemon off;'
```

- [ ] **Step 5: Update `docker/Dockerfile`**

Replace its contents with:

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM golang:1.22-alpine AS nasapi-build
WORKDIR /nasapi
COPY docker/nasapi/ ./
RUN go build -o /nasapi-bin .

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY --from=nasapi-build /nasapi-bin /usr/local/bin/nasapi
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 8090
ENTRYPOINT ["/entrypoint.sh"]
```

- [ ] **Step 6: Update `docker/nginx.conf`**

Add a new `location` block for `/nasapi/` alongside the existing `/api/` one — full resulting file:

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

    location /nasapi/ {
        proxy_pass http://127.0.0.1:9190/;
        proxy_set_header Host $host;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

- [ ] **Step 7: Build the image locally and verify both processes start**

```bash
cd /Users/codex074/nas-webui/.worktrees/nas-webui-impl
docker build --platform linux/amd64 -f docker/Dockerfile -t nas-webui:local .
docker run --rm -d --name nas-webui-test --network host -v /tmp:/srv/share:ro nas-webui:local
sleep 1
curl -sI http://localhost:8090/ | head -1
curl -s http://localhost:8090/nasapi/storage; echo
docker stop nas-webui-test
```

Expected: first `curl` shows `HTTP/1.1 200 OK` (static frontend still serves correctly); second prints a real `{"usedBytes":...,"totalBytes":...}` JSON object (nginx successfully proxied to `nasapi`, which statfs'd the bind-mounted `/tmp`).

- [ ] **Step 8: Commit**

```bash
cd /Users/codex074/nas-webui/.worktrees/nas-webui-impl
git add docker/nasapi docker/entrypoint.sh docker/Dockerfile docker/nginx.conf
git commit -m "feat: add nasapi disk-usage sidecar binary to the nas-webui image"
```

---

## Task 14: Deploy and end-to-end verification

**Files:** none (infrastructure task — no repo files change)

**Interfaces:** none — consumes the image built in Task 13, running against the frontend wired in Task 12.

- [ ] **Step 1: Build the production image**

```bash
cd /Users/codex074/nas-webui/.worktrees/nas-webui-impl
docker build --platform linux/amd64 -f docker/Dockerfile -t nas-webui:local .
```

Expected: builds successfully (three stages: `build`, `nasapi-build`, final `nginx:alpine`).

- [ ] **Step 2: Transfer the image to TrueNAS and load it**

```bash
docker save nas-webui:local | gzip > /tmp/nas-webui.tar.gz
scp /tmp/nas-webui.tar.gz root@100.71.13.117:/root/
ssh root@100.71.13.117 "scp /root/nas-webui.tar.gz truenas_admin@192.168.1.22:/tmp/"
ssh root@100.71.13.117 "ssh truenas_admin@192.168.1.22 'echo 571010074 | sudo -S sh -c \"gunzip -c /tmp/nas-webui.tar.gz | docker load\"'"
```

Expected: the final command prints `Loaded image: nas-webui:local`.

- [ ] **Step 3: Update the running app's compose config to add the read-only share mount**

```bash
ssh root@100.71.13.117 "curl -sk -u 'truenas_admin:truenasmigrate2026x' -X PUT https://192.168.1.22/api/v2.0/app/id/nas-webui \
  -H 'Content-Type: application/json' \
  -d '{
    \"custom_compose_config_string\": \"services:\\n  nas-webui:\\n    image: nas-webui:local\\n    network_mode: host\\n    restart: unless-stopped\\n    volumes:\\n      - /mnt/tank/share:/srv/share:ro\\n\"
  }'"
```

Expected: returns a job id (integer). If the response instead has a top-level `\"error\"` key, read it — the field name accepted by this endpoint was confirmed via the live OpenAPI schema at `https://192.168.1.22/api/v2.0/openapi.json` (`components.schemas.app_update`) but not exercised end-to-end before this task; if it rejects `custom_compose_config_string`, retry with the equivalent parsed-YAML object under `custom_compose_config` instead (the schema accepts either).

- [ ] **Step 4: Poll until the app is running again**

```bash
ssh root@100.71.13.117 "curl -sk -u 'truenas_admin:truenasmigrate2026x' https://192.168.1.22/api/v2.0/app/id/nas-webui | python3 -c \"import json,sys; print(json.load(sys.stdin).get('state'))\""
```

Expected: `RUNNING` (retry a few times, a few seconds apart, if it briefly shows `DEPLOYING`).

- [ ] **Step 5: Verify the new mount landed and nasapi is answering with real numbers**

```bash
ssh root@100.71.13.117 "curl -sk -u 'truenas_admin:truenasmigrate2026x' https://192.168.1.22/api/v2.0/app/id/nas-webui" | python3 -c "
import json,sys
d = json.load(sys.stdin)
print(d['active_workloads']['container_details'][0]['volume_mounts'])
"
ssh root@100.71.13.117 "curl -s http://192.168.1.22:8090/nasapi/storage"; echo
```

Expected: the mounts list includes `{"source": "/mnt/tank/share", "destination": "/srv/share", ...}`; the `curl` prints `{"usedBytes":...,"totalBytes":...}` with `totalBytes` around `1.8T` in bytes (matching the `tank/share` dataset size confirmed earlier via `df -h` inside the FileBrowser Quantum container), not an error.

- [ ] **Step 6: Full manual walkthrough against the live deployment**

Open `http://192.168.1.22:8090` (or `https://nas.codex074.com` if reachable), log in as `codex` / `571010074`, and confirm:

1. The sidebar's storage bar shows real, non-zero `totalBytes` matching Step 5, and updates within ~60s of uploading a new file.
2. Star a file from the grid; reload the page; confirm the star persisted; open ที่ติดดาว and confirm it's listed.
3. Delete a file; confirm it disappears from its folder immediately, including after a reload; open ถังขยะ and confirm it's listed with a "just now"-style relative time.
4. Restore it from ถังขยะ; confirm it's back in its original folder and gone from ถังขยะ.
5. Delete a different file, then use "Delete forever" on it from ถังขยะ; confirm it's actually gone (check both ถังขยะ and its old folder after a reload).
6. Multi-select 3 files in a folder, delete them as a batch, confirm all 3 land in ถังขยะ independently (restoring or deleting one doesn't affect the other two).
7. Switch to ถังขยะ, use "Empty trash", confirm the list goes empty and the items are gone from the whole app (not just hidden).

Expected: every step succeeds with no console errors (check the browser dev tools console).

- [ ] **Step 7: Confirm FileBrowser Quantum's own UI is unaffected**

```bash
curl -s http://192.168.1.22:30334/ -o /dev/null -w '%{http_code}\n'
```

Expected: `200` — unchanged, since this plan never touched the `filebrowser-quantum` app, only `nas-webui`.
