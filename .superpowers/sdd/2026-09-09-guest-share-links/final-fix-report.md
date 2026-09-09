# Final review fix wave — guest share links

Branch `nas-webui-polish`, worktree `/Users/codex074/nas-webui/.worktrees/nas-webui-polish`.
All five findings (A–E) applied in one commit, test-first for B4/B5/C.

## A. `docker/nginx.conf` — guest API hardening

1. `client_max_body_size 0;` → `client_max_body_size 1m;` in `location /public/api/`
   (`docker/nginx.conf:70`). Left the two `/api/` blocks (upload paths) untouched.
2. Added `limit_req_zone $http_cf_connecting_ip zone=publicapi:1m rate=20r/s;` at
   the top of the file, above `map` (`docker/nginx.conf:1-4`), and
   `limit_req zone=publicapi burst=60 nodelay;` inside `location /public/api/`
   (`docker/nginx.conf:66`).
3. Added `add_header X-Robots-Tag "noindex" always;` to `location /`
   (`docker/nginx.conf:81`) as the finding literally specifies. **Also** added
   the same header to `location = /index.html` (`docker/nginx.conf:20-25`) —
   see Concerns; this is the block that actually serves `/s/<hash>` guest pages.

Verification:
```
$ docker build --platform linux/amd64 -f docker/Dockerfile -t nas-webui:local .
...
#24 naming to docker.io/library/nas-webui:local done

$ docker run --rm --platform linux/amd64 --entrypoint nginx nas-webui:local -t
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
```
Additionally ran the built image locally (`docker run -d -p 18090:8090 nas-webui:local`)
and confirmed at runtime (not just `nginx -t`, which can't check header placement):
```
$ curl -sI http://localhost:18090/s/abc123 | grep -i robots
X-Robots-Tag: noindex
$ curl -sI http://localhost:18090/ | grep -i robots
X-Robots-Tag: noindex
```

## B. `frontend/src/components/GuestShareView.vue`

**4. Mid-browse 404 now distinguishes a vanished subfolder from a revoked/expired share.**
In the `state.value === 'browse'` 404 branch of `load()` (`GuestShareView.vue:41-59`),
re-check the share with `await getShareInfo(props.hash)`; if that itself rejects
with `status === 404`, set `state.value = 'unavailable'`. Otherwise (resolves, or
rejects with any other status) keep the existing "This folder no longer exists."
message.

Test added: `frontend/tests/components/GuestShareView.test.js` —
"shows the unavailable screen when a subfolder 404s mid-browse because the share
itself was revoked" (mocks `listPublic` to 404 and `getShareInfo` to 404 on the
second call). The existing "keeps the current listing … subfolder 404s" test is
untouched and still passes (there `getShareInfo`'s persistent `mockResolvedValue`
keeps resolving, so it falls through to the folder message).

**5. `start()` now treats a 401 from `getShareInfo` as a password gate, not an error.**
`GuestShareView.vue:57-67`: if `getShareInfo` rejects with `status === 401`,
set `info.value = { hasPassword: true }` and `state.value = 'password'` instead
of falling into the generic `error` state.

Test added: "returns to the password gate when getShareInfo itself is
password-protected (401)" — asserts `form.password-gate` renders.

**6. `openEntry` now revokes the previous preview URL before assigning a new one.**
`GuestShareView.vue:114-118`: call `revokePreview()` immediately before
`revokePreview = built.revoke`, so opening a second preview without closing the
first can't leak a blob URL. No new test (not reachable via UI per the finding);
confirmed no regression in existing preview tests.

RED (before implementation, `npx vitest run tests/components/shareLinks.test.js tests/components/GuestShareView.test.js`):
```
❯ tests/components/shareLinks.test.js (12 tests | 1 failed)
  × rounds 23.5-24h expiries up to 1 day, not down to 0
❯ tests/components/GuestShareView.test.js (10 tests | 2 failed)
  × shows the unavailable screen when a subfolder 404s mid-browse because the share itself was revoked
    AssertionError: expected '...' to contain 'ลิงก์นี้ใช้ไม่ได้แล้ว'
  × returns to the password gate when getShareInfo itself is password-protected (401)
    AssertionError: expected false to be true
Test Files  2 failed (2)
     Tests  3 failed | 19 passed (22)
```

GREEN (after implementation, same command):
```
Test Files  2 passed (2)
     Tests  22 passed (22)
```

## C. `frontend/src/components/shareLinks.js` — `formatExpiry` rounding

`frontend/src/components/shareLinks.js:37`: `Math.floor(diffMs / 86_400_000)` →
`Math.max(1, Math.floor(diffMs / 86_400_000))`, applied once the minutes/hours
branches are passed (hours already rounds up to 24 for anything ≥ 23.5h, so by
the time we reach the days branch a sub-24h remainder must read as "in 1 day",
never "in 0 days").

Test added: `formatExpiry(now/1000 + 23.8*3600, now)` → `'in 1 day'`. All
existing `formatExpiry` cases (Never/Expired/minutes/hours/6-day case) unchanged
and still pass — `6*86400+3600` still floors to 6 under `Math.max(1, ...)`.

RED/GREEN: see the combined shareLinks.test.js + GuestShareView.test.js run above
(same command covered both files' new tests).

## D. `frontend/src/vaulta-theme.css` — guest-links theme overrides

Confirmed real class names before writing selectors:
- `ShareDialog.vue:70` — dialog root is `<div class="menu share-dialog" ...>` —
  matches the finding's `.share-dialog` assumption exactly.
- `ShareDialog.vue:83` — create button is `<button class="create" ...>` —
  matches `button.create`.
- `ShareDialog.vue:97` — revoke button is `<button class="danger revoke" ...>` —
  matches `button.danger`.
- `GuestShareView.vue` — password form is `<form class="password-gate" ...>`
  (line ~172→176 after edits) and the loading/unavailable/error blocks are
  `<div class="guest-status" ...>` — matches `.password-gate` / `.guest-status`.
- `LinksView.vue:47` — `<section class="links-view" ...>`, revoke button
  `<button class="revoke danger" ...>` — matches `.links-view button.danger`.

No selector adjustments were needed; all class names in the finding match the
codebase as written.

Rules appended at `frontend/src/vaulta-theme.css:216-221`, directly after the
last `#app .menu ...` rule (`#app .menu input { margin: 6px 0; }`) and **before**
the responsive `@media` blocks further down the file. Placement matters here:
`.share-dialog` shares its root element's class list with `.menu`
(`class="menu share-dialog"`), and both `#app .menu` and `#app .share-dialog`
have equal specificity (id + one class), so CSS source order decides ties. By
inserting before the mobile breakpoint's `#app .menu { width: 100%; ... }`
override (further down the file), the mobile full-width behavior for the share
dialog is preserved — the later, mobile-scoped `#app .menu` rule still wins
inside that `@media` block. Had the new rule been appended at the very end of
the file instead, it would have permanently overridden the mobile menu's width
for the share dialog even on narrow viewports.

## E. `AGENTS.md`

Appended one sentence to the existing "Password shares can only be read with a
request header" gotcha (`AGENTS.md`, guest-share section): "The guest API is
also rate-limited per `CF-Connecting-IP` at nginx (`limit_req` zone
`publicapi`); on the LAN the header is absent so there is no limit."

## Suite / build / docker summary

```
$ cd frontend && npx vitest run
 Test Files  45 passed (45)
      Tests  338 passed (338)   # 335 baseline + 3 new (B4, B5, C)

$ npm run build
✓ built in 236ms
PWA v1.3.0 — files generated: dist/sw.js, dist/workbox-9c191d2f.js

$ docker build --platform linux/amd64 -f docker/Dockerfile -t nas-webui:local .
... naming to docker.io/library/nas-webui:local done

$ docker run --rm --platform linux/amd64 --entrypoint nginx nas-webui:local -t
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
```

## Concerns

- **Finding A.3 as literally written (`X-Robots-Tag` only in `location /`)
  would not have reached `/s/<hash>` guest pages.** `try_files $uri $uri/
  /index.html` performs an *internal redirect* to `/index.html` for any path
  that doesn't exist on disk (which is every `/s/<hash>` guest URL), and nginx
  re-enters location matching for that redirect — landing in the exact-match
  `location = /index.html` block, not `location /`. Response headers for
  `/s/<hash>` therefore come from `location = /index.html`, which is exactly
  why the pre-existing `Cache-Control: no-cache, no-store, must-revalidate` is
  already set there rather than in `location /`. `nginx -t` cannot catch this
  (it only checks syntax), so I added the header to **both** blocks: to
  `location /` per the finding's literal text (covers static-file hits like
  `/robots.txt` that don't redirect), and to `location = /index.html` so it
  actually lands on the guest share pages the finding is protecting. Verified
  at runtime with `curl -sI .../s/abc123` showing the header present (see
  above) — confirms the concern was real, not hypothetical.
- No other deviations. All other findings applied exactly as specified; the
  class-name checks in D confirmed no adjustment was needed.
