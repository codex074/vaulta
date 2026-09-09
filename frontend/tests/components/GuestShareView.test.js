import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import GuestShareView from '../../src/components/GuestShareView.vue'
import { getShareInfo, listPublic } from '../../src/api/publicShare.js'

vi.mock('../../src/api/publicShare.js', () => ({
  getShareInfo: vi.fn(),
  listPublic: vi.fn(),
  publicDownloadUrl: (hash, file, { inline = false } = {}) => `/public/api/resources/download?hash=${hash}&file=${encodeURIComponent(file)}${inline ? '&inline=true' : ''}`,
  publicPreviewUrl: (hash, path) => `/public/api/resources/preview?hash=${hash}&path=${encodeURIComponent(path)}`,
  fetchPublicBlobUrl: vi.fn(),
  fetchPublicText: vi.fn(),
}))
vi.mock('plyr', () => ({ default: class { destroy() {} } }))
vi.mock('plyr/dist/plyr.css', () => ({}))

const listing = {
  name: 'Docs', type: 'directory', path: '/',
  folders: [{ name: 'Sub', type: 'directory', modified: '2026-09-01T00:00:00Z', size: 0 }],
  files: [
    { name: 'a.jpg', type: 'image/jpeg', size: 1024, modified: '2026-09-01T00:00:00Z', hasPreview: true },
    { name: 'guide.pdf', type: 'application/pdf', size: 2048, modified: '2026-09-01T00:00:00Z', hasPreview: true },
  ],
}

function mountView() {
  const pinia = createPinia()
  setActivePinia(pinia)
  return mount(GuestShareView, { props: { hash: 'h1' }, global: { plugins: [pinia] } })
}

describe('GuestShareView', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows the unavailable screen when the share does not exist', async () => {
    getShareInfo.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }))
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.text()).toContain('ลิงก์นี้ใช้ไม่ได้แล้ว')
    expect(listPublic).not.toHaveBeenCalled()
  })

  it('lists an open share with folders first, thumbnails for images but not PDFs, and download links', async () => {
    getShareInfo.mockResolvedValue({ title: 'Docs', hasPassword: false })
    listPublic.mockResolvedValue(listing)
    const wrapper = mountView()
    await flushPromises()
    expect(listPublic).toHaveBeenCalledWith('h1', '/', '')
    const rows = wrapper.findAll('.guest-row')
    expect(rows.map((r) => r.get('.guest-name').text())).toEqual(['Sub', 'a.jpg', 'guide.pdf'])
    expect(rows[1].find('img.guest-thumb').attributes('src')).toContain('/public/api/resources/preview?hash=h1&path=%2Fa.jpg')
    expect(rows[2].find('img.guest-thumb').exists()).toBe(false)
    expect(rows[1].get('a.guest-download').attributes('href')).toBe('/public/api/resources/download?hash=h1&file=%2Fa.jpg')
  })

  it('navigates into a folder and back with the breadcrumb', async () => {
    getShareInfo.mockResolvedValue({ title: 'Docs', hasPassword: false })
    listPublic.mockResolvedValue(listing)
    const wrapper = mountView()
    await flushPromises()
    await wrapper.findAll('.guest-row')[0].get('button.guest-open').trigger('click')
    await flushPromises()
    expect(listPublic).toHaveBeenLastCalledWith('h1', '/Sub', '')
    await wrapper.get('button.crumb-root').trigger('click')
    await flushPromises()
    expect(listPublic).toHaveBeenLastCalledWith('h1', '/', '')
  })

  it('gates a password share, rejects a wrong password and accepts the right one', async () => {
    getShareInfo.mockResolvedValue({ title: 'Docs', hasPassword: true })
    listPublic.mockRejectedValueOnce(Object.assign(new Error('unauthorized'), { status: 401 }))
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.find('.guest-row').exists()).toBe(false)
    await wrapper.get('input.guest-password').setValue('nope')
    await wrapper.get('form.password-gate').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('รหัสไม่ถูกต้อง')
    listPublic.mockResolvedValue(listing)
    await wrapper.get('input.guest-password').setValue('right')
    await wrapper.get('form.password-gate').trigger('submit')
    await flushPromises()
    expect(listPublic).toHaveBeenLastCalledWith('h1', '/', 'right')
    expect(wrapper.findAll('.guest-row')).toHaveLength(3)
    // password shares never load thumbnails by URL and never expose a plain download href
    expect(wrapper.find('img.guest-thumb').exists()).toBe(false)
    expect(wrapper.find('a.guest-download').exists()).toBe(false)
    expect(wrapper.find('button.guest-download').exists()).toBe(true)
  })
})
