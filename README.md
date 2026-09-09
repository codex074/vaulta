<div align="center">

# 🗄️ Vaulta

**A Google-Drive-style web UI for your home NAS, built on FileBrowser Quantum.**

[![Vue 3](https://img.shields.io/badge/Vue-3-42b883?logo=vuedotjs&logoColor=white)](https://vuejs.org)
[![Vite](https://img.shields.io/badge/Vite-8-646cff?logo=vite&logoColor=white)](https://vite.dev)
[![Pinia](https://img.shields.io/badge/Pinia-4-ffd859?logo=pinia&logoColor=black)](https://pinia.vuejs.org)
[![Go](https://img.shields.io/badge/Go-1.22-00add8?logo=go&logoColor=white)](https://go.dev)
[![nginx](https://img.shields.io/badge/nginx-alpine-009639?logo=nginx&logoColor=white)](https://nginx.org)
[![FileBrowser Quantum](https://img.shields.io/badge/FileBrowser%20Quantum-v1.5.5-2d3748)](https://github.com/gtsteffaniak/filebrowser)
[![PWA](https://img.shields.io/badge/PWA-installable-5a0fc8?logo=pwa&logoColor=white)](#-install-as-an-app)
[![Tests](https://img.shields.io/badge/tests-vitest%20%2B%20go%20test-6e9f18?logo=vitest&logoColor=white)](#-tests)

Private drives · Quotas · Guest links · Office editing · Chunked uploads · iPhone-first

[Features](#-features) · [How it works](#-how-it-works) · [Quick start](#-quick-start) · [Configuration](#-configuration) · [First run](#-first-run) · [Development](#-development)

</div>

---

Vaulta sits in front of [FileBrowser Quantum](https://github.com/gtsteffaniak/filebrowser) (FBQ) and adds what a family or small team expects from a "drive": a shared area plus a private drive per user, admin-set storage quotas, starred files, a trash with restore, real previews, Office editing through OnlyOffice, drag-and-drop everything, guest share links, and an installable app for iPhone and iPad.

> [!NOTE]
> **FBQ stays the source of truth** for accounts, permissions and file storage. Vaulta never bypasses it: every file operation is an FBQ REST call, so FBQ's own per-user scopes remain the security boundary.

## ✨ Features

| | Feature | What you get |
|:-:|---|---|
| 🏠 | **Shared drive + private drives** | Two FBQ sources: `share` (everyone) and `home` (one isolated folder per user). |
| 📊 | **Storage quotas** | Admins set a per-user quota; over-quota writes into a private drive are refused with `413` before they reach FBQ. |
| 🗂️ | **Drive-style browsing** | Grid and list views, breadcrumbs, search, select all, multi-select, drag-and-drop move, folder upload, upload progress with per-file or whole-batch cancel. |
| ⬆️ | **Big uploads through Cloudflare** | Files over 10 MiB are sent in chunks, so uploads beyond Cloudflare's 100 MB per-request limit work from outside the LAN. |
| ⭐ | **Starred and Trash** | Star anything; deleted files go to `.trash` and can be restored or deleted forever. Owner-only delete on the shared drive. |
| 🖼️ | **Previews** | Image, video (Plyr) and PDF lightbox with fullscreen; folder covers show a 2×2 collage of the folder's photos; `txt` `md` `csv` `log` `json` `html` `xml` open in a built-in read-only viewer. |
| 📝 | **Office editing** | With OnlyOffice configured, `docx` `xlsx` `pptx` (and the other Word/Cell/Slide formats) open in OnlyOffice and can be edited in place; changes save when the document is closed. |
| 🔗 | **Guest links** | Share any file or folder as a read-only link (`/s/<hash>`) with an expiry and an optional password; guests browse, preview and download in Vaulta's own UI, no account needed. |
| 👥 | **Accounts** | Display-name profiles keyed by FBQ's immutable user ID, change password, and an admin **Manage users** dialog (create/delete users, assign or fix private drives, set quotas). |
| 🔐 | **Sessions** | **Keep me signed in** at login renews FBQ tokens as you use the app; otherwise Vaulta signs you out after 1 hour without activity. Every password field has a show/hide toggle. |
| 📱 | **Mobile-first** | Installable PWA, bottom tabs on phones, adaptive sidebar on iPad/desktop, light and dark themes. |

> [!TIP]
> PDF tiles deliberately show an icon instead of a thumbnail: FBQ 1.5.x can crash while generating PDF thumbnails. See `AGENTS.md` for the details.

## 🧩 How it works

One Docker image, two processes:

```
Browser ──> nginx :8090 ──┬── /               static Vue SPA (PWA)
                          ├── /api/*          ──> FileBrowser Quantum (default 127.0.0.1:30334)
                          ├── /api/resources  (POST/PATCH/DELETE only)
                          │                   ──> nasapi :9190 (quota gate) ──> FileBrowser Quantum
                          ├── /nasapi/*       ──> nasapi :9190 (storage, profiles, ownership, quotas, config)
                          └── /public/api/*   ──> FileBrowser Quantum (guest share links, no login)
```

| Component | Role |
|---|---|
| 🌐 **nginx** | Serves the built SPA and reverse-proxies `/api/*` to FBQ. |
| 🛡️ **nasapi** (Go sidecar) | Reports disk usage for the storage bar, stores display-name profiles, file ownership and quotas as JSON, and acts as a reverse-proxy **gate** on writes (`POST`/`PATCH`/`DELETE`) to `/api/resources`: a write into a `home` drive is checked against the user's quota, then forwarded to FBQ unchanged. |
| 🔒 **FBQ** | Owns isolation. Each user has one FBQ scope per source; FBQ resolves every path inside that scope and rejects `..` escapes on every endpoint. Vaulta only *manages* those scopes through FBQ's users API. |

> [!NOTE]
> Reads (`GET`) never touch nasapi, so listing and downloads keep working even if nasapi is down; home-drive writes answer `502` until `entrypoint.sh` respawns it.

## 🚀 Quick start

### Requirements

| Component | Notes |
|---|---|
| FileBrowser Quantum **v1.5.5-stable** | The version Vaulta was built and verified against. Reachable from the Vaulta container over HTTP. |
| Docker host | Any Linux host. Building on Apple Silicon for an x86_64 server? Use `--platform linux/amd64`. |
| Two data directories | One for the shared area, one holding per-user private folders. FBQ mounts them read-write; Vaulta mounts them read-only. |
| OnlyOffice Document Server *(optional)* | Only for Office viewing/editing inside the app. Any reachable instance works. |

### 1 · Build the image

From the repository root (the Dockerfile copies `frontend/` and `docker/nasapi/` from there):

```bash
docker build --platform linux/amd64 -f docker/Dockerfile -t vaulta:local .
```

The build compiles the Vue app with Node 20 and the sidecar with Go 1.22 inside Docker; neither toolchain is needed on the host.

### 2 · Run

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

> [!TIP]
> No host networking? Publish port `8090` instead and point `NASAPI_FILEBROWSER_URL` at FBQ's address. nginx's `/api/` upstream is fixed to `127.0.0.1:30334` in `docker/nginx.conf`; edit it to match.

## ⚙️ Configuration

### FileBrowser Quantum

FBQ needs two named sources. The `home` source **must** be `defaultEnabled: false` and `private: true`, and `share` must have `defaultEnabled: true` written out explicitly.

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

auth:
  tokenExpirationHours: 720   # lets "Keep me signed in" last; Vaulta renews the token on use
```

> [!WARNING]
> On every start FBQ grants scope `/` on every `defaultEnabled` source to every user who lacks one. For `home` that would hand each user the root of **all** private drives. Keep `defaultEnabled: false` on `home`. FBQ reads this file at startup only, so restart it after editing.

<details>
<summary><b>OnlyOffice (optional)</b></summary>

Add FBQ's `server.internalUrl` (an address the OnlyOffice container can reach FBQ on) and the `integrations.office` block with the same JWT secret as the Document Server:

```yaml
integrations:
  office:
    url: https://office.example.com        # what browsers load
    internalUrl: http://<fbq-host>:8095    # how FBQ reaches the Document Server
    secret: <same JWT secret as the Document Server>
    viewOnly: false                        # true = read-only for everyone
```

With `viewOnly: false`, FBQ decides per file: anyone whose FBQ account has the `modify` permission (every user Vaulta creates) gets an editable session for any OnlyOffice-supported format except `pages`/`numbers`/`key`. Vaulta keeps plain-text formats out of OnlyOffice so only office documents are editable. Saves travel from the Document Server straight to FBQ's callback endpoint, bypassing Vaulta's nginx and the quota gate; the storage numbers catch up on the next usage refresh.

> [!WARNING]
> Prefer editing `docx`/`xlsx`/`pptx`. FBQ writes whatever bytes OnlyOffice returns over the original file without checking the format, so legacy formats like `doc`/`odt` may be rewritten as OOXML.

The exact keys are documented in `docs/superpowers/specs/2026-09-08-onlyoffice-document-viewer-design.md`.

</details>

<details>
<summary><b>Environment variables (nasapi)</b></summary>

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

</details>

<details>
<summary><b>Volumes</b></summary>

| Container path | Mode | Why |
|---|---|---|
| `/srv/share` | `ro` | Disk usage for the storage bar (`statfs`). Required. |
| `/srv/home` | `ro` | Per-user usage walks for quota enforcement. Required. |
| `/var/lib/vaulta` | `rw` | Persistent profiles, ownership records and quotas. Required. |

Vaulta only ever *reads* file contents through these mounts. Writes go through FBQ, which needs the same directories mounted read-write on its side.

</details>

## 🏁 First run

1. Sign in with your FBQ admin account.
2. Open the account menu, then **Manage users**. Enter your password in the admin field (FBQ requires the actor's password for user changes).
3. Click **Enable my drive access** once. This gives the admin a `home` scope and unlocks the private-drive UI.
4. For each existing user click **Assign drive** and enter a quota in GiB. This creates `/srv/home/<username>` and sets the user's `home` scope to it. If a user shows **Fix drive** instead, their home scope currently points at `/` (see the warning above); clicking it repairs the scope.
5. New users created from this dialog get a private drive and quota at creation time.

Users see **My Drive** (private) and **Shared** in the sidebar. Their storage bar shows quota usage; an over-quota upload or copy fails with a clear message and leaves no partial file.

## 📲 Install as an app

On iPhone/iPad open the site in Safari, tap **Share**, then **Add to Home Screen**. On desktop Chrome use the install icon in the address bar. The service worker caches the app shell only; API and file requests always go to the server.

## 🛠️ Development

```bash
cd frontend
npm install
npm run dev
```

The dev server proxies `/api`, `/nasapi` and `/public` to a running Vaulta/FBQ instance. Set the targets in `frontend/.env.local` rather than editing the committed config:

```
VITE_API_TARGET=http://<nas-ip>:30334
VITE_NASAPI_TARGET=http://<nas-ip>:8090
```

### 🧪 Tests

Frontend (Vitest, jsdom):

```bash
cd frontend
npx vitest run
```

Sidecar (no local Go needed; run from the repository root):

```bash
docker run --rm -v "$PWD/docker/nasapi":/app -w /app -e GOFLAGS=-mod=mod golang:1.22 go test ./... -race
```

<details>
<summary><b>Repository layout</b></summary>

| Path | What lives there |
|---|---|
| `frontend/src/api/` | One thin REST client per concern (`auth`, `resources`, `users`, `profiles`, `ownership`, `pinned`, `trash`, `quota`, `storage`, `office`, `config`, `share`, `publicShare`). Every file call takes `source` first. |
| `frontend/src/stores/` | Pinia stores (`auth`, `files`, `quota`, `starred`, `trash`, `theme`). |
| `frontend/src/components/` | Vue components; pure logic lives in tested sibling `.js` helpers (`quotaMath`, `uploadQueue`, `chunkPlan`, `shareLinks`, `guestMedia`, `pathHelpers`, …). |
| `frontend/src/sessionPolicy.js`, `sessionGuard.js` | Idle sign-out and token renewal policy + wiring. |
| `frontend/src/vaulta-theme.css` | The authoritative stylesheet, including all responsive breakpoints. |
| `docker/nasapi/` | The Go sidecar: `main.go` (server, JSON stores), `quota.go`, `usage.go`, `gate.go`, each with tests. |
| `docker/Dockerfile`, `docker/nginx.conf`, `docker/entrypoint.sh` | The image. |
| `docs/superpowers/specs/`, `docs/superpowers/plans/` | One dated design spec and implementation plan per feature. The private-drives spec records verified FBQ v1.5.5 behaviour and is worth reading before changing scopes or quotas. |
| `docs/deployments/` | One log per production deployment. |
| `AGENTS.md` | Handoff notes for AI agents working on this repo, including the reference deployment on TrueNAS SCALE. |

</details>

## 🏡 Reference deployment

The maintainer's instance runs as a TrueNAS SCALE custom app with `network_mode: host`, behind a Cloudflare Tunnel, next to a catalog-installed FBQ and an OnlyOffice container. That instance's compose file expects the image tag `nas-webui:local`, not `vaulta:local` as in the examples above. TrueNAS does not build images, so the flow is `docker build --platform linux/amd64` on a workstation, `docker save`, copy the tarball to the host, `docker load`, then `docker compose … up -d` with the app's compose project name. The full procedure and its gotchas are in `AGENTS.md`.

## 📄 License

No license file has been added yet. Until one is, all rights are reserved by the author.

---

<div align="center">
Built with Vue, Go and a lot of test-first iteration · Backed by <a href="https://github.com/gtsteffaniak/filebrowser">FileBrowser Quantum</a>
</div>
