<script setup>
import { ref } from 'vue'
import { deleteItem, renameItem, moveItem, downloadUrl } from '../api/resources.js'
import { useFilesStore } from '../stores/files.js'

const props = defineProps({ entry: { type: Object, required: true }, path: { type: String, required: true } })
const emit = defineEmits(['close'])
const files = useFilesStore()
const renaming = ref(false)
const moving = ref(false)
const newName = ref(props.entry.name)
const destination = ref('')
const errorMessage = ref('')

async function doRename() {
  errorMessage.value = ''
  try {
    await renameItem(props.path, newName.value)
    await files.loadDirectory(files.currentPath)
    emit('close')
  } catch (err) {
    errorMessage.value = err.message || 'Rename failed.'
  }
}
async function doMove() {
  errorMessage.value = ''
  try {
    await moveItem(props.path, destination.value)
    await files.loadDirectory(files.currentPath)
    emit('close')
  } catch (err) {
    errorMessage.value = err.message || 'Move failed.'
  }
}
async function doDelete() {
  errorMessage.value = ''
  try {
    await deleteItem(props.path)
    await files.loadDirectory(files.currentPath)
    emit('close')
  } catch (err) {
    errorMessage.value = err.message || 'Delete failed.'
  }
}
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <div class="menu">
      <template v-if="renaming">
        <input v-model="newName" autofocus @keyup.enter="doRename" />
        <button @click="doRename">Save</button>
      </template>
      <template v-else-if="moving">
        <input v-model="destination" placeholder="/NewFolder/name.ext" autofocus @keyup.enter="doMove" />
        <button @click="doMove">Move</button>
      </template>
      <template v-else>
        <button @click="renaming = true">Rename</button>
        <button @click="moving = true">Move</button>
        <a :href="downloadUrl(path)" target="_blank">Download</a>
        <button class="danger" @click="doDelete">Delete</button>
      </template>
      <p v-if="errorMessage" class="error">{{ errorMessage }}</p>
    </div>
  </div>
</template>

<style scoped>
.backdrop { position: fixed; inset: 0; z-index: 15; }
.menu { position: absolute; top: 80px; right: 40px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.12); display: flex; flex-direction: column; padding: 6px; min-width: 160px; }
.menu button, .menu a { text-align: left; border: none; background: none; padding: 8px 10px; border-radius: 6px; color: var(--text); text-decoration: none; }
.menu button:hover, .menu a:hover { background: var(--bg); }
.menu .danger { color: #d92d20; }
.menu input { margin: 6px; padding: 8px; border: 1px solid var(--border); border-radius: 6px; }
.menu .error { color: #d92d20; font-size: 12px; margin: 6px; }
</style>
