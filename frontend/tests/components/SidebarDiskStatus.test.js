import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import Sidebar from '../../src/components/Sidebar.vue'
import { useAuthStore } from '../../src/stores/auth.js'

vi.mock('../../src/api/storage.js', () => ({ getStorageUsage: vi.fn().mockResolvedValue({ usedBytes: 0, totalBytes: 0 }) }))
vi.mock('../../src/api/quota.js', () => ({ getMyQuota: vi.fn().mockResolvedValue({ hasDrive: false, unlimited: false, limitBytes: 0, usedBytes: 0 }) }))

function mountSidebar(user) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().user = user
  return mount(Sidebar, { props: { view: 'browse' }, global: { plugins: [pinia] } })
}

async function openAccountMenu(wrapper) {
  await wrapper.get('[aria-label="Account"]').trigger('click')
}

describe('Sidebar disk status entry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows a "Disk status" button in the account menu for an admin', async () => {
    const wrapper = mountSidebar({ id: 1, uid: '1', username: 'root', permissions: { admin: true } })
    await openAccountMenu(wrapper)
    const button = wrapper.findAll('.account-menu button').find((b) => b.text() === 'Disk status')
    expect(button).toBeTruthy()
  })

  it('opens the DiskStatusDialog when clicked, right after Manage users', async () => {
    const wrapper = mountSidebar({ id: 1, uid: '1', username: 'root', permissions: { admin: true } })
    await openAccountMenu(wrapper)
    const menuButtons = wrapper.findAll('.account-menu button').map((b) => b.text())
    const manageIndex = menuButtons.indexOf('Manage users')
    const diskIndex = menuButtons.indexOf('Disk status')
    expect(manageIndex).toBeGreaterThan(-1)
    expect(diskIndex).toBe(manageIndex + 1)

    const button = wrapper.findAll('.account-menu button').find((b) => b.text() === 'Disk status')
    await button.trigger('click')
    expect(wrapper.find('[aria-label="Disk status"]').exists()).toBe(true)
  })

  it('does not show the button for a non-admin', async () => {
    const wrapper = mountSidebar({ id: 2, uid: '2', username: 'alice', permissions: { admin: false } })
    await openAccountMenu(wrapper)
    const button = wrapper.findAll('.account-menu button').find((b) => b.text() === 'Disk status')
    expect(button).toBeUndefined()
    expect(wrapper.findAll('.account-menu button').find((b) => b.text() === 'Manage users')).toBeUndefined()
  })
})
