import { authorizedFetch, apiError } from './http.js'

const USERNAME_RE = /^[A-Za-z0-9._-]{1,32}$/

// The username becomes a literal folder name on disk under /srv/home, so
// this both matches FileBrowser Quantum's own constraints and refuses the
// two names that would otherwise resolve to "the folder itself" or "its
// parent" once joined onto a path.
export function isValidUsername(name) {
  if (!USERNAME_RE.test(name)) return false
  if (name === '.' || name === '..') return false
  return true
}

export async function listUsers() {
  const response = await authorizedFetch('/api/users')
  if (!response.ok) throw await apiError(response)
  return response.json()
}

// See auth.js's changePassword for why this is a {which, data} envelope, not a
// raw user object: `which: []` (Quantum's own convention for "create with a
// full record") plus X-Password for the acting admin, confirmed live.
//
// Scopes granted at creation time: every user gets `/` on `share` (today's
// shared-area behavior, unchanged), plus a `home` scope — `/` for an admin
// (so they can reach every user's private folder for support purposes) or
// `/<username>` for everyone else. Sending these scopes here is what makes
// FBQ's own MakeUserDirs create /srv/home/<username> on disk; no separate
// mkdir step is needed.
export async function createUser(actorPassword, { username, password, admin = false }) {
  const response = await authorizedFetch('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Password': actorPassword },
    body: JSON.stringify({
      which: [],
      data: {
        username,
        password,
        loginMethod: 'password',
        permissions: {
          api: true, modify: true, share: true, realtime: true,
          delete: true, create: true, download: true, admin,
        },
        scopes: [
          { name: 'share', scope: '/' },
          { name: 'home', scope: admin ? '/' : `/${username}` },
        ],
      },
    }),
  })
  if (!response.ok) throw await apiError(response)
}

export async function deleteUser(id, actorPassword) {
  const response = await authorizedFetch(`/api/users?id=${id}`, {
    method: 'DELETE',
    headers: { 'X-Password': actorPassword },
  })
  if (!response.ok) throw await apiError(response)
}

// FBQ replaces a user's entire Scopes list wholesale on update (see
// resources.js/quota.js design notes) and only admins may change scopes, so
// this always sends the full, freshly-fetched user object with just the
// scopes field swapped in — never a partial patch.
export async function updateUserScopes(user, actorPassword, scopes) {
  const response = await authorizedFetch(`/api/users?id=${user.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Password': actorPassword },
    body: JSON.stringify({ which: ['scopes'], data: { ...user, scopes } }),
  })
  if (!response.ok) throw await apiError(response)
}
