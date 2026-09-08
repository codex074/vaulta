# Vaulta adaptive interface

The file library now uses system typography, an iOS blue accent, grouped file
surfaces, large titles, and consistent light/dark materials. The existing Vue,
Pinia, FileBrowser Quantum and nasapi architecture is retained.

## Interaction and layout

- Compact windows use five labeled bottom tabs. Landscape phones also use
  compact navigation so Account and the other tabs stay within the viewport.
- iPad and desktop use a sidebar and independently scrolling content. The
  toolbar remains visible, and navigation resets the file pane to the top.
- List rows combine file size/date under the name on narrower screens rather
  than requiring horizontal scrolling. Star remains available in the file
  action sheet when its dedicated column is hidden.
- File actions and settings become bottom sheets on compact windows. Modal
  focus stays inside the sheet, Escape closes it, and focus returns to the
  invoking control. Icon controls and selection checkboxes have names.
- Collection titles and the visible search value track navigation. Opening a
  starred folder returns to the browse view for that folder's own drive.
- Safe-area insets, dynamic viewport height, 16px form inputs, reduced motion,
  and light/dark browser theme colors support use on mobile and as a PWA.

The authoritative responsive stylesheet is `frontend/src/vaulta-theme.css`.
File glyphs are code-native SVG in `FileGlyph.vue`; they require no external
fonts, image services, or dependencies. `dialogFocus.js` handles modal keyboard
behavior independently of its presentation.

## Validation

- Frontend: 35 Vitest files, 277 tests pass.
- Production Vite/PWA build passes.
- Go sidecar: `go test ./... -race` passes using Docker `golang:1.22`.
- Chromium browser checks with intercepted, synthetic API responses cover
  320×568, 375×667, 393×852 (light and dark), 844×390, 507×768,
  768×1024, 1180×820, and 1440×1000.
- Checked grid/list, long names, search/reset, folder/back navigation,
  Starred-folder navigation, action sheets, Account/settings, new-folder
  cancellation, sticky toolbar, and login. No horizontal overflow or browser
  page errors were reported by those checks.

These are browser viewport checks, not physical-device Safari verification.
The fixture identities and files in review screenshots are synthetic. Live
login, uploads, quota enforcement, and OnlyOffice against the NAS were not
exercised in this design pass. The subsequent production deployment and its
verification are recorded in [the deployment log](../deployments/2026-09-09-ios-redesign.md).
