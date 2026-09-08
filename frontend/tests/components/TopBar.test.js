import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import TopBar from '../../src/components/TopBar.vue'

describe('file browser toolbar', () => {
  beforeEach(() => setActivePinia(createPinia()))
  it('shows the active collection and keeps search synchronized when navigation clears it', async () => {
    const wrapper = mount(TopBar, { props: { view: 'starred', searchQuery: 'report' } })
    expect(wrapper.get('h1').text()).toBe('Starred')
    expect(wrapper.get('input[type="search"]').element.value).toBe('report')
    await wrapper.setProps({ view: 'trash', searchQuery: '' })
    expect(wrapper.get('h1').text()).toBe('Trash')
    expect(wrapper.get('input[type="search"]').element.value).toBe('')
    expect(wrapper.find('[aria-label="New folder"]').exists()).toBe(false)
    await wrapper.get('input[type="search"]').setValue('photo')
    expect(wrapper.emitted('search').at(-1)).toEqual(['photo'])
  })
})
