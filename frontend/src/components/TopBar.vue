<script setup>
import { computed, ref } from 'vue'
import { useFilesStore } from '../stores/files.js'
import { showError } from '../errorToast.js'
import { dragPaths, isValidDropTarget, hasDragPayload, isWithin, moveInto } from './dragMove.js'
import { selectionKey } from './pathHelpers.js'
import ThemeToggle from './ThemeToggle.vue'
import UiIcon from './UiIcon.vue'

const props = defineProps({
  entries: { type: Array, default: () => [] },
})
const emit = defineEmits(['new-folder', 'search', 'upload'])
const files = useFilesStore()
const dropTargetPath = ref(null)

const allSelected = computed(() =>
  props.entries.length > 0 &&
  props.entries.every((entry) => files.selected.has(selectionKey(entry, files.currentPath, files.source)))
)
function onToggleSelectAll() {
  if (allSelected.value) files.clearSelection()
  else files.selectAllPaths(props.entries.map((entry) => selectionKey(entry, files.currentPath, files.source)))
}

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

function onDragOver(event, path) {
  if (!hasDragPayload(event)) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
  dropTargetPath.value = path
}
function onDragLeave() {
  dropTargetPath.value = null
}
async function onDrop(event, path) {
  dropTargetPath.value = null
  const paths = dragPaths(event)
  if (!isValidDropTarget(path, true, paths)) return
  event.preventDefault()
  event.stopPropagation()
  try {
    await moveInto(paths, path)
    if (isWithin(files.currentPath, path)) {
      await files.loadDirectory(files.currentPath)
    }
  } catch (err) {
    showError(err.message || 'Could not move.')
  }
}
</script>

<template>
  <header class="topbar">
    <label class="select-all">
      <input type="checkbox" :checked="allSelected" @change="onToggleSelectAll" />
      Select all
    </label>
    <nav class="breadcrumb">
      <span v-for="(crumb, i) in crumbs" :key="crumb.path">
        <button
          class="crumb"
          :class="{ 'drop-target': dropTargetPath === crumb.path }"
          @click="goTo(crumb.path)"
          @dragover="onDragOver($event, crumb.path)"
          @dragleave="onDragLeave"
          @drop="onDrop($event, crumb.path)"
        >{{ crumb.label }}</button>
        <span v-if="i < crumbs.length - 1"> / </span>
      </span>
    </nav>
    <label class="search-wrap">
      <UiIcon name="search" :size="17" />
      <input class="search" placeholder="Find in this space" @input="emit('search', $event.target.value)" />
    </label>
    <div class="toolbar-actions">
      <button class="toolbar-button" :aria-label="files.viewMode === 'grid' ? 'Switch to list view' : 'Switch to grid view'" @click="files.toggleViewMode()">
        <UiIcon :name="files.viewMode === 'grid' ? 'list' : 'grid'" />
        <span>{{ files.viewMode === 'grid' ? 'List' : 'Grid' }}</span>
      </button>
      <button class="toolbar-button" @click="emit('upload')"><UiIcon name="upload" /><span>Upload</span></button>
      <button class="toolbar-button primary-action" @click="emit('new-folder')"><UiIcon name="folder-plus" /><span>New folder</span></button>
      <ThemeToggle />
    </div>
  </header>
</template>

<style scoped>
.topbar { display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--border); background: var(--bg-elevated); }
.select-all { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text-muted); white-space: nowrap; cursor: pointer; }
.breadcrumb { flex: 1; }
.crumb { border: none; background: none; color: var(--text); font-weight: 600; padding: 4px; }
.crumb:hover { color: var(--accent); }
.crumb.drop-target { color: var(--accent); box-shadow: inset 0 -2px 0 var(--accent); border-radius: 2px; }
.search-wrap { position: relative; display: flex; align-items: center; color: var(--text-muted); }
.search-wrap > svg { position: absolute; z-index: 1; left: 12px; pointer-events: none; }
.search { padding: 8px 10px 8px 38px; border: 1px solid var(--border); border-radius: 8px; width: 200px; }
.toolbar-actions { display: flex; align-items: center; gap: 8px; }
.toolbar-button { display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; }
.topbar button { border: 1px solid var(--border); background: var(--bg-elevated); border-radius: 8px; padding: 8px 12px; }
</style>
