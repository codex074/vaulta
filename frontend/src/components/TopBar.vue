<script setup>
import { computed, ref } from 'vue'
import { useFilesStore } from '../stores/files.js'
import { showError } from '../errorToast.js'
import { dragPaths, isValidDropTarget, hasDragPayload, isWithin, moveInto } from './dragMove.js'

const emit = defineEmits(['new-folder', 'search', 'upload'])
const files = useFilesStore()
const dropTargetPath = ref(null)

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
    <input class="search" placeholder="Search" @input="emit('search', $event.target.value)" />
    <button @click="files.toggleViewMode()">{{ files.viewMode === 'grid' ? '☰ List' : '▦ Grid' }}</button>
    <button @click="emit('upload')">⬆ Upload</button>
    <button @click="emit('new-folder')">+ New folder</button>
  </header>
</template>

<style scoped>
.topbar { display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--border); background: var(--bg-elevated); }
.breadcrumb { flex: 1; }
.crumb { border: none; background: none; color: var(--text); font-weight: 600; padding: 4px; }
.crumb:hover { color: var(--accent); }
.crumb.drop-target { color: var(--accent); box-shadow: inset 0 -2px 0 var(--accent); border-radius: 2px; }
.search { padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; width: 200px; }
.topbar button { border: 1px solid var(--border); background: var(--bg-elevated); border-radius: 8px; padding: 8px 12px; }
</style>
