<script setup>
import { computed, ref, reactive } from 'vue'
import { useFilesStore } from '../stores/files.js'
import { formatSize, formatRelativeTime, iconFor } from './fileFormat.js'
import { previewUrl } from '../api/resources.js'
import { showError } from '../errorToast.js'
import { beginDrag, dragPaths, selectionToDrag, isValidDropTarget, hasDragPayload, moveInto } from './dragMove.js'
import { selectionKey, parseSelectionKey } from './pathHelpers.js'

const failedThumbs = reactive(new Set())

const props = defineProps({
  entries: { type: Array, required: true },
  disableOpen: { type: Boolean, default: false },
})
const emit = defineEmits(['open', 'menu', 'changed'])
const files = useFilesStore()
const draggingPath = ref(null)
const dropTargetPath = ref(null)

function fullPath(entry) {
  return entry.path || `${files.currentPath}${files.currentPath.endsWith('/') ? '' : '/'}${entry.name}`
}
function entrySource(entry) {
  return entry.source ?? files.source
}
function selKey(entry) {
  return selectionKey(entry, files.currentPath, files.source)
}
const allSelected = computed(() =>
  props.entries.length > 0 && props.entries.every((entry) => files.selected.has(selKey(entry)))
)
function onToggleSelectAll() {
  if (allSelected.value) files.clearSelection()
  else files.selectAllPaths(props.entries.map(selKey))
}
async function onClick(entry) {
  if (props.disableOpen) return
  if (entry.type === 'directory') {
    try {
      // A folder from a foreign drive (e.g. reached via Starred, which
      // aggregates both) switches the browsed drive so its own contents
      // resolve against the right source.
      if (entry.source && entry.source !== files.source) files.source = entry.source
      await files.loadDirectory(fullPath(entry))
    } catch (err) {
      showError(err.message || 'Could not open folder.')
    }
  } else {
    emit('open', { ...entry, path: fullPath(entry), source: entrySource(entry) })
  }
}
async function onStarClick(entry) {
  try {
    await files.toggleStar(entry)
  } catch (err) {
    showError(err.message || 'Could not update star.')
  }
}

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
function onDragStart(event, entry) {
  const path = fullPath(entry)
  beginDrag(event, selectionToDrag(path, samePathsForSource(entrySource(entry))))
  draggingPath.value = path
}
function onDragEnd() {
  draggingPath.value = null
}
function onDragOver(event, entry) {
  if (props.disableOpen || entry.type !== 'directory' || !hasDragPayload(event)) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
  dropTargetPath.value = fullPath(entry)
}
function onDragLeave() {
  dropTargetPath.value = null
}
async function onDrop(event, entry) {
  dropTargetPath.value = null
  if (props.disableOpen) return
  const target = fullPath(entry)
  const paths = dragPaths(event)
  if (!isValidDropTarget(target, entry.type === 'directory', paths)) return
  event.preventDefault()
  event.stopPropagation()
  try {
    await moveInto(entrySource(entry), paths, target)
    emit('changed')
  } catch (err) {
    showError(err.message || 'Could not move.')
  }
}
</script>

<template>
  <table class="list">
    <thead>
      <tr>
        <th class="select-col">
          <input type="checkbox" :checked="allSelected" @click="onToggleSelectAll" />
        </th>
        <th></th>
        <th>Name</th>
        <th>Size</th>
        <th>Modified</th>
        <th>Uploaded by</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      <tr
        v-for="entry in entries"
        :key="`${entry.source || files.source}:${entry.path || entry.name}`"
        :class="{ dragging: draggingPath === fullPath(entry), 'drop-target': dropTargetPath === fullPath(entry) }"
        :draggable="!disableOpen"
        @dragstart="onDragStart($event, entry)"
        @dragend="onDragEnd"
        @dragover="onDragOver($event, entry)"
        @dragleave="onDragLeave"
        @drop="onDrop($event, entry)"
      >
        <td class="select-col">
          <input
            type="checkbox"
            :checked="files.selected.has(selKey(entry))"
            @click.stop="files.toggleSelect(selKey(entry))"
          />
        </td>
        <td class="star-col">
          <button v-if="!disableOpen" class="star" @click.stop="onStarClick(entry)">
            {{ entry.pinned ?? files.pinnedNames.has(entry.name) ? '⭐' : '☆' }}
          </button>
        </td>
        <td class="name-col" @click="onClick(entry)">
          <span v-if="entry.hasPreview && !failedThumbs.has(fullPath(entry))" class="row-thumb-wrap">
            <img
              class="row-thumb"
              :src="previewUrl(entrySource(entry), fullPath(entry), 'small')"
              :alt="entry.name"
              loading="lazy"
              @error="failedThumbs.add(fullPath(entry))"
            />
            <span v-if="entry.type === 'directory'" class="row-folder-badge">📁</span>
          </span>
          <span v-else class="row-icon">{{ iconFor(entry) }}</span>
          {{ entry.displayName ?? entry.name }}
        </td>
        <td>{{ entry.type === 'directory' ? '—' : formatSize(entry.size) }}</td>
        <td>{{ entry.deletedAt ? `deleted ${formatRelativeTime(entry.deletedAt)}` : formatRelativeTime(entry.modified) }}</td>
        <td class="uploader-col">{{ entry.uploadedByUsername || '—' }}</td>
        <td><button @click.stop="emit('menu', { entry: { ...entry, source: entrySource(entry) }, path: fullPath(entry) })">⋮</button></td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
.list { width: 100%; border-collapse: collapse; }
.list th { text-align: left; font-size: 11px; color: var(--text-muted); border-bottom: 1px solid var(--border); padding: 8px 16px; }
.list td { padding: 8px 16px; border-bottom: 1px solid var(--border); font-size: 13px; }
.list td:nth-child(3) { cursor: pointer; }
.list tr.dragging { opacity: 0.5; }
.list tr.drop-target td { box-shadow: inset 0 0 0 2px var(--accent); }
.row-thumb-wrap { position: relative; display: inline-block; vertical-align: middle; margin-right: 4px; }
.row-thumb { width: 20px; height: 20px; object-fit: cover; border-radius: 4px; display: block; }
.row-folder-badge { position: absolute; bottom: -3px; right: -3px; font-size: 9px; line-height: 1; filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6)); }
.row-icon { display: inline-block; width: 20px; text-align: center; margin-right: 4px; }
.list button { border: none; background: none; color: var(--text-muted); }
.select-col, .star-col { width: 32px; }
.uploader-col { color: var(--text-muted); font-size: 12px; }
.star { font-size: 13px; }
</style>
