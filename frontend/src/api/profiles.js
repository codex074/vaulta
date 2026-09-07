import { authorizedFetch, apiError } from './http.js'

export async function getMyProfile() {
  const response = await authorizedFetch('/nasapi/profile')
  if (!response.ok) throw await apiError(response)
  return response.json()
}

export async function updateMyDisplayName(displayName) {
  const response = await authorizedFetch('/nasapi/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName }),
  })
  if (!response.ok) throw await apiError(response)
  return response.json()
}

export async function listProfiles() {
  const response = await authorizedFetch('/nasapi/profiles')
  if (!response.ok) throw await apiError(response)
  const payload = await response.json()
  return payload.profiles || {}
}

export async function updateUserDisplayName(uid, displayName) {
  const response = await authorizedFetch(`/nasapi/profiles/${encodeURIComponent(uid)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName }),
  })
  if (!response.ok) throw await apiError(response)
  return response.json()
}

export async function deleteUserProfile(uid) {
  const response = await authorizedFetch(`/nasapi/profiles/${encodeURIComponent(uid)}`, { method: 'DELETE' })
  if (!response.ok) throw await apiError(response)
}
