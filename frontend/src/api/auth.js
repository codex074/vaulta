import { authorizedFetch, apiError } from './http.js'

export async function login(username, password) {
  const url = `/api/auth/login?username=${encodeURIComponent(username)}&recaptcha=`
  const response = await authorizedFetch(url, {
    method: 'POST',
    headers: { 'X-Password': password, 'X-Secret': '' },
  })
  if (!response.ok) throw await apiError(response)
}

export async function logout() {
  const response = await authorizedFetch('/api/auth/logout', { method: 'POST' })
  if (!response.ok) throw await apiError(response)
}

export async function getCurrentUser() {
  const response = await authorizedFetch('/api/users?id=self')
  if (!response.ok) throw await apiError(response)
  return response.json()
}

// FileBrowser Quantum's PUT /api/users silently resets every field not named in
// `which` to its zero value (undocumented in its swagger spec, confirmed against
// the live backend and by reading its own frontend bundle) — never send a raw
// user object here, always the {which, data} envelope with only `password` named.
export async function renewToken() {
  const response = await authorizedFetch('/api/auth/renew', { method: 'POST' })
  if (!response.ok) throw await apiError(response)
}

export async function changePassword(currentPassword, newPassword) {
  const user = await getCurrentUser()
  const response = await authorizedFetch(`/api/users?id=${user.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Password': currentPassword },
    body: JSON.stringify({ which: ['password'], data: { password: newPassword } }),
  })
  if (!response.ok) throw await apiError(response)
}
