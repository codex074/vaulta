# Vaulta iOS redesign — deployment log

Date: 2026-09-09 (Asia/Bangkok)
Branch: `nas-webui-polish`
Previous commit: `9582fe869155313fe38c7dc6d57d29d02448b8a6`
Codex task: `01a081cf-d3e6-78a1-9480-30b176c983c9`

## Changes delivered

- Replaced the visual theme with system typography, iOS blue, large page
  titles, quiet grouped surfaces, and coordinated light/dark colors.
- Added labeled bottom tabs for compact windows and landscape phones;
  retained an adaptive sidebar for iPad and desktop, including Split View.
- Redesigned login, file grid/list, navigation/search, storage display,
  account settings, user management, new-folder dialogs and file actions.
- Replaced file emoji with local SVG folder/document glyphs. Updated mobile
  list rows to show size/date under file names without horizontal scrolling.
- Made icon actions and selections accessible by name, enlarged touch
  targets, and added modal focus trapping, Escape dismissal and focus return.
- Kept Star available through file actions on compact lists. Fixed opening
  starred folders to enter the corresponding drive/folder browse view.
- Synchronized collection titles and search clearing with navigation; reset
  the file pane scroll position on navigation and updated browser theme color.
- Preserved the existing Vue/PWA stack, API clients, private-drive permissions,
  storage quota enforcement, file operations, and backend deployment settings.
- Added component tests and documented layout and validation in
  `docs/design/2026-09-09-ios-redesign.md`.

## Release validation

- 2026-09-09 06:48 ICT: reran frontend tests in the deployment worktree;
  **35 files / 277 tests passed**.
- Go sidecar `go test ./... -race` using `golang:1.22`: **passed**.
- Previous Vite/PWA production build: **passed**. The deployment image rebuild
  below also compiles the production frontend from the release source.
- Previous Chromium UI checks with synthetic API responses: nine configurations,
  320–1440px wide, covering iPhone portrait/landscape, iPad portrait/landscape,
  Split View, desktop and dark mode. Grid/list, search/reset, folder/back,
  Starred navigation, account/settings, action sheets, new-folder cancellation
  and login passed; no horizontal overflow or page errors reported.
- Pre-deploy TrueNAS check: nas-webui running; FileBrowser Quantum healthy;
  OnlyOffice and Cloudflare tunnel running.

## Deployment

Status: **deployed and verified** on 2026-09-09, by 06:56 ICT.
Source release commit: `4baa7f3` (`Redesign Vaulta for iPhone and iPad`).
Deployment target: TrueNAS VM 105 on Proxmox pve2 (`100.71.13.117`).
Compose project: `ix-nas-webui`. Image: `nas-webui:local`, `linux/amd64`.
Running container: `ix-nas-webui-nas-webui-1` (`running`).

Running image ID:
`sha256:89184115e57546066d9a3acc76e5eab7d91539d1d3ce3ae17d67006c1a06f58e`

Archive MD5, matched independently on Mac, pve2 and TrueNAS:
`b03ca4ab3a1304ed853eb22beaf78bfe`

### Execution record

1. Built the image from the committed worktree with the prescribed
   `docker build --platform linux/amd64 -f docker/Dockerfile -t nas-webui:local .`.
   The container build's Vite/PWA production compilation passed.
2. Tagged the prior live image `nas-webui:pre-ios-20260909` for rollback.
   Prior image ID:
   `sha256:7cdd24ebb5dab7e8b639be55dd459b3ca5087c6b2c667b96d489feb383658090`.
3. Exported the 32 MB archive, transferred it to pve2, and verified MD5.
   Automatic approval review initially blocked SCP pending destination
   evidence. Read-only checks confirmed the SSH host is pve2 and VM 105
   serves the same Vaulta HTML/assets as the public production URL. The same
   SCP command was then approved and completed.
4. Started the temporary transfer server bound to `192.168.1.16:8765`,
   restricted to a fresh directory containing only a symlink to the release
   archive. Downloaded it into VM 105 and confirmed the same MD5 there.
5. Stopped the exact temporary server PID, removed its directory and the pve2
   archive, then loaded the image into TrueNAS. Confirmed amd64 architecture.
6. Recreated only the documented Compose project using the exact rendered
   compose path and `-p ix-nas-webui up -d --force-recreate`.
7. Verified the running image ID and public HTTP/bundle checks below.
   FileBrowser Quantum remained healthy; OnlyOffice and the Cloudflare tunnel
   remained running. Removed the temporary archive from TrueNAS.
8. Automatic approval review rejected broad `docker image prune -f` because
   it could remove unrelated images on the shared production VM. No image
   pruning was performed; cleanup was limited to this release's transfer
   files/server, and the previous Vaulta image remains tagged for rollback.

### Public verification

- `https://nas.codex074.com/`: **HTTP 200**.
- `https://nas.codex074.com/nasapi/storage`: **HTTP 200**.
- Public HTML references the new JS/CSS filenames and light theme color.
- Both downloaded production assets are byte-for-byte equal to the tested
  build, with SHA-256 checksums:
  - `assets/index-BJP2P3aU.js`:
    `f9b516241acab9ee00e55a9cdb1a60372e30c302fce2db5036050d2b70d8f6e3`
  - `assets/index-B7brrpby.css`:
    `c05599099ab35839aec02f5a74214c6e1c11b248091761ed4e862ee43f664bc0`
- JS includes the new `Add to Starred`, `Your files.` and `folder-opened`
  markers; CSS includes the new mobile account-label styles.

## Verification limits

Browser screenshots use synthetic identities and files. Physical-device
Safari and authenticated live uploads, quota and OnlyOffice workflows have
not been tested in this pass. Production verification covers service health
and the actual deployed HTML/JS/CSS bundle; no live user data is modified.
