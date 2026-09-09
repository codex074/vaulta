import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ShareDialog from '../../src/components/ShareDialog.vue'
import { createShare, sharesFor, deleteShare } from '../../src/api/share.js'

vi.mock('../../src/api/share.js', () => ({
  createShare: vi.fn(), sharesFor: vi.fn(), deleteShare: vi.fn(), listShares: vi.fn(),
}))

function mountDialog() {
  return mount(ShareDialog, {
    props: { entry: { name: 'Docs', type: 'directory' }, source: 'share', path: '/Docs' },
    global: { stubs: { teleport: true } },
  })
}

describe('ShareDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sharesFor.mockResolvedValue([])
    Object.defineProperty(window, 'location', { value: { origin: 'https://nas.test' }, writable: true })
  })

  it('creates a 7-day link by default and shows the guest URL', async () => {
    createShare.mockResolvedValue({ hash: 'abc', expire: 0, hasPassword: false, path: '/Docs/', source: '/srv/share' })
    const wrapper = mountDialog()
    await flushPromises()
    await wrapper.get('button.create').trigger('click')
    await flushPromises()
    expect(createShare).toHaveBeenCalledWith('share', '/Docs', { expiry: '7d', password: '' })
    expect(wrapper.get('input.guest-url').element.value).toBe('https://nas.test/s/abc')
  })

  it('passes the chosen expiry and password through', async () => {
    createShare.mockResolvedValue({ hash: 'x', expire: 1, hasPassword: true, path: '/Docs/', source: '/srv/share' })
    const wrapper = mountDialog()
    await flushPromises()
    await wrapper.get('select.expiry').setValue('never')
    await wrapper.get('input.password').setValue('pw')
    await wrapper.get('button.create').trigger('click')
    expect(createShare).toHaveBeenCalledWith('share', '/Docs', { expiry: 'never', password: 'pw' })
  })

  it('lists existing links with expiry and lock, and revokes one', async () => {
    sharesFor.mockResolvedValue([
      { hash: 'old', expire: 0, hasPassword: true, path: '/Docs/', source: '/srv/share' },
    ])
    deleteShare.mockResolvedValue()
    const wrapper = mountDialog()
    await flushPromises()
    const row = wrapper.get('li.share-row')
    expect(row.text()).toContain('Never')
    expect(row.find('.lock').exists()).toBe(true)
    sharesFor.mockResolvedValue([])
    await row.get('button.revoke').trigger('click')
    await flushPromises()
    expect(deleteShare).toHaveBeenCalledWith('old')
    expect(wrapper.find('li.share-row').exists()).toBe(false)
  })

  it('emits close from the Done button', async () => {
    const wrapper = mountDialog()
    await flushPromises()
    await wrapper.get('button.menu-cancel').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
