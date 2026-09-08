<script setup>
import { onMounted, watch, ref, reactive, computed } from 'vue'
import { useAuthStore } from './stores/auth.js'
import { useFilesStore } from './stores/files.js'
import { useStarredStore } from './stores/starred.js'
import { useTrashStore } from './stores/trash.js'
import { useThemeStore } from './stores/theme.js'
import { uploadFile, makeDirectory } from './api/resources.js'
import { stampOwnership } from './api/ownership.js'
import { onUnauthorized } from './api/http.js'
import { showError } from './errorToast.js'
import { partitionDeletable } from './permissions.js'
import { collectFilesFromDataTransfer, directoriesFor } from './components/folderDrop.js'
import LoginView from './components/LoginView.vue'
import Sidebar from './components/Sidebar.vue'
import TopBar from './components/TopBar.vue'
import FileGrid from './components/FileGrid.vue'
import FileListView from './components/FileListView.vue'
import NewFolderDialog from './components/NewFolderDialog.vue'
import UploadToast from './components/UploadToast.vue'
import ErrorToast from './components/ErrorToast.vue'
import ContextMenu from './components/ContextMenu.vue'
import Lightbox from './components/Lightbox.vue'

const auth = useAuthStore()
const files = useFilesStore()
const starred = useStarredStore()
const trash = useTrashStore()
const theme = useThemeStore()
watch(() => theme.current, (value) => { document.documentElement.dataset.theme = value }, { immediate: true })
const showNewFolder = ref(false)
const activeMenu = ref(null)
const previewing = ref(null)
const uploads = reactive([])
const searchQuery = ref('')
const view = ref('browse')

const activeEntries = computed(() => {
  const source = view.value === 'starred' ? starred.entries : view.value === 'trash' ? trash.entries : files.entries
  if (!searchQuery.value) return source
  return source.filter((e) => e.name.toLowerCase().includes(searchQuery.value.toLowerCase()))
})

let uploadId = 0
const fileInputEl = ref(null)

function triggerFilePicker() {
  fileInputEl.value?.click()
}

function onFileInputChange(event) {
  const items = Array.from(event.target.files).map((file) => ({ file, path: file.name }))
  if (items.length) handleFiles(items)
  event.target.value = ''
}

onMounted(() => auth.checkSession())
watch(() => auth.user, (user) => {
  if (user) {
    files.loadDirectory('/').catch((err) => showError(err.message || 'Could not load files.'))
  }
})

onUnauthorized(() => { auth.user = null })

async function onNavigate(nextView) {
  view.value = nextView
  searchQuery.value = ''
  files.clearSelection()
  try {
    if (nextView === 'starred') await starred.loadStarred()
    else if (nextView === 'trash') await trash.loadTrash()
  } catch (err) {
    showError(err.message || 'Could not load.')
  }
}

async function onEntryChanged() {
  try {
    if (view.value === 'browse') await files.loadDirectory(files.currentPath)
    else if (view.value === 'starred') await starred.loadStarred()
  } catch (err) {
    showError(err.message || 'Could not refresh.')
  }
}

async function handleFiles(items) {
  const base = files.currentPath.endsWith('/') ? files.currentPath : `${files.currentPath}/`
  for (const dir of directoriesFor(items.map((item) => item.path))) {
    const dirPath = `${base}${dir}`
    try {
      await makeDirectory(dirPath)
    } catch {
      // Likely already exists (e.g. a sibling file created the same parent) — the
      // upload below will surface a real problem with this directory on its own.
      continue
    }
    try {
      await stampOwnership(dirPath)
    } catch {
      // Best-effort: ownership is UI metadata, not a security control.
    }
  }
  for (const { file, path } of items) {
    const entry = reactive({ id: uploadId++, name: path, progress: 0, error: false, message: '' })
    uploads.push(entry)
    try {
      await uploadFile(`${base}${path}`, file, (pct) => { entry.progress = pct })
      try {
        await stampOwnership(`${base}${path}`)
      } catch {
        // Best-effort: ownership is UI metadata, not a security control, so a
        // failed stamp shouldn't surface as an upload failure.
      }
    } catch (err) {
      entry.error = true
      entry.message = err.message || 'Failed'
    }
  }
  await files.loadDirectory(files.currentPath)
  setTimeout(() => uploads.splice(0, uploads.length), 2000)
}

async function onDrop(event) {
  event.preventDefault()
  const items = await collectFilesFromDataTransfer(event.dataTransfer)
  if (items.length) handleFiles(items)
}

const bulkError = ref('')
async function onBulkDelete() {
  bulkError.value = ''
  const sourceEntries = view.value === 'starred' ? starred.entries : view.value === 'trash' ? trash.entries : files.entries
  const { allowed, blocked } = partitionDeletable(sourceEntries, files.selected, auth.user, files.currentPath)
  try {
    if (view.value === 'trash') {
      for (const item of allowed) {
        await trash.deleteForeverItem(item)
      }
      files.clearSelection()
    } else {
      await files.deleteSelected(allowed.map((e) => e.path))
      if (view.value === 'starred') await starred.loadStarred()
      else await files.loadDirectory(files.currentPath)
    }
    if (blocked.length) {
      bulkError.value = `Skipped (not your files): ${blocked.map((e) => e.name).join(', ')}`
    }
  } catch (err) {
    bulkError.value = err.message || 'Some items could not be deleted.'
  }
}

async function onEmptyTrash() {
  try {
    await trash.emptyAll()
  } catch (err) {
    showError(err.message || 'Could not empty trash.')
  }
}
</script>

<template>
  <LoginView v-if="auth.checked && !auth.user" />
  <div v-else-if="auth.checked" id="app-shell">
    <input ref="fileInputEl" type="file" multiple style="display: none" @change="onFileInputChange" />
    <Sidebar :view="view" @upload="triggerFilePicker" @navigate="onNavigate" />
    <div class="main">
      <TopBar
        :entries="activeEntries"
        @new-folder="showNewFolder = true"
        @search="searchQuery = $event"
        @upload="triggerFilePicker"
      />
      <div v-if="view === 'trash'" class="trash-bar">
        <button @click="onEmptyTrash">Empty trash</button>
      </div>
      <div
        v-if="(view === 'starred' && starred.loading) || (view === 'trash' && trash.loading)"
        class="loading-bar"
      >
        Loading…
      </div>
      <div v-if="files.selected.size" class="bulk-bar">
        <span>{{ files.selected.size }} selected</span>
        <button @click="onBulkDelete">{{ view === 'trash' ? 'Delete forever' : 'Delete' }}</button>
        <button @click="files.clearSelection()">Clear</button>
        <span v-if="bulkError" class="bulk-error">{{ bulkError }}</span>
      </div>
      <div class="content" @dragover.prevent @drop="onDrop">
        <FileGrid
          v-if="files.viewMode === 'grid'"
          :entries="activeEntries"
          :disable-open="view === 'trash'"
          @menu="activeMenu = $event"
          @open="previewing = $event"
          @changed="onEntryChanged"
        />
        <FileListView
          v-else
          :entries="activeEntries"
          :disable-open="view === 'trash'"
          @menu="activeMenu = $event"
          @open="previewing = $event"
          @changed="onEntryChanged"
        />
      </div>
    </div>
    <NewFolderDialog v-if="showNewFolder" @close="showNewFolder = false" />
    <UploadToast :uploads="uploads" />
    <ErrorToast />
    <ContextMenu
      v-if="activeMenu"
      :entry="activeMenu.entry"
      :path="activeMenu.path"
      :view="view"
      @close="activeMenu = null"
      @changed="onEntryChanged"
    />
    <Lightbox v-if="previewing" :entry="previewing" @close="previewing = null" />
  </div>
</template>

<style scoped>
#app-shell {
  display: flex;
  min-height: 100vh;
  min-height: 100dvh;
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
}
.main { flex: 1; display: flex; flex-direction: column; }
.content { padding: 20px; flex: 1; }
.bulk-bar { display: flex; gap: 12px; align-items: center; padding: 8px 16px; background: var(--selected-bg); border-bottom: 1px solid var(--border); font-size: 13px; }
.bulk-error { color: var(--danger); }
.trash-bar { display: flex; justify-content: flex-end; padding: 8px 16px; border-bottom: 1px solid var(--border); }
.trash-bar button { border: 1px solid var(--border); background: var(--bg-elevated); border-radius: 8px; padding: 6px 12px; }
.loading-bar { padding: 8px 16px; border-bottom: 1px solid var(--border); font-size: 13px; color: var(--text-muted); }

@media (max-width: 640px) {
  #app-shell { flex-direction: column; }
}
</style>
