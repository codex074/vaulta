<script setup>
import { useFilesStore } from '../stores/files.js'
import { formatSize, formatRelativeTime, iconFor } from './fileFormat.js'
import { showError } from '../errorToast.js'

const props = defineProps({
  entries: { type: Array, required: true },
  disableOpen: { type: Boolean, default: false },
})
const emit = defineEmits(['open', 'menu'])
const files = useFilesStore()

function fullPath(entry) {
  return entry.path || `${files.currentPath}${files.currentPath.endsWith('/') ? '' : '/'}${entry.name}`
}
async function onClick(entry) {
  if (props.disableOpen) return
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
async function onStarClick(entry) {
  try {
    await files.toggleStar(entry)
  } catch (err) {
    showError(err.message || 'Could not update star.')
  }
}
</script>

<template>
  <table class="list">
    <thead><tr><th></th><th></th><th>Name</th><th>Size</th><th>Modified</th><th></th></tr></thead>
    <tbody>
      <tr v-for="entry in entries" :key="entry.path || entry.name">
        <td class="select-col">
          <input
            type="checkbox"
            :checked="files.selected.has(fullPath(entry))"
            @click.stop="files.toggleSelect(fullPath(entry))"
          />
        </td>
        <td class="star-col">
          <button v-if="!disableOpen" class="star" @click.stop="onStarClick(entry)">
            {{ entry.pinned ?? files.pinnedNames.has(entry.name) ? '⭐' : '☆' }}
          </button>
        </td>
        <td @click="onClick(entry)">{{ iconFor(entry) }} {{ entry.displayName ?? entry.name }}</td>
        <td>{{ entry.type === 'directory' ? '—' : formatSize(entry.size) }}</td>
        <td>{{ entry.deletedAt ? `deleted ${formatRelativeTime(entry.deletedAt)}` : formatRelativeTime(entry.modified) }}</td>
        <td><button @click.stop="emit('menu', { entry, path: fullPath(entry) })">⋮</button></td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
.list { width: 100%; border-collapse: collapse; }
.list th { text-align: left; font-size: 11px; color: var(--text-muted); border-bottom: 1px solid var(--border); padding: 8px 16px; }
.list td { padding: 8px 16px; border-bottom: 1px solid var(--border); font-size: 13px; }
.list td:nth-child(3) { cursor: pointer; }
.list button { border: none; background: none; color: var(--text-muted); }
.select-col, .star-col { width: 32px; }
.star { font-size: 13px; }
</style>
