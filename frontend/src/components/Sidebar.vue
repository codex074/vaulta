<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useAuthStore } from '../stores/auth.js'
import { getStorageUsage } from '../api/storage.js'
import { formatSize } from './fileFormat.js'
import ChangePasswordDialog from './ChangePasswordDialog.vue'

defineProps({ view: { type: String, required: true } })
const emit = defineEmits(['upload', 'navigate'])
const auth = useAuthStore()
const showAccountMenu = ref(false)
const showChangePassword = ref(false)

function openChangePassword() {
  showAccountMenu.value = false
  showChangePassword.value = true
}

const usedBytes = ref(0)
const totalBytes = ref(0)
const storageError = ref(false)
const usagePercent = computed(() => {
  if (!totalBytes.value) return 0
  return Math.min(100, Math.round((usedBytes.value / totalBytes.value) * 100))
})
const fillColor = computed(() => {
  if (usagePercent.value >= 90) return '#d92d20'
  if (usagePercent.value >= 75) return '#f79009'
  return 'var(--accent)'
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
      <span class="sidebar-label">Home</span>
    </button>
    <button class="sidebar-item" :class="{ active: view === 'starred' }" @click="emit('navigate', 'starred')">
      <span class="sidebar-icon">⭐</span>
      <span class="sidebar-label">Starred</span>
    </button>
    <button class="sidebar-item" :class="{ active: view === 'trash' }" @click="emit('navigate', 'trash')">
      <span class="sidebar-icon">🗑️</span>
      <span class="sidebar-label">Trash</span>
    </button>
    <button class="sidebar-item" @click="emit('upload')">
      <span class="sidebar-icon">⬆️</span>
      <span class="sidebar-label">Upload</span>
    </button>
    <div class="sidebar-spacer"></div>
    <div v-if="!storageError" class="storage">
      <div class="storage-header">
        <span class="storage-icon">☁️</span>
        <span>Storage</span>
      </div>
      <div class="storage-bar"><div class="storage-fill" :style="{ width: usagePercent + '%', background: fillColor }"></div></div>
      <div class="storage-label">{{ formatSize(usedBytes) }} of {{ formatSize(totalBytes) }} used</div>
    </div>
    <div class="account-wrapper">
      <button class="sidebar-item" :class="{ active: showAccountMenu }" @click="showAccountMenu = !showAccountMenu">
        <span class="sidebar-icon">👤</span>
        <span class="sidebar-label">{{ auth.user?.username || 'Account' }}</span>
      </button>
      <div v-if="showAccountMenu" class="account-backdrop" @click="showAccountMenu = false"></div>
      <div v-if="showAccountMenu" class="account-menu">
        <div class="account-menu-header">
          {{ auth.user?.username }}
          <span v-if="auth.user?.permissions?.admin" class="admin-badge">Admin</span>
        </div>
        <button @click="openChangePassword">Change password</button>
        <button class="danger" @click="auth.signOut()">Sign out</button>
      </div>
    </div>
  </nav>
  <ChangePasswordDialog v-if="showChangePassword" @close="showChangePassword = false" />
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
.storage {
  margin: 4px 4px 8px;
  padding: 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.storage-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
}
.storage-icon { font-size: 13px; }
.storage-bar { width: 100%; height: 6px; background: var(--border); border-radius: 3px; overflow: hidden; }
.storage-fill { height: 100%; border-radius: 3px; transition: width 0.3s ease, background 0.3s ease; }
.storage-label { font-size: 11px; color: var(--text-muted); }

.account-wrapper { position: relative; }
.account-backdrop { position: fixed; inset: 0; z-index: 15; }
.account-menu {
  position: absolute;
  bottom: calc(100% + 4px);
  left: 0;
  z-index: 16;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  display: flex;
  flex-direction: column;
  padding: 6px;
  min-width: 180px;
}
.account-menu-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border);
  margin-bottom: 4px;
}
.admin-badge {
  background: var(--accent);
  color: var(--accent-contrast);
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 999px;
}
.account-menu button {
  text-align: left;
  border: none;
  background: none;
  padding: 8px 10px;
  border-radius: 6px;
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
}
.account-menu button:hover { background: var(--bg); }
.account-menu .danger { color: #d92d20; }

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
