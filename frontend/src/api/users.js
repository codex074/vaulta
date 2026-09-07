import { authorizedFetch, apiError } from './http.js'

export async function listUsers() {
  const response = await authorizedFetch('/api/users')
  if (!response.ok) throw await apiError(response)
  return response.json()
}

// See auth.js's changePassword for why this is a {which, data} envelope, not a
// raw user object: `which: []` (Quantum's own convention for "create with a
// full record") plus X-Password for the acting admin, confirmed live.
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
        scopes: [{ name: 'share', scope: '/' }],
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
