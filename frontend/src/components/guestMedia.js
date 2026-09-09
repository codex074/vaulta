import { lightboxKindFor } from './lightboxKind.js'
import { publicDownloadUrl, fetchPublicBlobUrl, fetchPublicText } from '../api/publicShare.js'

// A password-protected share can only be satisfied with a request header,
// which <img>/<video>/<iframe> cannot send. Small things (images, PDFs,
// text) are fetched with the header and shown from a blob; video would mean
// downloading the whole file before playing, so it stays download-only.
export function mediaPlanFor(entry, { hasPassword }) {
  let kind = lightboxKindFor(entry, { onlyOfficeAvailable: false })
  if (hasPassword && kind === 'video') kind = 'other'
  return { kind, direct: !hasPassword }
}

export async function buildGuestUrls(entry, { hash, password }) {
  const { kind, direct } = mediaPlanFor(entry, { hasPassword: Boolean(password) })
  const urls = { original: null, inline: null, preview: null, text: null }
  const blobs = []
  if (kind === 'text') {
    urls.text = await fetchPublicText(hash, entry.path, password)
  } else if (direct) {
    urls.original = publicDownloadUrl(hash, entry.path)
    urls.inline = publicDownloadUrl(hash, entry.path, { inline: true })
  } else if (kind === 'image' || kind === 'pdf') {
    const blob = await fetchPublicBlobUrl(hash, entry.path, password)
    blobs.push(blob)
    urls.original = blob
    urls.inline = blob
  }
  return {
    urls,
    revoke() { for (const blob of blobs) URL.revokeObjectURL(blob) },
  }
}
