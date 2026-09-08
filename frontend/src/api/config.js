import { authorizedFetch } from './http.js'

// This is optional, non-sensitive static config (which document viewer, if
// any, is configured) — a failed or missing fetch degrades to "feature not
// configured" rather than surfacing an error, same as ownership lookups.
let cachedUrl = null

export async function getOnlyOfficeUrl() {
  if (cachedUrl !== null) return cachedUrl
  try {
    const response = await authorizedFetch('/nasapi/config')
    if (!response.ok) {
      cachedUrl = ''
      return cachedUrl
    }
    const payload = await response.json()
    cachedUrl = payload.onlyOfficeUrl || ''
  } catch {
    cachedUrl = ''
  }
  return cachedUrl
}

export function __resetOnlyOfficeUrlCache() {
  cachedUrl = null
}
