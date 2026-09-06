<script setup>
import { computed } from 'vue'
import { useFilesStore } from '../stores/files.js'
import { formatSize, formatRelativeTime, iconFor } from './fileFormat.js'

const props = defineProps({ entry: { type: Object, required: true } })
const emit = defineEmits(['open', 'menu'])
const files = useFilesStore()

const fullPath = computed(() => `${files.currentPath}${files.currentPath.endsWith('/') ? '' : '/'}${props.entry.name}`)
const isSelected = computed(() => files.selected.has(fullPath.value))

function onClick() {
  if (props.entry.type === 'directory') files.loadDirectory(fullPath.value)
  else emit('open', { ...props.entry, path: fullPath.value })
}
</script>

<template>
  <div class="tile" :class="{ selected: isSelected }">
    <button class="dots" @click.stop="emit('menu', { entry, path: fullPath })">⋮</button>
    <div class="thumb" @click="onClick">{{ iconFor(entry) }}</div>
    <div class="name" :title="entry.name">{{ entry.name }}</div>
    <div class="meta">
      <span>{{ entry.type === 'directory' ? '—' : formatSize(entry.size) }}</span>
      <span>{{ formatRelativeTime(entry.modified) }}</span>
    </div>
  </div>
</template>

<style scoped>
.tile {
  position: relative;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tile.selected { border-color: var(--accent); background: #eaf1ff; }
.thumb { aspect-ratio: 1; display: flex; align-items: center; justify-content: center; font-size: 40px; background: var(--bg); border-radius: 8px; cursor: pointer; }
.name { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.meta { display: flex; justify-content: space-between; font-size: 10px; color: var(--text-muted); }
.dots { position: absolute; top: 6px; right: 6px; border: none; background: transparent; color: var(--text-muted); font-size: 14px; }
</style>
