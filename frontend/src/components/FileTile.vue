<script setup>
import { computed, ref, watch } from 'vue'
import { useFilesStore } from '../stores/files.js'
import { formatSize, formatRelativeTime, iconFor, pickFolderPreviewPaths } from './fileFormat.js'
import { previewUrl, listDirectory } from '../api/resources.js'
import { showError } from '../errorToast.js'
import { beginDrag, dragPaths, selectionToDrag, isValidDropTarget, hasDragPayload, moveInto } from './dragMove.js'
import { selectionKey } from './pathHelpers.js'

const props = defineProps({
  entry: { type: Object, required: true },
  disableOpen: { type: Boolean, default: false },
})
const emit = defineEmits(['open', 'menu', 'changed'])
const files = useFilesStore()

const fullPath = computed(() =>
  props.entry.path || `${files.currentPath}${files.currentPath.endsWith('/') ? '' : '/'}${props.entry.name}`
)
const selKey = computed(() => selectionKey(props.entry, files.currentPath, files.source))
const isSelected = computed(() => files.selected.has(selKey.value))
const isStarred = computed(() => props.entry.pinned ?? files.pinnedNames.has(props.entry.name))
const isDropTarget = ref(false)
const isDragging = ref(false)

function onDragStart(event) {
  beginDrag(event, selectionToDrag(fullPath.value, files.selected))
  isDragging.value = true
}
function onDragEnd() {
  isDragging.value = false
}
function onDragOver(event) {
  if (props.disableOpen || props.entry.type !== 'directory' || !hasDragPayload(event)) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
  isDropTarget.value = true
}
function onDragLeave() {
  isDropTarget.value = false
}
async function onDrop(event) {
  isDropTarget.value = false
  if (props.disableOpen) return
  const paths = dragPaths(event)
  if (!isValidDropTarget(fullPath.value, props.entry.type === 'directory', paths)) return
  event.preventDefault()
  event.stopPropagation()
  try {
    await moveInto(paths, fullPath.value)
    emit('changed')
  } catch (err) {
    showError(err.message || 'Could not move.')
  }
}

const thumbFailed = ref(false)
watch(fullPath, () => { thumbFailed.value = false })
const showThumb = computed(() => props.entry.hasPreview && !thumbFailed.value)
const thumbSrc = computed(() => previewUrl(fullPath.value, 'small'))

// A folder's own preview is just one cover image from FileBrowser Quantum —
// fetch its immediate children to build a 2x2 collage instead, so a photo
// folder reads as a folder of photos rather than a single image file.
const folderPreviewPaths = ref([])
watch(
  fullPath,
  async (path) => {
    folderPreviewPaths.value = []
    if (props.entry.type !== 'directory' || !props.entry.hasPreview) return
    try {
      const result = await listDirectory(path)
      if (fullPath.value === path) folderPreviewPaths.value = pickFolderPreviewPaths(result, path)
    } catch {
      // Best-effort — falls back to the single cover thumbnail below.
    }
  },
  { immediate: true }
)

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
  <div
    class="tile"
    :class="{ selected: isSelected, 'drop-target': isDropTarget, dragging: isDragging }"
    :title="entry.uploadedByUsername ? `Uploaded by ${entry.uploadedByUsername}` : ''"
    :draggable="!disableOpen"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <input
      type="checkbox"
      class="select-box"
      :checked="isSelected"
      @click.stop="files.toggleSelect(selKey)"
    />
    <button class="dots" @click.stop="emit('menu', { entry, path: fullPath })">⋮</button>
    <button v-if="!disableOpen" class="star" :class="{ starred: isStarred }" @click.stop="onStarClick">
      {{ isStarred ? '⭐' : '☆' }}
    </button>
    <div class="thumb" @click="onClick">
      <div v-if="folderPreviewPaths.length" class="folder-grid">
        <img v-for="path in folderPreviewPaths" :key="path" :src="previewUrl(path, 'small')" loading="lazy" />
      </div>
      <img v-else-if="showThumb" :src="thumbSrc" :alt="entry.name" loading="lazy" @error="thumbFailed = true" />
      <template v-else>{{ iconFor(entry) }}</template>
      <span v-if="entry.type === 'directory' && (folderPreviewPaths.length || showThumb)" class="folder-badge">📁</span>
    </div>
    <div class="name" :title="entry.name">{{ entry.displayName ?? entry.name }}</div>
    <div class="meta">
      <span>{{ entry.type === 'directory' ? '—' : formatSize(entry.size) }}</span>
      <span>{{ entry.deletedAt ? `deleted ${formatRelativeTime(entry.deletedAt)}` : formatRelativeTime(entry.modified) }}</span>
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
.tile.dragging { opacity: 0.5; }
.tile.drop-target { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent); }
.thumb { position: relative; aspect-ratio: 1; display: flex; align-items: center; justify-content: center; font-size: 40px; background: var(--bg); border-radius: 8px; cursor: pointer; overflow: hidden; }
.thumb img { width: 100%; height: 100%; object-fit: cover; }
.folder-grid {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  grid-template-rows: repeat(2, 1fr);
  gap: 2px;
}
.folder-grid img { display: block; width: 100%; height: 100%; object-fit: cover; }
.folder-badge {
  position: absolute;
  bottom: 4px;
  left: 4px;
  font-size: 15px;
  line-height: 1;
  filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.6));
}
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
