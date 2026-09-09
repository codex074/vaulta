# Chunked Uploads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Files larger than Cloudflare's 100 MB per-request cap upload successfully by sending them to FBQ in 25 MiB chunks, with quota still enforced and cancelled uploads leaving no temp files behind.

**Architecture:** FBQ 1.5.5 already implements chunked uploads on the same `POST /api/resources` endpoint via `X-File-Chunk-Offset` / `X-File-Total-Size`. The frontend's `uploadFile` gains a chunked path driven by pure helpers in `chunkPlan.js`; listings hide FBQ's `.uploading.tmp` partials; cancel also removes partials; the nasapi gate pre-checks the whole file size on chunk 0.

**Tech Stack:** Vue 3 + Pinia + Vite, Vitest (jsdom, `vi.stubGlobal('XMLHttpRequest', …)` for upload tests), Go 1.22 sidecar tested through Docker.

**Spec:** `docs/superpowers/specs/2026-09-09-chunked-uploads-design.md` — read it first.

## Global Constraints

- Work in `/Users/codex074/nas-webui/.worktrees/nas-webui-polish` on branch `nas-webui-polish`. Never touch `/Users/codex074/nas-webui`.
- TDD per task: failing test first, watch it fail for the expected reason, implement, pass, then the whole frontend suite (`cd frontend && npx vitest run`; currently 45 files / 338 tests) before every commit. Go changes: `docker run --rm -v "$PWD/docker/nasapi":/app -w /app -e GOFLAGS=-mod=mod golang:1.22 go test ./... -race` from the repo root.
- `CHUNK_SIZE = 25 * 1024 * 1024`; chunk headers exactly `X-File-Chunk-Offset` and `X-File-Total-Size`; every chunk uses `override=false`; chunk body `Content-Type: application/octet-stream`.
- Single-request uploads (files `<= CHUNK_SIZE`) must behave byte-for-byte as today; all existing `uploadFile` tests stay unchanged and green.
- FBQ partial file name pattern: `^(.+)\.[0-9a-f]{32}\.uploading\.tmp$`.
- Commit per task; end every commit message with your model's `Co-Authored-By` line and `Claude-Session: https://claude.ai/code/session_019wfqFN79ixJCZCCkh4eFVd`.

---

## File map

| File | Responsibility |
|---|---|
| `frontend/src/components/chunkPlan.js` (new) | Pure chunking/retry/partial-name helpers |
| `frontend/src/api/resources.js` (modify) | `sendUpload` extraction, chunked `uploadFile`, `removePartialUploads` |
| `frontend/src/stores/files.js` (modify) | Hide `.uploading.tmp` entries |
| `frontend/src/App.vue` (modify) | Cancel cleanup calls `removePartialUploads` |
| `docker/nasapi/gate.go` (modify) | Chunk-0 whole-file precheck |
| `README.md`, `AGENTS.md` (modify) | Docs |

---

### Task 1: `chunkPlan.js` helpers

**Files:**
- Create: `frontend/src/components/chunkPlan.js`
- Test: `frontend/tests/components/chunkPlan.test.js`

**Interfaces — Produces:**
- `CHUNK_SIZE: number` (26214400), `MAX_CHUNK_ATTEMPTS: number` (3)
- `shouldChunk(size, chunkSize = CHUNK_SIZE) → boolean`
- `planChunks(size, chunkSize = CHUNK_SIZE) → Array<{ offset: number, end: number }>`
- `overallProgress(offset, loaded, total) → number`
- `isRetryable(err, attempt, max = MAX_CHUNK_ATTEMPTS) → boolean`
- `PARTIAL_UPLOAD_PATTERN: RegExp`, `isPartialUpload(name) → boolean`, `partialUploadsFor(name, entries) → entries[]`

- [ ] **Step 1: Write the failing tests**

```js
// frontend/tests/components/chunkPlan.test.js
import { describe, it, expect } from 'vitest'
import {
  CHUNK_SIZE, MAX_CHUNK_ATTEMPTS, shouldChunk, planChunks, overallProgress, isRetryable,
  isPartialUpload, partialUploadsFor,
} from '../../src/components/chunkPlan.js'

describe('chunk planning', () => {
  it('uses 25 MiB chunks and three attempts', () => {
    expect(CHUNK_SIZE).toBe(25 * 1024 * 1024)
    expect(MAX_CHUNK_ATTEMPTS).toBe(3)
  })
  it('only chunks files strictly larger than the chunk size', () => {
    expect(shouldChunk(CHUNK_SIZE)).toBe(false)
    expect(shouldChunk(CHUNK_SIZE + 1)).toBe(true)
    expect(shouldChunk(10, 4)).toBe(true)
  })
  it('plans contiguous chunks with an exclusive end and a short last chunk', () => {
    expect(planChunks(10, 4)).toEqual([{ offset: 0, end: 4 }, { offset: 4, end: 8 }, { offset: 8, end: 10 }])
    expect(planChunks(8, 4)).toEqual([{ offset: 0, end: 4 }, { offset: 4, end: 8 }])
    expect(planChunks(0, 4)).toEqual([])
  })
  it('reports overall progress across chunks as a rounded percentage', () => {
    expect(overallProgress(0, 0, 100)).toBe(0)
    expect(overallProgress(50, 25, 100)).toBe(75)
    expect(overallProgress(75, 25, 100)).toBe(100)
    expect(overallProgress(0, 0, 0)).toBe(100)
    expect(overallProgress(90, 20, 100)).toBe(100)
  })
})

describe('isRetryable', () => {
  const net = new Error('Network error during upload')
  it('retries network errors and 5xx while attempts remain', () => {
    expect(isRetryable(net, 1)).toBe(true)
    expect(isRetryable(net, 2)).toBe(true)
    expect(isRetryable(net, 3)).toBe(false)
    expect(isRetryable(Object.assign(new Error('x'), { status: 502 }), 1)).toBe(true)
  })
  it('never retries 4xx or an abort', () => {
    expect(isRetryable(Object.assign(new Error('x'), { status: 409 }), 1)).toBe(false)
    expect(isRetryable(Object.assign(new Error('x'), { status: 413 }), 1)).toBe(false)
    expect(isRetryable(Object.assign(new Error('Upload cancelled'), { name: 'AbortError' }), 1)).toBe(false)
  })
})

describe('partial upload names', () => {
  const md5 = 'a'.repeat(32)
  it('recognises FBQ temp files and nothing else', () => {
    expect(isPartialUpload(`movie.mp4.${md5}.uploading.tmp`)).toBe(true)
    expect(isPartialUpload('movie.mp4')).toBe(false)
    expect(isPartialUpload(`movie.mp4.${'g'.repeat(32)}.uploading.tmp`)).toBe(false)
  })
  it('finds the partials that belong to one file name only', () => {
    const entries = [
      { name: `movie.mp4.${md5}.uploading.tmp` },
      { name: `other.mp4.${md5}.uploading.tmp` },
      { name: 'movie.mp4' },
    ]
    expect(partialUploadsFor('movie.mp4', entries)).toEqual([entries[0]])
    expect(partialUploadsFor('none.mp4', entries)).toEqual([])
  })
})
```

- [ ] **Step 2: Run `cd frontend && npx vitest run tests/components/chunkPlan.test.js`; fails on the missing module**

- [ ] **Step 3: Implement**

```js
// frontend/src/components/chunkPlan.js
// Cloudflare caps a single request body at 100 MB (free plan), so anything
// bigger goes to FileBrowser Quantum in chunks on the same POST endpoint,
// using its X-File-Chunk-Offset / X-File-Total-Size protocol.
export const CHUNK_SIZE = 25 * 1024 * 1024
export const MAX_CHUNK_ATTEMPTS = 3

export function shouldChunk(size, chunkSize = CHUNK_SIZE) {
  return size > chunkSize
}

export function planChunks(size, chunkSize = CHUNK_SIZE) {
  const chunks = []
  for (let offset = 0; offset < size; offset += chunkSize) {
    chunks.push({ offset, end: Math.min(offset + chunkSize, size) })
  }
  return chunks
}

export function overallProgress(offset, loaded, total) {
  if (total <= 0) return 100
  return Math.min(100, Math.round(((offset + loaded) / total) * 100))
}

// Re-sending a chunk at the same offset is idempotent on FBQ's side (it
// seeks and overwrites), so transient failures are worth another try.
export function isRetryable(err, attempt, max = MAX_CHUNK_ATTEMPTS) {
  if (attempt >= max) return false
  if (err?.name === 'AbortError') return false
  if (err?.status === undefined) return true
  return err.status >= 500
}

// FBQ writes chunks to "<target>.<md5 of real path>.uploading.tmp" beside
// the target and renames it into place on the last chunk.
export const PARTIAL_UPLOAD_PATTERN = /^(.+)\.[0-9a-f]{32}\.uploading\.tmp$/

export function isPartialUpload(name) {
  return PARTIAL_UPLOAD_PATTERN.test(name)
}

export function partialUploadsFor(name, entries) {
  return entries.filter((entry) => {
    const match = PARTIAL_UPLOAD_PATTERN.exec(entry.name)
    return match !== null && match[1] === name
  })
}
```

- [ ] **Step 4: Run the file, then the whole suite; green**
- [ ] **Step 5: Commit** — `git add frontend/src/components/chunkPlan.js frontend/tests/components/chunkPlan.test.js && git commit -m "Add chunk planning helpers for large uploads"`

---

### Task 2: Chunked `uploadFile` and `removePartialUploads`

**Files:**
- Modify: `frontend/src/api/resources.js` (the `uploadFile` function and its `abortError` helper; add `removePartialUploads`)
- Test: `frontend/tests/api/resources.test.js` (append; existing upload tests unchanged)

**Interfaces:**
- Consumes: Task 1 helpers; existing `resourcesUrl`, `listDirectory`, `deleteItem`, `notifyUnauthorized`.
- Produces: `uploadFile(source, path, file, onProgress, { signal, chunkSize = CHUNK_SIZE } = {}) → Promise<void>` (unchanged call shape for callers); `removePartialUploads(source, fullPath) → Promise<void>` (never rejects).

- [ ] **Step 1: Read the current `uploadFile` in `frontend/src/api/resources.js` in full.** It is one XHR wrapped in a Promise (`abortError`, `settled`/`finish`, `onAbort`, `open('POST', resourcesUrl(source, path, { override: 'false' }))`, `Content-Type` from `file.type`, `withCredentials`, `upload.onprogress` → percentage, `onload` → resolve on 2xx else reject with `{ status }` and a JSON `message` when present, `onerror` → `'Network error during upload'`, `send(file)`).

- [ ] **Step 2: Write the failing tests** (append inside the existing `describe('resources API')` in `frontend/tests/api/resources.test.js`; add `removePartialUploads` to the import list at the top)

```js
  // A scripted XHR double: each constructed instance records what was sent
  // and lets the test drive onload/onerror. `responses` is consumed in order.
  function scriptedXhr(responses) {
    const instances = []
    vi.stubGlobal('XMLHttpRequest', class {
      constructor() {
        const inst = {
          headers: {}, upload: {}, status: 0, responseText: '',
          open: (method, url) => { inst.method = method; inst.url = url },
          setRequestHeader: (k, v) => { inst.headers[k] = v },
          abort: () => { inst.aborted = true; inst.onabort?.() },
          send: (body) => {
            inst.body = body
            instances.push(inst)
            const next = responses.shift() ?? { status: 200 }
            queueMicrotask(() => {
              if (next.progress && inst.upload.onprogress) {
                inst.upload.onprogress({ lengthComputable: true, loaded: next.progress.loaded, total: next.progress.total })
              }
              if (next.networkError) { inst.onerror?.(); return }
              inst.status = next.status
              inst.responseText = next.body ?? ''
              inst.onload?.()
            })
          },
        }
        return inst
      }
    })
    return instances
  }

  it('uploads a large file in chunks with FBQ chunk headers and aggregate progress', async () => {
    const instances = scriptedXhr([
      { status: 200, progress: { loaded: 4, total: 4 } },
      { status: 200, progress: { loaded: 4, total: 4 } },
      { status: 200, progress: { loaded: 2, total: 2 } },
    ])
    const progress = []
    const file = new File(['0123456789'], 'big.bin')
    await uploadFile('home', '/big.bin', file, (pct) => progress.push(pct), { chunkSize: 4 })
    expect(instances).toHaveLength(3)
    expect(instances.map((i) => i.headers['X-File-Chunk-Offset'])).toEqual(['0', '4', '8'])
    expect(instances.every((i) => i.headers['X-File-Total-Size'] === '10')).toBe(true)
    expect(instances.every((i) => i.headers['Content-Type'] === 'application/octet-stream')).toBe(true)
    expect(instances.every((i) => i.url.includes('override=false') && i.url.includes('source=home'))).toBe(true)
    expect(instances.map((i) => i.body.size)).toEqual([4, 4, 2])
    expect(progress).toEqual([40, 80, 100])
  })

  it('keeps a small file on the single-request path', async () => {
    const instances = scriptedXhr([{ status: 200 }])
    await uploadFile('share', '/small.bin', new File(['abc'], 'small.bin'), null, { chunkSize: 4 })
    expect(instances).toHaveLength(1)
    expect(instances[0].headers['X-File-Chunk-Offset']).toBeUndefined()
    expect(instances[0].body).toBeInstanceOf(File)
  })

  it('retries a chunk after a 5xx or network error, then succeeds', async () => {
    const instances = scriptedXhr([
      { status: 200 },
      { networkError: true },
      { status: 502, body: '{"message":"bad gateway"}' },
      { status: 200 },
      { status: 200 },
    ])
    await uploadFile('home', '/big.bin', new File(['0123456789'], 'big.bin'), null, { chunkSize: 4 })
    expect(instances.map((i) => i.headers['X-File-Chunk-Offset'])).toEqual(['0', '4', '4', '4', '8'])
  })

  it('gives up after three attempts on the same chunk', async () => {
    scriptedXhr([{ networkError: true }, { networkError: true }, { networkError: true }, { status: 200 }])
    await expect(uploadFile('home', '/big.bin', new File(['0123456789'], 'big.bin'), null, { chunkSize: 4 }))
      .rejects.toThrow('Network error during upload')
  })

  it('does not retry a 4xx and surfaces its message and status', async () => {
    const instances = scriptedXhr([{ status: 409, body: '{"message":"already exists"}' }, { status: 200 }])
    await expect(uploadFile('home', '/big.bin', new File(['0123456789'], 'big.bin'), null, { chunkSize: 4 }))
      .rejects.toMatchObject({ status: 409, message: 'already exists' })
    expect(instances).toHaveLength(1)
  })

  it('stops the chunk sequence when aborted', async () => {
    const controller = new AbortController()
    const instances = scriptedXhr([{ status: 200 }])
    const promise = uploadFile('home', '/big.bin', new File(['0123456789'], 'big.bin'), null, { chunkSize: 4, signal: controller.signal })
    await new Promise((r) => setTimeout(r, 0))
    controller.abort()
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(instances.length).toBeLessThanOrEqual(2)
  })

  it('removePartialUploads deletes only the temp files belonging to the cancelled name', async () => {
    const md5 = 'b'.repeat(32)
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ files: [
        { name: `movie.mp4.${md5}.uploading.tmp` }, { name: `other.mp4.${md5}.uploading.tmp` }, { name: 'movie.mp4' },
      ] }) })
      .mockResolvedValueOnce({ ok: true, status: 200 })
    await removePartialUploads('home', '/Videos/movie.mp4')
    expect(global.fetch.mock.calls[0][0]).toContain('/api/resources?path=%2FVideos&source=home')
    expect(global.fetch.mock.calls[1][0]).toContain(`path=%2FVideos%2Fmovie.mp4.${md5}.uploading.tmp`)
    expect(global.fetch.mock.calls[1][1].method).toBe('DELETE')
    expect(global.fetch.mock.calls).toHaveLength(2)
  })

  it('removePartialUploads never throws', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('down'))
    await expect(removePartialUploads('home', '/x.bin')).resolves.toBeUndefined()
  })
```
Note: `scriptedXhr` replaces the global for the rest of the file's tests too; the existing upload tests each install their own stub, so order does not matter. Keep `vi.unstubAllGlobals()` out unless the existing file already uses it.

- [ ] **Step 3: Run the file; the new cases fail (no chunk headers / missing export)**

- [ ] **Step 4: Implement** — replace the whole `uploadFile` function with:

```js
import { CHUNK_SIZE, shouldChunk, planChunks, overallProgress, isRetryable, partialUploadsFor } from '../components/chunkPlan.js'

// One XHR. `onProgress(loaded, total)` reports raw bytes; callers map it to
// whatever scale they need. Rejects with AbortError on abort, with an Error
// carrying `.status` on a non-2xx response, and with a plain Error on a
// network failure (no status — the retry helper treats that as transient).
function sendUpload({ url, body, contentType, headers = {}, onProgress, signal }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }
    const xhr = new XMLHttpRequest()
    let settled = false
    const finish = (fn) => (value) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      fn(value)
    }
    const onAbort = () => {
      xhr.abort()
      finish(reject)(abortError())
    }
    signal?.addEventListener('abort', onAbort)
    xhr.onabort = () => finish(reject)(abortError())
    xhr.open('POST', url, true)
    xhr.setRequestHeader('Content-Type', contentType)
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value)
    xhr.withCredentials = true
    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(event.loaded, event.total)
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        finish(resolve)()
      } else {
        if (xhr.status === 401) notifyUnauthorized()
        let message = 'Upload failed'
        try {
          const body = JSON.parse(xhr.responseText)
          if (body && body.message) message = body.message
        } catch {
          // non-JSON response body, keep the fallback message
        }
        finish(reject)(Object.assign(new Error(message), { status: xhr.status }))
      }
    }
    xhr.onerror = () => finish(reject)(new Error('Network error during upload'))
    xhr.send(body)
  })
}

// Files above CHUNK_SIZE go up in pieces on the same endpoint using FBQ's
// chunk protocol (see chunkPlan.js) — Cloudflare rejects single request
// bodies over 100 MB before they ever reach the NAS. `chunkSize` is
// overridable for tests only.
export async function uploadFile(source, path, file, onProgress, { signal, chunkSize = CHUNK_SIZE } = {}) {
  const url = resourcesUrl(source, path, { override: 'false' })
  if (!shouldChunk(file.size, chunkSize)) {
    return sendUpload({
      url,
      body: file,
      contentType: file.type || 'application/octet-stream',
      onProgress: onProgress ? (loaded, total) => onProgress(Math.round((loaded / total) * 100)) : null,
      signal,
    })
  }
  for (const { offset, end } of planChunks(file.size, chunkSize)) {
    for (let attempt = 1; ; attempt++) {
      try {
        await sendUpload({
          url,
          body: file.slice(offset, end),
          contentType: 'application/octet-stream',
          headers: { 'X-File-Chunk-Offset': String(offset), 'X-File-Total-Size': String(file.size) },
          onProgress: onProgress ? (loaded) => onProgress(overallProgress(offset, loaded, file.size)) : null,
          signal,
        })
        break
      } catch (err) {
        if (!isRetryable(err, attempt)) throw err
      }
    }
  }
}

// A cancelled chunked upload can leave FBQ's "<name>.<md5>.uploading.tmp"
// beside the target. Best-effort removal; nothing here may throw.
export async function removePartialUploads(source, fullPath) {
  try {
    const slash = fullPath.lastIndexOf('/')
    const dir = slash <= 0 ? '/' : fullPath.slice(0, slash)
    const name = fullPath.slice(slash + 1)
    const listing = await listDirectory(source, dir)
    const base = dir.endsWith('/') ? dir : `${dir}/`
    for (const partial of partialUploadsFor(name, listing.files || [])) {
      try {
        await deleteItem(source, `${base}${partial.name}`)
      } catch {
        // leave it; the user can remove it from the listing
      }
    }
  } catch {
    // listing failed — nothing we can do, and the upload error already shows
  }
}
```
Keep the existing `abortError()` helper and the existing comment block above `uploadFile` (update it to mention chunking in one sentence).

- [ ] **Step 5: Run the file (all upload tests old and new), then the whole suite; green. `npm run build`.**
- [ ] **Step 6: Commit** — `git add frontend/src/api/resources.js frontend/tests/api/resources.test.js && git commit -m "Upload large files in 25 MiB chunks; clean partials on cancel"`

---

### Task 3: Hide partials in listings; cancel cleanup in App.vue

**Files:**
- Modify: `frontend/src/stores/files.js` (in `loadDirectory`, where `entries` is built from `folders`/`files`), `frontend/src/App.vue` (AbortError branch of the upload loop)
- Test: `frontend/tests/stores/files.test.js` (append)

**Interfaces:** Consumes `isPartialUpload` (Task 1) and `removePartialUploads` (Task 2).

- [ ] **Step 1: Write the failing test** (append to `frontend/tests/stores/files.test.js`, following that file's existing mocking of `../../src/api/resources.js` and store setup — read it first)

```js
  it('hides FileBrowser partial-upload temp files from the listing', async () => {
    listDirectory.mockResolvedValue({
      folders: [],
      files: [
        { name: 'movie.mp4', type: 'video/mp4' },
        { name: `movie.mp4.${'c'.repeat(32)}.uploading.tmp`, type: 'application/octet-stream' },
      ],
    })
    const store = useFilesStore()
    await store.loadDirectory('/')
    expect(store.entries.map((e) => e.name)).toEqual(['movie.mp4'])
  })
```
(If that test file mocks `lookupOwnership`, keep the mock returning `{}`.)

- [ ] **Step 2: Run it; fails (two entries)**

- [ ] **Step 3: Implement**
  - `files.js`: import `isPartialUpload` from `'../components/chunkPlan.js'` and change the entries construction to
    `const entries = [...folders, ...files].filter((entry) => !isPartialUpload(entry.name)).map((entry) => ({ ...entry, source: this.source }))`.
  - `App.vue`: import `removePartialUploads` alongside `uploadFile`/`deleteItem` from `'./api/resources.js'`; in the `AbortError` branch, after the existing `try { await deleteItem(source, fullPath) } catch { … }`, add `await removePartialUploads(source, fullPath)`. Update the comment above to say FBQ streams single uploads to the target and chunked ones to a `.uploading.tmp` beside it.

- [ ] **Step 4: Run the test file, the whole suite, `npm run build`; green**
- [ ] **Step 5: Commit** — `git add frontend/src/stores/files.js frontend/src/App.vue frontend/tests/stores/files.test.js && git commit -m "Hide in-flight upload temp files; remove partials when an upload is cancelled"`

---

### Task 4: nasapi gate — whole-file precheck on chunk 0

**Files:**
- Modify: `docker/nasapi/gate.go` (`gateUpload`; add `chunkTotal`)
- Test: `docker/nasapi/gate_test.go` (append; use the existing `newGateTestServer`, `gateRequest`, `nonAdminHomeUser` helpers — read `TestGateHomeUploadOverLimitRejectsAndReleases` first for the exact assertions style, including how the fake FBQ records whether it was called)

**Interfaces:** Produces `chunkTotal(r *http.Request) (total int64, ok bool)`.

- [ ] **Step 1: Write the failing tests**

```go
// Chunk 0 announces the whole file; an oversized file must be refused
// before a single byte lands in the temp file.
func TestGateChunkZeroOverTotalRejectsBeforeForwarding(t *testing.T) {
	server, fake, _ := newGateTestServer(t, nonAdminHomeUser(7, "alice"), 500)
	w := gateRequest(t, server.handler(), http.MethodPost, "/api/resources?path=%2Fbig.bin&source=home&override=false",
		strings.NewReader("0123456789"), map[string]string{"X-File-Chunk-Offset": "0", "X-File-Total-Size": "1000"})
	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413; body %s", w.Code, w.Body.String())
	}
	if fake.uploads != 0 { // adjust to the fake's actual counter/field name
		t.Fatalf("FBQ received %d uploads, want 0", fake.uploads)
	}
}

func TestGateChunkZeroWithinTotalForwardsAndReservesChunkLength(t *testing.T) {
	server, fake, _ := newGateTestServer(t, nonAdminHomeUser(7, "alice"), 500)
	w := gateRequest(t, server.handler(), http.MethodPost, "/api/resources?path=%2Fbig.bin&source=home&override=false",
		strings.NewReader("0123456789"), map[string]string{"X-File-Chunk-Offset": "0", "X-File-Total-Size": "400"})
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body %s", w.Code, w.Body.String())
	}
	if fake.uploads != 1 {
		t.Fatalf("FBQ received %d uploads, want 1", fake.uploads)
	}
}

func TestGateLaterChunkIsNotPrechecked(t *testing.T) {
	server, fake, _ := newGateTestServer(t, nonAdminHomeUser(7, "alice"), 500)
	w := gateRequest(t, server.handler(), http.MethodPost, "/api/resources?path=%2Fbig.bin&source=home&override=false",
		strings.NewReader("0123456789"), map[string]string{"X-File-Chunk-Offset": "490", "X-File-Total-Size": "1000"})
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (only the 10-byte chunk is reserved); body %s", w.Code, w.Body.String())
	}
	if fake.uploads != 1 {
		t.Fatalf("FBQ received %d uploads, want 1", fake.uploads)
	}
}
```
Replace `fake.uploads` with whatever the existing fake FBQ exposes for "a POST reached me" (read `gate_test.go`/`main_test.go` for the fake's fields); add `"strings"` to the test imports if missing.

- [ ] **Step 2: Run the Go suite via Docker; the first test fails (200 instead of 413)**

- [ ] **Step 3: Implement** — in `gate.go`, after `record, _ := s.quotas.get(...)` and before `s.usage.reserve(...)` in `gateUpload`:

```go
	// Chunk 0 of a chunked upload announces the whole file. Refuse an
	// oversized file here, before any byte is written to FBQ's temp file;
	// per-chunk reservation below remains the enforcement for the bytes
	// actually sent.
	if total, isFirstChunk := chunkTotal(r); isFirstChunk {
		used, err := s.usage.used(dir)
		if err != nil {
			log.Printf("usage for uid %d: %v", user.ID, err)
			writeMessage(w, http.StatusBadGateway, "File service unavailable.")
			return
		}
		if used+total > record.LimitBytes {
			io.Copy(io.Discard, r.Body)
			writeQuotaExceeded(w, used, record.LimitBytes, total)
			return
		}
	}
```
and add:
```go
// chunkTotal reports the announced whole-file size when this request is
// chunk 0 of FBQ's chunked-upload protocol; ok is false for unchunked
// requests, later chunks, or an unparseable size.
func chunkTotal(r *http.Request) (total int64, ok bool) {
	if r.Header.Get("X-File-Chunk-Offset") != "0" {
		return 0, false
	}
	parsed, err := strconv.ParseInt(r.Header.Get("X-File-Total-Size"), 10, 64)
	if err != nil || parsed < 0 {
		return 0, false
	}
	return parsed, true
}
```

- [ ] **Step 4: Run the Go suite via Docker with `-race`; all green. Also `gofmt -l docker/nasapi` (via the same Docker image) prints nothing.**
- [ ] **Step 5: Commit** — `git add docker/nasapi/gate.go docker/nasapi/gate_test.go && git commit -m "nasapi gate: refuse an oversized chunked upload on its first chunk"`

---

### Task 5: Docs

**Files:** Modify `README.md`, `AGENTS.md`.

- [ ] **Step 1: README** — in the Features list, extend the "Drive-style browsing" bullet's "upload progress with per-file or whole-batch cancel" with: `; files over 25 MiB are uploaded in chunks, so uploads beyond Cloudflare's 100 MB per-request limit work from outside the LAN`.
- [ ] **Step 2: AGENTS.md** — add a gotcha after the guest-share one:
  `- **Cloudflare drops request bodies over 100 MB before they reach the NAS** (413 from the edge, nothing in nginx/FBQ logs). \`uploadFile\` therefore sends files over \`CHUNK_SIZE\` (25 MiB, \`chunkPlan.js\`) with FBQ's \`X-File-Chunk-Offset\`/\`X-File-Total-Size\` headers on the same POST; FBQ writes \`<target>.<md5>.uploading.tmp\` beside the target and renames on the last chunk. Listings hide those temp files and cancel removes them (\`removePartialUploads\`). The nasapi gate pre-checks the whole size on chunk 0 and still reserves per chunk.`
- [ ] **Step 3: Commit** — `git add README.md AGENTS.md && git commit -m "Document chunked uploads and the Cloudflare body limit"`

---

## Deploy & verify (controller)

Per AGENTS.md. Then from outside the LAN (or via the tunnel from pve2 with a real session cookie, if provided): upload a ~150 MB file and confirm it lands with the right size; start another and cancel it mid-way, then confirm no `*.uploading.tmp` remains in that folder. Record in `docs/deployments/2026-09-09-chunked-uploads.md`.
