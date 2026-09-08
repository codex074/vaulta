<script setup>
import { computed, ref, reactive } from 'vue'
import { useFilesStore } from '../stores/files.js'
import { formatSize, formatRelativeTime, iconFor } from './fileFormat.js'
import { previewUrl } from '../api/resources.js'
import { showError } from '../errorToast.js'
import { beginDrag, dragPaths, selectionToDrag, isValidDropTarget, hasDragPayload, moveInto } from './dragMove.js'

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
const allSelected = computed(() =>
  props.entries.length > 0 && props.entries.every((entry) => files.selected.has(fullPath(entry)))
)
function onToggleSelectAll() {
  if (allSelected.value) files.clearSelection()
  else files.selectAllPaths(props.entries.map(fullPath))
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

function onDragStart(event, entry) {
  const path = fullPath(entry)
  beginDrag(event, selectionToDrag(path, files.selected))
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
    await moveInto(paths, target)
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
        :key="entry.path || entry.name"
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
            :checked="files.selected.has(fullPath(entry))"
            @click.stop="files.toggleSelect(fullPath(entry))"
          />
        </td>
        <td class="star-col">
          <button v-if="!disableOpen" class="star" @click.stop="onStarClick(entry)">
            {{ entry.pinned ?? files.pinnedNames.has(entry.name) ? '⭐' : '☆' }}
          </button>
        </td>
        <td class="name-col" @click="onClick(entry)">
          <img
            v-if="entry.hasPreview && !failedThumbs.has(fullPath(entry))"
            class="row-thumb"
            :src="previewUrl(fullPath(entry), 'small')"
            :alt="entry.name"
            loading="lazy"
            @error="failedThumbs.add(fullPath(entry))"
          />
          <span v-else class="row-icon">{{ iconFor(entry) }}</span>
          {{ entry.displayName ?? entry.name }}
        </td>
        <td>{{ entry.type === 'directory' ? '—' : formatSize(entry.size) }}</td>
        <td>{{ entry.deletedAt ? `deleted ${formatRelativeTime(entry.deletedAt)}` : formatRelativeTime(entry.modified) }}</td>
        <td class="uploader-col">{{ entry.uploadedByUsername || '—' }}</td>
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
.list tr.dragging { opacity: 0.5; }
.list tr.drop-target td { box-shadow: inset 0 0 0 2px var(--accent); }
.row-thumb { width: 20px; height: 20px; object-fit: cover; border-radius: 4px; vertical-align: middle; margin-right: 4px; }
.row-icon { display: inline-block; width: 20px; text-align: center; margin-right: 4px; }
.list button { border: none; background: none; color: var(--text-muted); }
.select-col, .star-col { width: 32px; }
.uploader-col { color: var(--text-muted); font-size: 12px; }
.star { font-size: 13px; }
</style>
