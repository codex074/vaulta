<script setup>
import { onMounted, watch, ref, reactive, computed } from 'vue'
import { useAuthStore } from './stores/auth.js'
import { useFilesStore } from './stores/files.js'
import { useStarredStore } from './stores/starred.js'
import { useTrashStore } from './stores/trash.js'
import { useQuotaStore } from './stores/quota.js'
import { useThemeStore } from './stores/theme.js'
import { uploadFile, makeDirectory, deleteItem } from './api/resources.js'
import { createUploadEntry, cancelUpload, activeUploads } from './components/uploadQueue.js'
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
import UiIcon from './components/UiIcon.vue'
import Lightbox from './components/Lightbox.vue'

const auth = useAuthStore()
const files = useFilesStore()
const starred = useStarredStore()
const trash = useTrashStore()
const quota = useQuotaStore()
const theme = useThemeStore()
watch(() => theme.current, (value) => {
  document.documentElement.dataset.theme = value
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', value === 'dark' ? '#18181b' : '#f5f5f7')
}, { immediate: true })
const showNewFolder = ref(false)
const activeMenu = ref(null)
const previewing = ref(null)
const uploads = reactive([])
const searchQuery = ref('')
const view = ref('browse')
const mainEl = ref(null)
watch(() => [view.value, files.source, files.currentPath], () => mainEl.value?.scrollTo?.({ top: 0 }))
function onFolderOpened() {
  view.value = 'browse'
  searchQuery.value = ''
}
const loading = computed(() => view.value === 'starred' ? starred.loading : view.value === 'trash' ? trash.loading : files.loading)

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
    files.switchDrive(auth.hasHomeDrive ? 'home' : 'share')
      .catch((err) => showError(err.message || 'Could not load files.'))
  }
})

onUnauthorized(() => { auth.user = null })

async function onNavigate(nextView) {
  searchQuery.value = ''
  files.clearSelection()
  try {
    if (nextView === 'home' || nextView === 'share') {
      view.value = 'browse'
      await files.switchDrive(nextView)
    } else {
      view.value = nextView
      if (nextView === 'starred') await starred.loadStarred()
      else if (nextView === 'trash') await trash.loadTrash()
    }
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
  quota.refresh().catch(() => {})
}

async function handleFiles(items) {
  // First layer of defense: skip the whole batch up front when it's
  // obviously over quota, so the user isn't left watching every file in a
  // batch fail one by one. The 413 a rejected upload gets back from
  // nasapi (surfaced via uploadFile's own message parsing) is the real,
  // server-side second layer — this is just a courtesy.
  if (files.source === 'home' && quota.loaded && !quota.unlimited) {
    const totalSize = items.reduce((sum, item) => sum + (item.file?.size || 0), 0)
    const remaining = Math.max(0, quota.limitBytes - quota.usedBytes)
    if (totalSize > remaining) {
      showError('Storage quota exceeded: not enough space left in My Drive for this upload.')
      return
    }
  }

  const base = files.currentPath.endsWith('/') ? files.currentPath : `${files.currentPath}/`
  for (const dir of directoriesFor(items.map((item) => item.path))) {
    const dirPath = `${base}${dir}`
    try {
      await makeDirectory(files.source, dirPath)
    } catch {
      // Likely already exists (e.g. a sibling file created the same parent) — the
      // upload below will surface a real problem with this directory on its own.
      continue
    }
    // Ownership tracking stays share-only (see design spec's Non-Goals).
    if (files.source === 'share') {
      try {
        await stampOwnership(dirPath)
      } catch {
        // Best-effort: ownership is UI metadata, not a security control.
      }
    }
  }
  // Every file gets a tray entry up front so the user can cancel ones that
  // are still queued (e.g. a wrong selection) before they even start.
  const source = files.source
  const queue = items.map(({ file, path }) => {
    const entry = reactive(createUploadEntry(uploadId++, path))
    uploads.push(entry)
    return { entry, file, fullPath: `${base}${path}` }
  })
  for (const { entry, file, fullPath } of queue) {
    if (entry.status === 'cancelled') continue
    entry.status = 'uploading'
    try {
      await uploadFile(source, fullPath, file, (pct) => { entry.progress = pct }, { signal: entry.controller.signal })
      entry.status = 'done'
      if (source === 'share') {
        try {
          await stampOwnership(fullPath)
        } catch {
          // Best-effort: ownership is UI metadata, not a security control, so a
          // failed stamp shouldn't surface as an upload failure.
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        entry.status = 'cancelled'
        entry.message = 'Cancelled'
        // FileBrowser streams uploads straight to disk, so an aborted upload
        // usually leaves a truncated file behind. Remove it best-effort; a
        // 404 just means nothing had been written yet.
        try {
          await deleteItem(source, fullPath)
        } catch {
          // Nothing to clean up, or it will show in the listing for the user to handle.
        }
      } else {
        entry.status = 'error'
        entry.message = err.message || 'Failed'
      }
    }
  }
  await files.loadDirectory(files.currentPath)
  quota.refresh().catch(() => {})
  setTimeout(() => uploads.splice(0, uploads.length), 2000)
}

function onCancelUpload(entry) {
  cancelUpload(entry)
}

function onCancelAllUploads() {
  for (const entry of activeUploads(uploads)) cancelUpload(entry)
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
  const { allowed, blocked } = partitionDeletable(sourceEntries, files.selected, auth.user, files.currentPath, files.source)
  try {
    if (view.value === 'trash') {
      for (const item of allowed) {
        await trash.deleteForeverItem(item)
      }
      files.clearSelection()
    } else {
      await files.deleteSelected(allowed)
      if (view.value === 'starred') await starred.loadStarred()
      else await files.loadDirectory(files.currentPath)
    }
    if (blocked.length) {
      bulkError.value = `Skipped (not your files): ${blocked.map((e) => e.name).join(', ')}`
    }
  } catch (err) {
    bulkError.value = err.message || 'Some items could not be deleted.'
  }
  quota.refresh().catch(() => {})
}

async function onEmptyTrash() {
  try {
    await trash.emptyAll()
  } catch (err) {
    showError(err.message || 'Could not empty trash.')
  }
  quota.refresh().catch(() => {})
}
</script>

<template>
  <LoginView v-if="auth.checked && !auth.user" />
  <div v-else-if="auth.checked" id="app-shell">
    <input ref="fileInputEl" type="file" multiple style="display: none" @change="onFileInputChange" />
    <Sidebar :view="view" @upload="triggerFilePicker" @navigate="onNavigate" />
    <div ref="mainEl" class="main">
      <TopBar
        :entries="activeEntries"
        :view="view"
        :search-query="searchQuery"
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
      <main class="content" :aria-busy="loading" @dragover.prevent @drop="onDrop">
        <div class="content-caption"><span>{{ searchQuery ? 'Search results' : 'All files' }}</span><span>{{ view === 'browse' ? 'Name ↑' : 'Across your drives' }}</span></div>
        <div v-if="loading && !activeEntries.length" class="empty-state" role="status"><span class="loading-spinner"></span><h2>Opening your files…</h2></div>
        <div v-else-if="!activeEntries.length" class="empty-state" role="status">
          <div class="empty-symbol"><UiIcon :name="searchQuery ? 'search' : view === 'starred' ? 'starred' : view === 'trash' ? 'trash' : 'folder'" :size="42" /></div>
          <h2>{{ searchQuery ? 'No matching files' : view === 'starred' ? 'Keep your favorites close' : view === 'trash' ? 'All clear' : 'Make yourself at home' }}</h2>
          <p>{{ searchQuery ? 'Try a different name or a shorter search.' : view === 'starred' ? 'Star a file to find it here whenever you need it.' : view === 'trash' ? 'Deleted files will appear here.' : 'Upload your first file or create a folder to get started.' }}</p>
          <button v-if="view === 'browse' && !searchQuery" class="empty-upload" @click="triggerFilePicker"><UiIcon name="upload" :size="18" />Upload files</button>
        </div>
        <FileGrid
          v-else-if="files.viewMode === 'grid'"
          :entries="activeEntries"
          :disable-open="view === 'trash'"
          @menu="activeMenu = $event"
          @open="previewing = $event"
          @folder-opened="onFolderOpened"
          @changed="onEntryChanged"
        />
        <FileListView
          v-else
          :entries="activeEntries"
          :disable-open="view === 'trash'"
          @menu="activeMenu = $event"
          @open="previewing = $event"
          @folder-opened="onFolderOpened"
          @changed="onEntryChanged"
        />
      </main>
    </div>
    <NewFolderDialog v-if="showNewFolder" @close="showNewFolder = false" />
    <UploadToast :uploads="uploads" @cancel="onCancelUpload" @cancel-all="onCancelAllUploads" />
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
