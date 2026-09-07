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
    <button class="sidebar-icon" :class="{ active: view === 'browse' }" title="หน้าแรก" @click="emit('navigate', 'browse')">🏠</button>
    <button class="sidebar-icon" :class="{ active: view === 'starred' }" title="ที่ติดดาว" @click="emit('navigate', 'starred')">⭐</button>
    <button class="sidebar-icon" :class="{ active: view === 'trash' }" title="ถังขยะ" @click="emit('navigate', 'trash')">🗑️</button>
    <button class="sidebar-icon" title="Upload" @click="emit('upload')">⬆️</button>
    <div class="sidebar-spacer"></div>
    <div v-if="!storageError" class="storage" title="พื้นที่เก็บข้อมูล">
      <div class="storage-bar"><div class="storage-fill" :style="{ width: usagePercent + '%' }"></div></div>
      <div class="storage-label">{{ formatSize(usedBytes) }} / {{ formatSize(totalBytes) }}</div>
    </div>
    <button class="sidebar-icon" title="Sign out" @click="auth.signOut()">👤</button>
  </nav>
</template>

<style scoped>
.sidebar {
  width: var(--sidebar-width);
  background: var(--bg-elevated);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 0;
  gap: 8px;
}
.sidebar-spacer { flex: 1; }
.sidebar-icon {
  width: 40px; height: 40px;
  border: none; background: transparent; border-radius: 8px; font-size: 18px;
}
.sidebar-icon.active { background: var(--border); }
.storage { width: 52px; display: flex; flex-direction: column; align-items: center; gap: 4px; margin-bottom: 4px; }
.storage-bar { width: 100%; height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; }
.storage-fill { height: 100%; background: var(--accent); }
.storage-label { font-size: 8px; color: var(--text-muted); text-align: center; line-height: 1.2; }

@media (max-width: 640px) {
  .sidebar {
    width: 100%; height: 56px; flex-direction: row;
    border-right: none; border-top: 1px solid var(--border);
    order: 2;
  }
  .storage { display: none; }
}
</style>
