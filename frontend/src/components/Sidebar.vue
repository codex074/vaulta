<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useAuthStore } from '../stores/auth.js'
import { getStorageUsage } from '../api/storage.js'
import { formatSize } from './fileFormat.js'

defineProps({ view: { type: String, required: true } })
const emit = defineEmits(['upload', 'navigate'])
const auth = useAuthStore()

const usedBytes = ref(0)
const totalBytes = ref(0)
const storageError = ref(false)
const usagePercent = computed(() => {
  if (!totalBytes.value) return 0
  return Math.min(100, Math.round((usedBytes.value / totalBytes.value) * 100))
})

let intervalId = null
async function refreshStorage() {
  try {
    const usage = await getStorageUsage()
    usedBytes.value = usage.usedBytes
    totalBytes.value = usage.totalBytes
    storageError.value = false
  } catch {
    storageError.value = true
  }
}

onMounted(() => {
  refreshStorage()
  intervalId = setInterval(refreshStorage, 60000)
})
onUnmounted(() => {
  if (intervalId) clearInterval(intervalId)
})
</script>

<template>
  <nav class="sidebar">
    <button class="sidebar-item" :class="{ active: view === 'browse' }" @click="emit('navigate', 'browse')">
      <span class="sidebar-icon">🏠</span>
      <span class="sidebar-label">หน้าแรก</span>
    </button>
    <button class="sidebar-item" :class="{ active: view === 'starred' }" @click="emit('navigate', 'starred')">
      <span class="sidebar-icon">⭐</span>
      <span class="sidebar-label">ที่ติดดาว</span>
    </button>
    <button class="sidebar-item" :class="{ active: view === 'trash' }" @click="emit('navigate', 'trash')">
      <span class="sidebar-icon">🗑️</span>
      <span class="sidebar-label">ถังขยะ</span>
    </button>
    <button class="sidebar-item" @click="emit('upload')">
      <span class="sidebar-icon">⬆️</span>
      <span class="sidebar-label">Upload</span>
    </button>
    <div class="sidebar-spacer"></div>
    <div v-if="!storageError" class="storage">
      <div class="storage-bar"><div class="storage-fill" :style="{ width: usagePercent + '%' }"></div></div>
      <div class="storage-label">{{ formatSize(usedBytes) }} / {{ formatSize(totalBytes) }}</div>
    </div>
    <button class="sidebar-item" @click="auth.signOut()">
      <span class="sidebar-icon">👤</span>
      <span class="sidebar-label">Sign out</span>
    </button>
  </nav>
</template>

<style scoped>
.sidebar {
  width: var(--sidebar-width);
  background: var(--bg-elevated);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 12px 8px;
  gap: 2px;
}
.sidebar-spacer { flex: 1; }
.sidebar-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 12px;
  border: none;
  background: transparent;
  border-radius: 8px;
  font-size: 14px;
  color: var(--text);
  text-align: left;
  cursor: pointer;
  transition: background 0.12s ease;
}
.sidebar-item:hover { background: var(--bg); }
.sidebar-item.active { background: var(--border); font-weight: 600; }
.sidebar-item.active:hover { background: var(--border); }
.sidebar-icon { font-size: 18px; width: 22px; text-align: center; flex-shrink: 0; }
.sidebar-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.storage { padding: 8px 12px 4px; display: flex; flex-direction: column; gap: 4px; }
.storage-bar { width: 100%; height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; }
.storage-fill { height: 100%; background: var(--accent); }
.storage-label { font-size: 11px; color: var(--text-muted); }

@media (max-width: 640px) {
  .sidebar {
    width: 100%; height: 56px; flex-direction: row; align-items: center;
    border-right: none; border-top: 1px solid var(--border);
    order: 2; padding: 6px 8px; gap: 4px; overflow-x: auto;
  }
  .sidebar-label { display: none; }
  .sidebar-item { width: auto; padding: 8px; }
  .storage { display: none; }
}
</style>
