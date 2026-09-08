# Private Drives + Admin Quotas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every user a private drive (`source=home`, `/srv/home/<username>`,
scope-isolated by FileBrowser Quantum itself), keep the existing shared area
(`source=share`, `/srv/share`) exactly as it works today, enforce a server-side
storage quota on each user's private drive via `nasapi`, and let an admin set/edit
each user's quota (GB) from Manage users.

**Architecture:** See `docs/superpowers/specs/2026-09-08-private-drives-quota-design.md`
for the full context, verified facts, ASCII architecture diagram, component
breakdown, data shapes, security model, and non-goals. This plan assumes that spec
has been read first and does not re-derive any of it.

**Tech Stack:** Go 1.22 (`docker/nasapi`), Vue 3 + Vite + Pinia + Vitest (`frontend`),
nginx, TrueNAS `midclt`/Proxmox `qm` (infra), FileBrowser Quantum v1.5.5-stable
(unmodified — configured only).

**Spec:** `docs/superpowers/specs/2026-09-08-private-drives-quota-design.md`

## Global Constraints

1. Repo: `/Users/codex074/nas-webui/.worktrees/nas-webui-polish` (branch
   `nas-webui-polish`). **Never touch `/Users/codex074/nas-webui`** (main worktree).
2. Gate routes by HTTP method: nginx `map $request_method` sends `POST`/`PATCH`/
   `DELETE` on `location = /api/resources` to `nasapi` (`:9190`); everything else
   goes straight to FBQ (`:30334`). Reads never depend on `nasapi`.
3. `source` is the **first positional argument, no default**, in every
   `resources.js` / `office.js` / `trash.js` function.
4. `newAPIServer(cfg apiServerConfig)` — a config struct — replaces the old
   positional `newAPIServer(...)` signature; update the 3 existing test call sites
   in `docker/nasapi/main_test.go` when this lands (Task 4/B1).
5. `nasapi` gains new files in the same `package main`: `quota.go`, `usage.go`,
   `gate.go`, each with a matching `_test.go`. `main.go` keeps the server/mux glue.
   The Dockerfile is unchanged (`go build .` already builds every `.go` file in the
   package).
6. Rejected uploads **drain** the request body
   (`io.Copy(io.Discard, r.Body)`) before writing the `413`, so nginx and the client
   reliably observe a clean `413` response rather than a connection reset.
7. Quota units: the UI always says "GB"; the math is **GiB** (`1024**3`), matching
   this app's existing `formatSize` helper.
8. Usernames: `^[A-Za-z0-9._-]{1,32}$` and never exactly `.` or `..` (the username
   becomes a literal folder name on disk under `/srv/home`).
9. **TDD everywhere**, matching this repo's existing test styles exactly:
   `docker/nasapi/main_test.go`'s httptest fake-FBQ pattern (keyed on
   `Cookie: auth=valid`), `frontend/tests/api/*`'s `global.fetch` mocking,
   `frontend/tests/stores/*`'s `vi.mock` of api modules. One commit per numbered
   task below.
10. Commit message trailer, exactly, on every commit in every task:
    ```
    Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_01LANe6ydnuViSsJ7jtX1TzZ
    ```
11. **Phase C gates Phase D.** Task 12 (C3) empirically proves the `413` response
    actually reaches a client through nginx with `proxy_request_buffering off`
    *before* any frontend code (Phase D) is written that depends on that behavior.
    If C3 fails, stop and investigate nginx's early-response handling — do not
    proceed into Phase D on an unverified assumption.
12. **Tasks 2 and 3 (A2, A3) require an explicit user go-ahead before the downtime
    step** — both cause a brief FileBrowser Quantum outage. Do not run the
    downtime-causing step in either task without the user confirming, in this
    session, that now is an acceptable time.

---

## Task 1: A1 — Create the `tank/home` ZFS dataset (no downtime)

**Files:** None (infrastructure only).

**Interfaces:** Produces: `/mnt/tank/home` on TrueNAS VM 105, owned by uid/gid 3000
(the FBQ container's user), mode 700, ready to be bind-mounted into FBQ in Task 2.

- [ ] **Step 1: Confirm the dataset doesn't already exist**

  Run: `ssh root@100.71.13.117 "qm guest exec 105 -- zfs list tank/home"`
  Expected: an error ("dataset does not exist") — confirms nothing to clean up first.

- [ ] **Step 2: Create the dataset**

  Per the approved high-level plan's constraint, anything with JSON quoting goes
  through a small runner script transferred to VM 105 (scp → pve2
  `python3 -m http.server` on `192.168.1.16` → `qm guest exec 105 -- curl`), not
  inlined into an `ssh ... "..."` command line — see the OnlyOffice plan's Task 2
  Step 3 for the exact transfer sequence to follow. Write a local
  `create_home_dataset.py` (same shape as that plan's `create_onlyoffice_app.py`)
  that runs `midclt call -j pool.dataset.create '{"name":"tank/home","type":"FILESYSTEM"}'`
  via `subprocess.run(['midclt','call','-j','pool.dataset.create', payload], ...)`
  and prints exit code / stdout / stderr; transfer it and run it via
  `qm guest exec 105 -- python3 /tmp/create_home_dataset.py`; clean it up from VM 105
  afterward.
  Expected: exit code 0, stdout containing JSON success output describing the new
  `tank/home` dataset.

- [ ] **Step 3: Set ownership and permissions**

  Run: `ssh root@100.71.13.117 "qm guest exec 105 -- chown 3000:3000 /mnt/tank/home"`
  Then: `ssh root@100.71.13.117 "qm guest exec 105 -- chmod 700 /mnt/tank/home"`
  Expected: both exit code 0, no output.

- [ ] **Step 4: Verify**

  Run: `ssh root@100.71.13.117 "qm guest exec 105 -- stat /mnt/tank/home"`
  Expected: `Uid: (3000/...)`, `Gid: (3000/...)`, `Access: (0700/drwx------)`.

- [ ] **Step 5: No commit** — this task has no repo changes.

---

## Task 2: A2 — Mount `/srv/home` into FBQ (downtime, requires go-ahead)

**Files:** None (infrastructure only — TrueNAS app config, not this repo's compose).

**Interfaces:** Produces: the running `ix-filebrowser-quantum-filebrowser-quantum-1`
container gains a second bind mount, `/mnt/tank/home → /srv/home` (rw), visible in
`docker inspect`.

- [ ] **Step 1: Dump the current app config to find the exact shape of the existing mount**

  Run: `ssh root@100.71.13.117 "qm guest exec 105 -- midclt call -j app.config filebrowser-quantum"`
  Expected: JSON containing the existing `/mnt/tank/share → /srv/share` storage
  entry — copy its exact shape (keys/types) to model the new entry on.

- [ ] **Step 2: STOP — get explicit user go-ahead before proceeding**

  This step causes a brief FileBrowser Quantum restart/outage (everyone briefly loses
  file browsing on both `nas.codex074.com` and this feature's private drives, once
  live). **Do not run Step 3 without the user explicitly confirming, in this session,
  that now is an acceptable time.**

- [ ] **Step 3: Apply the new mount**

  Build a payload shaped `{"values": {...}}` — the full existing `app.config`
  response from Step 1 with `/mnt/tank/home → /srv/home` (rw) appended to the
  additional-storage list inside `values`, per the approved high-level plan (`midclt
  call -j app.update filebrowser-quantum '{"values": …}'`). As with Step 2, write a
  local `update_fbq_storage.py` runner (payload read from a local JSON file, calling
  `midclt call -j app.update filebrowser-quantum <payload>` via `subprocess.run`) and
  transfer + run it through the same scp → pve2 http.server → `qm guest exec 105`
  pattern — never inline the JSON into the `ssh` command line.
  Expected: exit code 0, stdout JSON success, no error. **Fallback if the payload is
  rejected:** ask the user to add it manually via TrueNAS Apps UI →
  filebrowser-quantum → Edit → Additional Storage, then continue from Step 4 once
  done.

- [ ] **Step 4: Verify the mount is live**

  Run: `ssh root@100.71.13.117 "qm guest exec 105 -- docker inspect ix-filebrowser-quantum-filebrowser-quantum-1 --format '{{json .Mounts}}'"`
  Expected: an entry with `Source: /mnt/tank/home`, `Destination: /srv/home`,
  `RW: true`.

  Then: `ssh root@100.71.13.117 "qm guest exec 105 -- curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:30334/health"`
  Expected: `200`.

- [ ] **Step 5: No commit** — this task has no repo changes.

---

## Task 3: A3 — Add the `home` source to FBQ's config (downtime, requires go-ahead)

**Files:** None (infrastructure only — edits
`/mnt/.ix-apps/app_mounts/filebrowser-quantum/config/config.yaml` on VM 105, not a
file in this repo).

**Interfaces:** Produces: FBQ recognizes a second source named `home`
(`defaultEnabled: false`, `private: true`), so `Scopes` entries naming it are no
longer silently dropped on save.

- [ ] **Step 1: Back up the current config**

  Run: `ssh root@100.71.13.117 "qm guest exec 105 -- cp /mnt/.ix-apps/app_mounts/filebrowser-quantum/config/config.yaml /mnt/.ix-apps/app_mounts/filebrowser-quantum/config/config.yaml.bak-privatedrives"`
  Expected: exit code 0.

- [ ] **Step 2: Read the current config**

  Run: `ssh root@100.71.13.117 "qm guest exec 105 -- cat /mnt/.ix-apps/app_mounts/filebrowser-quantum/config/config.yaml"`
  Expected: the `server:`/`integrations:` block as it stands after the OnlyOffice
  plan's Task 4 (confirms nothing else changed it since).

- [ ] **Step 3: Write the new config locally, keeping every existing key**

  Add a `home` source entry; **explicitly** keep `share`'s `defaultEnabled: true` (no
  longer auto-forced once a second source exists — see spec's Verified Facts); keep
  the existing `integrations.office` block byte-for-byte:

  ```yaml
  server:
    port: 30334
    database: /config/filebrowser.db
    cacheDir: /.cache
    internalUrl: http://192.168.1.22:30334
    sources:
      - path: /srv/share
        config:
          defaultEnabled: true
      - path: /srv/home
        name: home
        config:
          defaultEnabled: false
          private: true
  integrations:
    office:
      url: https://office.codex074.com
      internalUrl: http://192.168.1.22:8095
      secret: <existing JWT secret — copy verbatim from the current config, do not regenerate>
      viewOnly: true
  ```

- [ ] **Step 4: STOP — get explicit user go-ahead before proceeding**

  This step also restarts FBQ (brief outage). **Do not run Step 5 without the user's
  explicit confirmation in this session.**

- [ ] **Step 5: Transfer and apply**

  Using the established scp → pve2 `python3 -m http.server` (bound to
  `192.168.1.16`) → `qm guest exec 105 -- curl` transfer pattern (see the OnlyOffice
  plan's Task 4 Step 3 for the exact sequence), overwrite
  `/mnt/.ix-apps/app_mounts/filebrowser-quantum/config/config.yaml` on VM 105 with
  Step 3's content. Confirm with `cat` that it matches exactly, including the real
  JWT secret (not a placeholder).

- [ ] **Step 6: Restart FBQ**

  Run: `ssh root@100.71.13.117 "qm guest exec 105 -- docker restart ix-filebrowser-quantum-filebrowser-quantum-1"`
  Expected: container name printed back, exit code 0.

- [ ] **Step 7: Verify**

  Run: `ssh root@100.71.13.117 "qm guest exec 105 -- curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:30334/health"`
  Expected: `200`.

  Run: `ssh root@100.71.13.117 "qm guest exec 105 -- docker logs --since 2m ix-filebrowser-quantum-filebrowser-quantum-1"`
  Expected: log lines mentioning both `share` and `home` sources being indexed; no
  fatal config errors; a `<db>.bak` backup line is expected and harmless (FBQ backs
  up its Bolt DB before applying the startup scope-merge — see spec's Verified
  Facts).

  Run: `ssh root@100.71.13.117 "qm guest exec 105 -- curl -sS 'http://127.0.0.1:30334/api/users' -H 'Cookie: <admin session cookie>'"`
  Expected: **no** existing user's `scopes` array gained a `home` entry (confirms
  `defaultEnabled: false` actually prevented the startup auto-merge from touching
  anyone).

- [ ] **Step 8: No commit** — this task has no repo changes.

---

## Task 4: B1 — nasapi scopes + `apiServerConfig` struct

**Files:**
- Modify: `docker/nasapi/main.go`
- Modify: `docker/nasapi/main_test.go`

**Interfaces (verbatim from the detailed plan):**
```go
type userScope struct { Name string `json:"name"`; Scope string `json:"scope"` }
type fileBrowserUser struct { ID int; Username string; Permissions struct{Admin bool}; Scopes []userScope `json:"scopes"` }
func (u fileBrowserUser) scopeFor(source string) (string, bool)
type apiServerConfig struct {
    StatPath, SharePath, HomePath string
    ProfilePath, OwnershipPath, QuotaPath string
    FileBrowserURL, OnlyOfficeURL string
    Client *http.Client              // identity lookups, 5s timeout
    ProxyTransport http.RoundTripper // uploads; no timeout
}
func newAPIServer(cfg apiServerConfig) (*apiServer, error)
```
`main()` reads `NASAPI_HOME_PATH` (default `/srv/home`), `NASAPI_SHARE_PATH`
(default `/srv/share`), and a quota file `quotas.json` in the existing data dir.

- [ ] **Step 1: Write the failing tests**

  In `docker/nasapi/main_test.go`, add test helpers used by every later Phase-B task:
  a `fakeFileBrowser` httptest server whose `/api/users?id=self` returns a
  configurable `fileBrowserUser` (including `Scopes`), whose `/api/users` returns a
  slice for admin listing, which records every *other* request's method, raw query,
  headers, and body bytes under a mutex (answering `200 {}`), and which returns `401`
  unless the request carries `Cookie: auth=valid`. Add `scopeFor` unit tests (found /
  not-found cases) and a test that `newAPIServer(apiServerConfig{...})` builds
  successfully with all fields populated and fails cleanly with a malformed
  `QuotaPath` directory.

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `docker run --rm -v $(pwd)/docker/nasapi:/app -w /app golang:1.22 go build ./...`
  Expected: build failure — `apiServerConfig`, `userScope.scopeFor`, and the new
  struct-based `newAPIServer` signature don't exist yet; the 3 existing
  `newAPIServer(...)` positional call sites also now mismatch.

- [ ] **Step 3: Implement the minimal code**

  Convert `newAPIServer`'s signature to the `apiServerConfig` struct form above; add
  `userScope`/`scopeFor` to `fileBrowserUser`; thread `HomePath`/`SharePath`/
  `QuotaPath`/`OnlyOfficeURL`/`ProxyTransport` through `apiServer`; update `main()` to
  read `NASAPI_HOME_PATH`/`NASAPI_SHARE_PATH` (with the stated defaults) and build a
  `quotas.json` path from the existing data dir; update the 3 existing test call
  sites in `main_test.go` to build an `apiServerConfig{...}` instead of positional
  arguments.

- [ ] **Step 4: Run the tests to verify they pass**

  Run: `docker run --rm -v $(pwd)/docker/nasapi:/app -w /app golang:1.22 go test ./... -v`
  Expected: all tests pass, including every pre-existing test (`TestProfile*`,
  `TestOwnership*`, `TestConfig*`, `TestNonAdmin*`) unaffected by the signature
  change.

- [ ] **Step 5: Commit**

  ```bash
  git add docker/nasapi/main.go docker/nasapi/main_test.go
  git commit -m "$(cat <<'EOF'
nasapi: apiServerConfig struct, scopes, HOME/SHARE paths

Replaces newAPIServer's growing positional-argument signature with a
config struct ahead of adding quota/gate logic. Adds userScope and
fileBrowserUser.scopeFor so later tasks can resolve a user's private
drive from their FBQ session scopes.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LANe6ydnuViSsJ7jtX1TzZ
EOF
)"
  ```

---

## Task 5: B2 — `quotaStore` (`docker/nasapi/quota.go`)

**Files:**
- Create: `docker/nasapi/quota.go`
- Create: `docker/nasapi/quota_test.go`

**Interfaces (verbatim):**
```go
type quotaRecord struct { LimitBytes int64 `json:"limitBytes"` }
func newQuotaStore(path string) (*quotaStore, error)
get(uid) (quotaRecord, bool); all() map[string]quotaRecord; set(uid string, limit int64) error; delete(uid string) error
```
File format: `{"version":1,"quotas":{"<uid>":{"limitBytes":n}}}`. Mirror the
existing `profileStore` exactly: `RWMutex`, rollback on save failure, `saveLocked`
via temp-file + rename.

- [ ] **Step 1: Write the failing tests**

  In `docker/nasapi/quota_test.go`: set then get returns the record; delete removes
  it; a fresh store on a missing file starts empty; a value written, then a new
  `newQuotaStore` opened on the same path, sees it persisted (restart-durability);
  concurrent set/get from multiple goroutines doesn't race (`-race` clean).

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `docker run --rm -v $(pwd)/docker/nasapi:/app -w /app golang:1.22 go test ./... -run TestQuota`
  Expected: build failure — `quotaStore`/`newQuotaStore` don't exist yet.

- [ ] **Step 3: Implement the minimal code**

  Model `quota.go` directly on the existing `profileStore` implementation
  (`docker/nasapi/main.go` or wherever it currently lives) — same locking, same
  atomic-write pattern, same JSON envelope shape with a `version` field.

- [ ] **Step 4: Run the tests to verify they pass**

  Run: `docker run --rm -v $(pwd)/docker/nasapi:/app -w /app golang:1.22 go test ./... -race -v -run TestQuota`
  Expected: all pass, race-clean.

- [ ] **Step 5: Commit**

  ```bash
  git add docker/nasapi/quota.go docker/nasapi/quota_test.go
  git commit -m "$(cat <<'EOF'
nasapi: add quotaStore (quotas.json)

Mirrors the existing profileStore's locking/atomic-write pattern.
Source of truth for each user's admin-set storage limit; a missing
record means 0 bytes allowed (fail closed), enforced starting in the
next task's gate.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LANe6ydnuViSsJ7jtX1TzZ
EOF
)"
  ```

---

## Task 6: B3 — `usageTracker` (`docker/nasapi/usage.go`)

**Files:**
- Create: `docker/nasapi/usage.go`
- Create: `docker/nasapi/usage_test.go`

**Interfaces (verbatim):**
```go
func directorySize(root string) (int64, error) // WalkDir, regular files only, logical size, never follow symlinks, missing root → 0,nil
type usageTracker struct { mu sync.Mutex; ttl time.Duration; now func() time.Time; scopes map[string]*scopeUsage }
type scopeUsage struct { mu sync.Mutex; used, reserved int64; computedAt time.Time; stale bool }
func newUsageTracker(ttl time.Duration) *usageTracker
func (t *usageTracker) used(dir string) (int64, error)
func (t *usageTracker) reserve(dir string, need, limit int64) (release func(committed bool), ok bool, err error)
func (t *usageTracker) invalidate(dir string)
```
`reserve`: per-scope lock, refresh if stale/expired, `ok` iff `need == 0 ||
used+reserved+need <= limit`; `release(true)` folds `need` into `used` without a
rewalk; `release(false)` subtracts it back out. TTL: 30s.

- [ ] **Step 1: Write the failing tests**

  In `docker/nasapi/usage_test.go`: `directorySize` sums nested files and a `.trash`
  subdirectory correctly and skips symlinks; a `reserve` under the limit succeeds, one
  over the limit fails; `need == 0` always succeeds (mkdir must work even if an admin
  lowered the limit below current usage); a concurrency test spawning two goroutines
  each requesting an amount that individually fits but jointly exceeds the limit
  — exactly one must get `ok == true` (run with `-race`); `release(true)` updates
  `used` without triggering a second directory walk (assert via a counting stub
  filesystem or a `directorySize` call counter); `release(false)` returns the
  reservation without touching `used`; `invalidate` forces the next `used`/`reserve`
  call to rewalk even within the TTL window; TTL expiry is exercised via the injected
  `now func() time.Time`, not real `time.Sleep`.

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `docker run --rm -v $(pwd)/docker/nasapi:/app -w /app golang:1.22 go test ./... -run TestUsage`
  Expected: build failure.

- [ ] **Step 3: Implement the minimal code**

  Implement `directorySize`/`usageTracker`/`scopeUsage` exactly per the signatures
  above.

- [ ] **Step 4: Run the tests to verify they pass**

  Run: `docker run --rm -v $(pwd)/docker/nasapi:/app -w /app golang:1.22 go test ./... -race -v -run TestUsage`
  Expected: all pass, race-clean, including the concurrent-reserve test showing
  exactly one winner.

- [ ] **Step 5: Commit**

  ```bash
  git add docker/nasapi/usage.go docker/nasapi/usage_test.go
  git commit -m "$(cat <<'EOF'
nasapi: add usageTracker with reserve/release and a 30s TTL cache

reserve() prevents two concurrent writes that individually fit under
quota from jointly exceeding it — exactly one of two racing
reservations that overlap the limit succeeds. release(true) folds the
reserved amount into used without a re-walk; release(false) returns
it. invalidate() forces a fresh walk on the next read.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LANe6ydnuViSsJ7jtX1TzZ
EOF
)"
  ```

---

## Task 7: B4 — Quota endpoints (`docker/nasapi/quota.go`, routes `/quota`, `/quotas`, `/quotas/`)

**Files:**
- Modify: `docker/nasapi/quota.go`
- Modify: `docker/nasapi/quota_test.go`
- Modify: `docker/nasapi/main.go` (route registration)

**Interfaces (verbatim):**
- `GET /quota` (self): `{"hasDrive","unlimited","limitBytes","usedBytes"}`; admin →
  `unlimited:true`, `usedBytes` = size of `/srv/home`; non-admin without a home scope
  → `hasDrive:false`, zeros; non-admin with a home scope but no quota record →
  `limitBytes: 0`. `Cache-Control: no-store` on every response.
- `GET /quotas` (`requireAdmin`): new `fetchUsers(r)` helper forwards the admin
  actor's auth headers (Cookie/Authorization/X-Auth) to `GET /api/users`; returns
  `{"quotas":{"<uid>":{"limitBytes","usedBytes","hasDrive","unlimited"}}}` for every
  user.
- `PUT /quotas/<uid>` (`requireAdmin`, `canonicalUID`, body `{"limitBytes":n}`,
  `DisallowUnknownFields`, `http.MaxBytesReader` capped at 4096 bytes, `n >= 0`,
  target uid must exist via `fetchUser`) → `200 {"uid","limitBytes"}`.
- `DELETE /quotas/<uid>` → `204`.
- `homeDirFor(user) (string, bool)`: `filepath.Join(homePath,
  filepath.Clean("/"+scope))`, then a prefix check that the result plus a trailing
  `/` has `homePath+"/"` as a prefix (defense against a scope value escaping via
  `..` before `Clean` even though FBQ itself already prevents this at the API layer).
- Reuse existing helpers: `fetchUser`, `requireAdmin`, `canonicalUID`, `writeJSON`,
  `writeUpstreamError`, `methodNotAllowed`.

- [ ] **Step 1: Write the failing tests**

  In `docker/nasapi/quota_test.go`: `GET /quota` for an admin, a non-admin with a
  home scope and a quota record, a non-admin with a home scope and *no* record
  (expect `limitBytes: 0`), and a non-admin with no home scope at all (expect
  `hasDrive:false`); `GET /quotas` / `PUT /quotas/<uid>` / `DELETE /quotas/<uid>` all
  `403` for a non-admin actor; `PUT` validation rejects a negative `limitBytes`, a
  non-integer value, and an unknown JSON field, each with `400`; a successful `PUT`
  persists across a store reload; `GET /quotas` computes `usedBytes` correctly
  against real temp-directory fixtures written with `writeFile(t, dir, rel, n)`.

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `docker run --rm -v $(pwd)/docker/nasapi:/app -w /app golang:1.22 go test ./... -run TestQuota`
  Expected: build/test failure — the new handlers and `fetchUsers`/`homeDirFor`
  don't exist yet.

- [ ] **Step 3: Implement the minimal code**

  Add `fetchUsers`, `homeDirFor`, and the four handlers to `quota.go`; register
  `/quota`, `/quotas`, `/quotas/` on the mux in `main.go`.

- [ ] **Step 4: Run the tests to verify they pass**

  Run: `docker run --rm -v $(pwd)/docker/nasapi:/app -w /app golang:1.22 go test ./... -race -v`
  Expected: all pass, including every earlier Phase B test still green.

- [ ] **Step 5: Commit**

  ```bash
  git add docker/nasapi/quota.go docker/nasapi/quota_test.go docker/nasapi/main.go
  git commit -m "$(cat <<'EOF'
nasapi: add GET /quota, GET /quotas, PUT/DELETE /quotas/<uid>

Self quota lookup for the Sidebar's storage card, and admin
list/edit/clear endpoints for Manage users. Identity for the self
lookup always comes from the caller's own FBQ session, never a
client-supplied uid.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LANe6ydnuViSsJ7jtX1TzZ
EOF
)"
  ```

---

## Task 8: B5 — The gate (`docker/nasapi/gate.go`), registered at `/api/resources`

**Files:**
- Create: `docker/nasapi/gate.go`
- Create: `docker/nasapi/gate_test.go`
- Modify: `docker/nasapi/main.go` (route registration)

**Interfaces (verbatim):**
```go
func (s *apiServer) handleResourcesGate(w, r)  // dispatch by method; GET etc. → forward
func (s *apiServer) gateUpload(w, r)           // POST
func (s *apiServer) gateTransfer(w, r)         // PATCH
func (s *apiServer) gateDelete(w, r)           // DELETE: forward, invalidate if source=home
func (s *apiServer) forward(w, r, onDone func(status int))
func writeQuotaExceeded(w, used, limit, need int64) // 413 {"message":"Storage quota exceeded: ..."}
```
Proxy: `httputil.NewSingleHostReverseProxy(fbqURL)`, `Transport: cfg.ProxyTransport`
(default `http.DefaultTransport.(*http.Transport).Clone()`), `FlushInterval: -1`,
default `Director` (Host/cookies pass through untouched), `ModifyResponse` records
the upstream status, `ErrorHandler` → `502 {"message":"File service unavailable."}`.

**POST rules:** `source != "home"` → forward untouched, no identity lookup at all.
Else `fetchUser` (failure → `writeUpstreamError`, i.e. fail closed). Admin → forward.
No home scope → `403 {"message":"No private drive assigned."}`. `need`: `isDir=true`
→ `0`; else `r.ContentLength` if `>= 0`; else `X-File-Total-Size` (only when
`X-File-Chunk-Offset` is `0` or absent); else `411
{"message":"Content-Length required."}`. `reserve`; not ok → drain the body then
`413`; ok → forward, `release(status < 300)`.

**PATCH rules:** read the body (`MaxBytesReader` 1 MiB cap), decode
`{items:[{fromSource,fromPath,toSource,toPath}], action}`, re-supply the body
(`io.NopCloser(bytes.NewReader(buf))` + correct `ContentLength`) so FBQ receives it
unchanged. For items where `toSource=="home" && (action=="copy" ||
fromSource!="home")`: resolve the source root (`share` → `sharePath` + the actor's
share scope; `home` → `homeDirFor`), join with `Clean("/"+fromPath)` with a prefix
check (`..` escape attempt → `400`), size via `directorySize` for directories or
`Stat` for files (missing → `0`), sum every such item into **one** `reserve` call on
the actor's home dir. Admin → forward without a reservation. After forwarding,
invalidate the home dir's cached usage if any item touched `home`.

**DELETE rules:** forward, then invalidate the home dir's cached usage if
`source=home`.

- [ ] **Step 1: Write the failing tests**

  In `docker/nasapi/gate_test.go`, using the recording `fakeFileBrowser`: share
  passthrough is byte-for-byte identical (body, query) with **zero** calls to
  `/api/users`; a home upload under the limit forwards; over the limit → `413`,
  nothing reaches FBQ, the reservation is released; an `isDir=true` mkdir over the
  limit still succeeds (`need==0`); a missing `Content-Length` and no
  `X-File-Total-Size` → `411`; admin bypasses the quota check entirely; a home scope
  with no quota record → `413` for any `need > 0`; no home scope at all → `403`; the
  identity lookup returning `500` → `502`, while a concurrent `share` request in the
  same test still passes through fine; FBQ itself down → `502`; two concurrent
  uploads each at 60% of the limit → exactly one `413` (run with `-race`); a
  committed reservation does not trigger a second directory walk; a `DELETE` on
  `source=home` invalidates the cached usage (assert via a forced-stale check); a
  `PATCH` copy from `share` to `home` is sized from the real files on disk and
  correctly `413`s when it would exceed the limit; a `PATCH` move from `home` to
  `share` invalidates the home dir's cache; a `home`→`home` move/copy is **not**
  quota-checked (already inside the same limit); the `PATCH` body reaches FBQ
  byte-for-byte unchanged; a `..` in `fromPath`/`toPath` → `400`.

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `docker run --rm -v $(pwd)/docker/nasapi:/app -w /app golang:1.22 go test ./... -run TestGate`
  Expected: build failure — `gate.go`'s handlers don't exist yet.

- [ ] **Step 3: Implement the minimal code**

  Implement `handleResourcesGate`, `gateUpload`, `gateTransfer`, `gateDelete`,
  `forward`, `writeQuotaExceeded` exactly per the rules above; register
  `/api/resources` on the mux in `main.go`.

- [ ] **Step 4: Run the tests to verify they pass**

  Run: `docker run --rm -v $(pwd)/docker/nasapi:/app -w /app golang:1.22 go test ./... -race -v`
  Expected: every test listed in Step 1 passes, `-race` clean, and every earlier
  Phase B test is still green.

- [ ] **Step 5: Commit**

  ```bash
  git add docker/nasapi/gate.go docker/nasapi/gate_test.go docker/nasapi/main.go
  git commit -m "$(cat <<'EOF'
nasapi: add the quota-enforcing reverse-proxy gate at /api/resources

POST/PATCH/DELETE against source=home are quota-checked against the
caller's own FBQ session identity before being forwarded to FBQ;
source=share is forwarded completely untouched, byte-for-byte, with
no identity lookup at all. Rejected writes drain the request body
before answering 413 so the client reliably sees the rejection rather
than a reset connection. Fails closed: an identity lookup failure or
FBQ being unreachable returns 502, never a silent pass-through.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LANe6ydnuViSsJ7jtX1TzZ
EOF
)"
  ```

---

## Task 9: B6 — Wire the mux, restart loop, run the full suite

**Files:**
- Modify: `docker/nasapi/main.go`
- Modify: `docker/entrypoint.sh`

**Interfaces:** None new — wiring only.

- [ ] **Step 1: Confirm every route is registered**

  In `main()`/`handler()` in `docker/nasapi/main.go`, confirm `/api/resources`,
  `/quota`, `/quotas`, `/quotas/` are all registered alongside the existing
  `/storage`, `/config`, `/profile`, `/profiles`, `/profiles/`, `/ownership`,
  `/ownership/lookup`, `/ownership/move` routes.

- [ ] **Step 2: Make nasapi self-restart on crash**

  In `docker/entrypoint.sh`, wrap the `nasapi` invocation in a restart loop:
  `while true; do /usr/local/bin/nasapi; sleep 1; done &` before starting nginx —
  this is what makes the "kill nasapi, home writes 502, reads keep working, nasapi
  recovers within ~1s" verification step in Phase F possible.

- [ ] **Step 3: Run the full test suite**

  Run: `docker run --rm -v $(pwd)/docker/nasapi:/app -w /app golang:1.22 go test ./... -race`
  (use a locally installed `go` instead if available)
  Expected: every test in the package passes, `-race` clean — this is the full
  Phase B regression gate before moving to nginx/frontend work.

- [ ] **Step 4: Commit**

  ```bash
  git add docker/nasapi/main.go docker/entrypoint.sh
  git commit -m "$(cat <<'EOF'
nasapi: wire quota/gate routes; auto-restart nasapi in entrypoint.sh

Closes out Phase B. entrypoint.sh now respawns nasapi if it ever
crashes, so a transient nasapi failure degrades to a brief 502 window
on home writes (reads unaffected) rather than a lasting outage.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LANe6ydnuViSsJ7jtX1TzZ
EOF
)"
  ```

---

## Task 10: C1 — nginx method-routed gate (`docker/nginx.conf`)

**Files:** Modify: `docker/nginx.conf`

**Interfaces (verbatim):**
```nginx
map $request_method $resources_backend {
    default 127.0.0.1:30334;
    POST    127.0.0.1:9190;
    PATCH   127.0.0.1:9190;
    DELETE  127.0.0.1:9190;
}
```
and, placed **before** the existing `location /api/` block:
```nginx
location = /api/resources {
    proxy_pass http://$resources_backend;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    client_max_body_size 0;
    proxy_request_buffering off;
}
```

- [ ] **Step 1: Add the `map` block**

  Add it in the `http` context, near the top of `docker/nginx.conf` (alongside any
  other existing `map`/global directives).

- [ ] **Step 2: Add the `location = /api/resources` block**

  Insert it immediately before the existing `location /api/` block (exact-match
  locations must be evaluated ahead of the prefix match, and nginx's own precedence
  rules already guarantee this regardless of file order, but keeping it visually
  above the general `/api/` block avoids confusion for the next reader).

- [ ] **Step 3: Validate the config syntax**

  Run: `docker run --rm -v "$(pwd)/docker/nginx.conf":/etc/nginx/conf.d/default.conf:ro nginx:alpine nginx -t`
  Expected: `syntax is ok` / `test is successful`.

- [ ] **Step 4: Commit**

  ```bash
  git add docker/nginx.conf
  git commit -m "$(cat <<'EOF'
nginx: route POST/PATCH/DELETE on /api/resources through nasapi's gate

GET (listing, download, preview, search) is unaffected — it still
goes straight to FileBrowser Quantum, so reads never depend on nasapi
being up. Only the three write verbs on this one path are gated, so
nasapi's quota check runs before FBQ ever sees a home-drive write.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LANe6ydnuViSsJ7jtX1TzZ
EOF
)"
  ```

---

## Task 11: C2 — README updates

**Files:** Modify: `README.md` (repo root — confirm exact filename first).

**Interfaces:** None (documentation only).

- [ ] **Step 1: Document the new env vars and architecture**

  Add: `NASAPI_HOME_PATH` (default `/srv/home`) and `NASAPI_SHARE_PATH` (default
  `/srv/share`) env vars; a short description of the write-verb gate at
  `/api/resources`; the existence of FBQ's `home` source and what it's for.

- [ ] **Step 2: Commit**

  ```bash
  git add README.md
  git commit -m "$(cat <<'EOF'
README: document NASAPI_HOME_PATH/NASAPI_SHARE_PATH and the quota gate

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LANe6ydnuViSsJ7jtX1TzZ
EOF
)"
  ```

---

## Task 12: C3 — Empirical proof the `413` path works end-to-end (gates Phase D)

**Files:** None (verification only — no repo changes).

**Interfaces:** None. **This task must pass before any Phase D (frontend) work
begins** — Phase D's upload pre-check and error-toast behavior assume the `413` is
real and reaches the browser cleanly.

- [ ] **Step 1: Build and run the image locally with a stub FBQ**

  Build the `docker/nasapi` + nginx image, point `NASAPI_FILEBROWSER_URL` at a
  minimal local stub server. The stub must serve `GET /api/users?id=self` returning
  a **non-admin** `fileBrowserUser` with a `home` scope (e.g. `{"id":42,"username":
  "test","permissions":{"admin":false},"scopes":[{"name":"share","scope":"/"},
  {"name":"home","scope":"/test"}]}`) — the gate's `fetchUser` call happens before
  any quota check, so a stub that only answers the upload itself yields `502`
  (identity lookup path never reached its "user" shape) or `403` (no home scope
  found), never the `413` this task exists to prove. The stub must also accept the
  forwarded upload itself and return `200`. Seed `quotas.json` with a 1 MiB limit
  keyed on that **same** uid (`42`).

- [ ] **Step 2: Send an oversized upload**

  Run: `curl -i --data-binary @<a ~200MB test file> 'http://127.0.0.1:8090/api/resources?source=home&path=/big.bin' -H 'Cookie: auth=valid'`
  Expected: HTTP `413` with the `{"message":"Storage quota exceeded..."}` body,
  received cleanly (not a connection reset) — this is the specific behavior
  `proxy_request_buffering off` + the gate's drain-then-413 pattern is meant to
  guarantee.

- [ ] **Step 3: Send a tiny, under-quota upload**

  Run: `curl -i --data-binary @<a small file> 'http://127.0.0.1:8090/api/resources?source=home&path=/small.bin' -H 'Cookie: auth=valid'`
  Expected: `200`/`201` — forwarded successfully.

- [ ] **Step 4: Confirm reads survive nasapi being killed**

  Kill the `nasapi` process inside the container; confirm `GET
  /api/resources?source=home&path=/` still returns a listing (reads never depend on
  nasapi).

- [ ] **Step 5: If Step 2 doesn't produce a clean 413**

  Stop. Do not proceed into Phase D. Investigate nginx's handling of an early
  upstream response while the client is still sending the request body — this is a
  known nginx subtlety with `proxy_request_buffering off`, and getting it wrong here
  would surface as a confusing, hard-to-reproduce bug in the frontend later instead.

- [ ] **Step 6: No commit** — this task has no repo changes, only confirms Tasks 8
  and 10 actually work together against a real proxy.

---

## Task 13: D1 — `resources.js` + `office.js` — source-first signatures

**Files:**
- Modify: `frontend/src/api/resources.js`
- Modify: `frontend/src/api/office.js`
- Modify: `frontend/tests/api/resources.test.js`
- Modify: `frontend/tests/api/office.test.js`

**Interfaces (verbatim):** `source` becomes the first, required, no-default argument
in every function: `listDirectory(source, path)`, `makeDirectory(source, path)`,
`uploadFile(source, path, file, onProgress)`, `deleteItem(source, path)`,
`renameItem(source, path, newName)`, `downloadUrl(source, path, {inline})`,
`previewUrl(source, path, size)`, `getFileText(source, path)`,
`getOfficeConfig(source, path)`. New: `transferItem({fromSource, fromPath,
toSource, toPath}, action='move')`, with `moveItem(source, from, to)` /
`copyItem(source, from, to)` as thin wrappers over it. `moveOwnership` is called
only when `action==='move' && fromSource==='share' && toSource==='share'`. Export
`SOURCES = ['home','share']`.

- [ ] **Step 1: Rewrite the failing tests first**

  Rewrite `frontend/tests/api/resources.test.js` and `frontend/tests/api/office.test.js`
  for the new source-first signatures on every existing test case, plus new cases
  for `transferItem`/`moveItem`/`copyItem` (both same-source and cross-source
  combinations) and the `moveOwnership`-only-on-share→share rule.

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `cd frontend && npx vitest run tests/api/resources.test.js tests/api/office.test.js`
  Expected: FAIL — every call site still uses the old (no-`source`, default `'share'`)
  signatures.

- [ ] **Step 3: Implement the minimal code**

  Rewrite `resources.js`/`office.js` to the new signatures; add `transferItem` and
  the `moveItem`/`copyItem` wrappers; export `SOURCES`.

- [ ] **Step 4: Run the tests to verify they pass**

  Run: `cd frontend && npx vitest run tests/api/resources.test.js tests/api/office.test.js`
  Expected: all green.

- [ ] **Step 5: Commit**

  ```bash
  git add frontend/src/api/resources.js frontend/src/api/office.js frontend/tests/api/resources.test.js frontend/tests/api/office.test.js
  git commit -m "$(cat <<'EOF'
resources.js/office.js: source becomes the first, required argument

Every call site must now say which drive (home or share) it means —
no more implicit default to share. Adds transferItem for cross-drive
move/copy; moveOwnership only fires for share-to-share moves, since
ownership tracking stays share-only.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LANe6ydnuViSsJ7jtX1TzZ
EOF
)"
  ```

---

## Task 14: D2 — `trash.js` per source

**Files:**
- Modify: `frontend/src/api/trash.js`
- Modify: `frontend/tests/api/trash.test.js`

**Interfaces (verbatim):** `softDelete(source, path)`, `listTrash(source)` (a `404`
on `/.trash` degrades to `[]`), `restoreFromTrash(item)` (uses `item.source`),
`deleteForever(item)`, `emptyTrash(source, canDelete)`. Ownership calls only fire for
`source==='share'`; every trash item carries its `source`.

- [ ] **Step 1: Rewrite the failing tests**

  Cover both drives independently, the `404`→`[]` degradation per-source, and that
  ownership calls are skipped entirely for `home` items.

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `cd frontend && npx vitest run tests/api/trash.test.js`

- [ ] **Step 3: Implement the minimal code**

- [ ] **Step 4: Run the tests to verify they pass**

  Run: `cd frontend && npx vitest run tests/api/trash.test.js`
  Expected: all green.

- [ ] **Step 5: Commit**

  ```bash
  git add frontend/src/api/trash.js frontend/tests/api/trash.test.js
  git commit -m "$(cat <<'EOF'
trash.js: source-aware trash operations, ownership skipped for home

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LANe6ydnuViSsJ7jtX1TzZ
EOF
)"
  ```

---

## Task 15: D3 — `users.js` scopes + new `quota.js`

**Files:**
- Modify: `frontend/src/api/users.js`
- Modify: `frontend/tests/api/users.test.js`
- Create: `frontend/src/api/quota.js`
- Create: `frontend/tests/api/quota.test.js`

**Interfaces (verbatim):** `createUser(actorPassword, {username, password, admin})`
sends scopes `[{name:'share',scope:'/'},{name:'home', scope: admin ? '/' :
'/'+username}]`; `isValidUsername(name)`; `updateUserScopes(user, actorPassword, scopes)` →
`PUT /api/users?id=<id>` `{which:['scopes'], data:{...freshUser, scopes}}` +
`X-Password`. New `api/quota.js`: `getMyQuota()`, `listQuotas()`,
`setUserQuota(uid, limitBytes)`, `deleteUserQuota(uid)`, `gbToBytes(gb)`,
`bytesToGb(bytes)` (GiB math).

- [ ] **Step 1: Write the failing tests**

  `users.test.js`: `createUser` sends the right scopes for both the admin and
  non-admin case; `isValidUsername` accepts/rejects per the regex + `.`/`..` rule
  from Global Constraints; `updateUserScopes` sends the correct body shape and
  `X-Password` header. `quota.test.js`: each of the five `quota.js` functions against
  a mocked `global.fetch`, plus `gbToBytes`/`bytesToGb` round-trip correctly using
  GiB (`1024**3`), not decimal GB.

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `cd frontend && npx vitest run tests/api/users.test.js tests/api/quota.test.js`
  Expected: FAIL — `quota.js` doesn't exist yet; `users.js` doesn't send home scopes
  yet.

- [ ] **Step 3: Implement the minimal code**

- [ ] **Step 4: Run the tests to verify they pass**

  Run: `cd frontend && npx vitest run tests/api/users.test.js tests/api/quota.test.js`
  Expected: all green.

- [ ] **Step 5: Commit**

  ```bash
  git add frontend/src/api/users.js frontend/src/api/quota.js frontend/tests/api/users.test.js frontend/tests/api/quota.test.js
  git commit -m "$(cat <<'EOF'
users.js: createUser grants a home scope; add quota.js

New users get both share and home scopes at creation time (admin
keeps root '/' on home; non-admins get '/<username>'), so the folder
is created by FBQ's own MakeUserDirs call with no extra step needed.
quota.js wraps nasapi's new /quota, /quotas endpoints and does
GB<->GiB conversion for the UI.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LANe6ydnuViSsJ7jtX1TzZ
EOF
)"
  ```

---

## Task 16: D4 — Stores: `auth`, `files`, `starred`, `trash`, new `quota`

**Files:**
- Modify: `frontend/src/stores/auth.js`
- Modify: `frontend/src/stores/files.js`
- Modify: `frontend/src/stores/starred.js`
- Modify: `frontend/src/stores/trash.js`
- Create: `frontend/src/stores/quota.js`
- Modify/create matching test files under `frontend/tests/stores/`

**Interfaces (verbatim):** `auth` gains getters `hasHomeDrive` (scopes include
`home`) and `isAdmin`. `files` gains `source` state (**default `'share'`**),
`switchDrive(source)`, entries stamped with `source`, ownership lookup skipped for
`home`, `toggleStar` uses `entry.source ?? this.source`, `deleteSelected` takes
`[{source,path}]`. `starred` walks each reachable source with `Promise.allSettled`,
tagging each result with its source, ownership lookup only for share. `trash`
aggregates both sources. New `stores/quota.js`: `{hasDrive, unlimited, limitBytes,
usedBytes, loaded, refresh()}`.

- [ ] **Step 1: Write/update the failing tests**

  Cover: `hasHomeDrive`/`isAdmin` derivation from a mocked user object; `switchDrive`
  changing `files.source` and re-fetching the listing; entries carrying `source`;
  ownership lookups being skipped when `source==='home'`; `deleteSelected` accepting
  mixed-source item arrays; `starred`/`trash` correctly merging results from both
  drives, including one drive failing (`allSettled`) without breaking the other;
  `quota.refresh()` populating state from `getMyQuota()`.

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `cd frontend && npx vitest run tests/stores/`

- [ ] **Step 3: Implement the minimal code**

- [ ] **Step 4: Run the tests to verify they pass**

  Run: `cd frontend && npx vitest run tests/stores/`
  Expected: all green.

- [ ] **Step 5: Commit**

  ```bash
  git add frontend/src/stores/auth.js frontend/src/stores/files.js frontend/src/stores/starred.js frontend/src/stores/trash.js frontend/src/stores/quota.js frontend/tests/stores/
  git commit -m "$(cat <<'EOF'
stores: source-aware files/starred/trash, hasHomeDrive/isAdmin, quota

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LANe6ydnuViSsJ7jtX1TzZ
EOF
)"
  ```

---

## Task 17: D5 — `pathHelpers.js` — `selectionKey`

**Files:**
- Modify: `frontend/src/components/pathHelpers.js`
- Modify: `frontend/src/components/FileTile.vue`
- Modify: `frontend/src/components/FileListView.vue`
- Modify: `frontend/src/components/TopBar.vue` (select-all)
- Modify: `frontend/src/components/permissions.js` (`partitionDeletable`) — **confirm
  this file's exact location first** (`frontend/src/components/` vs. e.g.
  `frontend/src/` or a `utils/` dir); it was not directly re-verified while writing
  this plan, unlike every other path listed here.
- Modify matching test files

**Interfaces (verbatim):** `selectionKey(entry, currentPath, defaultSource)` →
`${source}:${path}`; `files.selected` now holds these keys instead of bare paths.

- [ ] **Step 1: Write the failing tests**

  Cover key format for both drives, and that two same-relative-path entries in
  different drives produce distinct keys (the collision this change exists to
  prevent).

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `cd frontend && npx vitest run tests/components/pathHelpers.test.js`

- [ ] **Step 3: Implement the minimal code**

  Add `selectionKey`; update every consumer (`FileTile`, `FileListView`, `TopBar`
  select-all, `permissions.partitionDeletable`) to build/parse it consistently.

- [ ] **Step 4: Run the tests to verify they pass**

  Run: `cd frontend && npx vitest run`
  Expected: full suite green (this touches selection state used broadly).

- [ ] **Step 5: Commit**

  ```bash
  git add frontend/src/components/pathHelpers.js frontend/src/components/FileTile.vue frontend/src/components/FileListView.vue frontend/src/components/TopBar.vue frontend/src/components/permissions.js
  git commit -m "$(cat <<'EOF'
selectionKey: source:path keys prevent cross-drive selection collisions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LANe6ydnuViSsJ7jtX1TzZ
EOF
)"
  ```

---

## Task 18: D6 — Components: Sidebar, App, TopBar, tiles, ManageUsersDialog

**Files:**
- Modify: `frontend/src/components/Sidebar.vue`
- Modify: `frontend/src/App.vue`
- Modify: `frontend/src/components/TopBar.vue`
- Modify: `frontend/src/components/FileTile.vue`, `FileListView.vue`,
  `Lightbox.vue`, `ContextMenu.vue`, `NewFolderDialog.vue`
- Modify: `frontend/src/components/dragMove.js`
- Modify: `frontend/src/components/ManageUsersDialog.vue`
- Create: `frontend/src/components/quotaMath.js` (pure logic, tested)
- Modify/create matching test files

**Interfaces (verbatim, key points):**
- `Sidebar.vue`: nav items My Drive (disabled + hint when `!hasHomeDrive`) / Shared /
  Starred / Trash, emitting `navigate('home'|'share'|'starred'|'trash')`; storage
  card shows a quota bar for non-admins with a drive (`limitBytes: 0` → "No quota
  set — ask an admin") and disk stats for admins, refreshing the quota every 60s
  alongside the existing disk-stats poll.
- `App.vue`: on login, `files.switchDrive(auth.hasHomeDrive ? 'home' : 'share')`;
  `onNavigate` maps drive nav items to `switchDrive` (`view='browse'` +
  `switchDrive(source)`); upload pre-check runs when `files.source==='home' &&
  quota.loaded && !quota.unlimited` (`showError` + skip the batch when over,
  `quota.refresh()` after uploads/deletes — the actual `413` still surfaces via
  `uploadFile`'s existing message parsing as a second layer of defense).
- `TopBar.vue`: root breadcrumb reads "My Drive"/"Shared" depending on `files.source`.
- `FileTile`, `FileListView`, `Lightbox`, `ContextMenu`, `NewFolderDialog`,
  `dragMove.js` (`moveInto(source, paths, target)`): every call site passes
  `entry.source ?? files.source`.
- `ContextMenu.vue` gains "Copy to My Drive" / "Copy to Shared" (targeting the root
  of the other drive) via `transferItem`, **hidden entirely when the user lacks a
  home drive** (`!auth.hasHomeDrive`).
- `ManageUsersDialog.vue`: required **Quota (GB)** field on create (hidden when
  Admin is checked) → `createUser` → refresh the user list → `setUserQuota` (clear,
  visible warning if that call fails, since the user was already created); per-row
  used/limit with inline edit; **"Assign drive"** for users lacking a home scope
  (`makeDirectory('home', '/'+username)` tolerating a `409` if it already exists,
  then `updateUserScopes` with a freshly re-fetched user object); admin bootstrap
  banner **"Enable my drive access"** (`PUT` own scopes with `{home,'/'}`, then
  `auth.checkSession()`; every other row's "Assign drive" button stays disabled
  until this has been done); delete also calls `deleteUserQuota(uid)` (the home
  folder itself is left on disk, not deleted).
- `quotaMath.js`: the pure formatting/threshold logic (percent-used, color
  thresholds, "No quota set" string) factored out and unit-tested, matching this
  repo's existing convention of testing pure helpers rather than mounting SFCs
  (see `Lightbox.vue`/`lightboxSrc.js` precedent in the OnlyOffice plan).

- [ ] **Step 1: Write the failing tests for `quotaMath.js`**

  Cover percent-used calculation, the zero-limit "no quota set" case, and any color-
  threshold logic it exposes.

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `cd frontend && npx vitest run tests/components/quotaMath.test.js`

- [ ] **Step 3: Implement `quotaMath.js`, then wire every component above**

  No dedicated SFC-mount tests for the Vue components themselves (matches this
  repo's established convention — see the OnlyOffice plan's Task 11 precedent);
  verified manually in Phase F/E instead.

- [ ] **Step 4: Run the full test suite and build**

  Run: `cd frontend && npx vitest run && npm run build`
  Expected: all tests pass, build succeeds with no errors.

- [ ] **Step 5: Commit**

  ```bash
  git add frontend/src/components/Sidebar.vue frontend/src/App.vue frontend/src/components/TopBar.vue frontend/src/components/FileTile.vue frontend/src/components/FileListView.vue frontend/src/components/Lightbox.vue frontend/src/components/ContextMenu.vue frontend/src/components/NewFolderDialog.vue frontend/src/components/dragMove.js frontend/src/components/ManageUsersDialog.vue frontend/src/components/quotaMath.js frontend/tests/components/quotaMath.test.js
  git commit -m "$(cat <<'EOF'
Frontend: My Drive/Shared navigation, quota UI, Assign drive, admin bootstrap

Sidebar switches between the two drives and shows a quota bar for
non-admins; ManageUsersDialog requires a quota on creation, supports
editing it later, and lets an admin assign a home drive to a legacy
user or grant themselves one. Every component that touches a file
entry now threads that entry's own source through instead of assuming
share.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LANe6ydnuViSsJ7jtX1TzZ
EOF
)"
  ```

---

## Task 19: F1 — Deploy `nasapi` + `nas-webui`, apply the A4 compose changes

**Files:** None (deploy only — every code change needed already landed in Tasks
4-18).

**Interfaces:** Produces: the live deployment running the new code, with the
`/srv/home:ro` mount and `NASAPI_HOME_PATH`/`NASAPI_SHARE_PATH` env vars applied to
`nas-webui`'s own compose (this is "A4" from the high-level plan — deliberately
folded into this deploy task rather than being its own infra task, since it's just
compose-file editing done as part of the normal deploy pipeline, not a separate FBQ
downtime).

- [ ] **Step 1: Run both test suites one final time from a clean checkout**

  Run: `cd frontend && npx vitest run` and
  `docker run --rm -v $(pwd)/../docker/nasapi:/app -w /app golang:1.22 go test ./... -race`
  Expected: both green.

- [ ] **Step 2: Add the A4 compose changes**

  Read the current rendered compose:
  `ssh root@100.71.13.117 "qm guest exec 105 -- cat /mnt/.ix-apps/app_configs/nas-webui/versions/1.0.0/templates/rendered/docker-compose.yaml"`.
  Add to the `nas-webui` service: volume `/mnt/tank/home:/srv/home:ro` and env vars
  `NASAPI_HOME_PATH=/srv/home`, `NASAPI_SHARE_PATH=/srv/share` — preserving every
  existing line (image, `network_mode`, `restart`, existing volumes/env). Transfer
  the updated file back via the established scp → pve2 http.server → `qm guest exec
  105 -- curl` pattern, overwriting the rendered compose file in place.

- [ ] **Step 3: Build, transfer, and deploy the image**

  Follow the established deploy pipeline exactly: build `--platform linux/amd64`
  locally, `docker save | gzip`, scp to pve2, temporary `python3 -m http.server` on
  `192.168.1.16`, `qm guest exec 105 -- curl` to pull it into VM 105, `docker load`,
  then `docker compose -f
  /mnt/.ix-apps/app_configs/nas-webui/versions/1.0.0/templates/rendered/docker-compose.yaml
  -p ix-nas-webui up -d --force-recreate`.

- [ ] **Step 4: Clean up temp files**

  Remove the saved image tarball and any transfer artifacts from the Mac, pve2, and
  VM 105.

- [ ] **Step 5: Verify the deploy**

  Run: `ssh root@100.71.13.117 "qm guest exec 105 -- docker ps --filter name=nas-webui --format '{{.Names}}\t{{.Status}}'"`
  Expected: `Up ...`.

  Run: `ssh root@100.71.13.117 "qm guest exec 105 -- docker inspect ix-nas-webui-nas-webui-1 --format '{{json .Mounts}}'"`
  Expected: includes `/mnt/tank/home → /srv/home` (read-only).

- [ ] **Step 6: No commit** — deploy-only task.

---

## Task 20: F2 — Full verification checklist

**Files:** None (verification only).

**Interfaces:** None.

- [ ] **Step 1: Isolation, curl-level (against `127.0.0.1:8090` inside the VM, real
  cookie jars, passwords from local files)**

  A user "alice" lists `source=home&path=/` and sees only her own files;
  `path=/../bob` and the URL-encoded `path=/%2e%2e/bob` both fail to ever show any
  of bob's files (FBQ's own scope join makes this impossible, not something this
  app adds).

- [ ] **Step 2: Quota enforcement, curl-level**

  A 1.2 GB upload against a 1 GB quota returns `413` and leaves **no** partial file
  under `/mnt/tank/home/alice` (drain-then-413 confirmed live, not just in the
  Task 12 local test). A `PATCH` copy from `share` to `home` that would exceed the
  quota returns `413`; a small folder copy under quota returns `200`. An upload to
  `source=share` is completely unaffected regardless of alice's home quota.

- [ ] **Step 3: Admin path**

  An admin lists every user's home folder (scope `/` on `home`) and can upload to
  `home` with no quota record at all (admins are always `unlimited`).

- [ ] **Step 4: Usage accounting**

  `GET /nasapi/quota`'s `usedBytes` for alice equals `du -sb --apparent-size
  /mnt/tank/home/alice` on the real filesystem.

- [ ] **Step 5: Resilience**

  `pkill nasapi` inside the container: `GET` listings on both drives still work; a
  `POST` to `source=home` returns `502`; `nasapi` is back (per the Task 9 restart
  loop) within roughly 1 second, and home writes resume working.

- [ ] **Step 6: Browser, manual**

  Drive switch (My Drive ↔ Shared) in the Sidebar; breadcrumbs read correctly for
  each; Starred and Trash both show entries from both drives and restoring an item
  keeps it in its original drive; the upload pre-check toast fires before an
  over-quota upload even starts; a genuine `413` (server-side reject) also shows a
  toast; creating a user with a quota works end-to-end; editing an existing user's
  quota inline works; "Assign drive" grants a legacy user a home scope and it
  appears immediately after their next login/session refresh.

- [ ] **Step 7: No commit** — this task only confirms the deploy from Task 19
  actually works; report the results back to the user.

---

## Task 21: E1 — Migrate existing users (after Task 19/20, may run over multiple
sessions as the admin gets to each user)

**Files:** None (operational, done through the live UI — not a code task).

**Interfaces:** None.

- [ ] **Step 1: Admin bootstraps their own drive access**

  In Manage users, click **"Enable my drive access"** once. Confirm the banner
  disappears and every row's "Assign drive" button becomes enabled.

- [ ] **Step 2: For each legacy user, one at a time**

  Click **"Assign drive"** → confirm `/mnt/tank/home/<username>` now exists on disk
  → set their **Quota (GB)** → Save.

- [ ] **Step 3: Confirm from the user's side**

  Ask each migrated user to reload the app (or log out/in, if FBQ caches scopes for
  the lifetime of a session) and confirm `GET /api/users?id=self` now shows a `home`
  scope, and "My Drive" is no longer disabled in their Sidebar.

- [ ] **Step 4: No commit** — operational task, not a code change.
