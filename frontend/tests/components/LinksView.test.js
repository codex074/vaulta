import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import LinksView from '../../src/components/LinksView.vue'
import { useAuthStore } from '../../src/stores/auth.js'
import { listShares, deleteShare } from '../../src/api/share.js'

vi.mock('../../src/api/share.js', () => ({ listShares: vi.fn(), deleteShare: vi.fn(), createShare: vi.fn(), sharesFor: vi.fn() }))

function mountView(user) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().user = user
  return mount(LinksView, { global: { plugins: [pinia] } })
}

describe('LinksView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'location', { value: { origin: 'https://nas.test' }, writable: true })
  })

  it('lists links with name, drive and expiry; admins also see the owner', async () => {
    listShares.mockResolvedValue([
      { hash: 'a', expire: 0, hasPassword: false, path: '/alice/Photos/', source: '/srv/home', username: 'alice' },
      { hash: 'b', expire: 1, hasPassword: true, path: '/report.pdf', source: '/srv/share', username: 'bob' },
    ])
    const wrapper = mountView({ id: 1, uid: '1', username: 'admin', permissions: { admin: true } })
    await flushPromises()
    const rows = wrapper.findAll('tr.link-row')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('Photos')
    expect(rows[0].text()).toContain('My Drive')
    expect(rows[0].text()).toContain('Never')
    expect(rows[0].text()).toContain('alice')
    expect(rows[1].text()).toContain('Expired')
    expect(rows[1].find('.lock').exists()).toBe(true)
  })

  it('hides the owner column for non-admins and revokes in place', async () => {
    listShares.mockResolvedValue([{ hash: 'a', expire: 0, hasPassword: false, path: '/x/', source: '/srv/share', username: 'me' }])
    deleteShare.mockResolvedValue()
    const wrapper = mountView({ id: 2, uid: '2', username: 'me', permissions: { admin: false } })
    await flushPromises()
    expect(wrapper.find('th.owner').exists()).toBe(false)
    await wrapper.get('button.revoke').trigger('click')
    await flushPromises()
    expect(deleteShare).toHaveBeenCalledWith('a')
    expect(wrapper.find('tr.link-row').exists()).toBe(false)
    expect(wrapper.text()).toContain('No links yet')
  })
})
