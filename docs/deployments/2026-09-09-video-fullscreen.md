# Video fullscreen fix — deployment log

Date: 2026-09-09 (Asia/Bangkok)
Branch: `nas-webui-polish`
Source commit: `ecb5f62` (Video fullscreen: lift the frame's size caps once Plyr is fullscreen; native fullscreen on iPhone)

## Root cause

`Lightbox.vue` capped `.plyr`, `.plyr__video-wrapper` and the `<video>` at
80vw × 75dvh for the in-frame view. Plyr's fullscreen styles (`.plyr:fullscreen`
and the `.plyr--fullscreen-fallback` used where the Fullscreen API is missing)
set width/height to 100% but never override max-width/max-height, and the
scoped selectors outrank them, so "fullscreen" rendered as a boxed video on a
black screen. Plyr was also left at its default `iosNative: false`, so iPhone
got the CSS fallback instead of Safari's native player.

## Change

- Caps now apply only to `.plyr:not(.plyr--fullscreen-active)` (Plyr sets that
  class for native and fallback fullscreen alike).
- Plyr options: `fullscreen: { enabled: true, fallback: true, iosNative: true }`.
- Test asserts the player is constructed with those options (RED before GREEN).

## Validation

- `npx vitest run`: 46 files / 360 tests passed. `npm run build`: passed.

## Deployment

Status: **deployed** at 19:34 ICT. Image `nas-webui:local`, `linux/amd64`,
archive MD5 `8ae90fb38a4aa3f5a9c986754dcbeb11` matched on Mac, pve2 and the VM.
Container recreated; old image pruned; tarballs removed.

```
ix-nas-webui-nas-webui-1 Up 45 seconds
ix-filebrowser-quantum-filebrowser-quantum-1 Up 7 hours (healthy)
```

Served `assets/index-D7mXWvXw.js` contains `iosNative:!0`; served
`assets/index-MDOIEC57.css` contains the three `:not(.plyr--fullscreen-active)`
guards. Not verified without a session: the fullscreen button on desktop
Chrome/Safari, iPad, and iPhone (native player).
