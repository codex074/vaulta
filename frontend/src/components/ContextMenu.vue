<script setup>
import { dialogFocus as vDialogFocus } from './dialogFocus.js'
import { ref, computed } from 'vue'
import { renameItem, moveItem, downloadUrl, transferItem } from '../api/resources.js'
import { softDelete } from '../api/trash.js'
import { useFilesStore } from '../stores/files.js'
import { useTrashStore } from '../stores/trash.js'
import { useAuthStore } from '../stores/auth.js'
import { useQuotaStore } from '../stores/quota.js'
import { canDeleteEntry } from '../permissions.js'
import { showError } from '../errorToast.js'

const props = defineProps({
  entry: { type: Object, required: true },
  path: { type: String, required: true },
  view: { type: String, default: 'browse' },
})
const emit = defineEmits(['close', 'changed', 'share'])
const files = useFilesStore()
const trash = useTrashStore()
const auth = useAuthStore()
const quota = useQuotaStore()
const canDelete = computed(() => canDeleteEntry(props.entry, auth.user))
const renaming = ref(false)
const moving = ref(false)
const newName = ref(props.entry.name)
const destination = ref('')

const isStarred = computed(() => props.entry.pinned ?? files.pinnedNames.has(props.entry.name))
function doStar() { return refreshAfter(() => files.toggleStar(props.entry)) }

const source = computed(() => props.entry.source ?? files.source)
const otherSource = computed(() => (source.value === 'home' ? 'share' : 'home'))
const copyLabel = computed(() => (otherSource.value === 'home' ? 'Copy to My Drive' : 'Copy to Shared'))
// Cross-drive copy only makes sense once the user has a private drive at
// all, and only outside the trash view (trash items are already source-
// bound to where they were deleted from).
const showCopyToOther = computed(() => props.view !== 'trash' && auth.hasHomeDrive)

function basename(path) {
  const idx = path.lastIndexOf('/')
  return idx === -1 ? path : path.slice(idx + 1)
}

async function refreshAfter(action) {
  try {
    await action()
  } catch (err) {
    showError(err.message || 'Action failed.')
    return
  }
  emit('close')
  emit('changed')
  quota.refresh().catch(() => {})
}

function doRename() {
  return refreshAfter(() => renameItem(source.value, props.path, newName.value))
}
function doMove() {
  return refreshAfter(() => moveItem(source.value, props.path, destination.value))
}
function doCopyToOther() {
  return refreshAfter(() => transferItem({
    fromSource: source.value,
    fromPath: props.path,
    toSource: otherSource.value,
    toPath: `/${basename(props.path)}`,
  }, 'copy'))
}
function doDelete() {
  return refreshAfter(() => softDelete(source.value, props.path))
}
function doRestore() {
  return refreshAfter(() => trash.restore(props.entry))
}
function doDeleteForever() {
  return refreshAfter(() => trash.deleteForeverItem(props.entry))
}
function doShare() {
  emit('share', { entry: props.entry, source: source.value, path: props.path })
  emit('close')
}
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <div class="menu" v-dialog-focus="() => emit('close')" role="dialog" aria-modal="true" aria-label="File actions">
      <div class="menu-heading"><strong>{{ entry.displayName ?? entry.name }}</strong><span>{{ source === 'home' ? 'My Drive' : 'Shared' }}</span></div>
      <template v-if="renaming">
        <input aria-label="New name" v-model="newName" autofocus @keyup.enter="doRename" />
        <button @click="doRename">Save</button>
      </template>
      <template v-else-if="moving">
        <input aria-label="Destination path" v-model="destination" placeholder="/NewFolder/name.ext" autofocus @keyup.enter="doMove" />
        <button @click="doMove">Move</button>
      </template>
      <template v-else-if="view === 'trash'">
        <button @click="doRestore">Restore</button>
        <button v-if="canDelete" class="danger" @click="doDeleteForever">Delete forever</button>
        <span v-else class="hint">Only {{ entry.uploadedByUsername }} or an admin can delete this forever</span>
      </template>
      <template v-else>
        <button @click="doStar">{{ isStarred ? 'Remove from Starred' : 'Add to Starred' }}</button>
        <button @click="renaming = true">Rename</button>
        <button @click="moving = true">Move</button>
        <button v-if="showCopyToOther" @click="doCopyToOther">{{ copyLabel }}</button>
        <a :href="downloadUrl(source, path)" target="_blank" rel="noopener noreferrer">Download</a>
        <button class="share-link" @click="doShare">Share link</button>
        <button v-if="canDelete" class="danger" @click="doDelete">Delete</button>
        <span v-else class="hint">Only {{ entry.uploadedByUsername }} or an admin can delete this</span>
      </template>
      <button class="menu-cancel" @click="emit('close')">Done</button>
    </div>
  </div>
</template>

<style scoped>
.backdrop { position: fixed; inset: 0; z-index: 15; }
.menu { position: absolute; top: 80px; right: 40px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.12); display: flex; flex-direction: column; padding: 6px; min-width: 160px; }
.menu button, .menu a { text-align: left; border: none; background: none; padding: 8px 10px; border-radius: 6px; color: var(--text); text-decoration: none; }
.menu button:hover, .menu a:hover { background: var(--bg); }
.menu .danger { color: var(--danger); }
.menu .hint { padding: 8px 10px; font-size: 11px; color: var(--text-muted); max-width: 200px; }
.menu input { margin: 6px; padding: 8px; border: 1px solid var(--border); border-radius: 6px; }
</style>
