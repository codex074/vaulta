# nas-webui

A custom Google-Drive-style file browser frontend for a personal NAS, backed by
FileBrowser Quantum's REST API. Built with Vue 3 (Composition API), Vite, and
Pinia; packaged as a two-stage Docker build (Vite build → nginx serving the
static SPA and reverse-proxying `/api/*` to FileBrowser Quantum).

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
- The public Cloudflare Tunnel ingress rule for `nas.codex074.com` points at
  `http://localhost:8090` (this app), not at FileBrowser Quantum directly.
  FileBrowser Quantum's own UI remains reachable only on the LAN at
  `http://192.168.1.22:30334`, kept as an admin fallback.

## Architecture

- `frontend/src/api/` — thin REST client for FileBrowser Quantum
  (`auth.js`, `resources.js`, `http.js`)
- `frontend/src/stores/` — Pinia stores (`auth.js`, `files.js`)
- `frontend/src/components/` — UI components
- `docker/Dockerfile`, `docker/nginx.conf` — production container build and
  nginx reverse-proxy config
