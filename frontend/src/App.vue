<script setup>
import { onMounted, watch, ref } from 'vue'
import { useAuthStore } from './stores/auth.js'
import { useFilesStore } from './stores/files.js'
import LoginView from './components/LoginView.vue'
import Sidebar from './components/Sidebar.vue'
import TopBar from './components/TopBar.vue'
import FileGrid from './components/FileGrid.vue'
import FileListView from './components/FileListView.vue'
import NewFolderDialog from './components/NewFolderDialog.vue'

const auth = useAuthStore()
const files = useFilesStore()
const showNewFolder = ref(false)

onMounted(() => auth.checkSession())
watch(() => auth.user, (user) => { if (user) files.loadDirectory('/') })
</script>

<template>
  <LoginView v-if="auth.checked && !auth.user" />
  <div v-else-if="auth.checked" id="app-shell">
    <Sidebar />
    <div class="main">
      <TopBar @new-folder="showNewFolder = true" />
      <div class="content">
        <FileGrid v-if="files.viewMode === 'grid'" :entries="files.entries" />
        <FileListView v-else :entries="files.entries" />
      </div>
    </div>
    <NewFolderDialog v-if="showNewFolder" @close="showNewFolder = false" />
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
