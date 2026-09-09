import { describe, it, expect } from 'vitest'
import { lightboxKindFor, officeModeLabel } from '../../src/components/lightboxKind.js'

const entry = (name, type) => ({ name, type, path: `/${name}` })

describe('lightboxKindFor', () => {
  it('classifies images, video and pdf by MIME type', () => {
    expect(lightboxKindFor(entry('a.jpg', 'image/jpeg'), { onlyOfficeAvailable: true })).toBe('image')
    expect(lightboxKindFor(entry('a.mp4', 'video/mp4'), { onlyOfficeAvailable: true })).toBe('video')
    expect(lightboxKindFor(entry('a.pdf', 'application/pdf'), { onlyOfficeAvailable: true })).toBe('pdf')
  })

  it('shows plain-text formats in the built-in read-only viewer, never in OnlyOffice', () => {
    for (const name of ['notes.txt', 'README.md', 'data.csv', 'app.log', 'config.json']) {
      expect(lightboxKindFor(entry(name, 'text/plain'), { onlyOfficeAvailable: true })).toBe('text')
      expect(lightboxKindFor(entry(name, 'text/plain'), { onlyOfficeAvailable: false })).toBe('text')
    }
  })

  it('sends office documents to OnlyOffice only when a Document Server is configured', () => {
    const docx = entry('report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    expect(lightboxKindFor(docx, { onlyOfficeAvailable: true })).toBe('office')
    expect(lightboxKindFor(docx, { onlyOfficeAvailable: false })).toBe('other')
    expect(lightboxKindFor(entry('deck.pptx', 'application/octet-stream'), { onlyOfficeAvailable: true })).toBe('office')
    expect(lightboxKindFor(entry('budget.xlsx', 'application/octet-stream'), { onlyOfficeAvailable: true })).toBe('office')
  })

  it('falls back to other for anything it cannot preview', () => {
    expect(lightboxKindFor(entry('archive.zip', 'application/zip'), { onlyOfficeAvailable: true })).toBe('other')
    expect(lightboxKindFor(entry('README', 'text/plain'), { onlyOfficeAvailable: true })).toBe('other')
  })
})

describe('officeModeLabel', () => {
  it('tells the user an editable document saves itself on close', () => {
    expect(officeModeLabel({ editorConfig: { mode: 'edit' } })).toBe('แก้ไขได้ · บันทึกอัตโนมัติเมื่อปิด')
  })

  it('labels a view-only document, including a config with no mode at all', () => {
    expect(officeModeLabel({ editorConfig: { mode: 'view' } })).toBe('ดูอย่างเดียว')
    expect(officeModeLabel({})).toBe('ดูอย่างเดียว')
    expect(officeModeLabel(null)).toBe('ดูอย่างเดียว')
  })
})
