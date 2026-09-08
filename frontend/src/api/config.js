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
    const url = payload.onlyOfficeUrl || ''
    // documentServerUrl ends up as a <script src> origin (Lightbox.vue) — a
    // malformed value should read as "not configured", not an opaque
    // script-load/CSP failure.
    cachedUrl = /^https?:\/\//.test(url) ? url : ''
  } catch {
    cachedUrl = ''
  }
  return cachedUrl
}

export function __resetOnlyOfficeUrlCache() {
  cachedUrl = null
}
