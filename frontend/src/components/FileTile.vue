<script setup>
import { computed, ref, watch } from 'vue'
import { useFilesStore } from '../stores/files.js'
import { formatSize, formatRelativeTime, iconFor } from './fileFormat.js'
import { previewUrl } from '../api/resources.js'
import { showError } from '../errorToast.js'

const props = defineProps({
  entry: { type: Object, required: true },
  disableOpen: { type: Boolean, default: false },
})
const emit = defineEmits(['open', 'menu'])
const files = useFilesStore()

const fullPath = computed(() =>
  props.entry.path || `${files.currentPath}${files.currentPath.endsWith('/') ? '' : '/'}${props.entry.name}`
)
const isSelected = computed(() => files.selected.has(fullPath.value))
const isStarred = computed(() => props.entry.pinned ?? files.pinnedNames.has(props.entry.name))
const thumbFailed = ref(false)
watch(fullPath, () => { thumbFailed.value = false })
const showThumb = computed(() => props.entry.hasPreview && !thumbFailed.value)
const thumbSrc = computed(() => previewUrl(fullPath.value, 'small'))

async function onClick() {
  if (props.disableOpen) return
  if (props.entry.type === 'directory') {
    try {
      await files.loadDirectory(fullPath.value)
    } catch (err) {
      showError(err.message || 'Could not open folder.')
    }
  } else {
    emit('open', { ...props.entry, path: fullPath.value })
  }
}

async function onStarClick() {
  try {
    await files.toggleStar(props.entry)
  } catch (err) {
    showError(err.message || 'Could not update star.')
  }
}
</script>

<template>
  <div class="tile" :class="{ selected: isSelected }">
    <input
      type="checkbox"
      class="select-box"
      :checked="isSelected"
      @click.stop="files.toggleSelect(fullPath)"
    />
    <button class="dots" @click.stop="emit('menu', { entry, path: fullPath })">⋮</button>
    <button v-if="!disableOpen" class="star" :class="{ starred: isStarred }" @click.stop="onStarClick">
      {{ isStarred ? '⭐' : '☆' }}
    </button>
    <div class="thumb" @click="onClick">
      <img v-if="showThumb" :src="thumbSrc" :alt="entry.name" loading="lazy" @error="thumbFailed = true" />
      <template v-else>{{ iconFor(entry) }}</template>
    </div>
    <div class="name" :title="entry.name">{{ entry.displayName ?? entry.name }}</div>
    <div class="meta">
      <span>{{ entry.type === 'directory' ? '—' : formatSize(entry.size) }}</span>
      <span>{{ formatRelativeTime(entry.deletedAt ?? entry.modified) }}</span>
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
.tile.selected { border-color: var(--accent); background: var(--selected-bg); }
.thumb { aspect-ratio: 1; display: flex; align-items: center; justify-content: center; font-size: 40px; background: var(--bg); border-radius: 8px; cursor: pointer; overflow: hidden; }
.thumb img { width: 100%; height: 100%; object-fit: cover; }
.name { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.meta { display: flex; justify-content: space-between; font-size: 10px; color: var(--text-muted); }
.dots { position: absolute; top: 6px; right: 6px; border: none; background: transparent; color: var(--text-muted); font-size: 14px; }
.select-box { position: absolute; top: 6px; left: 6px; opacity: 0; }
.tile:hover .select-box, .tile.selected .select-box { opacity: 1; }
.star { position: absolute; bottom: 6px; right: 6px; border: none; background: transparent; font-size: 14px; opacity: 0; }
.tile:hover .star, .star.starred { opacity: 1; }
@media (hover: none) {
  .select-box { opacity: 1; }
  .star { opacity: 1; }
}
</style>
