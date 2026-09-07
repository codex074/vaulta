<script setup>
import { computed } from 'vue'
import { useFilesStore } from '../stores/files.js'
import { showError } from '../errorToast.js'
import ThemeToggle from './ThemeToggle.vue'

const emit = defineEmits(['new-folder', 'search', 'upload'])
const files = useFilesStore()

const crumbs = computed(() => {
  const parts = files.currentPath.split('/').filter(Boolean)
  const result = [{ label: 'Home', path: '/' }]
  let acc = ''
  for (const part of parts) {
    acc += `/${part}`
    result.push({ label: part, path: acc })
  }
  return result
})

async function goTo(path) {
  try {
    await files.loadDirectory(path)
  } catch (err) {
    showError(err.message || 'Could not open folder.')
  }
}
</script>

<template>
  <header class="topbar">
    <nav class="breadcrumb">
      <span v-for="(crumb, i) in crumbs" :key="crumb.path">
        <button class="crumb" @click="goTo(crumb.path)">{{ crumb.label }}</button>
        <span v-if="i < crumbs.length - 1"> / </span>
      </span>
    </nav>
    <input class="search" placeholder="Search" @input="emit('search', $event.target.value)" />
    <button @click="files.toggleViewMode()">{{ files.viewMode === 'grid' ? '☰ List' : '▦ Grid' }}</button>
    <button @click="emit('upload')">⬆ Upload</button>
    <button @click="emit('new-folder')">+ New folder</button>
    <ThemeToggle />
  </header>
</template>

<style scoped>
.topbar { display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--border); background: var(--bg-elevated); }
.breadcrumb { flex: 1; }
.crumb { border: none; background: none; color: var(--text); font-weight: 600; padding: 4px; }
.crumb:hover { color: var(--accent); }
.search { padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; width: 200px; }
.topbar button { border: 1px solid var(--border); background: var(--bg-elevated); border-radius: 8px; padding: 8px 12px; }
</style>
