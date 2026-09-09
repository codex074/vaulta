import { documentTypeFor } from './officeDocumentType.js'

// Plain-text formats always open in Vaulta's own read-only viewer. Since
// FileBrowser hands OnlyOffice an edit-mode config for any format a user
// may modify (the config is JWT-signed, so the client cannot downgrade it),
// keeping these out of OnlyOffice is what limits editing to office files.
const TEXT_EXTENSIONS = new Set(['txt', 'md', 'csv', 'log', 'json', 'html', 'htm', 'xml'])

function extensionOf(name) {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

export function lightboxKindFor(entry, { onlyOfficeAvailable }) {
  if (entry.type.startsWith('image/')) return 'image'
  if (entry.type.startsWith('video/')) return 'video'
  if (entry.type === 'application/pdf') return 'pdf'
  if (TEXT_EXTENSIONS.has(extensionOf(entry.name))) return 'text'
  if (onlyOfficeAvailable && documentTypeFor(entry.name)) return 'office'
  return 'other'
}

export function officeModeLabel(config) {
  return config?.editorConfig?.mode === 'edit'
    ? 'แก้ไขได้ · บันทึกอัตโนมัติเมื่อปิด'
    : 'ดูอย่างเดียว'
}
