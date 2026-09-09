# Office document editing — deployment log

Date: 2026-09-09 (Asia/Bangkok)
Branch: `nas-webui-polish`
Source commit: `65b3d1f` (Office documents open editable in OnlyOffice; plain text gets a read-only viewer)

## Changes delivered

- FileBrowser Quantum `integrations.office.viewOnly` flipped `true` → `false`
  on VM 105 (`/mnt/.ix-apps/app_mounts/filebrowser-quantum/config/config.yaml`,
  backup at `config.yaml.bak-20260909-editing`); FBQ container restarted and
  reported healthy.
- Frontend: `lightboxKind.js` routes `txt`/`md`/`csv`/`log`/`json` to a new
  built-in read-only `<pre>` viewer so only office formats reach OnlyOffice;
  document top bar shows the edit/view mode label.
- Policy chosen by the user: on the shared drive anyone may edit anyone's
  office file. Owner-only delete unchanged.

## Release validation

- `npx vitest run`: 37 files / 286 tests passed (9 new: `lightboxKind`,
  `Lightbox` component).
- `npm run build`: passed. Go suite not re-run (no Go changes).

## Deployment

Status: **deployed** by 12:05 ICT. Image `nas-webui:local`, `linux/amd64`,
archive MD5 `5cd348504d3a6351214d4854bb61d114` matched on Mac, pve2 and the VM.
`docker compose -p ix-nas-webui up -d` recreated `ix-nas-webui-nas-webui-1`;
`docker image prune -f` reclaimed the old image; tarballs removed on pve2 and
in the VM.

Verified: `https://nas.codex074.com/` returns 200 and the served
`assets/index-*.js` contains `doc-mode` and the Thai view-only label.
Not verified (no credentials): an authenticated open of a `.docx` showing
"แก้ไขได้ · บันทึกอัตโนมัติเมื่อปิด", and a round-trip save landing on disk.
