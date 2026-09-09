# Chunked Uploads — Design Spec

Date: 2026-09-09. Status: approved by the user in chat ("ข้อ 2 เลย").

## Problem

Uploading a file larger than 100 MB through `https://nas.codex074.com` fails
with `413 Payload Too Large`. Reproduced from pve2 with unauthenticated
POSTs: a 1 MB body reaches FBQ (401), a 105 MB body gets Cloudflare's own
413 HTML page and never reaches nginx (no log line on the NAS). Cloudflare's
free plan caps a single request body at 100 MB. Vaulta's `uploadFile` sends
the whole file in one XHR, so any file over that size cannot be uploaded
from outside the LAN.

## Verified facts

**FBQ 1.5.5 chunk protocol** (`backend/http/resource.go`, `resourcePostHandler`):
- Same endpoint: `POST /api/resources?path=<file>&source=<name>&override=<bool>`.
- A request carrying `X-File-Chunk-Offset: <bytes>` is a chunk; it must also
  carry `X-File-Total-Size: <bytes>` (400 otherwise). Body = raw chunk bytes.
- Offset `0` performs the conflict check: existing file → `409` unless
  `override=true`. FBQ's conflict check actually runs before the chunk
  branch on *every* request, offset 0 included; it only passes on later
  offsets because the target doesn't exist until the final chunk's rename —
  so a restart whose chunk 0 lands after a prior attempt's final chunk
  already completed gets a `409` there, not a resumed write.
- Bytes are written into a temp file **beside the target**:
  `<target>.<md5(realpath) as 32 hex>.uploading.tmp`, at the given offset.
  When `offset + len(body) >= total` the temp file is moved onto the target.
  Every chunk answers `200` (or `409`/`400`/`500`).
- A chunk that fails mid-body is truncated to `offset` and the temp file is
  removed (unless a pause was registered). An upload abandoned *between*
  chunks leaves the temp file behind.
- Re-sending the same chunk (same offset) is **not** safe: a failed chunk
  body deletes the temp file (`os.Remove(tempFilePath)`), so a same-offset
  retry has FBQ reopen the temp with `O_CREATE` and `Seek(offset)` — every
  byte before that offset becomes a zero-filled hole, and the final rename
  then ships a correctly-sized but corrupt file. A retry must restart the
  whole upload from offset 0.

**nasapi gate** (`docker/nasapi/gate.go`): `gateUpload` reserves
`uploadNeed(r)` bytes for home-drive POSTs: `Content-Length` when present
(every chunk has one), else `X-File-Total-Size` on chunk 0. So chunked
uploads already reserve cumulatively chunk by chunk — quota is enforced,
but an oversized file is only refused at the chunk that crosses the limit,
after earlier chunks were written.

**Frontend**: `uploadFile(source, path, file, onProgress, { signal })` in
`frontend/src/api/resources.js` is a single XHR with progress + abort;
`App.vue` runs the queue and, on cancel, deletes the target path (which is
wrong for chunked uploads: the partial lives in the `.uploading.tmp` file).

**nginx** already has `client_max_body_size 0` and
`proxy_request_buffering off` on `/api/resources`; no change needed.

## Design

### Chunk size
`CHUNK_SIZE = 10 MiB`. Well under Cloudflare's 100 MB cap, and small enough
that one chunk fits a slow home uplink inside Cloudflare's ~100 s origin
timeout. Files `<= CHUNK_SIZE` keep today's single-request path.

### `frontend/src/components/chunkPlan.js` (pure, tested)
- `CHUNK_SIZE`, `MAX_CHUNK_ATTEMPTS = 3`
- `shouldChunk(size, chunkSize = CHUNK_SIZE)` → `size > chunkSize`
- `planChunks(size, chunkSize = CHUNK_SIZE)` → `[{ offset, end }]` (end exclusive), `[]` for `size <= 0`
- `overallProgress(offset, loaded, total)` → 0–100 integer, 100 when `total` is 0
- `isRetryable(err, attempt, max = MAX_CHUNK_ATTEMPTS)` → `attempt < max` and the error is a network error (`err.status` undefined and `err.name !== 'AbortError'`) or `err.status >= 500`; never for 4xx or abort
- `PARTIAL_UPLOAD_PATTERN = /^(.+)\.[0-9a-f]{32}\.uploading\.tmp$/`, `isPartialUpload(name)`, `partialUploadsFor(name, entries)` → entries whose name is a partial of `name`

### `frontend/src/api/resources.js`
- Extract the XHR into `sendUpload({ url, body, contentType, headers, onProgress(loaded, total), signal })`; behaviour for the single-request path is unchanged (same URL, same errors, same abort semantics, `onProgress(pct)` still receives a percentage).
- `uploadFile(source, path, file, onProgress, { signal, chunkSize = CHUNK_SIZE } = {})`: if `!shouldChunk(file.size, chunkSize)` → single request as today. Otherwise a whole-upload attempt loop (`for (let attempt = 1; ; attempt++)`): each attempt sends every planned chunk in order (`sendUpload` with `body = file.slice(offset, end)`, `Content-Type: application/octet-stream`, headers `X-File-Chunk-Offset: <offset>` and `X-File-Total-Size: <file.size>`, `override=false` on every chunk, progress mapped through `overallProgress`). A retryable failure (network error or 5xx) on *any* chunk aborts that attempt and restarts the whole upload from offset 0 next attempt — same-offset resume is unsafe (see Verified facts). `isRetryable` bounds this at `MAX_CHUNK_ATTEMPTS` whole-upload attempts; a 4xx or `AbortError` propagates immediately without another attempt. A `409` on a restarted chunk 0 (`attempt > 1`) is checked against reality first: `targetAlreadyUploaded(source, fullPath, size)` lists the parent directory and, if an entry named like the target already has the full size, the upload resolves as success (the previous attempt finished; only its response was lost) — otherwise the `409` is rethrown, same as today. A first-attempt `409` on chunk 0 always rethrows immediately (never a restart, so never "our own" completed upload). Abort rejects with the same `AbortError`.
- `removePartialUploads(source, fullPath)`: lists the parent directory and deletes every `partialUploadsFor(basename, listing.files)` entry, best-effort (errors swallowed). Used by cancel handling and — as of this revision — by the plain `error` branch too, so a failed upload's `.uploading.tmp` doesn't linger invisibly.

### `frontend/src/stores/files.js`
`loadDirectory` drops entries where `isPartialUpload(entry.name)` so in-flight
temp files never show in listings (they are also excluded from folder
collages and selection as a consequence).

### `frontend/src/App.vue`
On `AbortError`: keep the existing `deleteItem(source, fullPath)` (single-
request uploads) and additionally `await removePartialUploads(source, fullPath)`.
On a plain failure (the `else` branch, `entry.status = 'error'`): also
`await removePartialUploads(source, fullPath)` — a retry-exhausted or
non-retryable chunked upload can leave a `.uploading.tmp` behind just like a
cancel does, and `loadDirectory` hides those from the listing, so skipping
cleanup here would leave it invisible forever rather than "for the user to
handle".

### `docker/nasapi/gate.go`
In `gateUpload`, before reserving: if the request is chunk 0
(`X-File-Chunk-Offset == "0"`) with a parseable `X-File-Total-Size`, check
`used + total <= LimitBytes`; if not, drain the body and answer the same
`413` quota message with `need = total`. Later chunks are not prechecked.
The existing per-chunk reservation (Content-Length) stays as the
enforcement; the precheck only makes an oversized file fail before any
byte is written. Admin bypass and share passthrough are unchanged.

### Docs
README: uploads over 10 MiB are chunked so files beyond Cloudflare's 100 MB
per-request limit work; AGENTS.md gotcha: the Cloudflare limit, FBQ's chunk
headers and temp-file naming, and that cancel must clean `.uploading.tmp`.

## Error handling
- Chunk 0, first attempt → 409: "already exists" as today, surfaced
  immediately. Chunk 0, a restart (`attempt > 1`) → 409: resolved as success
  if the target already exists at the full size (the previous attempt's
  final chunk landed but its response was lost), otherwise rethrown the
  same as a first-attempt 409. 413 from the gate: message from the gate as
  today. Network/5xx on any chunk: the whole upload restarts from offset 0,
  up to `MAX_CHUNK_ATTEMPTS` (3) whole-upload attempts, then the upload
  entry shows the error. A non-retryable failure (4xx other than the
  handled 409, or attempts exhausted) also triggers `removePartialUploads`
  so its `.uploading.tmp` doesn't linger hidden from the listing. Abort:
  `AbortError` → cancel path → target and partial removed best-effort.

## Non-goals
Resume after page reload, parallel chunks, FBQ's pause endpoint, changing
the OnlyOffice/office flows, uploads on public shares.

## Testing
- Vitest: `chunkPlan.test.js` (all helpers, `CHUNK_SIZE = 10 MiB`);
  `resources.test.js` — chunked upload sends N requests with correct
  offsets/headers/slices and aggregate progress, a network/5xx failure mid-
  upload restarts the whole upload at offset 0 with the same slice sizes,
  gives up after 3 whole-upload attempts (each restarting at chunk 0), does
  not retry a first-attempt 4xx, a 409 on a restarted chunk 0 resolves as
  success when the target already matches (and rethrows when it doesn't),
  aborts mid-sequence, small file still single request, existing tests
  unchanged; `removePartialUploads` deletes matching temp files only;
  `files.test.js` hides `.uploading.tmp`.
- Go (`docker run … golang:1.22 go test ./... -race`): chunk 0 over total
  → 413 without forwarding; chunk 0 within total forwards and reserves
  Content-Length; later chunk over total is not prechecked.
- Post-deploy: upload a 150 MB file from outside the LAN through the tunnel;
  cancel a chunked upload and confirm no `.uploading.tmp` remains.
