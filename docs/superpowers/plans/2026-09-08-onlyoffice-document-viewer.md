# OnlyOffice Document Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users open PDF, Word (.docx), Excel (.xlsx), .txt, and .md files directly in the app via a new OnlyOffice Document Server container, view-only.

**Architecture:** A new `onlyoffice/documentserver` container (its own TrueNAS Custom App, bridge-networked, port `8095:80`) is wired to the existing FileBrowser Quantum backend via its native `office` integration config. `nasapi` gains one read-only endpoint so the frontend knows where OnlyOffice lives without hardcoding it. `Lightbox.vue` gains an `office` kind that renders FileBrowser Quantum's own maintainer-sanctioned `@onlyoffice/document-editor-vue` component, falling back to the existing plain-download view on any failure.

**Tech Stack:** Go 1.22 (`docker/nasapi`), Vue 3 + Vite + Pinia + Vitest (`frontend`), `@onlyoffice/document-editor-vue@^1.4.0`, `onlyoffice/documentserver` (official Docker image), Proxmox `qm`/TrueNAS `midclt`.

**Spec:** `docs/superpowers/specs/2026-09-08-onlyoffice-document-viewer-design.md`

## Global Constraints

- View-only: `integrations.office.viewOnly: true` in FileBrowser Quantum's config — no per-file edit-permission tuning needed.
- OnlyOffice container must use bridge networking with an explicit published port (`8095:80`), never `network_mode: host` — its internal nginx is hardcoded to port 80, which would collide with TrueNAS's own UI (also on 80/443).
- `http.internalUrl` in FileBrowser Quantum's config must be the VM's real LAN IP (`http://192.168.1.22:30334`), not `127.0.0.1` — OnlyOffice reaches it from a different network namespace.
- The ownership feature (previous session) is already committed separately (`b9d1244`) — this plan's code tasks touch the same three files (`docker/nasapi/main.go`, `docker/nasapi/main_test.go`, `frontend/src/api/resources.js`) but start from a clean tree.
- Every new Go/JS behavior gets a failing test first (TDD, this repo's established convention) — see `docker/nasapi/main_test.go` and `frontend/tests/**` for the existing style to match exactly.
- Deploy pipeline for `nas-webui`/`nasapi` code changes: build `--platform linux/amd64` on the Mac → `docker save | gzip` → scp to `root@100.71.13.117` (pve2) → temporary `python3 -m http.server` bound to `192.168.1.16` → `qm guest exec 105 -- curl` into TrueNAS VM 105 → `docker load` → `docker compose -f /mnt/.ix-apps/app_configs/nas-webui/versions/1.0.0/templates/rendered/docker-compose.yaml -p ix-nas-webui up -d --force-recreate` → verify → clean up temp files on all three ends. (Established in earlier sessions — not re-derived here.)

---

## Task 1: Bump TrueNAS VM 105 RAM to 16 GB

**Files:** None (infrastructure only).

**Interfaces:** None.

- [ ] **Step 1: Confirm current state one more time**

Run: `ssh root@100.71.13.117 "qm config 105 | grep memory; qm guest exec 105 -- free -h"`
Expected: `memory: 8192`, and `free -h` still shows well under 2 GB truly available (confirms nothing has changed since design time).

- [ ] **Step 2: Check in with the user for timing**

This step causes a full VM restart (brief downtime for nas-webui, FileBrowser Quantum, SMB/NFS shares — everything on VM 105). Before running Step 3, confirm with the user in chat that now is an acceptable time. Do not proceed to Step 3 without an explicit go-ahead in this session.

- [ ] **Step 3: Update the VM's memory allocation**

Run: `ssh root@100.71.13.117 "qm set 105 --memory 16384"`
Expected: `update VM 105: -memory 16384` with no error.

- [ ] **Step 4: Gracefully shut down the VM**

Run: `ssh root@100.71.13.117 "qm shutdown 105"`
Expected: command returns once TrueNAS has cleanly stopped (can take 30-90s for ZFS/services to settle). Poll with `qm status 105` until it reports `status: stopped` before continuing — do not force-stop.

- [ ] **Step 5: Start the VM back up**

Run: `ssh root@100.71.13.117 "qm start 105"`
Expected: `start VM 105: UPID:...` with no error.

- [ ] **Step 6: Verify the new memory took effect and services came back**

Run: `ssh root@100.71.13.117 "qm guest exec 105 -- free -h"` (retry every few seconds for up to ~2 minutes — the guest agent isn't reachable until TrueNAS finishes booting)
Expected: `total` now reads `~15Gi`/`16Gi`.

Then: `ssh root@100.71.13.117 "qm guest exec 105 -- docker ps --format '{{.Names}}\t{{.Status}}'"`
Expected: `ix-nas-webui-nas-webui-1`, `ix-filebrowser-quantum-filebrowser-quantum-1`, `ix-nas-cloudflared-cloudflared-1` all show `Up ...` (containers with `restart: unless-stopped` should have come back automatically with the VM).

Then confirm the site itself: `curl -sS -o /dev/null -w '%{http_code}\n' https://nas.codex074.com`
Expected: `200`.

- [ ] **Step 7: No commit** — this task has no repo changes.

---

## Task 2: Deploy the OnlyOffice Document Server container

**Files:**
- Create (local scratch, not part of the repo): `/tmp/onlyoffice-compose.yaml`, `/tmp/onlyoffice-app-payload.json`, `/tmp/create_onlyoffice_app.py`

**Interfaces:**
- Produces: a running container reachable at `http://127.0.0.1:8095` (from VM 105's own network) and `http://192.168.1.22:8095` (from any other container on that VM), and a JWT secret value that Task 4 needs verbatim.

- [ ] **Step 1: Generate the JWT secret and record it**

Run locally: `openssl rand -hex 32`
Save the output — call it `<JWT_SECRET>` for the rest of this task and Task 4. (Do not paste it into any `ssh`/`qm` command line directly; it goes into files, per this repo's secrets-handling convention.)

- [ ] **Step 2: Write the compose YAML locally**

Create `/private/tmp/claude-501/onlyoffice-compose.yaml` (or your session's scratchpad dir) with `<JWT_SECRET>` substituted in:

```yaml
services:
  onlyoffice:
    image: onlyoffice/documentserver:latest
    restart: unless-stopped
    ports:
      - "8095:80"
    environment:
      - JWT_ENABLED=true
      - JWT_SECRET=<JWT_SECRET>
      - ALLOW_PRIVATE_IP_ADDRESS=true
      - ALLOW_META_IP_ADDRESS=true
    volumes:
      - /mnt/.ix-apps/app_mounts/onlyoffice/logs:/var/log/onlyoffice
      - /mnt/.ix-apps/app_mounts/onlyoffice/data:/var/lib/onlyoffice
      - /mnt/.ix-apps/app_mounts/onlyoffice/www-data:/var/www/onlyoffice/Data
      - /mnt/.ix-apps/app_mounts/onlyoffice/db:/var/lib/postgresql
      - /mnt/.ix-apps/app_mounts/onlyoffice/rabbitmq:/var/lib/rabbitmq
```

- [ ] **Step 2b: Build the `app.create` JSON payload locally with Python (correct escaping)**

```python
import json
compose_yaml = open('/path/to/onlyoffice-compose.yaml').read()
payload = {
    "custom_app": True,
    "app_name": "onlyoffice",
    "custom_compose_config_string": compose_yaml,
}
open('/path/to/onlyoffice-app-payload.json', 'w').write(json.dumps(payload))
```

- [ ] **Step 3: Write the tiny runner script locally**

`create_onlyoffice_app.py`:

```python
#!/usr/bin/env python3
import subprocess

with open('/tmp/onlyoffice-app-payload.json') as f:
    payload = f.read()

result = subprocess.run(
    ['midclt', 'call', '-j', 'app.create', payload],
    capture_output=True, text=True,
)
print('exit code:', result.returncode)
print('stdout:', result.stdout)
print('stderr:', result.stderr)
```

- [ ] **Step 4: Create the mount directories on VM 105**

Run: `ssh root@100.71.13.117 "qm guest exec 105 -- mkdir -p /mnt/.ix-apps/app_mounts/onlyoffice/logs /mnt/.ix-apps/app_mounts/onlyoffice/data /mnt/.ix-apps/app_mounts/onlyoffice/www-data /mnt/.ix-apps/app_mounts/onlyoffice/db /mnt/.ix-apps/app_mounts/onlyoffice/rabbitmq"`
Expected: exit code 0, no output.

- [ ] **Step 5: Transfer the two generated files onto VM 105**

Follow the same scp → pve2 → temporary `python3 -m http.server` (bound to `192.168.1.16`) → `qm guest exec 105 -- curl` pattern already used for `nas-webui` image transfers in this deployment (see Global Constraints). Land them at `/tmp/onlyoffice-app-payload.json` and `/tmp/create_onlyoffice_app.py` inside VM 105. Stop the temporary http.server and remove the files from pve2 once both are confirmed present on VM 105 (`qm guest exec 105 -- ls -la /tmp/onlyoffice-app-payload.json /tmp/create_onlyoffice_app.py`).

- [ ] **Step 6: Run the app-creation script on VM 105**

Run: `ssh root@100.71.13.117 "qm guest exec 105 -- python3 /tmp/create_onlyoffice_app.py"`
Expected: `exit code: 0` and `stdout` containing a JSON object with `"state": "RUNNING"` (or `"DEPLOYING"` — if so, wait ~30s and re-check with Step 7). If `stderr`/`exit code` shows an error, read it before retrying — do not re-run blindly (a second `app.create` with the same `app_name` will likely fail with "already exists" once the first partially succeeds).

- [ ] **Step 7: Verify the container is actually running and healthy**

Run: `ssh root@100.71.13.117 "qm guest exec 105 -- docker ps --filter name=onlyoffice --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'"`
Expected: one container, `Up ...`, `0.0.0.0:8095->80/tcp`.

Run: `ssh root@100.71.13.117 "qm guest exec 105 -- curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8095/healthcheck"`
Expected: `200` (OnlyOffice's own healthcheck endpoint; can take a minute or two after first start while its internal services finish booting — retry if it's `000`/`502`).

- [ ] **Step 8: Clean up the transferred files from VM 105**

Run: `ssh root@100.71.13.117 "qm guest exec 105 -- rm -f /tmp/onlyoffice-app-payload.json /tmp/create_onlyoffice_app.py"`

- [ ] **Step 9: No commit** — this task has no repo changes. Keep the `<JWT_SECRET>` value for Task 4.

---

## Task 3: User adds the Cloudflare Tunnel public hostname

**Files:** None — this step happens in the user's own Cloudflare Zero Trust dashboard, not something this session can do.

**Interfaces:** Produces: `https://office.codex074.com` reachable from the public internet, proxied to VM 105's `localhost:8095` via the existing tunnel.

- [ ] **Step 1: Ask the user to add the hostname**

Tell the user: "In Cloudflare Zero Trust → Networks → Tunnels → your existing tunnel (the one serving `nas.codex074.com`) → Public Hostname tab → Add a public hostname: subdomain `office`, domain `codex074.com`, service type `HTTP`, URL `localhost:8095`." Wait for their confirmation it's been added.

- [ ] **Step 2: Verify from outside**

Run: `curl -sS -o /dev/null -w '%{http_code}\n' https://office.codex074.com/healthcheck`
Expected: `200`.

---

## Task 4: Configure FileBrowser Quantum's OnlyOffice integration

**Files:**
- Modify (on VM 105, not in this repo): `/mnt/.ix-apps/app_mounts/filebrowser-quantum/config/config.yaml`

**Interfaces:** Consumes: the `<JWT_SECRET>` from Task 2. Produces: `GET /api/office/config?source=share&path=<path>` returning a real signed config instead of a 500.

- [ ] **Step 1: Read the current config to confirm it hasn't changed**

Run: `ssh root@100.71.13.117 "qm guest exec 105 -- cat /mnt/.ix-apps/app_mounts/filebrowser-quantum/config/config.yaml"`
Expected: exactly the `server:`-only block from the design spec's recon notes.

- [ ] **Step 2: Write the new config content locally**

**Note (already caught and fixed once — kept here for anyone re-running this task from scratch):** the deployed FileBrowser Quantum is `v1.5.5-stable`. In this exact version, `internalUrl` belongs under `server:`, not a top-level `http:` key (confirmed against `backend/common/settings/structs.go` at the `v1.5.5-stable` tag) — a top-level `http:` block with `internalUrl` crashes this version with `unknown field "internalUrl"`. The YAML below already reflects the corrected, verified-working schema.

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
integrations:
  office:
    url: https://office.codex074.com
    internalUrl: http://192.168.1.22:8095
    secret: <JWT_SECRET>
    viewOnly: true
```

- [ ] **Step 3: Transfer and apply it**

Using the same scp → pve2 http.server → `qm guest exec 105 -- curl` transfer pattern, land the new content at `/mnt/.ix-apps/app_mounts/filebrowser-quantum/config/config.yaml` on VM 105 (overwrite in place — this file is a bind mount, so writing to it takes effect for the container on its next restart, no container rebuild needed). Confirm with `qm guest exec 105 -- cat /mnt/.ix-apps/app_mounts/filebrowser-quantum/config/config.yaml` that it matches Step 2 exactly, including the real `<JWT_SECRET>` value (not the placeholder).

- [ ] **Step 4: Restart FileBrowser Quantum to pick up the config**

Run: `ssh root@100.71.13.117 "qm guest exec 105 -- docker restart ix-filebrowser-quantum-filebrowser-quantum-1"`
Expected: the container name printed back, exit code 0.

- [ ] **Step 5: Verify FileBrowser Quantum came back healthy**

Run: `ssh root@100.71.13.117 "qm guest exec 105 -- curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:30334/health"`
Expected: `200` (confirmed live at plan-writing time).

- [ ] **Step 6: Verify the office integration itself, end to end, against a real file**

Pick any real, existing document on the share (e.g. a `.txt` or `.docx` already sitting in `/srv/share`) and its exact FileBrowser path (e.g. `/Documents/example.txt`). Run:

`ssh root@100.71.13.117 "qm guest exec 105 -- curl -sS 'http://127.0.0.1:30334/api/office/config?source=share&path=/Documents/example.txt' -H 'Cookie: <a real session cookie>'"`

(Obtain a real session cookie by logging into `https://nas.codex074.com` in a browser and copying the `Cookie` header from any authenticated request via devtools — this is a one-off manual check, not something to script.)

Expected: a JSON object containing `document.url` (pointing at `http://192.168.1.22:30334/api/resources/view?...`), `editorConfig.callbackUrl`, and a `token` field (present because `secret` is now configured) — **not** a 500 with "only-office integration must be configured in settings".

- [ ] **Step 7: No commit** — this task has no repo changes (the edited file lives outside this repo).

---

## Task 5: `nasapi` — add `GET /config`

**Files:**
- Modify: `docker/nasapi/main.go`
- Modify: `docker/nasapi/main_test.go`

**Interfaces:**
- Produces: `newAPIServer(statPath, profilePath, ownershipPath, fileBrowserURL, onlyOfficeURL string, client *http.Client) (*apiServer, error)` (gains one new positional string parameter, `onlyOfficeURL`, inserted right after `fileBrowserURL`) and `GET /config` → `{"onlyOfficeUrl": "<value or empty string>"}`.

- [ ] **Step 1: Write the failing tests**

Add to `docker/nasapi/main_test.go`, right after the `newTestServerWithOwnership` helper (so later tests can use it):

```go
func newTestServerWithOnlyOfficeURL(t *testing.T, onlyOfficeURL string) *apiServer {
	t.Helper()
	fileBrowser := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, fileBrowserUser{ID: 2, Username: "login-handle"})
	}))
	t.Cleanup(fileBrowser.Close)
	server, err := newAPIServer(
		t.TempDir(),
		filepath.Join(t.TempDir(), "profiles.json"),
		filepath.Join(t.TempDir(), "ownership.json"),
		fileBrowser.URL,
		onlyOfficeURL,
		fileBrowser.Client(),
	)
	if err != nil {
		t.Fatal(err)
	}
	return server
}
```

And these test functions:

```go
func TestConfigReturnsConfiguredOnlyOfficeURL(t *testing.T) {
	server := newTestServerWithOnlyOfficeURL(t, "https://office.codex074.com")
	w := request(t, server.handler(), http.MethodGet, "/config", "", false)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	if w.Body.String() != `{"onlyOfficeUrl":"https://office.codex074.com"}`+"\n" {
		t.Fatalf("body = %s", w.Body.String())
	}
}

func TestConfigReturnsEmptyOnlyOfficeURLWhenUnset(t *testing.T) {
	server := newTestServerWithOnlyOfficeURL(t, "")
	w := request(t, server.handler(), http.MethodGet, "/config", "", false)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	if w.Body.String() != `{"onlyOfficeUrl":""}`+"\n" {
		t.Fatalf("body = %s", w.Body.String())
	}
}

func TestConfigRejectsNonGet(t *testing.T) {
	server := newTestServerWithOnlyOfficeURL(t, "https://office.codex074.com")
	w := request(t, server.handler(), http.MethodPost, "/config", "", false)
	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d", w.Code)
	}
}
```

Also update the three existing `newAPIServer(...)` call sites to pass `""` as the new `onlyOfficeURL` argument in the correct position (right after the `fileBrowserURL`/`fileBrowser.URL` argument, right before the trailing `*http.Client` argument):

- `newTestServerWithOwnership` (currently `newAPIServer(t.TempDir(), profilePath, ownershipPath, fileBrowser.URL, fileBrowser.Client())`) → `newAPIServer(t.TempDir(), profilePath, ownershipPath, fileBrowser.URL, "", fileBrowser.Client())`
- `TestProfileUpdatePersistsByUID`'s reload call → `newAPIServer(t.TempDir(), profilePath, filepath.Join(t.TempDir(), "ownership.json"), fileBrowser.URL, "", fileBrowser.Client())`
- `TestOwnershipPersistsAcrossRestart`'s reload call → `newAPIServer(t.TempDir(), filepath.Join(t.TempDir(), "profiles.json"), ownershipPath, fileBrowser.URL, "", fileBrowser.Client())`

- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker run --rm -v $(pwd)/docker/nasapi:/app -w /app golang:1.22 go build ./...` (from the repo root)
Expected: build failure — `newAPIServer` call-site arity mismatches (`not enough arguments`) and `undefined: newTestServerWithOnlyOfficeURL` — confirming the new code doesn't exist yet.

- [ ] **Step 3: Implement the minimal code**

In `docker/nasapi/main.go`:

Add a new response type near `storageResponse`:

```go
type configResponse struct {
	OnlyOfficeURL string `json:"onlyOfficeUrl"`
}
```

Add a field to `apiServer`:

```go
type apiServer struct {
	statPath       string
	fileBrowserURL string
	client         *http.Client
	profiles       *profileStore
	ownerships     *ownershipStore
	onlyOfficeURL  string
}
```

Change `newAPIServer`'s signature and body:

```go
func newAPIServer(statPath, profilePath, ownershipPath, fileBrowserURL, onlyOfficeURL string, client *http.Client) (*apiServer, error) {
	store, err := newProfileStore(profilePath)
	if err != nil {
		return nil, err
	}
	ownerships, err := newOwnershipStore(ownershipPath)
	if err != nil {
		return nil, err
	}
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	return &apiServer{
		statPath:       statPath,
		fileBrowserURL: strings.TrimRight(fileBrowserURL, "/"),
		client:         client,
		profiles:       store,
		ownerships:     ownerships,
		onlyOfficeURL:  onlyOfficeURL,
	}, nil
}
```

Register the route in `handler()`:

```go
func (s *apiServer) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/storage", s.handleStorage)
	mux.HandleFunc("/config", s.handleConfig)
	mux.HandleFunc("/profile", s.handleMyProfile)
	mux.HandleFunc("/profiles", s.handleProfiles)
	mux.HandleFunc("/profiles/", s.handleProfileByUID)
	mux.HandleFunc("/ownership", s.handleOwnership)
	mux.HandleFunc("/ownership/lookup", s.handleOwnershipLookup)
	mux.HandleFunc("/ownership/move", s.handleOwnershipMove)
	return mux
}
```

Add the handler (near `handleStorage`):

```go
func (s *apiServer) handleConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	writeJSON(w, http.StatusOK, configResponse{OnlyOfficeURL: s.onlyOfficeURL})
}
```

Update `main()`:

```go
func main() {
	statPath := envOrDefault("NASAPI_STAT_PATH", "/srv/share")
	dataPath := envOrDefault("NASAPI_DATA_PATH", "/var/lib/vaulta")
	fileBrowserURL := envOrDefault("NASAPI_FILEBROWSER_URL", "http://127.0.0.1:30334")
	onlyOfficeURL := envOrDefault("NASAPI_ONLYOFFICE_URL", "")
	port := envOrDefault("NASAPI_PORT", "9190")

	server, err := newAPIServer(statPath, filepath.Join(dataPath, "profiles.json"), filepath.Join(dataPath, "ownership.json"), fileBrowserURL, onlyOfficeURL, nil)
	if err != nil {
		log.Fatal(err)
	}

	addr := "127.0.0.1:" + port
	log.Printf("nasapi listening on %s, stat path %s, profile path %s", addr, statPath, dataPath)
	log.Fatal(http.ListenAndServe(addr, server.handler()))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `docker run --rm -v $(pwd)/docker/nasapi:/app -w /app golang:1.22 go test ./... -v`
Expected: all tests pass, including the three new ones and every pre-existing one (`TestProfile*`, `TestOwnership*`, `TestNonAdmin*`).

- [ ] **Step 5: Commit**

```bash
git add docker/nasapi/main.go docker/nasapi/main_test.go
git commit -m "$(cat <<'EOF'
nasapi: add GET /config so the frontend can find OnlyOffice

Avoids hardcoding the OnlyOffice Document Server's URL into the
frontend bundle; sourced from NASAPI_ONLYOFFICE_URL, empty by default
so the document viewer feature stays off until explicitly configured.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LANe6ydnuViSsJ7jtX1TzZ
EOF
)"
```

---

## Task 6: `resources.js` — `downloadUrl` gains an `inline` option

**Files:**
- Modify: `frontend/src/api/resources.js`
- Test: `frontend/tests/api/resources.test.js`

**Interfaces:**
- Produces: `downloadUrl(path, { inline } = {})` — second argument optional, defaults preserve the exact current behavior for every existing call site (`ContextMenu.vue`'s Download link, `Lightbox.vue`'s `src` computed for video/other).

- [ ] **Step 1: Write the failing test**

Add to `frontend/tests/api/resources.test.js`, right after the existing `downloadUrl builds a plain GET link` test:

```javascript
it('downloadUrl accepts an inline option for browser-native preview', () => {
  expect(downloadUrl('/Photos/a.jpg', { inline: true })).toBe(
    '/api/resources/download?file=%2FPhotos%2Fa.jpg&source=share&inline=true'
  )
})

it('downloadUrl omits inline entirely when not requested', () => {
  expect(downloadUrl('/Photos/a.jpg', {})).toBe('/api/resources/download?file=%2FPhotos%2Fa.jpg&source=share')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/api/resources.test.js`
Expected: FAIL — `downloadUrl('/Photos/a.jpg', { inline: true })` returns the same URL as the no-options call today (the `inline` param is silently ignored), not one containing `inline=true`.

- [ ] **Step 3: Implement the minimal code**

In `frontend/src/api/resources.js`, replace:

```javascript
export function downloadUrl(path) {
  const params = new URLSearchParams({ file: path, source: SOURCE })
  return `/api/resources/download?${params.toString()}`
}
```

with:

```javascript
export function downloadUrl(path, { inline = false } = {}) {
  const params = new URLSearchParams({ file: path, source: SOURCE })
  if (inline) params.set('inline', 'true')
  return `/api/resources/download?${params.toString()}`
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run tests/api/resources.test.js`
Expected: all tests in the file pass, including the two new ones and the pre-existing `downloadUrl builds a plain GET link` one (still exercises the zero-arg call, unaffected by the default).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/resources.js frontend/tests/api/resources.test.js
git commit -m "$(cat <<'EOF'
resources.js: downloadUrl accepts an inline option

Backward compatible — every existing call site is unaffected. Used
next to fix the PDF preview's disposition bug in Lightbox.vue.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LANe6ydnuViSsJ7jtX1TzZ
EOF
)"
```

---

## Task 7: `officeDocumentType.js` — pure extension → OnlyOffice category map

**Files:**
- Create: `frontend/src/components/officeDocumentType.js`
- Test: `frontend/tests/components/officeDocumentType.test.js`

**Interfaces:**
- Produces: `documentTypeFor(name)` → `'word' | 'cell' | 'slide' | 'pdf' | undefined`, given a filename (uses its extension, case-insensitive).
- Consumed by: Task 11 (`Lightbox.vue`).

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/components/officeDocumentType.test.js`:

```javascript
import { describe, it, expect } from 'vitest'
import { documentTypeFor } from '../../src/components/officeDocumentType.js'

describe('documentTypeFor', () => {
  it('maps word-processing extensions to word', () => {
    expect(documentTypeFor('report.docx')).toBe('word')
    expect(documentTypeFor('notes.txt')).toBe('word')
    expect(documentTypeFor('readme.md')).toBe('word')
  })

  it('maps spreadsheet extensions to cell', () => {
    expect(documentTypeFor('budget.xlsx')).toBe('cell')
    expect(documentTypeFor('export.csv')).toBe('cell')
  })

  it('maps presentation extensions to slide', () => {
    expect(documentTypeFor('deck.pptx')).toBe('slide')
  })

  it('maps pdf-family extensions to pdf', () => {
    expect(documentTypeFor('scan.pdf')).toBe('pdf')
  })

  it('is case-insensitive on the extension', () => {
    expect(documentTypeFor('REPORT.DOCX')).toBe('word')
  })

  it('returns undefined for an extension with no known category', () => {
    expect(documentTypeFor('archive.zip')).toBeUndefined()
  })

  it('returns undefined for a name with no extension', () => {
    expect(documentTypeFor('README')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/components/officeDocumentType.test.js`
Expected: FAIL — `Failed to resolve import "../../src/components/officeDocumentType.js"`.

- [ ] **Step 3: Implement the minimal code**

Create `frontend/src/components/officeDocumentType.js`:

```javascript
// Mirrors FileBrowser Quantum's own extension → category grouping
// (backend/pkg/indexing/iteminfo/conditions.go, onlyOfficeSupported map),
// re-expressed as OnlyOffice's own documentType taxonomy. Supplied
// defensively alongside /api/office/config's response — that response
// never includes documentType, and this app doesn't rely on the
// Document Server auto-inferring it from fileType.
const WORD_EXTENSIONS = new Set([
  'doc', 'docm', 'docx', 'dot', 'dotm', 'dotx', 'epub', 'fb2', 'fodt', 'htm', 'html',
  'mht', 'mhtml', 'odt', 'ott', 'rtf', 'stw', 'sxw', 'txt', 'wps', 'wpt', 'xml',
  'hwp', 'hwpx', 'md', 'pages', 'docxf', 'oform',
])
const CELL_EXTENSIONS = new Set([
  'csv', 'et', 'ett', 'fods', 'ods', 'ots', 'sxc', 'xls', 'xlsb', 'xlsm', 'xlsx',
  'xlt', 'xltm', 'xltx', 'numbers',
])
const SLIDE_EXTENSIONS = new Set([
  'dps', 'dpt', 'fodp', 'odp', 'otp', 'pot', 'potm', 'potx', 'pps', 'ppsm', 'ppsx',
  'ppt', 'pptm', 'pptx', 'sxi', 'key', 'odg',
])
const PDF_EXTENSIONS = new Set(['pdf', 'djvu', 'oxps', 'xps'])

export function documentTypeFor(name) {
  const dot = name.lastIndexOf('.')
  if (dot === -1) return undefined
  const ext = name.slice(dot + 1).toLowerCase()
  if (WORD_EXTENSIONS.has(ext)) return 'word'
  if (CELL_EXTENSIONS.has(ext)) return 'cell'
  if (SLIDE_EXTENSIONS.has(ext)) return 'slide'
  if (PDF_EXTENSIONS.has(ext)) return 'pdf'
  return undefined
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run tests/components/officeDocumentType.test.js`
Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/officeDocumentType.js frontend/tests/components/officeDocumentType.test.js
git commit -m "$(cat <<'EOF'
Add documentTypeFor: extension to OnlyOffice category map

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LANe6ydnuViSsJ7jtX1TzZ
EOF
)"
```

---

## Task 8: `api/config.js` — cached `getOnlyOfficeUrl()`

**Files:**
- Create: `frontend/src/api/config.js`
- Test: `frontend/tests/api/config.test.js`

**Interfaces:**
- Produces: `async getOnlyOfficeUrl()` → the configured URL string, or `''` if unset/unreachable (never throws); `__resetOnlyOfficeUrlCache()` (test-only).
- Consumed by: Task 11 (`Lightbox.vue`).

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/api/config.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getOnlyOfficeUrl, __resetOnlyOfficeUrlCache } from '../../src/api/config.js'

describe('getOnlyOfficeUrl', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
    __resetOnlyOfficeUrlCache()
  })

  it('returns the configured URL from /nasapi/config', async () => {
    global.fetch.mockResolvedValue({
      ok: true, status: 200, json: () => Promise.resolve({ onlyOfficeUrl: 'https://office.codex074.com' }),
    })
    await expect(getOnlyOfficeUrl()).resolves.toBe('https://office.codex074.com')
    expect(global.fetch.mock.calls[0][0]).toBe('/nasapi/config')
  })

  it('caches the result — a second call does not fetch again', async () => {
    global.fetch.mockResolvedValue({
      ok: true, status: 200, json: () => Promise.resolve({ onlyOfficeUrl: 'https://office.codex074.com' }),
    })
    await getOnlyOfficeUrl()
    await getOnlyOfficeUrl()
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('degrades to an empty string when the request fails', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 500 })
    await expect(getOnlyOfficeUrl()).resolves.toBe('')
  })

  it('degrades to an empty string when fetch itself throws', async () => {
    global.fetch.mockRejectedValue(new Error('network down'))
    await expect(getOnlyOfficeUrl()).resolves.toBe('')
  })

  it('__resetOnlyOfficeUrlCache allows a fresh fetch afterward', async () => {
    global.fetch.mockResolvedValue({
      ok: true, status: 200, json: () => Promise.resolve({ onlyOfficeUrl: 'https://office.codex074.com' }),
    })
    await getOnlyOfficeUrl()
    __resetOnlyOfficeUrlCache()
    await getOnlyOfficeUrl()
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/api/config.test.js`
Expected: FAIL — `Failed to resolve import "../../src/api/config.js"`.

- [ ] **Step 3: Implement the minimal code**

Create `frontend/src/api/config.js`:

```javascript
import { authorizedFetch } from './http.js'

// This is optional, non-sensitive static config (which document viewer, if
// any, is configured) — a failed or missing fetch degrades to "feature not
// configured" rather than surfacing an error, same as ownership lookups.
let cachedUrl = null

export async function getOnlyOfficeUrl() {
  if (cachedUrl !== null) return cachedUrl
  try {
    const response = await authorizedFetch('/nasapi/config')
    if (!response.ok) {
      cachedUrl = ''
      return cachedUrl
    }
    const payload = await response.json()
    cachedUrl = payload.onlyOfficeUrl || ''
  } catch {
    cachedUrl = ''
  }
  return cachedUrl
}

export function __resetOnlyOfficeUrlCache() {
  cachedUrl = null
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run tests/api/config.test.js`
Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/config.js frontend/tests/api/config.test.js
git commit -m "$(cat <<'EOF'
Add cached getOnlyOfficeUrl() reading nasapi's new /config endpoint

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LANe6ydnuViSsJ7jtX1TzZ
EOF
)"
```

---

## Task 9: `api/office.js` — `getOfficeConfig(path)`

**Files:**
- Create: `frontend/src/api/office.js`
- Test: `frontend/tests/api/office.test.js`

**Interfaces:**
- Produces: `async getOfficeConfig(path)` → the parsed JSON from `GET /api/office/config?source=share&path=<path>`, or throws (via `apiError`) on a non-OK response.
- Consumed by: Task 11 (`Lightbox.vue`).

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/api/office.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getOfficeConfig } from '../../src/api/office.js'

describe('getOfficeConfig', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  it('requests the document config with source=share and the given path', async () => {
    const config = { document: { fileType: 'docx', key: 'abc', title: 'a.docx', url: 'https://...' } }
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(config) })
    await expect(getOfficeConfig('/Documents/a.docx')).resolves.toEqual(config)
    expect(global.fetch.mock.calls[0][0]).toBe('/api/office/config?source=share&path=%2FDocuments%2Fa.docx')
  })

  it('throws with the server message when the request fails', async () => {
    global.fetch.mockResolvedValue({
      ok: false, status: 500, statusText: 'Internal Server Error',
      clone() { return this },
      json: () => Promise.resolve({ message: 'only-office integration must be configured in settings' }),
    })
    await expect(getOfficeConfig('/a.docx')).rejects.toThrow('only-office integration must be configured in settings')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/api/office.test.js`
Expected: FAIL — `Failed to resolve import "../../src/api/office.js"`.

- [ ] **Step 3: Implement the minimal code**

Create `frontend/src/api/office.js`:

```javascript
import { authorizedFetch, apiError } from './http.js'

const SOURCE = 'share'

export async function getOfficeConfig(path) {
  const params = new URLSearchParams({ source: SOURCE, path })
  const response = await authorizedFetch(`/api/office/config?${params.toString()}`)
  if (!response.ok) throw await apiError(response)
  return response.json()
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run tests/api/office.test.js`
Expected: both tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/office.js frontend/tests/api/office.test.js
git commit -m "$(cat <<'EOF'
Add getOfficeConfig: thin wrapper around GET /api/office/config

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LANe6ydnuViSsJ7jtX1TzZ
EOF
)"
```

---

## Task 10: Add the `@onlyoffice/document-editor-vue` dependency

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`

**Interfaces:** Produces: the `DocumentEditor` component, importable as `import { DocumentEditor } from '@onlyoffice/document-editor-vue'`. Consumed by: Task 11.

- [ ] **Step 1: Install it**

Run: `cd frontend && npm install @onlyoffice/document-editor-vue@^1.4.0`
Expected: `package.json`'s `dependencies` gains `"@onlyoffice/document-editor-vue": "^1.4.0"`, `package-lock.json` is updated, no install errors.

- [ ] **Step 2: Confirm the project still builds**

Run: `cd frontend && npm run build`
Expected: build succeeds (this dependency isn't used anywhere yet, so this just confirms the install didn't break anything).

- [ ] **Step 3: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "$(cat <<'EOF'
Add @onlyoffice/document-editor-vue dependency

FileBrowser Quantum's own frontend uses this exact package against
this exact backend (confirmed by reading their source) — the
maintainer-sanctioned integration path, not a generic example.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LANe6ydnuViSsJ7jtX1TzZ
EOF
)"
```

---

## Task 11: Wire `Lightbox.vue` — fix PDF, add the office viewer

**Files:**
- Modify: `frontend/src/components/Lightbox.vue`

**Interfaces:**
- Consumes: `downloadUrl(path, { inline })` (Task 6), `documentTypeFor(name)` (Task 7), `getOnlyOfficeUrl()` (Task 8), `getOfficeConfig(path)` (Task 9), `DocumentEditor` (Task 10).
- No new automated test for this file — matches this repo's established convention of testing the pure/API modules a component wires together rather than mounting the SFC itself (see `lightboxSrc.js`/`lightboxSrc.test.js` vs. the untested image-swap `watch` already in this same file). Verified manually in Task 13.

- [ ] **Step 1: Replace the script block**

Replace the entire `<script setup>` block in `frontend/src/components/Lightbox.vue` with:

```vue
<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Plyr from 'plyr'
import 'plyr/dist/plyr.css'
import { DocumentEditor } from '@onlyoffice/document-editor-vue'
import { downloadUrl, previewUrl } from '../api/resources.js'
import { getOnlyOfficeUrl } from '../api/config.js'
import { getOfficeConfig } from '../api/office.js'
import { documentTypeFor } from './officeDocumentType.js'
import { pickImageSource } from './lightboxSrc.js'

const props = defineProps({ entry: { type: Object, required: true } })
defineEmits(['close'])

const videoEl = ref(null)
let player = null
onMounted(() => {
  if (videoEl.value) {
    player = new Plyr(videoEl.value, { speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] } })
  }
})
onBeforeUnmount(() => {
  player?.destroy()
})

const onlyOfficeAvailable = ref(false)
onMounted(async () => {
  onlyOfficeAvailable.value = Boolean(await getOnlyOfficeUrl())
})

const kind = computed(() => {
  if (props.entry.type.startsWith('image/')) return 'image'
  if (props.entry.type.startsWith('video/')) return 'video'
  if (props.entry.type === 'application/pdf') return 'pdf'
  if (onlyOfficeAvailable.value) return 'office'
  return 'other'
})
const src = computed(() => downloadUrl(props.entry.path))
const pdfSrc = computed(() => downloadUrl(props.entry.path, { inline: true }))
const imagePreviewFailed = ref(false)
const originalLoaded = ref(false)
const imageSrc = computed(() =>
  pickImageSource({
    hasPreview: props.entry.hasPreview,
    previewFailed: imagePreviewFailed.value,
    originalLoaded: originalLoaded.value,
  }) === 'preview'
    ? previewUrl(props.entry.path, 'large')
    : src.value
)

// Always ends up showing the true original — the preview above is only an
// instant-loading placeholder while the full-quality file downloads in the background.
watch(
  () => props.entry.path,
  (path) => {
    imagePreviewFailed.value = false
    originalLoaded.value = false
    if (!props.entry.type.startsWith('image/')) return
    const original = new Image()
    original.onload = () => {
      if (props.entry.path === path) originalLoaded.value = true
    }
    original.src = downloadUrl(path)
  },
  { immediate: true }
)

const officeUrl = ref('')
const officeConfig = ref(null)
const officeFailed = ref(false)

async function loadOffice(path, name) {
  officeFailed.value = false
  officeConfig.value = null
  try {
    const baseUrl = await getOnlyOfficeUrl()
    if (!baseUrl) throw new Error('office viewer not configured')
    const config = await getOfficeConfig(path)
    const documentType = documentTypeFor(name)
    officeUrl.value = baseUrl
    officeConfig.value = {
      ...config,
      documentType,
      type: /Mobi|Android|iPhone/i.test(navigator.userAgent) ? 'mobile' : 'desktop',
    }
  } catch {
    officeFailed.value = true
  }
}

watch(
  () => [kind.value, props.entry.path],
  ([currentKind, path]) => {
    if (currentKind === 'office') loadOffice(path, props.entry.name)
  },
  { immediate: true }
)

function onOfficeLoadError() {
  officeFailed.value = true
}
</script>
```

- [ ] **Step 2: Replace the template block**

Replace the `<template>` block with:

```vue
<template>
  <div class="backdrop" @click.self="$emit('close')">
    <div class="frame">
      <button class="close" @click="$emit('close')">✕</button>
      <img v-if="kind === 'image'" :src="imageSrc" :alt="entry.name" @error="imagePreviewFailed = true" />
      <video v-else-if="kind === 'video'" ref="videoEl" :src="src" controls autoplay playsinline />
      <iframe v-else-if="kind === 'pdf'" :src="pdfSrc" title="PDF preview" />
      <DocumentEditor
        v-else-if="kind === 'office' && officeConfig && !officeFailed"
        id="vaulta-office-editor"
        :document-server-url="officeUrl"
        :config="officeConfig"
        :on-load-component-error="onOfficeLoadError"
      />
      <div v-else class="fallback">
        <p>{{ entry.name }}</p>
        <a :href="src" target="_blank">Download</a>
      </div>
    </div>
  </div>
</template>
```

(Note: the `v-else` fallback now also correctly covers `kind === 'office'` while `officeConfig` is still loading or `officeFailed` is `true` — showing the download link during the brief async gap is an acceptable, honest loading state, not a bug: it never claims a broken editor is working.)

- [ ] **Step 3: Add a style rule for the new editor frame**

Add to the `<style scoped>` block, next to the existing `.frame iframe` rule:

```css
.frame :deep(#vaulta-office-editor) { width: 80vw; height: 85vh; }
```

- [ ] **Step 4: Confirm the project builds**

Run: `cd frontend && npm run build`
Expected: build succeeds with no errors.

- [ ] **Step 5: Run the full existing test suite**

Run: `cd frontend && npx vitest run`
Expected: all tests still pass (this file has no dedicated tests, but this confirms nothing else broke — e.g. `lightboxSrc.test.js` still exercises `pickImageSource` unchanged).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Lightbox.vue
git commit -m "$(cat <<'EOF'
Lightbox: open PDF/docx/xlsx/txt/md via OnlyOffice, view-only

Fixes the PDF preview's missing inline=true (was requesting an
attachment disposition). Everything that isn't image/video/pdf now
tries the OnlyOffice document editor when configured, falling back
silently to the existing download-link view on any failure — a
missing or unreachable OnlyOffice server never blocks viewing or
downloading the file.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LANe6ydnuViSsJ7jtX1TzZ
EOF
)"
```

---

## Task 12: Deploy `nasapi` + `nas-webui` frontend

**Files:** None (deploy only — Tasks 5-11 already changed everything needed).

**Interfaces:** None.

- [ ] **Step 1: Run both test suites one final time from a clean checkout state**

Run: `cd frontend && npx vitest run` and `docker run --rm -v $(pwd)/../docker/nasapi:/app -w /app golang:1.22 go test ./...`
Expected: both green.

- [ ] **Step 2: Set `NASAPI_ONLYOFFICE_URL` in nas-webui's own compose**

Read the current rendered compose: `ssh root@100.71.13.117 "qm guest exec 105 -- cat /mnt/.ix-apps/app_configs/nas-webui/versions/1.0.0/templates/rendered/docker-compose.yaml"`. Add an `environment` entry to the `nas-webui` service: `NASAPI_ONLYOFFICE_URL=https://office.codex074.com`, preserving every existing line (image, network_mode, restart, volumes). Transfer the updated file back the same way Task 4 Step 3 did, overwriting the rendered compose file in place.

- [ ] **Step 3: Build, transfer, and deploy the image**

Follow the established deploy pipeline exactly (see Global Constraints): build `--platform linux/amd64` locally, `docker save | gzip`, scp to pve2, temporary `python3 -m http.server` on `192.168.1.16`, `qm guest exec 105 -- curl` to pull it into VM 105, `docker load`, then `docker compose -f /mnt/.ix-apps/app_configs/nas-webui/versions/1.0.0/templates/rendered/docker-compose.yaml -p ix-nas-webui up -d --force-recreate`.

- [ ] **Step 4: Clean up temp files**

Remove the saved image tarball and any transfer artifacts from the Mac, pve2, and VM 105.

- [ ] **Step 5: Verify the deploy**

Run: `ssh root@100.71.13.117 "qm guest exec 105 -- docker ps --filter name=nas-webui --format '{{.Names}}\t{{.Status}}'"`
Expected: `Up ...`.

Run: `curl -sS https://nas.codex074.com/nasapi/config`
Expected: `{"onlyOfficeUrl":"https://office.codex074.com"}`.

---

## Task 13: End-to-end manual verification

**Files:** None.

**Interfaces:** None.

- [ ] **Step 1: Open a PDF**

In a browser, log into `https://nas.codex074.com`, open any `.pdf` file. Expected: renders inline via the browser's native PDF viewer (not a download prompt) — confirms the `inline=true` fix.

- [ ] **Step 2: Open a .docx**

Open a `.docx` file. Expected: the OnlyOffice editor loads inside the Lightbox, shows the document content, and has no visible Save/Edit controls (view-only mode confirmed).

- [ ] **Step 3: Open a .xlsx, .txt, and .md**

Same as Step 2 for each. Expected: all three render via OnlyOffice.

- [ ] **Step 4: Confirm graceful degradation**

Stop the OnlyOffice container: `ssh root@100.71.13.117 "qm guest exec 105 -- docker stop $(qm guest exec 105 -- docker ps --filter name=onlyoffice -q)"`. Open a `.docx` again. Expected: falls back to the plain "Download" link view, no broken UI, no console-breaking error. Restart it afterward: `docker start <container>`.

- [ ] **Step 5: Confirm nothing else regressed**

Open an image and a video from the grid. Expected: both still work exactly as before (image preview/original swap, Plyr video controls).

- [ ] **Step 6: Report back to the user**

Summarize what was verified and hand back control — this plan is complete once Steps 1-5 all pass.
