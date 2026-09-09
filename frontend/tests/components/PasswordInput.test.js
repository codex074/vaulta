import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import PasswordInput from '../../src/components/PasswordInput.vue'

describe('PasswordInput', () => {
  it('starts hidden, forwards attrs, and toggles visibility with an accessible button', async () => {
    const wrapper = mount(PasswordInput, {
      props: { modelValue: 'secret', 'onUpdate:modelValue': (v) => wrapper.setProps({ modelValue: v }) },
      attrs: { placeholder: 'Your password', autocomplete: 'current-password', class: 'password', required: true },
    })
    const input = wrapper.get('input')
    expect(input.attributes('type')).toBe('password')
    expect(input.attributes('placeholder')).toBe('Your password')
    expect(input.attributes('autocomplete')).toBe('current-password')
    expect(input.classes()).toContain('password')
    expect(input.element.value).toBe('secret')
    expect(input.attributes('spellcheck')).toBe('false')
    expect(input.attributes('autocapitalize')).toBe('none')
    expect(input.attributes('autocorrect')).toBe('off')
    const toggle = wrapper.get('button.toggle-password')
    expect(toggle.attributes('aria-label')).toBe('Show password')
    expect(toggle.attributes('aria-pressed')).toBe('false')
    expect(toggle.attributes('type')).toBe('button')
    await toggle.trigger('click')
    expect(input.attributes('type')).toBe('text')
    expect(toggle.attributes('aria-label')).toBe('Hide password')
    expect(toggle.attributes('aria-pressed')).toBe('true')
    await input.setValue('changed')
    expect(wrapper.props('modelValue')).toBe('changed')
  })
})
