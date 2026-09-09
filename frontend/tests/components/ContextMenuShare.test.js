import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ContextMenu from '../../src/components/ContextMenu.vue'
import { useAuthStore } from '../../src/stores/auth.js'

vi.mock('../../src/api/resources.js', async (importOriginal) => ({
  ...(await importOriginal()),
  renameItem: vi.fn(), moveItem: vi.fn(), transferItem: vi.fn(), downloadUrl: () => '/dl',
}))
vi.mock('../../src/api/trash.js', async (importOriginal) => ({ ...(await importOriginal()), softDelete: vi.fn() }))

describe('ContextMenu share action', () => {
  it('emits share with the entry, source and path', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useAuthStore().user = { id: 1, uid: '1', username: 'u', permissions: { admin: true } }
    const wrapper = mount(ContextMenu, {
      props: { entry: { name: 'a.jpg', type: 'image/jpeg', source: 'home' }, path: '/a.jpg', view: 'browse' },
      global: { plugins: [pinia] },
    })
    await wrapper.get('button.share-link').trigger('click')
    expect(wrapper.emitted('share')[0][0]).toEqual({ entry: { name: 'a.jpg', type: 'image/jpeg', source: 'home' }, source: 'home', path: '/a.jpg' })
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('offers no share button in the trash view', () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useAuthStore().user = { id: 1, uid: '1', username: 'u', permissions: { admin: true } }
    const wrapper = mount(ContextMenu, {
      props: { entry: { name: 'a.jpg', type: 'image/jpeg', source: 'home' }, path: '/.trash/a.jpg', view: 'trash' },
      global: { plugins: [pinia] },
    })
    expect(wrapper.find('button.share-link').exists()).toBe(false)
  })
})
