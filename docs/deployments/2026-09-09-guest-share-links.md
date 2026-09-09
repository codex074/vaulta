# Guest share links — deployment log

Date: 2026-09-09 (Asia/Bangkok)
Branch: `nas-webui-polish`
Source commit: `695b7c0` (Guest links: harden nginx, mid-browse revoke, expiry rounding, theme overrides)
Spec: `docs/superpowers/specs/2026-09-09-guest-share-links-design.md`
Plan: `docs/superpowers/plans/2026-09-09-guest-share-links.md`

## What shipped

- Owner side: "Share link" in the file menu → ShareDialog (expiry 1/7/30 days or never, optional password, copy, existing links, revoke); "Links" sidebar view listing my links (admins: everyone's).
- Guest side: `/s/<hash>` served by the SPA as a separate GuestApp; browses, previews (image/video/PDF/text) and downloads via FBQ's `/public/api/*`; password gate via `X-SHARE-PASSWORD`; password shares use blob URLs for media and download-only video.
- nginx: `/public/api/` proxied to FBQ (1 MB body cap, `limit_req` per `CF-Connecting-IP` 20 r/s burst 60); `X-Robots-Tag: noindex` on the SPA shell; service-worker denylist covers `/public/`.

## Process

Nine plan tasks, each implemented by a fresh Sonnet subagent test-first and gated by a task review; one fix round on Task 8 (four state-machine gaps); Opus whole-branch review → one fix wave (nginx hardening, mid-browse revoke re-check, 401→password gate, expiry rounding, theme overrides) → scoped re-review clean.

## Validation

- `npx vitest run`: 45 files / 338 tests passed (from 335 before the feature: +9 files, +48 tests over the branch).
- `npm run build`: passed. `docker run --entrypoint nginx nas-webui:local -t`: syntax ok / test successful. Go suite not run (no Go changes).

## Deployment

Status: **deployed** at 16:28 ICT. Image `nas-webui:local`, `linux/amd64`, archive MD5 `39a62693010f4f2fd850f5de9d9b72ec` matched on Mac, pve2 and the VM. `docker compose -p ix-nas-webui up -d` recreated the container; old image pruned; tarballs removed.

Containers after deploy:
```
ix-nas-webui-nas-webui-1 Up About a minute
ix-filebrowser-quantum-filebrowser-quantum-1 Up 4 hours (healthy)
```

Live checks (unauthenticated, from pve2):
- `GET /` → 200; served bundle `assets/index-BXPnyqNS.js` contains `guest-shell`.
- `GET /s/abc123` → 200 with `x-robots-tag: noindex` and the SPA's no-store cache header.
- `GET /public/api/share/info?hash=doesnotexist` → 404 JSON from FBQ (proxy works).
- `GET /public/share/x` → 200 text/html (SPA shell, FBQ's own guest UI stays unexposed).
- `POST /public/api/resources?hash=doesnotexist` → 404 (no 5xx from nginx/FBQ).

Not verified (needs a real account): creating a link, opening it in a private window, password flow, revoke → unavailable, and `curl -X POST` against a real share hash to confirm FBQ refuses writes. See the checklist handed to the user.
