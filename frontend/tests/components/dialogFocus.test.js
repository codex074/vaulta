import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { dialogFocus } from '../../src/components/dialogFocus.js'
let wrapper
let opener
afterEach(() => { wrapper?.unmount(); opener?.remove() })
it('keeps keyboard navigation in a dialog, closes on Escape, and restores focus', async () => {
  opener = document.createElement('button')
  document.body.appendChild(opener)
  opener.focus()
  const close = vi.fn()
  wrapper = mount({ directives: { dialogFocus }, setup: () => ({ close }), template: '<section v-dialog-focus="close"><button>First</button><input aria-label="Name"><button>Last</button></section>' }, { attachTo: document.body })
  await new Promise(resolve => queueMicrotask(resolve))
  const buttons = wrapper.findAll('button')
  expect(document.activeElement).toBe(buttons[0].element)
  buttons[1].element.focus()
  await buttons[1].trigger('keydown', { key: 'Tab' })
  expect(document.activeElement).toBe(buttons[0].element)
  await buttons[0].trigger('keydown', { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(buttons[1].element)
  await buttons[1].trigger('keydown', { key: 'Escape' })
  expect(close).toHaveBeenCalledOnce()
  wrapper.unmount(); wrapper = null
  expect(document.activeElement).toBe(opener)
})
