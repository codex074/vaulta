<script setup>
import { onMounted, watch, ref, reactive, computed } from 'vue'
import { useAuthStore } from './stores/auth.js'
import { useFilesStore } from './stores/files.js'
import { uploadFile } from './api/resources.js'
import LoginView from './components/LoginView.vue'
import Sidebar from './components/Sidebar.vue'
import TopBar from './components/TopBar.vue'
import FileGrid from './components/FileGrid.vue'
import FileListView from './components/FileListView.vue'
import NewFolderDialog from './components/NewFolderDialog.vue'
import UploadToast from './components/UploadToast.vue'

const auth = useAuthStore()
const files = useFilesStore()
const showNewFolder = ref(false)
const uploads = reactive([])
const searchQuery = ref('')
const filteredEntries = computed(() =>
  !searchQuery.value
    ? files.entries
    : files.entries.filter((e) => e.name.toLowerCase().includes(searchQuery.value.toLowerCase()))
)
let uploadId = 0

onMounted(() => auth.checkSession())
watch(() => auth.user, (user) => { if (user) files.loadDirectory('/') })

async function handleFiles(fileList) {
  const base = files.currentPath.endsWith('/') ? files.currentPath : `${files.currentPath}/`
  for (const file of Array.from(fileList)) {
    const entry = reactive({ id: uploadId++, name: file.name, progress: 0, error: false })
    uploads.push(entry)
    try {
      await uploadFile(`${base}${file.name}`, file, (pct) => { entry.progress = pct })
    } catch {
      entry.error = true
    }
  }
  await files.loadDirectory(files.currentPath)
  setTimeout(() => uploads.splice(0, uploads.length), 2000)
}

function onDrop(event) {
  event.preventDefault()
  if (event.dataTransfer.files.length) handleFiles(event.dataTransfer.files)
}
</script>

<template>
  <LoginView v-if="auth.checked && !auth.user" />
  <div v-else-if="auth.checked" id="app-shell">
    <Sidebar />
    <div class="main">
      <TopBar @new-folder="showNewFolder = true" @search="searchQuery = $event" />
      <div class="content" @dragover.prevent @drop="onDrop">
        <FileGrid v-if="files.viewMode === 'grid'" :entries="filteredEntries" />
        <FileListView v-else :entries="filteredEntries" />
      </div>
    </div>
    <NewFolderDialog v-if="showNewFolder" @close="showNewFolder = false" />
    <UploadToast :uploads="uploads" />
  </div>
</template>

<style scoped>
#app-shell { display: flex; min-height: 100vh; }
.main { flex: 1; display: flex; flex-direction: column; }
.content { padding: 20px; flex: 1; }

@media (max-width: 640px) {
  #app-shell { flex-direction: column; }
}
</style>
