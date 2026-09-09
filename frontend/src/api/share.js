import { authorizedFetch, apiError } from './http.js'
import { buildCreateBody } from '../components/shareLinks.js'

export async function createShare(source, path, { expiry, password } = {}) {
  const response = await authorizedFetch('/api/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildCreateBody({ source, path, expiry, password })),
  })
  if (!response.ok) throw await apiError(response)
  return response.json()
}

export async function listShares() {
  const response = await authorizedFetch('/api/share/list')
  if (!response.ok) throw await apiError(response)
  return response.json()
}

export async function sharesFor(source, path) {
  const params = new URLSearchParams({ path, source })
  const response = await authorizedFetch(`/api/share?${params.toString()}`)
  if (response.status === 404) return []
  if (!response.ok) throw await apiError(response)
  return response.json()
}

export async function deleteShare(hash) {
  const params = new URLSearchParams({ hash })
  const response = await authorizedFetch(`/api/share?${params.toString()}`, { method: 'DELETE' })
  if (!response.ok) throw await apiError(response)
}
