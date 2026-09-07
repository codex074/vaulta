import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useThemeStore } from '../../src/stores/theme.js'

function stubSystemPreference(prefersDark) {
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query) => ({
    matches: query === '(prefers-color-scheme: dark)' && prefersDark,
  })))
}

describe('theme store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    stubSystemPreference(false)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('defaults to light when there is no saved preference and the system prefers light', () => {
    const store = useThemeStore()
    expect(store.current).toBe('light')
  })

  it('defaults to dark when there is no saved preference and the system prefers dark', () => {
    stubSystemPreference(true)
    const store = useThemeStore()
    expect(store.current).toBe('dark')
  })

  it('toggles and persists the choice', () => {
    const store = useThemeStore()
    store.toggleTheme()
    expect(store.current).toBe('dark')
    expect(localStorage.getItem('nas-theme')).toBe('dark')
    store.toggleTheme()
    expect(store.current).toBe('light')
    expect(localStorage.getItem('nas-theme')).toBe('light')
  })

  it('restores a saved preference over the system default', () => {
    stubSystemPreference(true)
    localStorage.setItem('nas-theme', 'light')
    const store = useThemeStore()
    expect(store.current).toBe('light')
  })
})
