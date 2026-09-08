import { describe, it, expect } from 'vitest'
import { pickFolderPreviewPaths } from '../../src/components/fileFormat.js'

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
