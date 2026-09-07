import { defineStore } from 'pinia'

const THEME_KEY = 'nas-theme'

function systemPrefersDark() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

function initialTheme() {
  const stored = localStorage.getItem(THEME_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return systemPrefersDark() ? 'dark' : 'light'
}

export const useThemeStore = defineStore('theme', {
  state: () => ({
    current: initialTheme(),
  }),
  actions: {
    toggleTheme() {
      this.current = this.current === 'dark' ? 'light' : 'dark'
      localStorage.setItem(THEME_KEY, this.current)
    },
  },
})
