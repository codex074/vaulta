# PDF thumbnail guard — deployment log

Date: 2026-09-09 (Asia/Bangkok)
Branch: `nas-webui-polish`
Source commit: `8fedd0d` (Never request PDF-family thumbnails)

## Why

Users saw red "Request failed (502)" toasts while browsing quickly. Root
cause, from nginx + FBQ logs: every `GET /api/resources/preview` for
`home-server-guideline.pdf` in the share root made FileBrowser Quantum
1.5.5 print `aborting process from uncaught error!` (MuPDF `fz_throw`
outside a try block → `exit()`), Docker restarted it, and every request
in flight during those ~2 s got a 502. 46 such crashes since 2026-09-08
13:xx UTC; zero PDF previews ever completed, so nothing was cached and it
recurred on every listing. Upstream issue gtsteffaniak/filebrowser#2763,
fixed only in 2.x (beta only as of today; not backported to 1.5.x).

## Change

`canRequestThumbnail()` in `fileFormat.js` gates the grid tile, the list
row and the folder collage: pdf/xps/epub/mobi/fb2/cbz never get a
thumbnail request. The FBQ `viewOnly` change from earlier today is
unrelated and untouched.

## Validation

- `npx vitest run`: 37 files / 290 tests passed (4 new).
- `npm run build`: passed. Go suite not run (no Go changes).

## Deployment

Status: **deployed** at 13:38 ICT. Image `nas-webui:local`, `linux/amd64`,
archive MD5 `5fcf1cbab53029ad0fcfcc27a8b439a3` matched on Mac, pve2 and the
VM. `docker compose -p ix-nas-webui up -d` recreated the container; old image
pruned; tarballs removed. Served `assets/index-9_Tc__Kh.js` contains the
guard set. FBQ crash counter at deploy time: 46 — if it stays there after
normal browsing, the guard works.
