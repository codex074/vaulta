import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import AccountSettingsDialog from '../../src/components/AccountSettingsDialog.vue'
import { useAuthStore } from '../../src/stores/auth.js'
import * as authApi from '../../src/api/auth.js'
import * as profilesApi from '../../src/api/profiles.js'

vi.mock('../../src/api/auth.js', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  getCurrentUser: vi.fn(),
  changePassword: vi.fn(),
}))

vi.mock('../../src/api/profiles.js', () => ({
  getMyProfile: vi.fn(),
  updateMyDisplayName: vi.fn(),
}))

function mountDialog() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuthStore()
  auth.user = { id: 2, uid: '2', username: 'codex', displayName: 'Codex Home' }
  return { auth, wrapper: mount(AccountSettingsDialog, { global: { plugins: [pinia] } }) }
}

describe('AccountSettingsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows profile and password settings in one dialog', () => {
    const { wrapper } = mountDialog()
    expect(wrapper.get('[role="dialog"]').text()).toContain('Account settings')
    expect(wrapper.text()).toContain('UID 2 · @codex')
    expect(wrapper.text()).toContain('Display name')
    expect(wrapper.text()).toContain('Current password')
  })

  it('updates the display name without closing the settings dialog', async () => {
    profilesApi.updateMyDisplayName.mockResolvedValue({ uid: '2', username: 'codex', displayName: 'New Name' })
    const { wrapper } = mountDialog()

    await wrapper.get('input[autocomplete="name"]').setValue('New Name')
    await wrapper.findAll('form')[0].trigger('submit')
    await flushPromises()

    expect(profilesApi.updateMyDisplayName).toHaveBeenCalledWith('New Name')
    expect(wrapper.text()).toContain('Display name updated.')
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('changes the password independently and clears password fields', async () => {
    authApi.changePassword.mockResolvedValue()
    const { wrapper } = mountDialog()
    const passwordInputs = wrapper.findAll('input[type="password"]')

    await passwordInputs[0].setValue('oldpass')
    await passwordInputs[1].setValue('newpass')
    await passwordInputs[2].setValue('newpass')
    await wrapper.findAll('form')[1].trigger('submit')
    await flushPromises()

    expect(authApi.changePassword).toHaveBeenCalledWith('oldpass', 'newpass')
    expect(wrapper.text()).toContain('Password changed successfully.')
    expect(passwordInputs.every(input => input.element.value === '')).toBe(true)
  })
})
