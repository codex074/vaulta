# AGENTS.md — nas-webui (Vaulta)

Handoff for an AI agent picking up this project. Read this once, then work from
the environment (git log, the files, `README.md`, the specs) — this file caches
only what those cannot tell you: the live topology, the deploy path, and the
gotchas that already cost someone a debugging session.

## What this is

A Google-Drive-style file-browser web UI ("Vaulta") over **FileBrowser Quantum
(FBQ) v1.5.5-stable**. Vue 3 (Composition API) + Pinia + Vite SPA, served by
nginx which also reverse-proxies `/api/*` to FBQ and `/nasapi/*` to a small Go
sidecar. One Docker image, two processes (nginx + `nasapi`). `README.md` covers
build/run/architecture; don't restate it — read it.

**All work lives on branch `nas-webui-polish`, and that is what production
runs.** `main` is fast-forwarded to it at each push; commit on
`nas-webui-polish`, then `git merge --ff-only nas-webui-polish` on `main`.
The GitHub remote is `https://github.com/codex074/vaulta` (`origin`), with
`main` as the default branch. This repo is checked out as a git worktree;
other worktrees may be on other branches.

## Where the truth already is (don't duplicate — read these)

- `README.md` — dev server, `npm test` (Vitest), the `docker build` line, the
  container's two processes, the nginx routes, the TrueNAS deploy shape.
- `docs/superpowers/specs/*` + `docs/superpowers/plans/*` — one dated
  spec+plan pair per feature. The newest, **`2026-09-08-private-drives-quota-*`**,
  is the current system: per-user private drives + admin quotas. Its spec's
  "Deployment Notes" and "Verified Facts" sections are the authoritative record
  of how FBQ v1.5.5 actually behaves (scopes, the startup source-merge, upload
  streaming) — trust them over guessing.
- `git log` — every change is one commit with a message explaining the why.

## Layout (so you can navigate, not memorize)

- `frontend/src/api/*.js` — thin REST clients (one per concern). Every
  resource call is **source-first**: `listDirectory(source, path)`,
  `uploadFile(source, path, file, onProgress, { signal })`, etc. `source` is
  `'home'` (private drive) or `'share'` (the shared area) — never defaulted.
  `share.js` is the owner-side client (create/list/revoke links, authenticated
  like the rest of the app); `publicShare.js` is the guest-side client — a
  plain `fetch` against `/public/api/*` with no auth cookie, sending
  `X-SHARE-PASSWORD` when the link is password-protected.
- `frontend/src/stores/*.js` — Pinia stores (`files` holds `source` +
  `currentPath`; `quota`, `auth`, `starred`, `trash`, `theme`).
- `frontend/src/components/*.vue` — UI. Pure logic is factored into tested
  sibling `.js` helpers (`quotaMath.js`, `uploadQueue.js`, `pathHelpers.js`,
  `dragMove.js`, `folderDrop.js`) — follow that pattern rather than putting
  testable logic in an SFC.
- `frontend/src/vaulta-theme.css` — **the authoritative stylesheet**, loaded
  after `style.css` with `#app`-prefixed selectors that outrank scoped
  component styles. When a component's own CSS doesn't render, a `#app .foo`
  rule here is why. All responsive breakpoints live here.
- `docker/nasapi/*.go` — the Go sidecar: `main.go` (server + mux + JSON
  stores), `quota.go`, `usage.go`, `gate.go`, each with a `_test.go`.
- `docker/{Dockerfile,nginx.conf,entrypoint.sh}` — the image.

## How to work here

- **TDD, always** — every change in `git log` was a failing test first. Match
  the existing test style: api tests mock `global.fetch` and assert URL/body;
  store tests `vi.mock` the api modules; Go tests use an httptest fake FBQ keyed
  on `Cookie: auth=valid`. Run `cd frontend && npx vitest run` and the Go suite
  before every commit; both must be green.
- **Go is not installed locally.** Run its tests through Docker:
  `docker run --rm -v "$PWD/docker/nasapi":/app -w /app -e GOFLAGS=-mod=mod golang:1.22 go test ./... -race`
  (from the repo root). `gofmt`/`go vet` the same way.
- **Docker Desktop on the Mac is arm64 with no host networking.** Build the
  deploy image with `--platform linux/amd64` (the TrueNAS host is x86_64). For a
  local integration test, run the image with `-p 8090:8090` and `apk add
  python3` inside it to host a stub FBQ on `127.0.0.1:30334`.
- Commit trailer: end each commit with the `Co-Authored-By` line for your model
  and the `Claude-Session` URL, matching recent commits.

## Live topology (cannot be discovered from this repo)

- The app runs on **TrueNAS SCALE VM 105** (`192.168.1.22`) on Proxmox host
  **pve2**, reachable only as `ssh root@100.71.13.117` (Tailscale). There is no
  direct SSH into the VM; run commands inside it with
  `ssh root@100.71.13.117 "qm guest exec 105 -- <cmd>"` (output returns as JSON
  with an `out-data` field; use `sh -c '…'` for anything with pipes/quotes, and
  `--pass-stdin 1 -- sh -c 'cat > /path'` to drop a small file in without a file
  server). Keep each remote command short and single-purpose.
- Three TrueNAS apps matter: **`nas-webui`** (this app, custom app,
  `network_mode: host`, port 8090, runs as root), **`filebrowser-quantum`**
  (catalog app, uid 3000, bridge net, port 30334, its own LAN-only admin UI),
  and **`onlyoffice`** (document viewer). Public URL `nas.codex074.com` →
  Cloudflare tunnel → nas-webui :8090. FBQ's own UI on `:30334` bypasses nginx
  and nasapi entirely (admin fallback only — the quota gate does not cover it).
- Two data sources on disk: `/mnt/tank/share` (shared, source `share`) and
  `/mnt/tank/home` (per-user private drives, source `home`, dataset created
  2026-09-08). nas-webui mounts both read-only for usage walks; FBQ mounts them
  read-write. nasapi's JSON stores (`profiles.json`, `ownership.json`,
  `quotas.json`) persist in `/mnt/.ix-apps/app_mounts/nas-webui/config`
  (→ `/var/lib/vaulta`).

## Deploy (the established path — follow it exactly)

nas-webui is a **custom** TrueNAS app whose rendered compose is hand-edited;
FBQ is a **catalog** app whose config goes through TrueNAS middleware, not the
rendered compose.

To ship a code change (build → run):
1. `cd frontend && npx vitest run` + the Go suite, both green.
2. `docker build --platform linux/amd64 -f docker/Dockerfile -t nas-webui:local .`
3. `docker save nas-webui:local | gzip > /tmp/nas-webui.tar.gz`, `scp` to
   `root@100.71.13.117:/root/`, verify md5 matches the Mac's.
4. On pve2: `python3 -m http.server 8765 --bind 192.168.1.16` (background it),
   then `qm guest exec 105 -- curl -s -o /root/nas-webui.tar.gz
   http://192.168.1.16:8765/nas-webui.tar.gz`; kill the server and delete the
   tarball on pve2. Verify the VM's md5 matches.
5. In the VM: `gunzip -c /root/nas-webui.tar.gz | docker load`, then
   `docker compose -f /mnt/.ix-apps/app_configs/nas-webui/versions/1.0.0/templates/rendered/docker-compose.yaml -p ix-nas-webui up -d --force-recreate`,
   then `docker image prune -f`, then remove the tarball.
   **The `-p ix-nas-webui` is required** — without it compose infers the project
   name from the directory and spawns a stray `rendered-nas-webui-1` container.
6. Verify: `curl -s -o /dev/null -w '%{http_code}' https://nas.codex074.com/`
   is 200, and grep the served `assets/index-*.{js,css}` for a string unique to
   your change to confirm the new bundle is live.

## Gotchas that already cost a session

- **FBQ's catalog `init` sidecar rewrites the config on every start.** It force-
  sets `server.{port,database,cacheDir}` and appends every additional mount to
  `server.sources` as `{path, config:{defaultEnabled: true}}`. FBQ then grants
  scope `/` on every `defaultEnabled` source to every existing user at startup —
  which, for the `home` source, would give everyone the root of all private
  drives. After adding a mount, immediately rewrite that source entry in
  `config.yaml` to `name: home`, `defaultEnabled: false`, `private: true` and
  restart FBQ; the sidecar only re-appends when the path is absent, so the fixed
  entry survives. `ManageUsersDialog`'s "Fix drive" action exists to repair
  users left at `/`.
- **Per-user isolation is FBQ's job; quota is nasapi's.** FBQ enforces each
  user's `scopes: [{name, scope}]` on every resource endpoint (`..` cannot
  escape) — that is the real security boundary. nasapi is a reverse-proxy
  **gate** that nginx routes POST/PATCH/DELETE on `/api/resources` through; it
  checks the quota for `source=home` writes and returns 413 when over. Reads
  (GET) go straight to FBQ and never depend on nasapi. `nasapi` down = home
  writes 502, reads unaffected; `entrypoint.sh` respawns it (in a `set +e`
  subshell — a bare `while` loop under `set -e` dies on the first SIGTERM).
- **`PUT /api/users` with `which:['scopes']` replaces scopes wholesale** and
  never creates directories — the scope folder must already exist. Always send a
  freshly fetched user object. Creating a user with explicit scopes, by
  contrast, does create the folder.
- **The FBQ admin password was changed in-app**, so it differs from the app
  config's `FILEBROWSER_ADMIN_PASSWORD` (that is only the seed). Authenticated
  API scripting as admin needs credentials from the human or a throwaway test
  user made through the UI.
- **FBQ 1.5.x aborts on PDF thumbnails (upstream #2763).** Its MuPDF
  renderer can hit an uncaught error and `exit()` the whole FBQ process
  (`aborting process from uncaught error!` in its log), which surfaces in
  Vaulta as a burst of `502`s on every in-flight request for ~2 s. Never
  cached because it never completes, so it recurs on every listing. Fixed
  upstream only in 2.x (beta as of 2026-09-09, no stable). Vaulta's
  `canRequestThumbnail()` in `fileFormat.js` therefore never requests
  thumbnails for pdf/xps/epub/mobi/fb2/cbz — keep that guard until FBQ is on
  2.x. FBQ's own UI on `:30334` still triggers it.
- **OnlyOffice editing is decided by FBQ, not by this app.** `GET
  /api/office/config` returns a JWT-signed config whose `editorConfig.mode` is
  `edit` whenever `integrations.office.viewOnly` is `false` and the user has
  `modify` (all Vaulta users do); the client cannot downgrade it. "Only office
  files are editable" is therefore enforced by `lightboxKind.js` routing
  txt/md/csv/log/json/html/htm/xml to the built-in `<pre>` viewer so they never reach
  OnlyOffice. Saves go Document Server → FBQ `/api/office/callback` via
  `server.internalUrl`, bypassing nginx and nasapi's quota gate (accepted
  gap). `viewOnly: false` has been live since 2026-09-09.
- **Password shares can only be read with a request header** — the share
  token is never given to guests, so `<img>`/`<video>` can't authenticate;
  `guestMedia.js` fetches blobs instead and video is download-only. The guest
  API is also rate-limited per `CF-Connecting-IP` at nginx (`limit_req` zone
  `publicapi`); on the LAN the header is absent so there is no limit.
- **Verification has been build/bundle-level only.** No agent this far has had
  login credentials, so the authenticated UI has never been visually checked on
  a real device, and the private-drives end-to-end checks (two real users,
  live 413, `usedBytes == du --apparent-size`) are proven only against a local
  stub, not production. Ask the human for a throwaway account to close this.

## Outstanding

- **Phase E — migrate existing users** (from the private-drives plan, still not
  done): the admin opens Manage users, clicks "Enable my drive access" once,
  then for each legacy user clicks "Assign drive" (or "Fix drive" if they show a
  `/` home scope) and sets a quota. Until then, legacy non-admins may hold the
  shared-root home scope described in the gotcha above. `/mnt/tank/home` is
  currently empty, so nothing is exposed yet.
- **Live authenticated verification** of every feature shipped since the private-
  drives work (drives, quota, upload-cancel, responsive, breadcrumb back button)
  — see the verification gotcha above.
