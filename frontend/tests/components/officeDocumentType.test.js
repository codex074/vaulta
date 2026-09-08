import { describe, it, expect } from 'vitest'
import { documentTypeFor } from '../../src/components/officeDocumentType.js'

describe('documentTypeFor', () => {
  it('maps word-processing extensions to word', () => {
    expect(documentTypeFor('report.docx')).toBe('word')
    expect(documentTypeFor('notes.txt')).toBe('word')
    expect(documentTypeFor('readme.md')).toBe('word')
  })

  it('maps spreadsheet extensions to cell', () => {
    expect(documentTypeFor('budget.xlsx')).toBe('cell')
    expect(documentTypeFor('export.csv')).toBe('cell')
  })

  it('maps presentation extensions to slide', () => {
    expect(documentTypeFor('deck.pptx')).toBe('slide')
  })

  it('maps pdf-family extensions to pdf', () => {
    expect(documentTypeFor('scan.pdf')).toBe('pdf')
  })

  it('is case-insensitive on the extension', () => {
    expect(documentTypeFor('REPORT.DOCX')).toBe('word')
  })

  it('returns undefined for an extension with no known category', () => {
    expect(documentTypeFor('archive.zip')).toBeUndefined()
  })

  it('returns undefined for a name with no extension', () => {
    expect(documentTypeFor('README')).toBeUndefined()
  })
})
