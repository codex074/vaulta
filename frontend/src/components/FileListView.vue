<script setup>
import { useFilesStore } from '../stores/files.js'
import { formatSize, formatRelativeTime, iconFor } from './fileFormat.js'
import { showError } from '../errorToast.js'

defineProps({ entries: { type: Array, required: true } })
const emit = defineEmits(['open', 'menu'])
const files = useFilesStore()

function fullPath(entry) {
  return `${files.currentPath}${files.currentPath.endsWith('/') ? '' : '/'}${entry.name}`
}
async function onClick(entry) {
  if (entry.type === 'directory') {
    try {
      await files.loadDirectory(fullPath(entry))
    } catch (err) {
      showError(err.message || 'Could not open folder.')
    }
  } else {
    emit('open', { ...entry, path: fullPath(entry) })
  }
}
</script>

<template>
  <table class="list">
    <thead><tr><th></th><th>Name</th><th>Size</th><th>Modified</th><th></th></tr></thead>
    <tbody>
      <tr v-for="entry in entries" :key="entry.name">
        <td class="select-col">
          <input
            type="checkbox"
            :checked="files.selected.has(fullPath(entry))"
            @click.stop="files.toggleSelect(fullPath(entry))"
          />
        </td>
        <td @click="onClick(entry)">{{ iconFor(entry) }} {{ entry.name }}</td>
        <td>{{ entry.type === 'directory' ? '—' : formatSize(entry.size) }}</td>
        <td>{{ formatRelativeTime(entry.modified) }}</td>
        <td><button @click.stop="emit('menu', { entry, path: fullPath(entry) })">⋮</button></td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
.list { width: 100%; border-collapse: collapse; }
.list th { text-align: left; font-size: 11px; color: var(--text-muted); border-bottom: 1px solid var(--border); padding: 8px 16px; }
.list td { padding: 8px 16px; border-bottom: 1px solid var(--border); font-size: 13px; }
.list td:nth-child(2) { cursor: pointer; }
.list button { border: none; background: none; color: var(--text-muted); }
.select-col { width: 32px; }
</style>
