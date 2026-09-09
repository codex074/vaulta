# Guest Share Links — Design Spec

Date: 2026-09-09. Status: approved by the user in chat (guest page is Vaulta's own;
options are expiry + password; everyone may share from both drives).

## Goal

A signed-in user picks a file or folder in My Drive or Shared, creates a link,
and hands it to someone with no account. The guest opens
`https://nas.codex074.com/s/<hash>` in Vaulta's own UI and can browse the
shared folder, preview images / video / PDF / plain text, and download files.
Links can expire and can require a password. Owners see and revoke their
links; admins see everyone's.

## Verified backend facts (FBQ v1.5.5-stable source, `backend/http/*`)

- **Shares are a first-class FBQ feature.** `POST /api/share` body
  (`share.CreateBody`): `source` (source *name*: `home` / `share`), `path`
  (relative to the caller's scope on that source), `expires` (string number),
  `unit` (`seconds|minutes|hours|days`; anything else = hours), `password`.
  Handler resolves `path` inside the caller's scope (`JoinScopedIndexPath`),
  rejects paths that do not exist (403), stores `UserID = caller`, generates
  a secure random `hash`, bcrypts the password. `expire` is a unix timestamp,
  `0` = never. Response is `http.ShareResponse` incl. `hash`, `expire`,
  `hasPassword`, `path` (the **scoped** index path, e.g. `/alice/Docs/` on
  `home`, `/Docs/` on `share`), `source` (source *path* on disk), `username`.
- `GET /api/share/list` — admin: all links; others: own links only.
  `GET /api/share?path=&source=` — links for one item (caller's own).
  `DELETE /api/share?hash=` — owner or admin only (403 otherwise).
- Writes on a share are off unless `allowModify/allowCreate/allowDelete` are
  sent; Vaulta never sends them, so every link is read-only.
- **Public API** (no login) mounted at `/public/api/`, all keyed by `hash`:
  `GET share/info?hash=` (title, `hasPassword`, `shareType`, `expire`… never
  the token), `GET resources?hash=&path=` (listing / file info, same shape
  as `/api/resources`), `GET resources/download?hash=&file=&inline=true`,
  `GET resources/preview?hash=&path=&size=`. Paths are relative to the
  share root; `withHashFile` refuses anything outside it and 404s an
  unknown / expired hash.
- **Password model** (`authenticateShareRequest`): a password-protected
  share accepts either header `X-SHARE-PASSWORD: <plain>` on each request or
  `?token=<share token>`. The token is only ever returned to the *owner*
  (`share.Link.token` via `/api/share/list`), never to guests, so a guest
  browser can only satisfy the check with the header. Consequence: for
  password shares, anything a browser loads by URL (`<img>`, `<video>`,
  `<iframe>`) cannot authenticate; content must be fetched with the header
  and shown from a blob URL.
- FBQ's own guest page `/public/share/<hash>` and its assets under
  `/public/static/` exist but are **not** exposed: Vaulta's nginx will proxy
  only `/public/api/`.
- PDF thumbnails still crash FBQ 1.5.5 (issue #2763); the guest listing
  must apply the same `canRequestThumbnail()` guard as the main app.

## Architecture

```
Owner (logged in)                          Guest (no account)
  ContextMenu → "Share link"                  GET /s/<hash>  → Vaulta SPA (index.html)
  ShareDialog ── api/share.js ──> /api/share  GuestShareView ── api/publicShare.js ──> /public/api/*
  Sidebar "Links" → LinksView                  (nginx: new location /public/api/ → FBQ :30334)
```

No change to nasapi, FBQ config, or the quota gate (guests never write).

## Components

### 1. `frontend/src/api/share.js` (owner side)
- `createShare(source, path, { expiry, password })` → `POST /api/share`.
  `expiry` is one of `'1d' | '7d' | '30d' | 'never'`; body built by
  `buildCreateBody()` (below). Returns the FBQ response.
- `listShares()` → `GET /api/share/list`.
- `sharesFor(source, path)` → `GET /api/share?path=&source=`.
- `deleteShare(hash)` → `DELETE /api/share?hash=`.
All use `authorizedFetch` + `apiError` like every other client.

### 2. `frontend/src/components/shareLinks.js` (pure, tested)
- `EXPIRY_OPTIONS = [{value:'1d',label:'1 day'},{value:'7d',…},{value:'30d',…},{value:'never',label:'Never'}]`
- `buildCreateBody({ source, path, expiry, password })` →
  `{ source, path, expires: '1'|'7'|'30' | '' , unit: 'days', password }`;
  `never` → `expires: ''` (omit); empty password → omit key.
- `guestUrlFor(hash, origin = window.location.origin)` → `${origin}/s/${hash}`.
- `parseGuestHash(pathname)` → hash or `null` for `/s/<hash>` (hash charset
  `[A-Za-z0-9_-]`).
- `formatExpiry(expireUnix, now = Date.now())` → `'Never'`, `'Expired'`,
  `'in 6 days'`, `'in 3 hours'`, `'in 20 minutes'`.
- `shareDisplayName(share)` → basename of `share.path` (strip trailing `/`),
  `'/'` root → the source label (`My Drive` / `Shared`).
- `driveLabelFor(share, sources)` → `'My Drive'` when `share.source` ends in
  the home source path, else `'Shared'` (FBQ returns the disk path here).

### 3. `ShareDialog.vue`
Props `{ entry, source, path }`. Opened from `ContextMenu` ("Share link"
button, visible in `browse` and `starred` views, not in `trash`).
- Form: expiry `<select>` (default `7d`), optional password input, Create.
- After create: shows the guest URL in a read-only input + **Copy** button
  (`navigator.clipboard.writeText`, fallback: select the text).
- "Existing links" list from `sharesFor()`: expiry text, lock badge when
  `hasPassword`, Copy, Revoke (`deleteShare`, then refresh list).
- Errors via `showError()`; dialog uses `v-dialog-focus` like the others.

### 4. `LinksView.vue` + Sidebar entry
- `App.vue` gains `view === 'links'`; Sidebar gets a "Links" item after
  Trash (icon: link). TopBar title "Links".
- Rows: `shareDisplayName`, drive label, owner username (admin only),
  `formatExpiry`, lock badge, Copy, Revoke. Empty state: "No links yet".
- Loads via `listShares()` on entering the view; revoke removes the row.

### 5. Guest route
- `main.js`: `const guestHash = parseGuestHash(location.pathname)`; if set,
  mount `GuestApp.vue` instead of `App.vue` (same Pinia, same theme CSS).
  `GuestApp` never imports the auth/files stores and never calls
  `/api/users`, so no login redirect and no 401 handling fire.
- `frontend/src/api/publicShare.js`:
  `getShareInfo(hash)`, `listPublic(hash, path, password)`,
  `publicDownloadUrl(hash, file, { inline })`, `publicPreviewUrl(hash, path, size)`,
  `fetchPublicBlob(hash, file, password)` (fetch with `X-SHARE-PASSWORD`,
  returns `URL.createObjectURL(blob)`), `fetchPublicText(hash, path, password)`
  (`?content=true`). Every request carries the header when a password is set.

### 6. `GuestShareView.vue` (inside `GuestApp`)
- States: `loading` → (`password` gate if `hasPassword`) → `browse` |
  `unavailable` (404 / expired: "ลิงก์นี้ใช้ไม่ได้แล้ว") | `error`.
- Password gate: input + button; verifies by `listPublic(hash, '/', pw)`;
  401 → "รหัสไม่ถูกต้อง"; the password lives in a `ref` for the tab only.
- Header: Vaulta brand, share `title` (or root item name), "Shared with
  you" caption. No sidebar, no upload, no selection, no context menu.
- Listing: reuse `FileListView`/`FileTile` **only if** they can run without
  the files/auth stores; they cannot (they import stores), so the guest
  listing is a small dedicated `GuestFileList.vue`: folders first, name,
  size, modified (`formatSize`, `formatRelativeTime`), thumbnail via
  `publicPreviewUrl` when `canRequestThumbnail(entry)` **and** no password
  (password shares show icons only), breadcrumb to navigate up.
- Open file → `Lightbox` with the new `urls` prop (see 7). Media plan from
  `guestMedia.js`:
  `mediaPlanFor(entry, { hasPassword })` → `{ kind, direct: bool }`; with a
  password: image/pdf/text are fetched as blob/text first, video is not
  played (download only). Blob URLs are revoked when the Lightbox closes.
- Download button per file: no password → `<a :href="publicDownloadUrl">`
  with `download`; password → `fetchPublicBlob` then programmatic
  `<a download>` click.

### 7. `Lightbox.vue` change
New optional prop `urls: { original, inline, preview, text, office: false }`.
When present, `src`/`pdfSrc`/`imageSrc`/text content come from it and the
office branch is skipped (`kind` never becomes `office` because
`onlyOfficeAvailable` stays false when `urls` is given). When absent,
behaviour is byte-for-byte today's. Existing Lightbox tests stay green.

### 8. Infrastructure
- `docker/nginx.conf`: add
  `location /public/api/ { proxy_pass http://127.0.0.1:30334/public/api/; proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr; client_max_body_size 0; }`.
  `/s/…` falls through to the existing SPA `location /`.
- `vite.config.js`: `navigateFallbackDenylist` gains `/^\/public\//`.
- Dev proxy: add `/public` → `VITE_API_TARGET`.

## Data flow (guest, password share)
1. `GET /s/abc` → index.html → `GuestApp` → `getShareInfo('abc')` →
   `{ hasPassword: true, title }`.
2. Guest types password → `listPublic('abc', '/', pw)` with header → 200
   listing (or 401 → retry).
3. Navigation repeats `listPublic` with header. Opening `photo.jpg` →
   `fetchPublicBlob('abc', '/photo.jpg', pw)` → blob URL → Lightbox
   `urls.original`. Closing revokes the blob.
Without a password the same flow uses direct `/public/api/...` URLs.

## Error handling
- Share create 403 "path not found" → "This item can't be shared" toast.
- Guest 404 (unknown/expired/revoked) → unavailable screen with a
  "Back to Vaulta" link. 401 → password retry. 5xx / network → generic
  error with retry.
- FBQ down → guest sees the generic error; owner UI already handles 502.

## Security
- Isolation and expiry are FBQ's: path fixed at creation inside the owner's
  scope; hash generated server-side by FBQ (`secure_hash`); password bcrypt; delete owner/admin
  only. Vaulta adds no bypass.
- Guests receive no session cookie, token, or user data. The public API
  answers only for the hash's subtree.
- Passwords are never put in URLs or storage; header only, tab memory only.
- FBQ's full guest UI stays LAN-only (`:30334`); only `/public/api/` is
  proxied.

## Non-goals
- Upload / editable shares, OnlyOffice for guests, folder ZIP download,
  download counters, per-user allowed usernames, share banners/themes,
  editing a link after creation (revoke + recreate instead).

## Testing
- Vitest: `shareLinks.test.js` (every helper), `guestMedia.test.js`,
  `api/share.test.js` and `api/publicShare.test.js` (mock `global.fetch`,
  assert URLs/headers/bodies), `ShareDialog.test.js` (create → URL shown,
  copy, revoke), `GuestShareView.test.js` (password gate 401→retry,
  unavailable on 404, listing renders, blob path for password share),
  `Lightbox.test.js` additions (uses `urls` when given, never office).
- `docker build` runs `nginx -t` implicitly at container start; verify with
  `docker run --rm nas-webui:local nginx -t`.
- Post-deploy: create a link for a folder in Shared, open it in a private
  window: listing, image preview, PDF preview, download; then a
  password-protected link: wrong password rejected, right one works;
  revoke → link shows unavailable.
