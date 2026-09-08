// Mirrors FileBrowser Quantum's own extension → category grouping
// (backend/pkg/indexing/iteminfo/conditions.go, onlyOfficeSupported map),
// re-expressed as OnlyOffice's own documentType taxonomy. Supplied
// defensively alongside /api/office/config's response — that response
// never includes documentType, and this app doesn't rely on the
// Document Server auto-inferring it from fileType.
const WORD_EXTENSIONS = new Set([
  'doc', 'docm', 'docx', 'dot', 'dotm', 'dotx', 'epub', 'fb2', 'fodt', 'htm', 'html',
  'mht', 'mhtml', 'odt', 'ott', 'rtf', 'stw', 'sxw', 'txt', 'wps', 'wpt', 'xml',
  'hwp', 'hwpx', 'md', 'pages', 'docxf', 'oform',
])
const CELL_EXTENSIONS = new Set([
  'csv', 'et', 'ett', 'fods', 'ods', 'ots', 'sxc', 'xls', 'xlsb', 'xlsm', 'xlsx',
  'xlt', 'xltm', 'xltx', 'numbers',
])
const SLIDE_EXTENSIONS = new Set([
  'dps', 'dpt', 'fodp', 'odp', 'otp', 'pot', 'potm', 'potx', 'pps', 'ppsm', 'ppsx',
  'ppt', 'pptm', 'pptx', 'sxi', 'key', 'odg',
])
const PDF_EXTENSIONS = new Set(['pdf', 'djvu', 'oxps', 'xps'])

export function documentTypeFor(name) {
  const dot = name.lastIndexOf('.')
  if (dot === -1) return undefined
  const ext = name.slice(dot + 1).toLowerCase()
  if (WORD_EXTENSIONS.has(ext)) return 'word'
  if (CELL_EXTENSIONS.has(ext)) return 'cell'
  if (SLIDE_EXTENSIONS.has(ext)) return 'slide'
  if (PDF_EXTENSIONS.has(ext)) return 'pdf'
  return undefined
}
