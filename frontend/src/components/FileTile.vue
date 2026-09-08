<script setup>
import FileGlyph from './FileGlyph.vue'
import UiIcon from './UiIcon.vue'
import { computed, ref, watch } from 'vue'
import { useFilesStore } from '../stores/files.js'
import { formatSize, formatRelativeTime, pickFolderPreviewPaths } from './fileFormat.js'
import { previewUrl, listDirectory } from '../api/resources.js'
import { showError } from '../errorToast.js'
import { beginDrag, dragPaths, selectionToDrag, isValidDropTarget, hasDragPayload, moveInto } from './dragMove.js'
import { selectionKey, parseSelectionKey } from './pathHelpers.js'

const props = defineProps({
  entry: { type: Object, required: true },
  disableOpen: { type: Boolean, default: false },
})
const emit = defineEmits(['open', 'menu', 'changed', 'folder-opened'])
const files = useFilesStore()

const fullPath = computed(() =>
  props.entry.path || `${files.currentPath}${files.currentPath.endsWith('/') ? '' : '/'}${props.entry.name}`
)
const entrySource = computed(() => props.entry.source ?? files.source)
const selKey = computed(() => selectionKey(props.entry, files.currentPath, files.source))
const isSelected = computed(() => files.selected.has(selKey.value))
const isStarred = computed(() => props.entry.pinned ?? files.pinnedNames.has(props.entry.name))
const isDropTarget = ref(false)
const isDragging = ref(false)

// Drag-and-drop only ever moves items within one drive (see dragMove.js's
// moveInto), so a multi-item drag only carries along the rest of the
// selection that shares this item's own source — a selection spanning two
// drives (possible in the aggregated Starred view) degrades to dragging
// just this one item rather than silently mixing sources.
function samePathsForSource(source) {
  return new Set(
    Array.from(files.selected)
      .map(parseSelectionKey)
      .filter((k) => k.source === source)
      .map((k) => k.path)
  )
}
function onDragStart(event) {
  beginDrag(event, selectionToDrag(fullPath.value, samePathsForSource(entrySource.value)))
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
    await moveInto(entrySource.value, paths, fullPath.value)
    emit('changed')
  } catch (err) {
    showError(err.message || 'Could not move.')
  }
}

const thumbFailed = ref(false)
watch(fullPath, () => { thumbFailed.value = false })
const showThumb = computed(() => props.entry.hasPreview && !thumbFailed.value)
const thumbSrc = computed(() => previewUrl(entrySource.value, fullPath.value, 'small'))

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
      const result = await listDirectory(entrySource.value, path)
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
      // A folder from a foreign drive (e.g. reached via Starred, which
      // aggregates both) switches the browsed drive so its own contents
      // resolve against the right source.
      if (props.entry.source && props.entry.source !== files.source) files.source = props.entry.source
      await files.loadDirectory(fullPath.value)
      emit('folder-opened')
    } catch (err) {
      showError(err.message || 'Could not open folder.')
    }
  } else {
    emit('open', { ...props.entry, path: fullPath.value, source: entrySource.value })
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
      :aria-label="`Select ${entry.name}`"
      :checked="isSelected"
      @click.stop="files.toggleSelect(selKey)"
    />
    <button class="dots" :aria-label="`Actions for ${entry.name}`" @click.stop="emit('menu', { entry: { ...entry, source: entrySource }, path: fullPath })"><UiIcon name="more" /></button>
    <button v-if="!disableOpen" class="star" :aria-label="`${isStarred ? 'Unstar' : 'Star'} ${entry.name}`" :class="{ starred: isStarred }" @click.stop="onStarClick">
      <UiIcon name="starred" :size="17" />
    </button>
    <button class="thumb" :aria-label="`Open ${entry.name}`" :disabled="disableOpen" @click="onClick">
      <div v-if="folderPreviewPaths.length" class="folder-grid">
        <img v-for="path in folderPreviewPaths" :key="path" :src="previewUrl(entrySource, path, 'small')" loading="lazy" />
      </div>
      <img v-else-if="showThumb" :src="thumbSrc" :alt="entry.name" loading="lazy" @error="thumbFailed = true" />
      <FileGlyph v-else :entry="entry" />
      <span v-if="entry.type === 'directory' && (folderPreviewPaths.length || showThumb)" class="folder-badge"><UiIcon name="folder" :size="18" /></span>
    </button>
    <button class="name" :disabled="disableOpen" @click="onClick" :title="entry.name">{{ entry.displayName ?? entry.name }}</button>
    <div class="meta">
      <span>{{ entry.type === 'directory' ? 'Folder' : formatSize(entry.size) }}</span>
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
