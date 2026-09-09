import { apiError } from './http.js'

// Guests have no session: plain fetch, no cookies, and a 401 here must never
// reach the logged-in app's unauthorized listeners.
function headersFor(password) {
  return password ? { 'X-SHARE-PASSWORD': password } : {}
}

async function publicFetch(url, password = '') {
  const response = await fetch(url, { credentials: 'omit', headers: headersFor(password) })
  if (!response.ok) throw await apiError(response)
  return response
}

export async function getShareInfo(hash) {
  const params = new URLSearchParams({ hash })
  const response = await publicFetch(`/public/api/share/info?${params.toString()}`)
  return response.json()
}

export async function listPublic(hash, path, password = '') {
  const params = new URLSearchParams({ hash, path })
  const response = await publicFetch(`/public/api/resources?${params.toString()}`, password)
  return response.json()
}

export function publicDownloadUrl(hash, file, { inline = false } = {}) {
  const params = new URLSearchParams({ hash, file })
  if (inline) params.set('inline', 'true')
  return `/public/api/resources/download?${params.toString()}`
}

export function publicPreviewUrl(hash, path, size = 'small') {
  const params = new URLSearchParams({ hash, path, size })
  return `/public/api/resources/preview?${params.toString()}`
}

export async function fetchPublicBlobUrl(hash, file, password = '') {
  const response = await publicFetch(publicDownloadUrl(hash, file, { inline: true }), password)
  return URL.createObjectURL(await response.blob())
}

export async function fetchPublicText(hash, path, password = '') {
  const params = new URLSearchParams({ hash, path, content: 'true' })
  const response = await publicFetch(`/public/api/resources?${params.toString()}`, password)
  const data = await response.json()
  return data.content
}
