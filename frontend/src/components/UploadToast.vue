<script setup>
import { computed } from 'vue'
import { isCancellable, activeUploads } from './uploadQueue.js'

const props = defineProps({ uploads: { type: Array, required: true } })
const emit = defineEmits(['cancel', 'cancel-all'])

const activeCount = computed(() => activeUploads(props.uploads).length)

function statusText(u) {
  if (u.status === 'error' || u.status === 'cancelled') return u.message
  if (u.status === 'done') return 'Done'
  if (u.status === 'pending') return 'Waiting'
  return u.progress + '%'
}
</script>

<template>
  <div v-if="uploads.length" class="tray">
    <div v-if="activeCount > 1" class="tray-head">
      <span>Uploading {{ activeCount }} files</span>
      <button type="button" class="link-button" @click="emit('cancel-all')">Cancel all</button>
    </div>
    <div v-for="u in uploads" :key="u.id" class="row" :class="u.status">
      <span class="name" :title="u.name">{{ u.name }}</span>
      <div class="bar"><div class="fill" :style="{ width: u.progress + '%' }"></div></div>
      <span class="pct">{{ statusText(u) }}</span>
      <button
        v-if="isCancellable(u)"
        type="button"
        class="cancel"
        :title="u.status === 'pending' ? 'Remove from queue' : 'Cancel upload'"
        aria-label="Cancel upload"
        @click="emit('cancel', u)"
      >×</button>
    </div>
  </div>
</template>

<style scoped>
.tray { position: fixed; bottom: 16px; right: 16px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; width: 300px; max-height: 50vh; max-height: 50dvh; overflow-y: auto; box-shadow: 0 8px 24px rgba(0,0,0,0.12); z-index: 20; }
.tray-head { display: flex; align-items: center; justify-content: space-between; font-size: 12px; font-weight: 600; padding-bottom: 6px; margin-bottom: 4px; border-bottom: 1px solid var(--border); }
.link-button { border: none; background: none; color: var(--accent); font-size: 12px; cursor: pointer; padding: 0; }
.row { display: flex; align-items: center; gap: 8px; font-size: 12px; padding: 4px 0; }
.name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar { width: 60px; height: 6px; background: var(--border); border-radius: 3px; overflow: hidden; }
.fill { height: 100%; background: var(--accent); }
.row.cancelled .fill, .row.error .fill { background: var(--text-muted); }
.row.cancelled .name, .row.cancelled .pct { color: var(--text-muted); text-decoration: line-through; }
.row.error .pct { color: var(--danger); }
.pct { min-width: 32px; text-align: right; }
.cancel { border: none; background: none; color: var(--text-muted); font-size: 16px; line-height: 1; cursor: pointer; padding: 0 2px; }
.cancel:hover { color: var(--danger); }
</style>
