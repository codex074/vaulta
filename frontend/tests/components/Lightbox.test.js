import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import Lightbox from '../../src/components/Lightbox.vue'
import { getFileText } from '../../src/api/resources.js'
import { getOnlyOfficeUrl } from '../../src/api/config.js'
import { getOfficeConfig } from '../../src/api/office.js'

vi.mock('plyr', () => ({ default: class { destroy() {} } }))
vi.mock('plyr/dist/plyr.css', () => ({}))
vi.mock('@onlyoffice/document-editor-vue', () => ({
  DocumentEditor: defineComponent({
    name: 'DocumentEditor',
    props: ['config'],
    setup: (props) => () => h('div', { class: 'fake-editor' }, props.config?.editorConfig?.mode),
  }),
}))
vi.mock('../../src/api/resources.js', () => ({
  downloadUrl: vi.fn(() => '/download'),
  previewUrl: vi.fn(() => '/preview'),
  getFileText: vi.fn(),
}))
vi.mock('../../src/api/config.js', () => ({ getOnlyOfficeUrl: vi.fn() }))
vi.mock('../../src/api/office.js', () => ({ getOfficeConfig: vi.fn() }))

describe('Lightbox documents', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows a plain-text file read-only in its own viewer without touching OnlyOffice', async () => {
    getOnlyOfficeUrl.mockResolvedValue('https://office.example.com')
    getFileText.mockResolvedValue('hello <world>')
    const wrapper = mount(Lightbox, {
      props: { entry: { name: 'notes.txt', type: 'text/plain', path: '/notes.txt', source: 'home' } },
    })
    await flushPromises()
    expect(getFileText).toHaveBeenCalledWith('home', '/notes.txt')
    expect(wrapper.get('pre').text()).toBe('hello <world>')
    expect(wrapper.find('.fake-editor').exists()).toBe(false)
    expect(getOfficeConfig).not.toHaveBeenCalled()
  })

  it('tells the user an office document is editable and saves itself on close', async () => {
    getOnlyOfficeUrl.mockResolvedValue('https://office.example.com')
    getOfficeConfig.mockResolvedValue({ document: {}, editorConfig: { mode: 'edit' }, token: 't' })
    const wrapper = mount(Lightbox, {
      props: { entry: { name: 'report.docx', type: 'application/octet-stream', path: '/report.docx', source: 'share' } },
    })
    await flushPromises()
    await flushPromises()
    expect(wrapper.get('.doc-topbar').text()).toContain('แก้ไขได้ · บันทึกอัตโนมัติเมื่อปิด')
    expect(wrapper.get('.fake-editor').text()).toBe('edit')
  })

  it('labels a document that FileBrowser handed over view-only', async () => {
    getOnlyOfficeUrl.mockResolvedValue('https://office.example.com')
    getOfficeConfig.mockResolvedValue({ document: {}, editorConfig: { mode: 'view' }, token: 't' })
    const wrapper = mount(Lightbox, {
      props: { entry: { name: 'old.pages', type: 'application/octet-stream', path: '/old.pages', source: 'share' } },
    })
    await flushPromises()
    await flushPromises()
    expect(wrapper.get('.doc-topbar').text()).toContain('ดูอย่างเดียว')
  })

  it('with urls, shows the given image without calling any API', async () => {
    const wrapper = mount(Lightbox, {
      props: {
        entry: { name: 'a.jpg', type: 'image/jpeg', path: '/a.jpg' },
        urls: { original: 'blob:img', inline: null, preview: null, text: null },
      },
    })
    await flushPromises()
    expect(wrapper.get('img').attributes('src')).toBe('blob:img')
    expect(getOnlyOfficeUrl).not.toHaveBeenCalled()
    expect(getFileText).not.toHaveBeenCalled()
  })

  it('with urls, a pdf iframe uses the inline URL and text comes from urls.text', async () => {
    const pdf = mount(Lightbox, {
      props: { entry: { name: 'a.pdf', type: 'application/pdf', path: '/a.pdf' }, urls: { original: 'blob:p', inline: 'blob:p', preview: null, text: null } },
    })
    await flushPromises()
    expect(pdf.get('iframe').attributes('src')).toBe('blob:p')
    const text = mount(Lightbox, {
      props: { entry: { name: 'n.txt', type: 'text/plain', path: '/n.txt' }, urls: { original: null, inline: null, preview: null, text: 'guest text' } },
    })
    await flushPromises()
    expect(text.get('pre').text()).toBe('guest text')
    expect(getFileText).not.toHaveBeenCalled()
  })

  it('with urls, an office document is never sent to OnlyOffice', async () => {
    getOnlyOfficeUrl.mockResolvedValue('https://office.example.com')
    const wrapper = mount(Lightbox, {
      props: { entry: { name: 'r.docx', type: 'application/octet-stream', path: '/r.docx' }, urls: { original: '/dl', inline: '/dl', preview: null, text: null } },
    })
    await flushPromises()
    expect(wrapper.find('.fake-editor').exists()).toBe(false)
    expect(wrapper.get('.fallback a').attributes('href')).toBe('/dl')
  })
})
