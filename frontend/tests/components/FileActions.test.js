import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ContextMenu from '../../src/components/ContextMenu.vue'
import FileTile from '../../src/components/FileTile.vue'
import FileListView from '../../src/components/FileListView.vue'
import { useFilesStore } from '../../src/stores/files.js'

describe('compact file navigation', () => {
  beforeEach(() => setActivePinia(createPinia()))
  it('offers starring through the action sheet, including when the list hides its star column', async () => {
    const files = useFilesStore()
    const toggle = vi.spyOn(files, 'toggleStar').mockResolvedValue()
    const wrapper = mount(ContextMenu, { props: { entry: { name: 'Notes.txt', type: 'text/plain', source: 'home' }, path: '/Notes.txt' } })
    await wrapper.findAll('button').find(b => b.text() === 'Add to Starred').trigger('click')
    await flushPromises()
    expect(toggle).toHaveBeenCalledWith(expect.objectContaining({ name: 'Notes.txt', source: 'home' }))
    expect(wrapper.emitted('changed')).toHaveLength(1)
  })
  for (const component of [FileTile, FileListView]) {
    it(`leaves a collection only after its folder opens successfully in ${component.__name}`, async () => {
      const files = useFilesStore()
      const load = vi.spyOn(files, 'loadDirectory').mockResolvedValue()
      const entry = { name: 'Photos', type: 'directory', path: '/Photos', source: 'home' }
      const wrapper = mount(component, { props: component === FileTile ? { entry } : { entries: [entry] } })
      await wrapper.get('button[aria-label="Open Photos"]').trigger('click')
      await flushPromises()
      expect(load).toHaveBeenCalledWith('/Photos')
      expect(wrapper.emitted('folder-opened')).toHaveLength(1)
    })
  }
})
