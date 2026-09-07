import { describe, it, expect } from 'vitest'
import { collectFilesFromDataTransfer, directoriesFor } from '../../src/components/folderDrop.js'

function fakeFileEntry(name, file) {
  return { isFile: true, isDirectory: false, name, file: (resolve) => resolve(file) }
}

function fakeDirEntry(name, children) {
  let read = false
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => ({
      // Real FileSystemDirectoryReader only returns entries once per readEntries()
      // call sequence, then an empty batch — this mock mirrors that contract.
      readEntries: (resolve) => {
        if (read) return resolve([])
        read = true
        resolve(children)
      },
    }),
  }
}

describe('collectFilesFromDataTransfer', () => {
  it('collects a flat file selection with no path prefix', async () => {
    const fileA = new File(['a'], 'a.jpg')
    const dt = {
      items: [{ webkitGetAsEntry: () => fakeFileEntry('a.jpg', fileA) }],
      files: [fileA],
    }
    const result = await collectFilesFromDataTransfer(dt)
    expect(result).toEqual([{ file: fileA, path: 'a.jpg' }])
  })

  it('recursively collects nested folders with relative paths', async () => {
    const deepFile = new File(['x'], 'deep.jpg')
    const topFile = new File(['y'], 'top.jpg')
    const deepDir = fakeDirEntry('Deep', [fakeFileEntry('deep.jpg', deepFile)])
    const subDir = fakeDirEntry('Sub', [deepDir, fakeFileEntry('top.jpg', topFile)])
    const dt = { items: [{ webkitGetAsEntry: () => subDir }], files: [] }

    const result = await collectFilesFromDataTransfer(dt)
    expect(result.sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { file: deepFile, path: 'Sub/Deep/deep.jpg' },
      { file: topFile, path: 'Sub/top.jpg' },
    ])
  })

  it('falls back to the flat file list when webkitGetAsEntry is unavailable', async () => {
    const fileA = new File(['a'], 'a.jpg')
    const dt = { items: [], files: [fileA] }
    const result = await collectFilesFromDataTransfer(dt)
    expect(result).toEqual([{ file: fileA, path: 'a.jpg' }])
  })
})

describe('directoriesFor', () => {
  it('returns the unique set of parent directories for nested paths', () => {
    expect(directoriesFor(['Sub/Deep/a.jpg', 'Sub/Deep/b.jpg', 'Sub/c.jpg']).sort()).toEqual(['Sub', 'Sub/Deep'])
  })

  it('returns nothing for flat, non-nested paths', () => {
    expect(directoriesFor(['a.jpg', 'b.jpg'])).toEqual([])
  })
})
