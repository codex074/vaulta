<script setup>
import { useThemeStore } from '../stores/theme.js'

const theme = useThemeStore()
</script>

<template>
  <button
    class="theme-toggle"
    role="switch"
    :aria-checked="theme.current === 'dark'"
    :title="theme.current === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
    @click="theme.toggleTheme()"
  >
    <span class="icon sun">☀️</span>
    <span class="track" :class="{ dark: theme.current === 'dark' }"><span class="thumb"></span></span>
    <span class="icon moon">🌙</span>
  </button>
</template>

<style scoped>
.theme-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  padding: 4px;
}
.icon { font-size: 12px; line-height: 1; }
.track {
  width: 34px;
  height: 18px;
  background: var(--border);
  border-radius: 999px;
  position: relative;
  transition: background 0.15s ease;
}
.track.dark { background: var(--accent); }
.thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  background: var(--bg-elevated);
  border-radius: 50%;
  transition: transform 0.15s ease;
}
.track.dark .thumb { transform: translateX(16px); }
</style>
