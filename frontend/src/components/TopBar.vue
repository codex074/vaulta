<script setup>
import { computed, ref } from 'vue'
import { useFilesStore } from '../stores/files.js'
import { showError } from '../errorToast.js'
import { dragPaths, isValidDropTarget, hasDragPayload, isWithin, moveInto } from './dragMove.js'
import { selectionKey, collapseTrail } from './pathHelpers.js'
import UiIcon from './UiIcon.vue'

const props = defineProps({
  entries: { type: Array, default: () => [] },
  view: { type: String, default: 'browse' },
  searchQuery: { type: String, default: '' },
})
const emit = defineEmits(['new-folder', 'search', 'upload'])
const files = useFilesStore()
const dropTargetPath = ref(null)
const heading = computed(() => props.view === 'starred' ? 'Starred' : props.view === 'links' ? 'Links' : props.view === 'trash' ? 'Trash' : files.currentPath.split('/').filter(Boolean).at(-1) || (files.source === 'home' ? 'My Drive' : 'Shared'))
const subtitle = computed(() => props.view === 'starred' ? 'Your favorites, all together.' : props.view === 'trash' ? 'Restore files or let them go.' : files.currentPath !== '/' ? 'A little more organized.' : files.source === 'home' ? 'A home for everything that matters.' : 'Good things are better shared.')

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
  const rootLabel = files.source === 'home' ? 'My Drive' : 'Shared'
  const result = [{ label: rootLabel, path: '/' }]
  let acc = ''
  for (const part of parts) {
    acc += `/${part}`
    result.push({ label: part, path: acc })
  }
  return result
})

// Collapse the middle of a deep path into a "…" menu so the trail stays on
// one line: root › … › parent › current. Only the middle is hidden — the
// root and the last two crumbs are always shown, and the hidden ones remain
// reachable through the ellipsis menu.
const trail = computed(() => collapseTrail(crumbs.value, 2))

const atRoot = computed(() => trail.value.tail.length === 0)
const showCrumbMenu = ref(false)

function parentOf(path) {
  const idx = path.lastIndexOf('/')
  return idx <= 0 ? '/' : path.slice(0, idx)
}

async function goTo(path) {
  showCrumbMenu.value = false
  try {
    await files.loadDirectory(path)
  } catch (err) {
    showError(err.message || 'Could not open folder.')
  }
}

function goUp() {
  if (!atRoot.value) goTo(parentOf(files.currentPath))
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
    await moveInto(files.source, paths, path)
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
    <div class="navigation-row">
    <span v-if="view !== 'browse' || atRoot" class="location-label"><UiIcon :name="view === 'starred' ? 'starred' : view === 'trash' ? 'trash' : 'home'" :size="17" />{{ view === 'browse' ? 'Your library' : 'Collections' }}</span>
    <button v-if="view === 'browse' && !atRoot" class="back-btn" :disabled="atRoot" aria-label="Up one level" title="Up one level" @click="goUp">
      <UiIcon name="arrow-left" :size="18" />
    </button>
    <nav v-if="view === 'browse' && !atRoot" class="breadcrumb" aria-label="Folder path">
      <button
        class="crumb"
        :class="{ 'drop-target': dropTargetPath === trail.lead.path }"
        @click="goTo(trail.lead.path)"
        @dragover="onDragOver($event, trail.lead.path)"
        @dragleave="onDragLeave"
        @drop="onDrop($event, trail.lead.path)"
      >{{ trail.lead.label }}</button>

      <span v-if="trail.hidden.length" class="crumb-collapse">
        <UiIcon class="sep" name="chevron" :size="13" />
        <button class="crumb ellipsis" aria-label="Show hidden folders" @click="showCrumbMenu = !showCrumbMenu">…</button>
        <div v-if="showCrumbMenu" class="crumb-backdrop" @click="showCrumbMenu = false"></div>
        <div v-if="showCrumbMenu" class="crumb-menu">
          <button v-for="crumb in trail.hidden" :key="crumb.path" @click="goTo(crumb.path)">{{ crumb.label }}</button>
        </div>
      </span>

      <template v-for="(crumb, i) in trail.tail" :key="crumb.path">
        <UiIcon class="sep" name="chevron" :size="13" />
        <button
          class="crumb"
          :class="{ 'drop-target': dropTargetPath === crumb.path, current: i === trail.tail.length - 1 }"
          @click="goTo(crumb.path)"
          @dragover="onDragOver($event, crumb.path)"
          @dragleave="onDragLeave"
          @drop="onDrop($event, crumb.path)"
        >{{ crumb.label }}</button>
      </template>
    </nav>
    <div class="toolbar-actions">
      <button class="toolbar-button" :aria-label="files.viewMode === 'grid' ? 'Switch to list view' : 'Switch to grid view'" @click="files.toggleViewMode()">
        <UiIcon :name="files.viewMode === 'grid' ? 'list' : 'grid'" />
        <span>{{ files.viewMode === 'grid' ? 'List' : 'Grid' }}</span>
      </button>
      <button v-if="view === 'browse'" class="toolbar-button" aria-label="Upload files" @click="emit('upload')"><UiIcon name="upload" /><span>Upload</span></button>
      <button v-if="view === 'browse'" class="toolbar-button primary-action" aria-label="New folder" @click="emit('new-folder')"><UiIcon name="folder-plus" /><span>New folder</span></button>
    </div>
    </div>
    <div class="page-heading">
      <div class="heading-copy"><h1 :title="heading">{{ heading }}</h1><p>{{ subtitle }}</p></div>
      <span class="item-count">{{ entries.length }} {{ entries.length === 1 ? 'item' : 'items' }}</span>
    </div>
    <div class="search-row">
      <label class="search-wrap">
        <UiIcon name="search" :size="19" />
        <input class="search" type="search" aria-label="Search files" placeholder="Search files" :value="searchQuery" @input="emit('search', $event.target.value)" />
      </label>
      <label class="select-all"><input type="checkbox" :checked="allSelected" @change="onToggleSelectAll" />Select all</label>
    </div>
  </header>
</template>

<style scoped>
.topbar { display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--border); background: var(--bg-elevated); }
.select-all { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text-muted); white-space: nowrap; cursor: pointer; }
.back-btn { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; padding: 8px; color: var(--text-muted); }
.back-btn:hover:not(:disabled) { color: var(--accent); }
.back-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.breadcrumb { flex: 1; min-width: 0; display: flex; align-items: center; gap: 1px; flex-wrap: nowrap; overflow: hidden; }
.crumb { border: none; background: none; color: var(--text-muted); font-weight: 600; padding: 4px 5px; border-radius: 6px; max-width: 200px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 1; }
.crumb.current { color: var(--text); min-width: 4ch; }
.crumb.ellipsis { max-width: none; min-width: max-content; letter-spacing: 1px; flex-shrink: 0; }
.crumb:hover { color: var(--accent); background: var(--bg); }
.crumb.drop-target { color: var(--accent); box-shadow: inset 0 -2px 0 var(--accent); border-radius: 2px; }
.sep { color: var(--text-muted); flex-shrink: 0; opacity: 0.6; }
.crumb-collapse { position: relative; display: inline-flex; align-items: center; gap: 1px; flex-shrink: 0; }
.crumb-backdrop { position: fixed; inset: 0; z-index: 15; }
.crumb-menu { position: absolute; top: calc(100% + 4px); left: 0; z-index: 16; display: flex; flex-direction: column; min-width: 160px; max-height: 60vh; max-height: 60dvh; overflow-y: auto; padding: 6px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,0.14); }
.crumb-menu button { border: none; background: none; color: var(--text); text-align: left; padding: 8px 10px; border-radius: 7px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.crumb-menu button:hover { background: var(--bg); color: var(--accent); }
.search-wrap { position: relative; display: flex; align-items: center; color: var(--text-muted); }
.search-wrap > svg { position: absolute; z-index: 1; left: 12px; pointer-events: none; }
.search { padding: 8px 10px 8px 38px; border: 1px solid var(--border); border-radius: 8px; width: 200px; }
.toolbar-actions { display: flex; align-items: center; gap: 8px; }
.toolbar-button { display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; }
.topbar button { border: 1px solid var(--border); background: var(--bg-elevated); border-radius: 8px; padding: 8px 12px; }
</style>
