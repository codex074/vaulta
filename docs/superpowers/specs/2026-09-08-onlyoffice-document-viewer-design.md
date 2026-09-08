# Document Viewer (OnlyOffice) — Design Spec

## Context

The user asked to open common document types directly in the app: PDF, Excel (.xlsx), Word (.docx), .txt, .md. `Lightbox.vue` currently only understands three `kind`s derived from MIME type — `image`, `video`, and a bare `pdf` iframe pointed at `downloadUrl()` — everything else falls into `other` (a plain download link, no preview).

Two approaches were evaluated:
- **Client-side rendering** (marked+DOMPurify for txt/md, `docx-preview` and `xlsx`/SheetJS for Office formats, native `<iframe>` for PDF) — zero new infrastructure, but three different rendering paths to maintain, and no real fidelity for complex Office documents.
- **OnlyOffice Document Server** — FileBrowser Quantum already has first-class integration for this (`GET /api/office/config`, `POST/GET /api/office/callback`, wired in `httpRouter.go`), but it requires a separately-run OnlyOffice Document Server container; the config endpoint hard-fails (`500`) if `Integrations.OnlyOffice.Url`/`Secret` aren't set — there's no partial/free path through it.

The user explicitly chose the OnlyOffice route and approved adding a new container. Checking FileBrowser Quantum's own extension list (`backend/pkg/indexing/iteminfo/conditions.go`, `onlyOfficeSupported` map) confirmed all five requested types — `.pdf`, `.docx`, `.xlsx`, `.txt`, `.md` — are natively supported by OnlyOffice itself, so one integration covers the whole request; no client-side rendering libraries are needed.

### Infra recon (done before designing, not assumed)

- TrueNAS VM 105 (`qm config 105`): 8192 MB RAM, 4 cores. Live `free -h` inside the VM showed only **~1.7 GB actually available** (ZFS ARC dominates the rest) — not enough headroom for OnlyOffice Document Server (recommends ≥2 GB). Proxmox host `pve2` has 32 GB total / ~19 GB available and runs no other VM, so **bumping VM 105 to 16 GB is safe and was approved by the user** (requires one VM restart).
- `ss -tlnp` inside VM 105: ports `8090` (nas-webui nginx), `30334` (filebrowser-quantum, published `0.0.0.0`), `9190` (nasapi, loopback-only), `80`/`443` already bound to TrueNAS's own UI nginx. **OnlyOffice's bundled nginx listens on 80 internally and is not configurable** — it must run on a normal Docker bridge network with an explicit published port (`8095:80`), not `network_mode: host` like the other three containers, or it would collide with TrueNAS's own UI.
- `ix-nas-cloudflared-cloudflared-1` runs `network_mode: host` with no local `config.yml` (ingress rules are managed remotely in the user's Cloudflare Zero Trust dashboard, confirmed by an empty mounts list and a missing local config file) — reachable from cloudflared as `http://127.0.0.1:8095` once OnlyOffice's port is published, so exposing it publicly is a **dashboard-only change on the user's end** (add a Public Hostname), no container/network changes needed for the tunnel itself.
- `ix-filebrowser-quantum-filebrowser-quantum-1` runs on its own bridge network (`ix-filebrowser-quantum_default`), **not** host — it reaches other host-published ports via the VM's real LAN IP (`192.168.1.22`), not `127.0.0.1`.
- FileBrowser Quantum's config file was located and read: `/mnt/.ix-apps/app_mounts/filebrowser-quantum/config/config.yaml` (bind-mounted to `/config` in its container), currently just `server:` block. It is **read at startup only** — editing it requires restarting that container. Confirmed the two relevant Go structs (`backend/pkg/settings/structs.go`): `Http.InternalUrl`/`ExternalUrl` (top-level `http:` key) and `Integrations.OnlyOffice` (top-level `integrations.office:` key, fields `url`/`internalUrl`/`secret`/`viewOnly`, camelCase JSON tags matching the file's existing camelCase convention).
- `Integrations.OnlyOffice.ViewOnly = true` forces `editorConfig.mode` and `document.permissions.edit` to `"view"` regardless of per-file modify permission (`onlyOffice.go` line ~232/249) — this is a single global switch, no per-file tuning needed for the user's "view-only" choice.

## Architecture

```
Browser ──(loads editor UI + fetches file)──> OnlyOffice Document Server (office.codex074.com, via existing Cloudflare Tunnel)
   │                                                        │
   │  GET /api/office/config (via nas.codex074.com)         │ GET /api/resources/view (fetch file)
   │  GET /nasapi/config (get office base URL)              │ POST /api/office/callback (unused in view-only mode)
   ▼                                                        ▼
nas-webui nginx ──/api/──> FileBrowser Quantum :30334 <─────┘ (reached by OnlyOffice via VM LAN IP, InternalUrl)
   │
   └──/nasapi/──> nasapi :9190
```

Only one new container is added (OnlyOffice Document Server). Nothing changes about how images/video/PDF already work today except one small bug fix (see below).

## Component 1: OnlyOffice Document Server container

New ix Custom App on TrueNAS VM 105, docker-compose (own stack, not merged into `nas-webui`'s):

- Image: `onlyoffice/documentserver` (official, Community Edition — free).
- **Bridge network** (default), publish `8095:80` — deliberately *not* `network_mode: host` (see recon above: its internal nginx is hardcoded to port 80 and would collide with TrueNAS's own UI).
- Env: `JWT_ENABLED=true`, `JWT_SECRET=<generated once, shared with FileBrowser's config>`.
- Persistent volumes (per OnlyOffice's own documented list, mounted under `/mnt/.ix-apps/app_mounts/onlyoffice/...` matching this deployment's existing convention): `/var/log/onlyoffice`, `/var/www/onlyoffice/Data`, `/var/lib/onlyoffice`, `/var/lib/postgresql`, `/var/lib/rabbitmq` — survives `--force-recreate` the same way `nas-webui`'s and `filebrowser-quantum`'s config/data mounts already do.
- No resource limit set at the Docker level initially (the VM RAM bump already gives headroom); revisit if it turns out to need capping.

## Component 2: FileBrowser Quantum config change

Edit `/mnt/.ix-apps/app_mounts/filebrowser-quantum/config/config.yaml` directly (existing file, not part of this repo):

```yaml
server:
  port: 30334
  database: /config/filebrowser.db
  cacheDir: /.cache
  sources:
    - path: /srv/share
      config:
        defaultEnabled: true
http:
  internalUrl: http://127.0.0.1:30334   # how OnlyOffice reaches FileBrowser back, bypassing the tunnel
integrations:
  office:
    url: https://office.codex074.com     # how the browser + FileBrowser reach OnlyOffice
    internalUrl: http://192.168.1.22:8095 # faster path for FileBrowser -> OnlyOffice (bridge network, needs the VM's real IP, not 127.0.0.1)
    secret: <same JWT_SECRET as the OnlyOffice container>
    viewOnly: true
```

Requires restarting the `filebrowser-quantum` container (config is read at startup only) — done once during rollout, not part of the normal `nas-webui` deploy pipeline.

## Component 3: `nasapi` — new `/config` endpoint

The frontend needs to know where to load OnlyOffice's embedding script (`<url>/web-apps/apps/api/documents/api.js`) from, but `/api/office/config`'s response doesn't include the server's own base URL (only the per-document config). Rather than hardcode `office.codex074.com` into the frontend bundle, `nasapi` gains one more tiny read-only endpoint, following its existing `envOrDefault` pattern (`docker/nasapi/main.go`):

- `GET /nasapi/config` → `{"onlyOfficeUrl": "https://office.codex074.com"}`, sourced from a new `NASAPI_ONLYOFFICE_URL` env var (default `""`).
- An empty value means "not configured" — the frontend uses this to skip attempting the office viewer entirely (see below), so the feature degrades cleanly if the env var is ever unset or OnlyOffice is torn down later.
- No auth required (same as `/storage` today) — it's non-sensitive static config, not per-user data.

## Component 4: Frontend — `Lightbox.vue`

- Fix the existing PDF path first: `downloadUrl()` gains an optional third `{inline}` param; the PDF iframe (`kind === 'pdf'`) now requests `downloadUrl(path, {inline: true})` instead of the default `attachment` disposition. Native PDF rendering keeps working exactly as before for the common case, just without the disposition bug.
- `kind` computed gains one more branch: anything that isn't `image`/`video`/`pdf` is tentatively `office` **if** `GET /nasapi/config` returned a non-empty `onlyOfficeUrl` (fetched once, cached at app level — a tiny new `stores/onlyoffice.js` Pinia store, or a plain module-level cache; not per-Lightbox-instance).
- Opening an `office`-kind entry:
  1. Load the OnlyOffice embedding script once (`<script src="<onlyOfficeUrl>/web-apps/apps/api/documents/api.js">`, injected into `document.head` on first use, cached so repeat opens don't re-inject).
  2. `GET /api/office/config?source=share&path=<path>` (existing FileBrowser Quantum endpoint, not something this repo builds).
  3. On success: render a container div, `new DocsAPI.DocEditor(elementId, config)`.
  4. On any failure (script load, config fetch — extension not supported, OnlyOffice unreachable, etc.): fall back to the existing `other` view (plain download link) rather than showing a broken/blank editor. This is the same graceful-degradation philosophy already used for ownership metadata (§ prior session) — a missing/misbehaving optional service never blocks the core action (viewing/downloading the file).
- `onBeforeUnmount`: destroy the DocEditor instance if one was created (`editor.destroyEditor()`), mirroring the existing Plyr `destroy()` cleanup for video.

No change is needed to `nas-webui`'s own `nginx.conf`: `/api/office/config` and `/api/office/callback` are already covered by the existing `location /api/ { proxy_pass http://127.0.0.1:30334/api/; }` block, same as every other FileBrowser Quantum endpoint this app already calls.

## Data Flow Summary (new/changed calls only)

| Action | Call |
|---|---|
| Determine if office viewer is available | `GET /nasapi/config` (new, cached) |
| Open a non-image/video/pdf file | `GET /api/office/config?source=share&path=<path>` (existing FileBrowser Quantum endpoint) |
| OnlyOffice fetching the file | `GET /api/resources/view` (server-to-server, OnlyOffice → FileBrowser, not initiated by this frontend) |
| PDF preview (fixed) | `GET /api/resources/download?file=<path>&source=share&inline=true` |

## Error Handling

- `/nasapi/config` unreachable or returns empty `onlyOfficeUrl` → office branch never activates; existing `other` (download link) behavior is unchanged for every file type that isn't image/video/pdf. No error toast — this is a normal "feature not configured" state, not a failure.
- `/api/office/config` fails for a specific file (e.g. FileBrowser Quantum's own extension check rejects it, or the OnlyOffice container is down) → same fallback to `other`, silently (per-file, not app-wide) — the user can still download the file.
- OnlyOffice script fails to load (network blip, `office.codex074.com` DNS/tunnel issue) → same fallback.
- View-only mode means there is no save/callback path to worry about failing — `POST /api/office/callback` is never exercised by this app's configuration.

## Rollout Order

1. Bump VM 105 RAM 8 GB → 16 GB (Proxmox `qm set 105 --memory 16384`, requires a VM restart — brief downtime for the whole NAS stack, done at a time the user is fine with).
2. Deploy the new OnlyOffice Document Server ix Custom App (own docker-compose, generate and record the `JWT_SECRET`).
3. User adds the `office.codex074.com` Public Hostname in their Cloudflare Zero Trust dashboard (service `http://localhost:8095`) — outside this repo/session's reach.
4. Edit FileBrowser Quantum's `config.yaml` with the `http.internalUrl` and `integrations.office` blocks, restart that container.
5. Implement and deploy the `nasapi` `/config` endpoint and `Lightbox.vue`/`resources.js` frontend changes (normal `nas-webui` deploy pipeline, TDD as usual).
6. Verify end-to-end (see Testing below) before considering the feature done.

## Testing / Verification

1. `nasapi`: `GET /config` returns the configured URL when `NASAPI_ONLYOFFICE_URL` is set, and `{"onlyOfficeUrl": ""}` when unset — Go test following the existing `main_test.go` pattern.
2. `resources.js`: `downloadUrl(path, {inline: true})` produces a URL containing `inline=true`; `downloadUrl(path)` (no options) is unchanged from today — Vitest, existing file.
3. Manual, against the real deployment: open a `.pdf`, `.docx`, `.xlsx`, `.txt`, and `.md` file from the grid — each renders through OnlyOffice with no edit toolbar available (view-only confirmed), and closing the Lightbox doesn't leave the editor iframe/process resident.
4. Manual: temporarily stop the OnlyOffice container, open a `.docx` — confirm the app falls back to the plain download link instead of an error state or blank screen.
5. Manual: confirm the existing PDF preview still renders inline (not a forced download) after the `inline=true` fix, across at least one desktop and one mobile browser.
6. Manual: confirm opening any document does not affect the existing image/video Lightbox flows (regression check on the `kind` computed's new branch ordering).
