# Chunked uploads — deployment log

Date: 2026-09-09 (Asia/Bangkok)
Branch: `nas-webui-polish`
Source commit: `24a3486` (Chunked uploads: restart from zero on failure, clean partials on error, 10 MiB chunks)
Spec: `docs/superpowers/specs/2026-09-09-chunked-uploads-design.md`
Plan: `docs/superpowers/plans/2026-09-09-chunked-uploads.md`

## Why

An .mp4 upload failed with 413. Reproduced from pve2 through the tunnel:
1 MB POST → 401 (reached FBQ), 105 MB POST → Cloudflare's own
"413 Payload Too Large" page, nothing in nginx/FBQ logs. Cloudflare caps a
request body at 100 MB; Vaulta sent whole files in one request.

## What shipped

- `uploadFile` sends files over 10 MiB as sequential chunks on the same
  POST using FBQ's `X-File-Chunk-Offset`/`X-File-Total-Size` protocol.
  Any network/5xx failure restarts the whole upload from offset 0 (FBQ
  deletes its temp file on a mid-body failure, so resuming at an offset
  would zero-fill the file); 3 whole-upload attempts; a 409 on a restart is
  accepted only if the target already has the full size.
- Listings hide FBQ's `<name>.<md5>.uploading.tmp`; cancelled AND failed
  uploads remove leftover partials.
- nasapi gate refuses an oversized file on chunk 0 (announced total vs
  remaining quota, overflow-safe) before any byte is written; per-chunk
  reservation remains the enforcement.

## Process

Five plan tasks by Sonnet subagents, test-first, each gated by a review
(one fix round on Task 2's abort test); Opus whole-branch review found the
resume-at-offset corruption (inherited from a wrong "verified fact" in the
spec) → one fix wave → scoped re-review clean. Specs corrected.

## Validation

- `npx vitest run`: 46 files / 359 tests passed (from 338 before the feature).
- Go sidecar `go test ./... -race` (golang:1.22 via Docker): passed; `gofmt -l` clean.
- `npm run build`: passed.

## Deployment

Status: **deployed** at 18:19 ICT. Image `nas-webui:local`, `linux/amd64`,
archive MD5 `07873552835bd8b5bc81524c28f4f746` matched on Mac, pve2 and the VM.
`docker compose -p ix-nas-webui up -d` recreated the container; old image
pruned; tarballs removed.

Containers after deploy:
```
ix-nas-webui-nas-webui-1 Up 58 seconds
ix-filebrowser-quantum-filebrowser-quantum-1 Up 6 hours (healthy)
```

Live checks (from pve2, unauthenticated):
- `GET /` → 200; served `assets/index-Dp7p1G9b.js` references both chunk
  headers and the 10 MiB constant.
- Chunk-0 POST with both headers and a 1 MB body through the tunnel → 401
  from FBQ, i.e. Cloudflare and nginx pass chunk requests through.

Not verified (needs a real session): a ~150 MB upload landing with the right
checksum, a retry after a dropped connection, and cancel leaving no
`.uploading.tmp`. Handed to the user as the post-deploy checklist.
