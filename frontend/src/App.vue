<script setup>
import { onMounted, watch, ref, reactive, computed } from 'vue'
import { useAuthStore } from './stores/auth.js'
import { useFilesStore } from './stores/files.js'
import { uploadFile } from './api/resources.js'
import { onUnauthorized } from './api/http.js'
import { showError } from './errorToast.js'
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
const showNewFolder = ref(false)
const activeMenu = ref(null)
const previewing = ref(null)
const uploads = reactive([])
const searchQuery = ref('')
const filteredEntries = computed(() =>
  !searchQuery.value
    ? files.entries
    : files.entries.filter((e) => e.name.toLowerCase().includes(searchQuery.value.toLowerCase()))
)
let uploadId = 0
const fileInputEl = ref(null)

function triggerFilePicker() {
  fileInputEl.value?.click()
}

function onFileInputChange(event) {
  if (event.target.files.length) handleFiles(event.target.files)
  event.target.value = ''
}

onMounted(() => auth.checkSession())
watch(() => auth.user, (user) => {
  if (user) {
    files.loadDirectory('/').catch((err) => showError(err.message || 'Could not load files.'))
  }
})

onUnauthorized(() => { auth.user = null })

async function handleFiles(fileList) {
  const base = files.currentPath.endsWith('/') ? files.currentPath : `${files.currentPath}/`
  for (const file of Array.from(fileList)) {
    const entry = reactive({ id: uploadId++, name: file.name, progress: 0, error: false, message: '' })
    uploads.push(entry)
    try {
      await uploadFile(`${base}${file.name}`, file, (pct) => { entry.progress = pct })
    } catch (err) {
      entry.error = true
      entry.message = err.message || 'Failed'
    }
  }
  await files.loadDirectory(files.currentPath)
  setTimeout(() => uploads.splice(0, uploads.length), 2000)
}

function onDrop(event) {
  event.preventDefault()
  if (event.dataTransfer.files.length) handleFiles(event.dataTransfer.files)
}

const bulkError = ref('')
async function onBulkDelete() {
  bulkError.value = ''
  try {
    await files.deleteSelected()
  } catch (err) {
    bulkError.value = err.message || 'Some items could not be deleted.'
  }
}
</script>

<template>
  <LoginView v-if="auth.checked && !auth.user" />
  <div v-else-if="auth.checked" id="app-shell">
    <input ref="fileInputEl" type="file" multiple style="display: none" @change="onFileInputChange" />
    <Sidebar @upload="triggerFilePicker" />
    <div class="main">
      <TopBar @new-folder="showNewFolder = true" @search="searchQuery = $event" @upload="triggerFilePicker" />
      <div v-if="files.selected.size" class="bulk-bar">
        <span>{{ files.selected.size }} selected</span>
        <button @click="onBulkDelete">Delete</button>
        <button @click="files.clearSelection()">Clear</button>
        <span v-if="bulkError" class="bulk-error">{{ bulkError }}</span>
      </div>
      <div class="content" @dragover.prevent @drop="onDrop">
        <FileGrid v-if="files.viewMode === 'grid'" :entries="filteredEntries" @menu="activeMenu = $event" @open="previewing = $event" />
        <FileListView v-else :entries="filteredEntries" @menu="activeMenu = $event" @open="previewing = $event" />
      </div>
    </div>
    <NewFolderDialog v-if="showNewFolder" @close="showNewFolder = false" />
    <UploadToast :uploads="uploads" />
    <ErrorToast />
    <ContextMenu v-if="activeMenu" :entry="activeMenu.entry" :path="activeMenu.path" @close="activeMenu = null" />
    <Lightbox v-if="previewing" :entry="previewing" @close="previewing = null" />
  </div>
</template>

<style scoped>
#app-shell { display: flex; min-height: 100vh; }
.main { flex: 1; display: flex; flex-direction: column; }
.content { padding: 20px; flex: 1; }
.bulk-bar { display: flex; gap: 12px; align-items: center; padding: 8px 16px; background: #eaf1ff; border-bottom: 1px solid var(--border); font-size: 13px; }
.bulk-error { color: #d92d20; }

@media (max-width: 640px) {
  #app-shell { flex-direction: column; }
}
</style>
