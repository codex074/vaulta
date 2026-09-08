import { authorizedFetch, apiError } from './http.js'

const GIB = 1024 ** 3

// The UI always says "GB", but the math underneath is GiB (1024**3), matching
// this app's existing formatSize helper.
export function gbToBytes(gb) {
  return Math.round(gb * GIB)
}

export function bytesToGb(bytes) {
  return bytes / GIB
}

export async function getMyQuota() {
  const response = await authorizedFetch('/nasapi/quota')
  if (!response.ok) throw await apiError(response)
  return response.json()
}

export async function listQuotas() {
  const response = await authorizedFetch('/nasapi/quotas')
  if (!response.ok) throw await apiError(response)
  const payload = await response.json()
  return payload.quotas || {}
}

export async function setUserQuota(uid, limitBytes) {
  const response = await authorizedFetch(`/nasapi/quotas/${encodeURIComponent(uid)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limitBytes }),
  })
  if (!response.ok) throw await apiError(response)
  return response.json()
}

export async function deleteUserQuota(uid) {
  const response = await authorizedFetch(`/nasapi/quotas/${encodeURIComponent(uid)}`, { method: 'DELETE' })
  if (!response.ok) throw await apiError(response)
}
