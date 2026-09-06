# NAS Web UI Redesign — Design Spec

## Context

Earlier this session, a personal NAS was migrated from a plain Debian/Samba container to TrueNAS SCALE, and a self-hosted file-browser web app (FileBrowser Quantum) was deployed on it and exposed externally at `https://nas.codex074.com` via a dedicated Cloudflare Tunnel, so the user (`codex`) can browse and upload files from outside the home network.

After using it, the user doesn't like FileBrowser Quantum's stock look and feel. Its built-in customization is limited to six accent-color swatches, a rounded/sharp-corner toggle, dark/light mode, and language — nowhere near enough to change the "vibe" of the page. The user wants a genuinely new-feeling web UI, not a reskin, but has no concrete visual direction of their own yet.

Goal: design and build a custom frontend with a Google-Drive-like feel, reusing FileBrowser Quantum's already-working backend (auth, multi-user, storage, upload/download) via its REST API rather than rebuilding that logic from scratch.

## Visual Direction (validated via mockups)

Four visual decisions were shown to the user as side-by-side wireframes/mockups and confirmed by explicit click-through selection (not just described in words):

- **Layout:** narrow icon-rail sidebar (Notion/Linear style) — a slim column of icons on the left that can expand to show labels, rather than a full always-labeled sidebar (Google Drive classic) or no sidebar at all.
- **Palette:** Light + Blue — white/near-white backgrounds, light-gray secondary surfaces, a single blue accent (`#2563eb`-range) for primary actions and selection state. This is the closest of the three options shown to Google Drive's actual palette.
- **File/folder tile (grid view):** "info-dense" style — thin border, no drop shadow, a persistent (not hover-only) three-dot (`⋮`) action menu on every tile, and a metadata row showing file size alongside a relative last-modified date (e.g. "2.4 MB · 2d ago").
- **File preview:** centered modal lightbox — dimmed backdrop, content floats centered, closes via an X button or backdrop click. Chosen over a side sliding panel and over full-page navigation.

## Architecture

A new lightweight container is added alongside the existing `filebrowser-quantum` and `nas-cloudflared` TrueNAS Apps (same Docker/Apps engine on the `tank` pool, no new infrastructure elsewhere):

- **Static frontend + reverse proxy in one container.** An nginx (or equivalent) container serves the built SPA's static assets, and reverse-proxies any request under `/api/*` to `filebrowser-quantum`'s internal address/port (`localhost:30334`, reachable via TrueNAS's shared Docker host network — the same mechanism already used by the `nas-cloudflared` app). This avoids CORS entirely and keeps a single origin from the browser's perspective.
- **Cloudflare Tunnel retarget.** The existing tunnel that currently points `nas.codex074.com` at `http://localhost:30334` (FileBrowser Quantum directly) gets repointed at this new container's port instead. No new tunnel/token needed — just an ingress-rule edit in the Cloudflare Zero Trust dashboard (user action, same as before).
- **FileBrowser Quantum keeps running unchanged**, still reachable on the LAN at `http://192.168.1.22:30334` directly (not through the tunnel), kept as a fallback admin tool — this is where the one FileBrowser-specific admin action we already needed once (creating a new user under a different username, since usernames can't be renamed) still has to happen, from its own built-in Settings UI.
- **No changes to FileBrowser Quantum's data model.** All files, users, and permissions continue to live exactly where they do today (`tank/share` dataset, FileBrowser's own user database). The new frontend is a presentation layer only.

## Components

- **Sidebar (icon-rail):** "My Files" entry (only section needed today — no Shared/Trash, since the FileBrowser backend has no such concept to surface), an Upload action, and a user avatar + logout control pinned to the bottom. Collapses to a bottom icon bar on narrow/mobile viewports rather than staying a left rail (a left rail that narrow would be unusable).
- **Top bar:** clickable breadcrumb (jump back to any ancestor folder in one click), a search input, a grid/list view toggle, and a "New folder" action.
- **Grid view (default) / List view (toggle):** grid shows the info-dense tiles described above; list shows the same items as rows with name/size/modified columns. The toggle preference should persist per-browser (localStorage), not reset every visit.
- **Upload:** drag-and-drop anywhere over the content area (no dedicated drop-zone box needed) plus an explicit Upload button that opens the native file picker; progress shows as a toast/tray in the bottom-right corner, one row per in-flight file.
- **Nested folder creation:** typing a slash-separated path (e.g. `A/B/C`) in the "New folder" dialog creates the whole chain in one step — this already works against FileBrowser Quantum's API and needs no new backend behavior, just a text input that doesn't reject slashes.
- **File preview (lightbox):** centered modal; renders images/video/PDF inline where the browser can, otherwise shows a file-type icon with a Download button. Closes on X or backdrop click; arrow-key or edge-tap navigation to the next/previous file in the current folder is a nice-to-have, not required for v1.
- **Per-file actions (⋮ menu):** Rename, Move, Delete, Download, and Copy share-link if FileBrowser's API exposes one (to be confirmed during implementation — not blocking, falls back to just omitting that action if unsupported).
- **Multi-select:** shift-click range select and per-tile checkboxes (checkboxes appear on hover on desktop, on long-press on touch) to bulk-delete or bulk-move.

## Data Flow / API Integration

The frontend talks only to FileBrowser Quantum's existing REST API (already reverse-engineered and proven working this session):

- **Auth:** `POST /api/auth/login?username=<u>&recaptcha=` with the password passed as an `X-Password` header (not a JSON body field — this is FileBrowser Quantum's actual, undocumented convention, confirmed by reading its minified frontend bundle). Response sets a `filebrowser_quantum_jwt` cookie used for all subsequent calls.
- **Listing / file ops:** the `/api/resources` family (exact verbs and payload shapes for list/rename/delete/mkdir to be pinned down at implementation time by the same bundle-reading technique used for auth, since there is no public API doc).
- **Upload:** a multipart or chunked endpoint under `/api/resources` or similar — not yet exercised through raw API calls this session (only through the bundled UI), so this is the one piece of "data flow" that needs discovery work during implementation rather than being pre-verified here.
- **User management:** intentionally *not* reimplemented in the new frontend. Creating/editing sub-users continues to happen in FileBrowser Quantum's own Settings UI on the LAN, since we already hit real quirks there (e.g., usernames can only be set at creation time, not renamed) that are easier to keep behind FileBrowser's existing, tested UI than to re-expose through a new one.

## Error Handling

- Every mutating action (upload, rename, delete, mkdir, move) surfaces failures as a red toast in the bottom-right showing the actual message returned by the API, not a generic "something went wrong."
- A `401` response from any API call (expired/invalid session) redirects to the login screen with a "Please sign in again" message, rather than silently failing or showing an empty file list.

## Mobile Behavior

- Below a tablet-width breakpoint, the icon-rail sidebar becomes a bottom navigation bar (standard mobile app pattern) instead of trying to keep a left rail that would be too narrow to tap reliably.
- Grid view drops to 2–3 columns depending on viewport width.
- The lightbox preview already behaves correctly full-screen on small viewports with no special-casing needed.

## Testing / Verification

End-to-end manual verification against the live deployment before considering this done:

1. Deploy the new container on TrueNAS, confirm it's reachable locally and proxies `/api/*` correctly to FileBrowser Quantum.
2. Repoint the Cloudflare Tunnel ingress rule to the new container; confirm `https://nas.codex074.com` serves the new UI.
3. Full manual flow on a desktop browser: log in → create a nested folder (`A/B`) → drag-and-drop upload a file → open it in the lightbox → rename it → delete it.
4. Repeat the same flow on an actual mobile device (not just a resized desktop browser window) to confirm the bottom-nav layout and touch interactions (long-press multi-select, drag-drop equivalent via the Upload button) work as designed.
5. Confirm FileBrowser Quantum's own UI is still reachable and functional on the LAN (`http://192.168.1.22:30334`) as the admin fallback, and is *not* reachable via the public tunnel anymore.
