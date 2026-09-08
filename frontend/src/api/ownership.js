import { authorizedFetch, apiError } from './http.js'

export async function stampOwnership(path) {
  const response = await authorizedFetch('/nasapi/ownership', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
  if (!response.ok) throw await apiError(response)
  return response.json()
}

// Ownership is display/UI metadata, not a security control, so a failed
// lookup degrades to "no known owner" (permissive) rather than surfacing
// an error to the user.
export async function lookupOwnership(paths) {
  try {
    const response = await authorizedFetch('/nasapi/ownership/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths }),
    })
    if (!response.ok) return {}
    const payload = await response.json()
    return payload.records || {}
  } catch {
    return {}
  }
}

export async function moveOwnership(from, to) {
  const response = await authorizedFetch('/nasapi/ownership/move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to }),
  })
  if (!response.ok) throw await apiError(response)
}

export async function deleteOwnership(path) {
  const response = await authorizedFetch(`/nasapi/ownership?path=${encodeURIComponent(path)}`, {
    method: 'DELETE',
  })
  if (!response.ok) throw await apiError(response)
}
