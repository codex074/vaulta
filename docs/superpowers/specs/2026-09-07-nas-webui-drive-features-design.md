# NAS Web UI — Starred, Trash, Storage Bar — Design Spec

## Context

The custom Drive-styled frontend built in the previous session (`docs/superpowers/specs/2026-09-06-nas-webui-design.md`) is live at `http://192.168.1.22:8090` (TrueNAS app `nas-webui`, image `nas-webui:local`, host-network container in front of FileBrowser Quantum on `127.0.0.1:30334`). The user now wants it to match Google Drive's sidebar more closely: a trash bin for recently deleted files, starring important files, and a storage-used indicator — shown as a reference screenshot of Drive's own sidebar (หน้าแรก / ไดรฟ์ของฉัน / ที่ติดดาว / ถังขยะ / พื้นที่เก็บข้อมูล with a usage bar).

Before designing, the running FileBrowser Quantum backend (v1.5.5-stable) was interrogated directly (live Swagger spec at `/swagger/doc.json`, and authenticated calls) to find out what it actually supports:

- **Starring:** native. `PATCH /api/users/pinnedItems?action=add|remove` with `{name, path, source}` toggles a pin; verified live (pinned `/Photos`, saw it appear in that folder's listing response under `pinnedItems: ["Photos"]`, then unpinned). Every `/api/resources` directory listing already includes a `pinnedItems: string[]` array naming which of *its own* entries are pinned. There is no endpoint that returns the *global* flat list of everything pinned — the full `users.User.pinnedItems` map exists in the Go struct but the `/api/users` responses used by this app never serialize it (confirmed empty on a real account with an active pin).
- **Trash:** does not exist. Delete calls `os.RemoveAll` — permanent, unrecoverable, no config flag changes this.
- **Storage usage:** no field anywhere in the API (settings, resources, or users responses) reports used/total bytes for a source. Confirmed via `df -h /srv/share` run *inside* the FileBrowser Quantum container that this data is available at the OS level (`tank/share`, ZFS dataset, 1.8T capacity) — it's just never surfaced over HTTP.
- Dot-prefixed folders (e.g. `/.trash`) are auto-excluded from `/api/resources` listings of their parent, with no client-side filtering needed, but remain directly reachable by listing that exact path. Verified by creating and deleting a real `/.trash` folder against the live instance.

Given this, the plan below extends the *existing* `nas-webui` app in place — no new TrueNAS App, no changes to FileBrowser Quantum — rather than a new subsystem.

## Sidebar Scope

Matches the reference screenshot for only the three things asked for, using existing Thai labels for consistency with the rest of this deployment's Thai-language surfaces:

- **หน้าแรก** (Home) — existing "My Files" browse view, now explicitly the default/root entry.
- **ที่ติดดาว** (Starred) — new.
- **ถังขยะ** (Trash) — new.
- **Storage bar** — used/total, pinned to the bottom of the sidebar.

`ไดรฟ์ของฉัน` / `คอมพิวเตอร์` / `แชร์กับฉัน` / `ล่าสุด` / `สแปม` from the screenshot are deliberately omitted: there's no backend concept behind any of them (no shares-with-me, no "recent" index beyond what search already gives, no spam), and adding placeholder nav items with nothing behind them would be worse than not having them. Can be revisited if the user asks for a specific one later.

## Feature: Starred (⭐)

- **Toggle:** a star button on `FileTile` (grid) and the list-view row, visible on hover/always-on-touch like the existing select checkbox. Calls the existing `PATCH /api/users/pinnedItems`. Reflects state from the current listing's `pinnedItems` array (`files.pinnedNames` — a `Set` computed from `entries` + the raw `pinnedItems` field returned alongside them), so no extra round-trip for the *current folder's* star state.
- **Starred view:** since there is no global-list endpoint, `ที่ติดดาว` does a client-side recursive walk from `/` — call `/api/resources` per folder (reusing the existing `listDirectory`), collect any entry whose name is in that response's `pinnedItems`, recurse into subfolders. Runs on-demand when the view is opened (not on every app load), with a loading state. Acceptable for a personal NAS's scale; if the tree ever grows large enough for this to be slow, a future revision would need a real backend index, which is out of scope here.
- Skips `/.trash` when walking (trash items are never "starred" in the UI sense; also avoids surfacing soft-deleted files as if they were live).

## Feature: Trash (🗑️)

FileBrowser Quantum's delete is permanent, so soft-delete is implemented entirely client-side using the existing move API — no backend change:

- **Delete → move to `/.trash`.** "Delete" (single or bulk) now calls `moveItem(originalPath, "/.trash/<ts>__<basename>")` instead of the permanent `deleteItem`/`bulkDelete`. `<ts>` is `Date.now()` in milliseconds, `<basename>` is the item's own name (file or folder) unchanged — this keeps the visible name in the trash view recognizable while guaranteeing uniqueness if the same name is deleted twice.
- **Metadata sidecar, one per trashed item.** Immediately after the move, upload a small JSON file `/.trash/<ts>__<basename>.trashmeta` with `{"originalPath": "<full path before delete>", "deletedAt": <ts>}`. Kept as one file per item (not one shared index file) specifically to avoid read-modify-write races when deleting multiple items in a bulk action.
- **`/.trash` is invisible during normal browsing** — confirmed above, dot-folders are excluded from parent listings automatically. The Trash view fetches it explicitly (`listDirectory('/.trash')`), pairs each real entry with its `.trashmeta` sidecar (skipping the `.trashmeta` files themselves from the displayed list), and shows name + "deleted \<relative time\>" (reusing the existing `formatRelativeTime` helper against `deletedAt`).
- **Restore:** reads the sidecar's `originalPath`, calls `moveItem(trashPath, originalPath)` — recreating the parent folder is not attempted; if the original parent was itself deleted/renamed since, the move fails and the existing error-toast path surfaces that (e.g. "destination not found") rather than silently doing something unexpected. Deletes the sidecar on success.
- **Delete Forever:** the *real*, permanent `deleteItem` on both the trashed entry and its sidecar.
- **Empty Trash:** a button in the Trash view's toolbar; iterates every entry currently in `/.trash` and does what Delete Forever does for each.
- Bulk-delete-from-normal-view and the existing multi-select bar keep working exactly as before from the user's perspective — they now just land in Trash instead of vanishing outright.

## Feature: Storage Bar

Since neither FileBrowser Quantum nor its API exposes disk usage, a tiny second binary is added to the **same** `nas-webui` Docker image/App (not a new TrueNAS App):

- **`nasapi`**: a ~30-line Go HTTP server, statically built in an added stage of the existing multi-stage `docker/Dockerfile`, that calls `syscall.Statfs` on a mounted path and serves `GET /storage` → `{"usedBytes": N, "totalBytes": N}`.
- **Docker Compose change:** the `nas-webui` service gains a read-only bind mount of `/srv/share` from the TrueNAS host's `tank/share` dataset (the same path FileBrowser Quantum itself already mounts), so `nasapi` reports real numbers for the same share the frontend browses. `nas-webui` currently uses `network_mode: host` with no volumes at all — this adds the one mount, nothing else changes about its networking.
- **nginx routes `/nasapi/` to `127.0.0.1:<nasapi-port>`**, alongside the existing `/api/` → `127.0.0.1:30334` proxy block already in `docker/nginx.conf`. Both processes run in the one container (nginx stays PID 1 / entrypoint owner; `nasapi` is started as a background process from a small wrapper entrypoint script, since this image has no supervisor today and adding a full one like s6 would be more than this needs).
- **Sidebar** fetches `/nasapi/storage` once on load (and on a coarse interval, e.g. every 60s, while the app is open) and renders a progress bar + "ใช้ไป X GB จาก Y GB" line, formatted with the existing `formatSize` helper.

## Data Flow Summary (new/changed calls only)

| Action | Call |
|---|---|
| Star / unstar | `PATCH /api/users/pinnedItems?action=add\|remove` |
| Load starred view | recursive `GET /api/resources` walk from `/`, filtered by each response's `pinnedItems` |
| Delete (now soft) | `PATCH /api/resources` (move) to `/.trash/<ts>__<name>`, then `POST /api/resources` (upload) of the `.trashmeta` JSON |
| Load trash view | `GET /api/resources?path=/.trash` |
| Restore | `PATCH /api/resources` (move) back to the sidecar's `originalPath`, then `DELETE` the sidecar |
| Delete forever / empty trash | `DELETE /api/resources` on the item and its sidecar |
| Storage bar | `GET /nasapi/storage` (new, same-origin, nginx-routed) |

## Error Handling

Follows the existing pattern (`showError` toast with the real API message, `401` → login redirect via `onUnauthorized`) for every new call above, including the two-step trash/restore sequences — if the second step (sidecar upload/delete) fails after the first (move) succeeds, the toast surfaces that explicitly (e.g. "Moved to trash, but couldn't save its restore info") rather than silently leaving an orphaned sidecar or item.

## Testing / Verification

1. Star a file from the grid view, confirm the star persists across a page reload (re-derived from the listing response, not local-only state) and appears in "ที่ติดดาว".
2. Delete a file, confirm it disappears from its folder immediately and appears in "ถังขยะ" with a correct "deleted just now" label; confirm it does **not** appear in a normal folder listing of its old parent, including after a reload.
3. Restore it, confirm it's back at the exact original path and gone from Trash.
4. Delete-forever an item from Trash, confirm it's actually gone (re-fetch Trash, re-fetch its old parent).
5. Bulk-select 3 files, delete, confirm all 3 land in Trash with independent sidecars (delete-forever one without affecting the other two).
6. Confirm the storage bar shows real numbers matching `df -h /srv/share` on the TrueNAS host, and updates after uploading a large-enough file to move the percentage visibly.
7. Rebuild and redeploy the `nas-webui` TrueNAS App; confirm both nginx-served static assets and the new `/nasapi/storage` route work post-redeploy (i.e. the entrypoint wrapper actually starts both processes reliably on container restart, not just on a fresh `docker build`).
