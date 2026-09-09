import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mediaPlanFor, buildGuestUrls } from '../../src/components/guestMedia.js'
import { fetchPublicBlobUrl, fetchPublicText } from '../../src/api/publicShare.js'

vi.mock('../../src/api/publicShare.js', () => ({
  publicDownloadUrl: (hash, file, { inline = false } = {}) => `/dl?hash=${hash}&file=${file}${inline ? '&inline=true' : ''}`,
  fetchPublicBlobUrl: vi.fn(),
  fetchPublicText: vi.fn(),
}))

const entry = (name, type) => ({ name, type, path: `/${name}` })

describe('mediaPlanFor', () => {
  it('uses direct URLs when there is no password', () => {
    expect(mediaPlanFor(entry('a.jpg', 'image/jpeg'), { hasPassword: false })).toEqual({ kind: 'image', direct: true })
    expect(mediaPlanFor(entry('a.mp4', 'video/mp4'), { hasPassword: false })).toEqual({ kind: 'video', direct: true })
    expect(mediaPlanFor(entry('a.docx', 'application/octet-stream'), { hasPassword: false })).toEqual({ kind: 'other', direct: true })
  })
  it('with a password, fetches media as blobs and does not stream video', () => {
    expect(mediaPlanFor(entry('a.jpg', 'image/jpeg'), { hasPassword: true })).toEqual({ kind: 'image', direct: false })
    expect(mediaPlanFor(entry('a.pdf', 'application/pdf'), { hasPassword: true })).toEqual({ kind: 'pdf', direct: false })
    expect(mediaPlanFor(entry('a.mp4', 'video/mp4'), { hasPassword: true })).toEqual({ kind: 'other', direct: false })
  })
})

describe('buildGuestUrls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.URL.revokeObjectURL = vi.fn()
  })

  it('direct: original/inline point at the public download URL, text is fetched', async () => {
    fetchPublicText.mockResolvedValue('hi')
    const image = await buildGuestUrls(entry('a.jpg', 'image/jpeg'), { hash: 'h', password: '' })
    expect(image.urls).toEqual({ original: '/dl?hash=h&file=/a.jpg', inline: '/dl?hash=h&file=/a.jpg&inline=true', preview: null, text: null })
    const text = await buildGuestUrls(entry('n.txt', 'text/plain'), { hash: 'h', password: '' })
    expect(text.urls.text).toBe('hi')
    expect(fetchPublicText).toHaveBeenCalledWith('h', '/n.txt', '')
    expect(fetchPublicBlobUrl).not.toHaveBeenCalled()
  })

  it('password: image and pdf become blob URLs that revoke() releases', async () => {
    fetchPublicBlobUrl.mockResolvedValue('blob:one')
    const pdf = await buildGuestUrls(entry('a.pdf', 'application/pdf'), { hash: 'h', password: 'pw' })
    expect(fetchPublicBlobUrl).toHaveBeenCalledWith('h', '/a.pdf', 'pw')
    expect(pdf.urls).toEqual({ original: 'blob:one', inline: 'blob:one', preview: null, text: null })
    pdf.revoke()
    expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:one')
  })

  it('password: text is fetched with the password, nothing to revoke', async () => {
    fetchPublicText.mockResolvedValue('secret text')
    const text = await buildGuestUrls(entry('n.md', 'text/plain'), { hash: 'h', password: 'pw' })
    expect(fetchPublicText).toHaveBeenCalledWith('h', '/n.md', 'pw')
    expect(text.urls.text).toBe('secret text')
    text.revoke()
    expect(global.URL.revokeObjectURL).not.toHaveBeenCalled()
  })
})
