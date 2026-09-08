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

Status: preparing the linux/amd64 image using the established AGENTS.md path.
Deployment target: TrueNAS VM 105 on Proxmox pve2 (`100.71.13.117`).
Compose project: `ix-nas-webui`. Image: `nas-webui:local`.

The final image identity, transfer checksums, time, and public bundle checks
will be recorded here after deployment completes.

## Verification limits

Browser screenshots use synthetic identities and files. Physical-device
Safari and authenticated live uploads, quota and OnlyOffice workflows have
not been tested in this pass. Production verification covers service health
and the actual deployed HTML/JS/CSS bundle; no live user data is modified.
