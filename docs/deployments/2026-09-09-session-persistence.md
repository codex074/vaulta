# Session persistence + password visibility — deployment log

Date: 2026-09-09 (Asia/Bangkok)
Branch: `nas-webui-polish`
Source commit: `aef7fbc` (Sessions: cache the storage-reachability probe …)
Spec: `docs/superpowers/specs/2026-09-09-session-persistence-design.md`
Plan: `docs/superpowers/plans/2026-09-09-session-persistence.md`

## What shipped

- Login: "Keep me signed in" checkbox (unticked by default) and a notice
  when the app signed the user out for inactivity. Every password field has
  a show/hide toggle (`PasswordInput`), with spellcheck/autocorrect off.
- Sessions: FBQ's `X-Renew-Token` triggers a throttled `POST /api/auth/renew`
  (never for an idle-expired session). Unremembered sessions sign out after
  1 hour without pointer/keyboard/scroll/upload activity, checked every
  minute, on tab return and on page load. Fail-closed rules: a failed
  logout keeps the stale activity stamp so the next load signs out again;
  a valid cookie with no stored prefs (legacy/purged) is signed out; when
  storage throws, an in-memory mirror enforces the limit for the tab.
- FBQ config on the NAS: `auth.tokenExpirationHours: 720` appended
  (backup `config.yaml.bak-20260909-sessions`), FBQ restarted, healthy.

## Process

Six plan tasks by Sonnet subagents, test-first, each gated by a review (fix
rounds on Task 3 — a clock bug in the plan's own test — and Task 5 — login
field styles not reaching the child input). Opus whole-branch review found
two spec defects (failed-logout resurrection; missing-storage fail-open) →
one fix wave + two follow-ups (first-time-visitor notice; probe caching) →
scoped re-reviews clean.

## Validation

- `npx vitest run`: 50 files / 397 tests passed (360 before the feature).
- `npm run build`: passed. Go suite untouched.

## Deployment

Status: **deployed** at 22:43 ICT. Image `nas-webui:local`, `linux/amd64`,
archive MD5 `ad0f43eb793f0e9695fcac762930dec1` matched on Mac, pve2 and the VM.
Container recreated; old image pruned; tarballs removed.

```
ix-nas-webui-nas-webui-1 Up 56 seconds
ix-filebrowser-quantum-filebrowser-quantum-1 Up 2 minutes (healthy)
```

Served `assets/index-OUGGNP19.js` contains `vaulta-remember`, "Keep me signed
in", `toggle-password`, `/api/auth/renew`, `X-Renew-Token` and the idle notice.

Not verified without a session: the idle sign-out on a real device, a renew
round-trip (`X-Renew-Token` reaching the browser through Cloudflare), and
the login/dialog toggle placement. Checklist handed to the user.

## Consequences of the 720 h token (from source, FBQ v1.5.5)

- Web tokens are validated by signature and expiry only; a password change
  does NOT invalidate outstanding tokens. Revocation now takes up to 30 days
  instead of 2 hours. Cookies are HttpOnly, SameSite=Strict, Secure on HTTPS.
- FBQ's own LAN UI on :30334 inherits the 30-day lifetime with no idle policy.
- Already-issued 2 h cookies keep their expiry; users re-login once.
