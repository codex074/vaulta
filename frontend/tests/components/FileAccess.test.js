import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import FileTile from '../../src/components/FileTile.vue'
import FileListView from '../../src/components/FileListView.vue'

const entry = { name: 'Travel notes.txt', type: 'text/plain', size: 200, modified: '2026-09-08T00:00:00Z' }
describe('accessible file actions', () => {
  beforeEach(() => setActivePinia(createPinia()))
  for (const [name, component, props] of [['grid', FileTile, { entry }], ['list', FileListView, { entries: [entry] }]]) {
    it(`opens a file with a named button in ${name} view and exposes its actions`, async () => {
      const wrapper = mount(component, { props })
      await wrapper.get('button[aria-label="Open Travel notes.txt"]').trigger('click')
      expect(wrapper.emitted('open')[0][0]).toMatchObject({ path: '/Travel notes.txt', source: 'share' })
      await wrapper.get('button[aria-label="Actions for Travel notes.txt"]').trigger('click')
      expect(wrapper.emitted('menu')[0][0].path).toBe('/Travel notes.txt')
      expect(wrapper.get('input[aria-label="Select Travel notes.txt"]').exists()).toBe(true)
    })
  }
})
