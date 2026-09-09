# Vaulta

Vaulta is a self-hosted, Google-Drive-style web UI for a home NAS. It sits in
front of [FileBrowser Quantum](https://github.com/gtsteffaniak/filebrowser)
(FBQ) and adds the things a family or small team expects from a "drive":
a shared area plus a private drive per user, admin-set storage quotas,
starred files, a trash with restore, real image/video/PDF previews, Office
document viewing through OnlyOffice, drag-and-drop uploads and moves, an
installable PWA for iPhone/iPad, and light/dark themes.

FBQ stays the source of truth for accounts, permissions and file storage.
Vaulta never bypasses it: every file operation is an FBQ REST call, so FBQ's
own per-user scopes remain the security boundary.

## Features

- **Shared drive + private drives.** Two FBQ sources: `share` (everyone) and
  `home` (one isolated folder per user).
- **Storage quotas.** Admins set a per-user quota; over-quota writes into a
  private drive are rejected with `413` before they reach FBQ.
- **Drive-style browsing.** Grid and list views, breadcrumbs, search, select
  all, multi-select, drag-and-drop move, folder upload, upload progress with
  per-file or whole-batch cancel.
- **Starred and Trash.** Star anything; deleted files go to a `.trash` folder
  and can be restored or deleted forever. Owner-only delete on the shared drive.
- **Previews and editing.** Image, video (Plyr player) and PDF lightbox
  (PDF tiles show an icon, not a thumbnail: FBQ 1.5.x can crash generating
  PDF thumbnails, see `AGENTS.md`);
  folder covers show a 2x2 collage of the folder's own photos; `txt`/`md`/
  `csv`/`log`/`json`/`html`/`xml` open in a built-in read-only text viewer. With an
  OnlyOffice Document Server configured, `docx`/`xlsx`/`pptx` (and the other
  Word/Cell/Slide formats OnlyOffice knows) open in OnlyOffice and can be
  edited in place; changes save automatically when the document is closed.
- **Accounts.** Display-name profiles keyed by FBQ's immutable user ID, change
  password, and an admin "Manage users" dialog (create/delete users, assign or
  fix private drives, set quotas).
- **Mobile-first.** Installable PWA, bottom tabs on phones, adaptive sidebar
  on iPad/desktop, light and dark themes.

## How it works

One Docker image runs two processes:

```
Browser ──> nginx :8090 ──┬── /            static Vue SPA (PWA)
                          ├── /api/*       ──> FileBrowser Quantum (default 127.0.0.1:30334)
                          ├── /api/resources (POST/PATCH/DELETE only)
                          │                 ──> nasapi :9190 (quota gate) ──> FileBrowser Quantum
                          └── /nasapi/*    ──> nasapi :9190 (storage, profiles, ownership, quotas, config)
```

- **nginx** serves the built SPA and reverse-proxies `/api/*` to FBQ.
- **nasapi** is a small Go sidecar. It reports disk usage for the storage bar,
  stores display-name profiles, file ownership and quotas as JSON files, and
  acts as a reverse-proxy *gate* on writes (`POST`/`PATCH`/`DELETE`) to
  `/api/resources`: a write into a user's `home` drive is checked against
  their quota, then forwarded to FBQ unchanged. Reads (`GET`) never touch
  nasapi, so listing and downloads keep working even if nasapi is down; home
  drive writes return `502` until `entrypoint.sh` respawns it.
- **Isolation is FBQ's job.** Each user has one FBQ scope per source. FBQ
  resolves every path inside that scope and rejects `..` escapes on every
  endpoint. Vaulta only *manages* those scopes through FBQ's users API.

## Requirements

| Component | Notes |
|---|---|
| FileBrowser Quantum **v1.5.5-stable** | The version Vaulta was built and verified against. Reachable from the Vaulta container over HTTP. |
| Docker host | Any Linux host that can run the image. If you build on Apple Silicon for an x86_64 server, build with `--platform linux/amd64`. |
| Two data directories | One for the shared area and one holding per-user private folders. FBQ mounts them read-write; Vaulta mounts them read-only. |
| OnlyOffice Document Server (optional) | Needed only for Office/PDF viewing inside the app. Any reachable instance works. |

## Configure FileBrowser Quantum

FBQ needs two named sources. The `home` source **must** be
`defaultEnabled: false` and `private: true`, and `share` must have
`defaultEnabled: true` written out explicitly. Reason: on every start FBQ
grants scope `/` on every `defaultEnabled` source to every user who lacks
one, which for `home` would hand each user the root of *all* private drives.

```yaml
server:
  port: 30334
  sources:
    - path: /srv/share
      name: share
      config:
        defaultEnabled: true
    - path: /srv/home
      name: home
      config:
        defaultEnabled: false
        private: true
```

FBQ reads this file at startup only, so restart it after editing.

If you also run OnlyOffice, add FBQ's `server.internalUrl` (an address the
OnlyOffice container can reach FBQ on) and the `integrations.office` block
with the same JWT secret as the Document Server:

```yaml
integrations:
  office:
    url: https://office.example.com        # what browsers load
    internalUrl: http://<fbq-host>:8095    # how FBQ reaches the Document Server
    secret: <same JWT secret as the Document Server>
    viewOnly: false                        # true = read-only for everyone
```

With `viewOnly: false`, FBQ decides per file: anyone whose FBQ account has
the `modify` permission (every user Vaulta creates) gets an editable session
for any OnlyOffice-supported format except `pages`/`numbers`/`key`. Vaulta
keeps plain-text formats out of OnlyOffice so only office documents are
editable. Saves travel from the Document Server straight to FBQ's callback
endpoint, bypassing Vaulta's nginx and the quota gate; the storage numbers
catch up on the next usage refresh. Prefer editing `docx`/`xlsx`/`pptx`:
FBQ writes whatever bytes OnlyOffice returns over the original file without
checking the format, so legacy formats like `doc`/`odt` may be rewritten as
OOXML. The exact keys are documented in
`docs/superpowers/specs/2026-09-08-onlyoffice-document-viewer-design.md`.

## Build the image

From the repository root (the Dockerfile copies `frontend/` and
`docker/nasapi/` from there):

```bash
docker build --platform linux/amd64 -f docker/Dockerfile -t vaulta:local .
```

The build compiles the Vue app with Node 20 and the sidecar with Go 1.22
inside Docker; neither toolchain is needed on the host.

## Run

Example `docker-compose.yaml`. Replace the host paths with your own.

```yaml
services:
  vaulta:
    image: vaulta:local
    network_mode: host          # nginx reaches FBQ on 127.0.0.1:30334
    restart: unless-stopped
    environment:
      NASAPI_FILEBROWSER_URL: http://127.0.0.1:30334
      NASAPI_ONLYOFFICE_URL: https://office.example.com   # omit if no OnlyOffice
    volumes:
      - /path/to/share:/srv/share:ro
      - /path/to/home:/srv/home:ro
      - /path/to/vaulta-config:/var/lib/vaulta
```

Then open `http://<host>:8090` and sign in with an FBQ account.

If you cannot use host networking, publish port `8090` instead and point
`NASAPI_FILEBROWSER_URL` at FBQ's address. nginx's `/api/` upstream is fixed
to `127.0.0.1:30334` in `docker/nginx.conf`; edit it to match.

### Environment variables

All are read by `nasapi` (`docker/nasapi/main.go`).

| Variable | Default | Purpose |
|---|---|---|
| `NASAPI_FILEBROWSER_URL` | `http://127.0.0.1:30334` | Where the quota gate forwards `/api/resources` writes. |
| `NASAPI_SHARE_PATH` | `/srv/share` | Mount point of the `share` source inside the container. |
| `NASAPI_HOME_PATH` | `/srv/home` | Mount point of the `home` source. Usage per user is computed by walking `<home>/<username>`. |
| `NASAPI_STAT_PATH` | `/srv/share` | Path that is `statfs()`ed for the sidebar's total/free disk numbers. |
| `NASAPI_DATA_PATH` | `/var/lib/vaulta` | Where `profiles.json`, `ownership.json` and `quotas.json` live. Mount it read-write and persistently. |
| `NASAPI_ONLYOFFICE_URL` | *(empty)* | Public URL of the OnlyOffice Document Server. Empty disables Office viewing. |
| `NASAPI_PORT` | `9190` | Loopback port nasapi listens on. Must match `docker/nginx.conf` if changed. |

### Volumes

| Container path | Mode | Why |
|---|---|---|
| `/srv/share` | `ro` | Disk usage for the storage bar (`statfs`). Required. |
| `/srv/home` | `ro` | Per-user usage walks for quota enforcement. Required. |
| `/var/lib/vaulta` | `rw` | Persistent profiles, ownership records and quotas. Required. |

Vaulta only ever *reads* file contents through these mounts. Writes go
through FBQ, which needs the same directories mounted read-write on its side.

## First run

1. Sign in with your FBQ admin account.
2. Open the account menu, then **Manage users**. Enter your password in the
   admin field (FBQ requires the actor's password for user changes).
3. Click **Enable my drive access** once. This gives the admin a `home` scope
   and unlocks the private-drive UI.
4. For each existing user click **Assign drive** and enter a quota in GiB.
   This creates `/srv/home/<username>` and sets the user's `home` scope to
   it. If a user shows **Fix drive** instead, their home scope currently
   points at `/` (see the FBQ note above); clicking it repairs the scope.
5. New users created from this dialog get a private drive and quota at
   creation time.

Users see **My Drive** (private) and **Shared** in the sidebar. Their storage
bar shows quota usage; an over-quota upload or copy fails with a clear
message and leaves no partial file.

## Install as an app

On iPhone/iPad open the site in Safari, tap Share, then **Add to Home
Screen**. On desktop Chrome use the install icon in the address bar. The
service worker caches the app shell only; API and file requests always go to
the server.

## Local development

```bash
cd frontend
npm install
npm run dev
```

The dev server proxies `/api` and `/nasapi` to a running Vaulta/FBQ instance.
Set the targets in `frontend/.env.local` rather than editing the committed
config:

```
VITE_API_TARGET=http://<nas-ip>:30334
VITE_NASAPI_TARGET=http://<nas-ip>:8090
```

## Tests

Frontend (Vitest, jsdom):

```bash
cd frontend
npx vitest run
```

Sidecar (no local Go needed; run from the repository root):

```bash
docker run --rm -v "$PWD/docker/nasapi":/app -w /app -e GOFLAGS=-mod=mod golang:1.22 go test ./... -race
```

## Repository layout

- `frontend/src/api/` — one thin REST client per concern (`auth`, `resources`,
  `users`, `profiles`, `ownership`, `pinned` for starring, `trash`, `quota`,
  `storage`, `office`, `config`). Every file call takes `source` first.
- `frontend/src/stores/` — Pinia stores (`auth`, `files`, `quota`, `starred`,
  `trash`, `theme`).
- `frontend/src/components/` — Vue components; pure logic lives in tested
  sibling `.js` helpers (`quotaMath`, `uploadQueue`, `pathHelpers`,
  `dragMove`, `folderDrop`, ...).
- `frontend/src/vaulta-theme.css` — the authoritative stylesheet, including
  all responsive breakpoints.
- `docker/nasapi/` — the Go sidecar: `main.go` (server, JSON stores),
  `quota.go`, `usage.go`, `gate.go`, each with tests.
- `docker/Dockerfile`, `docker/nginx.conf`, `docker/entrypoint.sh` — the image.
- `docs/superpowers/specs/` and `docs/superpowers/plans/` — one dated design
  spec and implementation plan per feature. The private-drives spec records
  verified FBQ v1.5.5 behaviour and is worth reading before changing scopes
  or quotas.
- `AGENTS.md` — handoff notes for AI agents working on this repo, including
  the reference deployment on TrueNAS SCALE.

## Reference deployment

The maintainer's instance runs as a TrueNAS SCALE custom app with
`network_mode: host`, behind a Cloudflare Tunnel, next to a catalog-installed
FBQ and an OnlyOffice container. That instance's compose file expects the
image tag `nas-webui:local`, not `vaulta:local` as in the examples above.
TrueNAS does not build images, so the flow is
`docker build --platform linux/amd64` on a workstation, `docker save`, copy
the tarball to the host, `docker load`, then `docker compose ... up -d
--force-recreate` with the app's compose project name. The full procedure and
its gotchas are in `AGENTS.md`.

## License

No license file has been added yet. Until one is, all rights are reserved by
the author.
