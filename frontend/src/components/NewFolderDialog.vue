<script setup>
import { dialogFocus as vDialogFocus } from './dialogFocus.js'
import { ref } from 'vue'
import { makeDirectory } from '../api/resources.js'
import { stampOwnership } from '../api/ownership.js'
import { useFilesStore } from '../stores/files.js'
import { showError } from '../errorToast.js'

const emit = defineEmits(['close'])
const files = useFilesStore()
const name = ref('')
const submitting = ref(false)

async function onSubmit() {
  if (!name.value.trim()) return
  submitting.value = true
  const base = files.currentPath.endsWith('/') ? files.currentPath : `${files.currentPath}/`
  const folderPath = `${base}${name.value.trim()}`
  try {
    await makeDirectory(files.source, folderPath)
  } catch (err) {
    showError(err.message || 'Could not create folder.')
    submitting.value = false
    return
  }
  // Ownership tracking stays share-only (see design spec's Non-Goals).
  if (files.source === 'share') {
    try {
      await stampOwnership(folderPath)
    } catch {
      // Best-effort: ownership is UI metadata, not a security control.
    }
  }
  emit('close')
  try {
    await files.loadDirectory(files.currentPath)
  } catch (err) {
    showError(err.message || 'Could not refresh folder.')
  }
  submitting.value = false
}
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <form class="dialog" v-dialog-focus="() => emit('close')" role="dialog" aria-modal="true" aria-label="New folder" @submit.prevent="onSubmit">
      <h3>New folder</h3>
      <p class="hint">You can type a path like <code>Photos/2026</code> to create nested folders at once.</p>
      <input aria-label="Folder name" v-model="name" placeholder="Folder name" autofocus />
      <div class="actions">
        <button type="button" @click="emit('close')">Cancel</button>
        <button type="submit" :disabled="submitting">Create</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.backdrop { position: fixed; inset: 0; background: rgba(20, 25, 35, 0.4); display: flex; align-items: center; justify-content: center; z-index: 10; }
.dialog { background: var(--bg-elevated); border-radius: var(--radius); padding: 24px; width: 320px; display: flex; flex-direction: column; gap: 10px; }
.hint { font-size: 12px; color: var(--text-muted); margin: 0; }
.dialog input { padding: 10px; border: 1px solid var(--border); border-radius: 8px; }
.actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
