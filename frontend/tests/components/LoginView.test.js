import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import LoginView from '../../src/components/LoginView.vue'
import { useAuthStore } from '../../src/stores/auth.js'

function mountLogin() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuthStore()
  auth.signIn = vi.fn().mockResolvedValue()
  return { auth, wrapper: mount(LoginView, { global: { plugins: [pinia] } }) }
}

describe('LoginView', () => {
  beforeEach(() => localStorage.clear())

  it('signs in without remembering by default and passes the checkbox through', async () => {
    const { auth, wrapper } = mountLogin()
    await wrapper.get('input[autocomplete="username"]').setValue('alice')
    await wrapper.get('input[type="password"]').setValue('pw')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(auth.signIn).toHaveBeenLastCalledWith('alice', 'pw', { remember: false })
    await wrapper.get('input.remember').setValue(true)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(auth.signIn).toHaveBeenLastCalledWith('alice', 'pw', { remember: true })
  })

  it('shows why the user was signed out', () => {
    const { auth, wrapper } = mountLogin()
    auth.signedOutReason = 'Signed out after 1 hour of inactivity.'
    return wrapper.vm.$nextTick().then(() => {
      expect(wrapper.get('.login-notice').text()).toBe('Signed out after 1 hour of inactivity.')
    })
  })
})
