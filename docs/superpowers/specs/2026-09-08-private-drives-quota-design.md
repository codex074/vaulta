# Private Drives + Admin Quotas — Design Spec

## Context

nas-webui (branch `nas-webui-polish`) is a Vue 3 + Pinia frontend over FileBrowser
Quantum (FBQ) v1.5.5-stable, fronted by nginx, with a Go sidecar `nasapi` (user
profiles, file ownership, disk stats, OnlyOffice config) — all three running in one
container on TrueNAS VM 105. Today every user has scope `/` on the single source
`share`, so every user sees and can modify every other user's files, and there is no
storage limit anywhere in the system.

The user asked for four things:
1. **A private drive per user** — invisible to and unmodifiable by other users.
2. **The existing shared area preserved** — today's `/srv/share` content and behavior
   unchanged for every user.
3. **Quota enforced server-side** — not just hidden in the UI; a user must not be able
   to exceed their limit by calling the API directly.
4. **Admin-set quota per user** — entered (in GB) when the admin creates a user, and
   editable afterward.

## Verified Infra / Backend Facts

These are not assumptions — each was confirmed either by reading FBQ v1.5.5-stable's
source at that exact tag, or by live inspection of the running deployment. Full detail:
`/Users/codex074/.claude/plans/elegant-gathering-pearl-agent-a0cd7be33b2eff53c.md`.

**FBQ scopes (the real isolation mechanism):**
- FBQ supports multiple named sources, each with its own filesystem path, and each
  user carries `Scopes: []SourceScope{Name, Scope}` — one scope per source they can
  reach. Every resource endpoint resolves `(source, userScope, requestPath)` to a real
  path via `JoinScopedIndexPath` (which cleans `..` at the root, so it cannot escape)
  and rejects any source the user has no scope for. This is enforced on **every**
  endpoint that touches files: list, upload, mkdir, move, copy, delete, download,
  search, preview, and the OnlyOffice `office/config` endpoint. Cross-source move/copy
  is allowed as long as each side is confined by that side's own scope.
- **Creating** a user with explicit `Scopes` in the POST body runs `MakeUserDirs(user,
  createDir=true)`, which `MkdirAll`s every scope's folder on disk **regardless of any
  `createUserDir` flag** — that flag only controls whether the username gets appended
  to the scope path. So sending `{name:'home', scope:'/<username>'}` at user-creation
  time is what actually creates `/srv/home/<username>` — no extra step needed.
- **Updating** a user's scopes (`PUT /api/users` with `which:['scopes']`) runs
  `MakeUserDirs(user, createDir=false)` — it does **not** create folders, and fails
  the whole update if any scope's folder doesn't already exist. Only admins may change
  scopes (`X-Password` header of the *actor* required; scopes are replaced wholesale —
  always send the full, freshly-fetched scope list, never a partial patch).
- **Every FBQ restart auto-merges scopes for existing users**: for each source with
  `defaultEnabled: true`, any user who lacks that source's scope is granted
  `defaultUserScope` (`/` unless overridden) — silently, on every restart, admins and
  non-admins alike. This means the new `home` source **must** be configured
  `defaultEnabled: false` — otherwise every restart would re-grant `/` (full access to
  every user's private folder, not `/<username>`) to any user missing a home scope,
  including ones an admin deliberately never assigned one. `share` must keep
  `defaultEnabled: true` **explicit** in config (with only one source, FBQ forces
  `defaultEnabled: true` regardless of the file; with two sources that forcing no
  longer applies, so it must be written out).
- FBQ has **no quota feature** at v1.5.5-stable (confirmed absent from the source,
  the Bolt schema, and the Swagger doc; the changelog places storage quotas at a much
  later v2.1.0). Upload is a streamed `io.Copy` — `Content-Length` is never checked
  against anything. Chunked uploads (used by FBQ's own web UI, not by this app's
  frontend) send `X-File-Chunk-Offset` / `X-File-Total-Size` headers instead.

**Live deployment facts (TrueNAS VM 105, `192.168.1.22`):**
- FBQ is a TrueNAS *catalog* app: uid 3000, bridge network, `/mnt/tank/share` bind-
  mounted `rw` to `/srv/share`; config at
  `/mnt/.ix-apps/app_mounts/filebrowser-quantum/config/config.yaml` (read at startup
  only — a config change needs a container restart). Adding a second mount requires
  going through TrueNAS's own app-config machinery (`midclt call app.update` or the
  Apps UI's "Additional Storage" — this is a catalog app, not something whose compose
  file this repo controls directly), not the rendered compose file.
- nas-webui is a **custom** TrueNAS app: `network_mode: host`, runs as root, compose
  hand-edited at
  `/mnt/.ix-apps/app_configs/nas-webui/versions/1.0.0/templates/rendered/docker-compose.yaml`;
  `nasapi`'s own data (profiles, ownership) persists at
  `/mnt/.ix-apps/app_mounts/nas-webui/config`.
- No `tank/home` ZFS dataset exists yet — it must be created (Phase A).
- FBQ's own web UI is separately reachable on the LAN at `:30334` and bypasses this
  app's nginx/nasapi entirely (see Non-Goals).

**Frontend facts (current state, before this feature):**
- `source` is hardcoded to the string `'share'` in `frontend/src/api/resources.js:4`,
  `frontend/src/api/office.js:3`, and `frontend/src/stores/files.js:75`.
- Trash, Starred, and file ownership are all single-root today — they assume exactly
  one source exists.
- `user.scopes` (returned by `GET /api/users?id=self`) is fetched but never read by
  the frontend today.
- `ManageUsersDialog.vue` / `frontend/src/api/users.js` / `frontend/src/api/profiles.js`
  already exist and are the natural place to add quota UI and drive assignment.

## Architecture

```
browser ── nginx :8090 ──┬── GET /api/resources, /api/resources/*, /api/* ──────────► FBQ :30334
                         ├── POST/PATCH/DELETE /api/resources ──► nasapi :9190 gate ──► FBQ :30334
                         │        (quota check on source=home; reverse-proxied streaming)
                         └── /nasapi/* ──► nasapi (profiles, ownership, storage, config, quota)
FBQ mounts:   /mnt/tank/share → /srv/share (rw)   /mnt/tank/home → /srv/home (rw)   [source "home", defaultEnabled:false, private:true]
nasapi mounts: /srv/share:ro, /srv/home:ro (usage walks)   /var/lib/vaulta (profiles.json, ownership.json, quotas.json)
Scopes: non-admin [{share,/},{home,/<username>}]   admin [{share,/},{home,/}]
```

Reads (`GET`) never depend on `nasapi` being up — they go straight to FBQ, unchanged
from today. Only the three write verbs on `/api/resources` (`POST`, `PATCH`,
`DELETE`) are routed through `nasapi` first, and only so it can (a) enforce quota on
writes into `source=home` and (b) invalidate its own usage cache — the actual
isolation between users' private drives is enforced entirely by FBQ's own scope
mechanism, independent of `nasapi` being present at all.

## Components

**1. FBQ `home` source + per-user scopes.** A second FBQ source, name auto-derived as
`home` from its path `/srv/home`, `config: {defaultEnabled: false, private: true}`
(no `createUserDir` — the frontend always sends the full scope explicitly, per-user,
at creation time; see verified facts above for why `createUserDir` is unnecessary and
would even be wrong for the admin case). Every user's `Scopes` list carries both
`share` and `home` entries; the `home` scope's value (`/`, or `/<username>`) is the
entire isolation boundary — FBQ enforces it, this app never re-implements path
containment.

**2. `nasapi` quota store + usage tracker + method-routed gate.**
- `quotaStore` (`docker/nasapi/quota.go`): a small JSON-file-backed store (same shape
  as the existing `profileStore`) mapping uid → `{limitBytes}`. Source of truth for
  "how much is this user allowed."
- `usageTracker` (`docker/nasapi/usage.go`): walks `/srv/home/<scope>` on disk to
  compute bytes used, with a short TTL cache and an in-flight "reservation" mechanism
  so two concurrent uploads that would individually fit can't both succeed and
  jointly overshoot. Source of truth for "how much is this user actually using right
  now, including in-flight writes."
- `gate.go`: registered at `/api/resources` (mirroring FBQ's own route exactly), sits
  in front of FBQ as a reverse proxy. It inspects only requests whose target is
  `source=home`; every `source=share` request passes through completely untouched
  (no identity lookup, no body inspection, byte-for-byte). For `source=home`: `POST`
  (upload/mkdir) checks the incoming size against remaining quota before forwarding;
  `PATCH` (move/copy) sizes any item landing in `home` from a copy or a `share→home`
  move before forwarding; `DELETE` simply invalidates the cached usage after
  forwarding. A rejected write is drained (`io.Copy(io.Discard, r.Body)`) then
  answered `413` directly by `nasapi` — FBQ never sees it.

**3. nginx method-routed map.** `map $request_method $resources_backend` sends
`POST`/`PATCH`/`DELETE` on `location = /api/resources` to `nasapi` (`:9190`) and
everything else (including every other `/api/` path) straight to FBQ (`:30334`), as
today.

**4. Frontend — source-aware API/stores/components.** Every function in
`api/resources.js`, `api/office.js`, and `api/trash.js` gains `source` as its first,
required (no-default) argument. `stores/files.js` gains a `source` state field and
`switchDrive(source)`; a new `stores/quota.js` exposes the current user's quota/usage
for the Sidebar's storage card and the upload pre-check. `stores/auth.js` gains
`hasHomeDrive`/`isAdmin` getters derived from the logged-in user's `scopes`. Selection
keys (`pathHelpers.js`) become `source:path` so the same relative path in two
different drives can't collide in a multi-select.

**5. `ManageUsersDialog.vue` — quota + drive assignment + admin bootstrap.** Creating
a user requires a **Quota (GB)** field (hidden for admins, who are unlimited); each
existing user's row shows used/limit with inline editing; a new **"Assign drive"**
action lets the admin grant a home scope to a legacy user who doesn't have one yet
(pre-creates the folder, then `PUT`s the full scope list); a one-time **"Enable my
drive access"** banner lets the admin grant themselves a home scope (`/`, admin-wide,
so admins can see every user's private folder for support purposes).

## Data Shapes

**`quotas.json`** (nasapi data dir, `{"version":1,"quotas":{"<uid>":{"limitBytes":n}}}`):
```json
{
  "version": 1,
  "quotas": {
    "3": { "limitBytes": 5368709120 }
  }
}
```
Absence of a uid's entry means "no quota record" — treated as **0 bytes allowed**
(fail closed), not unlimited, so a user with a home scope but no admin-set quota
cannot write until the admin explicitly sets one.

**`GET /nasapi/quota`** (self, any authenticated user):
```json
{ "hasDrive": true, "unlimited": false, "limitBytes": 5368709120, "usedBytes": 1717986918 }
```
Admins always get `unlimited: true`. A user with no `home` scope at all gets
`hasDrive: false` and zeros for the rest.

**`GET /nasapi/quotas`** (admin only):
```json
{ "quotas": { "3": { "limitBytes": 5368709120, "usedBytes": 1717986918, "hasDrive": true, "unlimited": false } } }
```

**Gate error JSON** (from `nasapi`'s reverse-proxy gate, matching this app's existing
`{message}` error convention used by `apiError()` on the frontend):
- `413`: `{"message":"Storage quota exceeded: ..."}`
- `403` (no home scope): `{"message":"No private drive assigned."}`
- `411` (no length info on a non-dir upload): `{"message":"Content-Length required."}`
- `502` (FBQ unreachable or identity lookup failed): `{"message":"File service unavailable."}`

## Security Model

- **FBQ scopes are the isolation boundary.** A user cannot see, list, download,
  move, copy into, or delete another user's private files, because FBQ itself refuses
  any request whose resolved path falls outside that user's scope for that source —
  this is true independent of `nasapi`, independent of the frontend, and independent
  of the nginx gate. `nasapi` never re-implements or re-checks this containment.
- **`nasapi` is the quota boundary**, and only for `source=home` writes. It does not
  and must not attempt to enforce isolation — that would be redundant with, and
  strictly weaker than, FBQ's own scope enforcement.
- **Identity always comes from the session, never from the request body.** Every quota
  decision in the gate uses the identity FBQ itself resolves from the caller's
  session cookie (`fetchUser`, mirroring the existing `nasapi` pattern for profiles/
  ownership) — never a uid or username the client claims in a header, query string, or
  JSON body. This is what makes "hitting the API directly instead of the UI" not a
  bypass: the gate asks FBQ who the caller actually is on every write.
- **Fail closed, not fail open.** Home writes when `nasapi` is down or the identity
  lookup fails return `502`, not a silent pass-through — a user cannot exceed quota
  by causing (or waiting for) `nasapi` to be unavailable. Reads are unaffected either
  way (they never touch `nasapi`).
- **Known, honest caveat (not addressed by this design):** FBQ's own POST
  upload/mkdir path resolves the target with the *unscoped* `GetRealPath` rather than
  the symlink-bounded `GetRealPathScoped` used by reads (confirmed by reading the
  handler; whether a symlink planted inside a user's own scope pointing elsewhere in
  the *same source* could be write-target-escaped is inferred, not proven, from that
  asymmetry). This is an FBQ-level property, out of scope for this feature to fix, and
  is no worse than FBQ's existing behavior on `share` today.

## Non-Goals

- **Ownership tracking for `home`.** The existing "ownership" feature (who created a
  file, used for permission checks on `share`) stays **share-only**. Inside a user's
  `home` drive, only that user (and admins) can reach anything at all — per-file
  ownership metadata inside a space only one non-admin can already see adds no
  security value and is not implemented.
- **Precise accounting for chunked uploads.** This app's own frontend never chunks
  uploads (confirmed: `frontend/src/api/resources.js`'s `uploadFile` always sends a
  single request). The gate estimates chunked-upload size from
  `X-File-Total-Size` when present (FBQ's own web UI does chunk), but does not track
  partial chunk state across requests with byte-level precision — acceptable because
  this app's own UI is the only sanctioned upload path being sized precisely.
- **FBQ's own LAN UI (`:30334`) bypassing the gate.** An admin (or anyone on the LAN)
  hitting FBQ's web UI directly reaches FBQ without going through nginx or `nasapi` at
  all, so quota is not enforced there. This is accepted as an admin-only fallback
  path (documented, not hidden) — same tradeoff already accepted for the existing
  ownership feature. A future, separate hardening step could add a `zfs quota=` at
  the pool level on `tank/home` as a backstop; it is out of scope here.

## Rollout Order

1. **Phase A** — TrueNAS infra: create the `tank/home` dataset (no downtime), mount it
   into FBQ (short downtime, explicit go-ahead), add the `home` source to FBQ's config
   (short downtime, explicit go-ahead).
2. **Phases B–D** — build `nasapi`'s quota/gate logic (TDD, Go), the nginx
   method-routed gate, and the source-aware frontend (TDD, Vitest) — all in this repo,
   no infra downtime.
3. **Phase F** — deploy: build the image, apply the Phase-A-dependent compose changes
   (`/srv/home:ro` mount + `NASAPI_HOME_PATH`/`NASAPI_SHARE_PATH` env vars), push, and
   run the full verification checklist below against the live system.
4. **Phase E** — migrate existing users: admin enables their own drive access, then
   assigns a drive + quota to each legacy user one at a time. Deliberately **after**
   Phase F so no existing user is silently granted (or silently denied) drive access
   mid-deploy.

## Deployment Notes (what actually happened, 2026-09-08)

- Phase A2 worked via `midclt call app.config filebrowser-quantum` → append to
  `storage.additional_storage` → `midclt call -j app.update filebrowser-quantum
  '{"values": …}'` (ix_* keys stripped). ~30 s FBQ restart.
- **Correction to the design:** the catalog app's `init` sidecar appends *every*
  additional mount to `server.sources` as `{path, config: {defaultEnabled: true}}`
  on each app update/start — the A3 config edit was therefore pre-empted with the
  wrong flag, and FBQ started twice with `home` defaultEnabled, which (per the
  Verified Facts) grants every existing user scope `/` on `home`. The entry was
  rewritten in place to `name: home`, `defaultEnabled: false`, `private: true` and
  FBQ restarted; the sidecar only appends when the path is absent, so the fixed
  entry survives future restarts. Because existing non-admin users may now hold
  `home: /`, `ManageUsersDialog` gained `driveStatus()` and a **Fix drive** action
  (same mkdir + scope PUT as Assign drive) — Phase E must be run promptly after
  deploy. `/mnt/tank/home` was empty throughout, so nothing was exposed.
- The `entrypoint.sh` restart loop initially inherited `set -e` and died on the
  first non-zero nasapi exit; caught by the C3 integration test (kill → no
  respawn) and fixed with a `set +e` subshell. C3 also showed `/quota` walking the
  disk instead of reading the usage tracker; fixed so the sidebar number equals the
  number the gate judges by.
- nasapi's `/quota` for an admin walks all of `/srv/home`; fine at this scale.
- The FBQ admin password differs from the app's `FILEBROWSER_ADMIN_PASSWORD`
  (changed in-app), so authenticated F2 checks need real credentials or a
  throwaway test user created through the UI.

## Verification Checklist

- `go test ./... -race` green in `docker/nasapi` (unit + concurrency tests for
  `quotaStore`, `usageTracker`, and the gate).
- `npx vitest run` green in `frontend` (API/store/component-logic tests for every
  touched module) and `npm run build` succeeds.
- `nginx -t` passes against the updated `docker/nginx.conf`.
- Empirical: a request larger than quota against `source=home` actually receives a
  `413` through the full nginx→nasapi→(rejected before FBQ) path with
  `proxy_request_buffering off` (verified before frontend work begins, per Phase C).
- Live, post-deploy: a non-admin user can list/upload/download only inside their own
  `home` scope; `../` and `%2e%2e/` path tricks against another user's folder are
  rejected by FBQ itself; an over-quota upload/copy returns `413` and leaves no
  partial file; `source=share` behavior is provably unchanged (byte-for-byte
  passthrough, existing tests still green); killing `nasapi` leaves reads (including
  `source=home` reads) working while `source=home` writes correctly 502 and recover
  within ~1s of `nasapi` restarting; `GET /nasapi/quota`'s `usedBytes` matches
  `du -sb --apparent-size` on the real folder.
