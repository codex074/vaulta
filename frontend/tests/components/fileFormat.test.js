import { describe, it, expect } from 'vitest'
import { canRequestThumbnail, pickFolderPreviewPaths } from '../../src/components/fileFormat.js'

describe('pickFolderPreviewPaths', () => {
  it('picks up to the limit of previewable files, joined onto the base path', () => {
    const result = {
      files: [
        { name: 'a.jpg', hasPreview: true },
        { name: 'b.jpg', hasPreview: true },
        { name: 'c.jpg', hasPreview: true },
        { name: 'd.jpg', hasPreview: true },
        { name: 'e.jpg', hasPreview: true },
      ],
    }
    expect(pickFolderPreviewPaths(result, '/Photos')).toEqual([
      '/Photos/a.jpg', '/Photos/b.jpg', '/Photos/c.jpg', '/Photos/d.jpg',
    ])
  })

  it('skips files without a preview', () => {
    const result = {
      files: [
        { name: 'a.jpg', hasPreview: true },
        { name: 'notes.txt', hasPreview: false },
        { name: 'b.jpg', hasPreview: true },
      ],
    }
    expect(pickFolderPreviewPaths(result, '/Photos')).toEqual(['/Photos/a.jpg', '/Photos/b.jpg'])
  })

  it('returns fewer than the limit when there are not enough previewable files', () => {
    const result = { files: [{ name: 'a.jpg', hasPreview: true }] }
    expect(pickFolderPreviewPaths(result, '/Photos')).toEqual(['/Photos/a.jpg'])
  })

  it('returns an empty array when there are no files at all', () => {
    expect(pickFolderPreviewPaths({ files: [] }, '/Photos')).toEqual([])
    expect(pickFolderPreviewPaths({}, '/Photos')).toEqual([])
  })

  it('joins correctly whether or not the base path already ends with a slash', () => {
    const result = { files: [{ name: 'a.jpg', hasPreview: true }] }
    expect(pickFolderPreviewPaths(result, '/')).toEqual(['/a.jpg'])
  })
})

// FileBrowser Quantum 1.5.x renders PDF-family thumbnails through MuPDF,
// which aborts the whole FBQ process on some files (upstream #2763, fixed
// only in 2.x). Never asking for those thumbnails keeps FBQ alive.
describe('canRequestThumbnail', () => {
  it('refuses the document formats FileBrowser hands to MuPDF', () => {
    for (const name of ['guide.pdf', 'GUIDE.PDF', 'book.epub', 'page.xps', 'novel.mobi', 'x.fb2', 'comic.cbz']) {
      expect(canRequestThumbnail({ name, type: 'application/octet-stream', hasPreview: true })).toBe(false)
    }
  })

  it('allows everything else FileBrowser marks previewable', () => {
    expect(canRequestThumbnail({ name: 'a.jpg', type: 'image/jpeg', hasPreview: true })).toBe(true)
    expect(canRequestThumbnail({ name: 'Photos', type: 'directory', hasPreview: true })).toBe(true)
    expect(canRequestThumbnail({ name: 'report.docx', type: 'application/octet-stream', hasPreview: true })).toBe(true)
  })

  it('is false when FileBrowser itself offers no preview', () => {
    expect(canRequestThumbnail({ name: 'a.jpg', type: 'image/jpeg', hasPreview: false })).toBe(false)
  })
})

describe('pickFolderPreviewPaths and PDFs', () => {
  it('never picks a PDF for the folder collage', () => {
    const result = { files: [
      { name: 'guide.pdf', hasPreview: true, type: 'application/pdf' },
      { name: 'a.jpg', hasPreview: true, type: 'image/jpeg' },
    ] }
    expect(pickFolderPreviewPaths(result, '/Docs')).toEqual(['/Docs/a.jpg'])
  })
})
