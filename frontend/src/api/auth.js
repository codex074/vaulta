import { authorizedFetch } from './http.js'

async function apiError(response) {
  const err = new Error(response.statusText || 'Request failed')
  err.status = response.status
  return err
}

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
