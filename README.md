# nas-webui

A custom Google-Drive-style file browser frontend for a personal NAS, backed by
FileBrowser Quantum's REST API. Built with Vue 3 (Composition API), Vite, and
Pinia; packaged as a multi-stage Docker build (Vite build + a small Go
disk-usage sidecar build → nginx serving the static SPA, reverse-proxying
`/api/*` to FileBrowser Quantum and `/nasapi/*` to the sidecar).

Vaulta treats FileBrowser's numeric `user.id` as the immutable account UID.
The login username remains a credential, while a separate UID-keyed profile
stores the user-editable display name. Existing users need no data migration:
until they save a display name, their login username is displayed.

FileBrowser Quantum serves two sources: `share` (`/srv/share`, the existing
shared area — unchanged behavior for every user) and `home` (`/srv/home`,
each user's private drive, isolated by FBQ's own per-user scopes). `nasapi`
enforces a per-user storage quota on `home` writes: it sits in front of FBQ
as a reverse-proxy gate on `POST`/`PATCH`/`DELETE` to `/api/resources`,
checking a write against the caller's admin-set quota before forwarding it
on. `GET` (listing, download, preview, search) always goes straight to FBQ,
so reads never depend on `nasapi` being up.

## Local development

```bash
cd frontend
npm install
npm run dev
```

This starts a Vite dev server that proxies `/api/*` requests to the FileBrowser
Quantum backend configured in `vite.config.js` (`server.proxy['/api'].target`,
currently the LAN address of the NAS). Set `VITE_API_TARGET` in a `.env.local`
file under `frontend/` if that address ever changes, instead of editing the
committed config.

## Tests

```bash
cd frontend
npm test
```

## Building the production image

The image must target `linux/amd64` — the TrueNAS host this runs on is x86_64,
which differs from an Apple Silicon build machine's native architecture:

```bash
docker build --platform linux/amd64 -f docker/Dockerfile -t nas-webui:local .
```

Run from the repository root (the Dockerfile's `COPY frontend/...` lines assume
that build context).

## Deploying

This runs as a TrueNAS Custom App (Docker Compose config applied through
TrueNAS's Apps UI), alongside the existing `filebrowser-quantum` and
`nas-cloudflared` apps on the same TrueNAS instance:

- Image: `nas-webui:local` (loaded via `docker load` after transferring the
  built image — TrueNAS's Apps engine doesn't build images itself)
- Port: `8090`, published
- `network_mode: host` — required so nginx can reach FileBrowser Quantum at
  `127.0.0.1:30334` without container-to-container networking
- Bind mount: `/mnt/tank/share:/srv/share:ro` — read-only, and required. The
  `nasapi` sidecar `statfs()`s this path to report real disk usage for the
  sidebar's storage bar; without the mount the storage endpoint fails
- Bind mount: `/mnt/tank/home:/srv/home:ro` — read-only, and required for
  quota enforcement. `nasapi` walks each user's home scope under this path
  to compute `usedBytes`; FBQ itself mounts the same ZFS dataset read-write
  separately, since `nasapi` only ever reads, never writes, drive contents
- Bind mount: `/mnt/.ix-apps/app_mounts/nas-webui/config:/var/lib/vaulta` —
  read-write and required for persistent UID-keyed display-name profiles,
  file ownership records, and per-user storage quotas (`profiles.json`,
  `ownership.json`, `quotas.json`). The FileBrowser numeric user ID is the
  immutable UID; existing login usernames remain unchanged and become the
  initial display name automatically
- Env vars: `NASAPI_SHARE_PATH` (default `/srv/share`) and
  `NASAPI_HOME_PATH` (default `/srv/home`) tell `nasapi` where each source
  lives on disk, matching the two bind mounts above
- The container runs two processes, started by `docker/entrypoint.sh`: nginx
  (serving the SPA and reverse-proxying `/api/*` to FileBrowser Quantum) and a
  small `nasapi` binary listening on `127.0.0.1:9190`, respawned by
  `entrypoint.sh` if it ever crashes. It serves `/nasapi/storage` and other
  sidecar endpoints (reverse-proxied by nginx alongside `/api/*`), and also
  sits in front of FBQ as a quota-enforcing gate: nginx routes
  `POST`/`PATCH`/`DELETE` on `/api/resources` to `nasapi` first, which
  checks writes into a user's `home` drive against their admin-set quota
  before forwarding the request on to FBQ (`GET` on the same path, and every
  other `/api/*` path, goes straight to FBQ unaffected)
- The public Cloudflare Tunnel ingress rule for `nas.codex074.com` points at
  `http://localhost:8090` (this app), not at FileBrowser Quantum directly.
  FileBrowser Quantum's own UI remains reachable only on the LAN at
  `http://192.168.1.22:30334`, kept as an admin fallback.

## Architecture

- `frontend/src/api/` — thin REST client for FileBrowser Quantum and the
  `nasapi` sidecar (`auth.js`, `resources.js`, `http.js`, `pinned.js`
  for starring, `trash.js` for the move-to-`.trash` soft-delete convention,
  `storage.js` for the disk-usage endpoint)
- `frontend/src/stores/` — Pinia stores (`auth.js`, `files.js`, `starred.js`,
  `trash.js`)
- `frontend/src/components/` — UI components
- `docker/Dockerfile`, `docker/nginx.conf` — production container build and
  nginx reverse-proxy config
- `docker/nasapi/` — the Go sidecar serving `/nasapi/storage` plus authenticated
  UID profile endpoints under `/nasapi/profile*`, quota endpoints under
  `/nasapi/quota*`, and the `/api/resources` reverse-proxy gate that enforces
  those quotas on writes into a user's `home` drive (`quota.go`, `usage.go`,
  `gate.go`)
- `docker/entrypoint.sh` — container entrypoint, starts both processes
  (`nasapi` in a restart loop in the background, then nginx in the
  foreground)
