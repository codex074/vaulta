<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useAuthStore } from '../stores/auth.js'
import { useFilesStore } from '../stores/files.js'
import { useQuotaStore } from '../stores/quota.js'
import { getStorageUsage } from '../api/storage.js'
import { formatSize } from './fileFormat.js'
import { quotaPercent, quotaFillColor, quotaLabel } from './quotaMath.js'
import AccountSettingsDialog from './AccountSettingsDialog.vue'
import ManageUsersDialog from './ManageUsersDialog.vue'
import VaultaBrand from './VaultaBrand.vue'
import UiIcon from './UiIcon.vue'

defineProps({ view: { type: String, required: true } })
const emit = defineEmits(['upload', 'navigate'])
const auth = useAuthStore()
const files = useFilesStore()
const quota = useQuotaStore()
const showAccountMenu = ref(false)
const showAccountSettings = ref(false)
const showManageUsers = ref(false)
const accountInitial = computed(() => (auth.user?.displayName || auth.user?.username || 'A').trim().charAt(0).toUpperCase())

function openAccountSettings() {
  showAccountMenu.value = false
  showAccountSettings.value = true
}

function openManageUsers() {
  showAccountMenu.value = false
  showManageUsers.value = true
}

// Non-admins with a private drive see their own quota usage here; everyone
// else (admins, and anyone without a drive yet) sees the whole-disk stats
// this card has always shown.
const showQuota = computed(() => !auth.isAdmin && auth.hasHomeDrive)

const usedBytes = ref(0)
const totalBytes = ref(0)
const storageError = ref(false)
const usagePercent = computed(() => {
  if (!totalBytes.value) return 0
  return Math.min(100, Math.round((usedBytes.value / totalBytes.value) * 100))
})
const fillColor = computed(() => {
  if (usagePercent.value >= 90) return 'var(--danger)'
  if (usagePercent.value >= 75) return 'var(--warning)'
  return 'var(--accent)'
})

const quotaPct = computed(() => quotaPercent(quota.usedBytes, quota.limitBytes))
const quotaColor = computed(() => quotaFillColor(quotaPct.value))
const quotaText = computed(() => quotaLabel(quota))

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
async function refreshAll() {
  await Promise.all([refreshStorage(), quota.refresh().catch(() => {})])
}

onMounted(() => {
  refreshAll()
  intervalId = setInterval(refreshAll, 60000)
})
onUnmounted(() => {
  if (intervalId) clearInterval(intervalId)
})
</script>

<template>
  <nav class="sidebar" aria-label="Primary navigation">
    <VaultaBrand class="sidebar-brand" />
    <p class="nav-label">Workspace</p>
    <button
      class="sidebar-item"
      :class="{ active: view === 'browse' && files.source === 'home' }"
      :disabled="!auth.hasHomeDrive"
      :title="auth.hasHomeDrive ? '' : 'Ask an admin to assign you a private drive'"
      @click="emit('navigate', 'home')"
    >
      <span class="sidebar-icon"><UiIcon name="home" /></span>
      <span class="sidebar-label">My Drive</span>
    </button>
    <button class="sidebar-item" :class="{ active: view === 'browse' && files.source === 'share' }" @click="emit('navigate', 'share')">
      <span class="sidebar-icon"><UiIcon name="storage" /></span>
      <span class="sidebar-label">Shared</span>
    </button>
    <button class="sidebar-item" :class="{ active: view === 'starred' }" @click="emit('navigate', 'starred')">
      <span class="sidebar-icon"><UiIcon name="starred" /></span>
      <span class="sidebar-label">Starred</span>
    </button>
    <button class="sidebar-item" :class="{ active: view === 'trash' }" @click="emit('navigate', 'trash')">
      <span class="sidebar-icon"><UiIcon name="trash" /></span>
      <span class="sidebar-label">Trash</span>
    </button>
    <button class="sidebar-item upload-item" @click="emit('upload')">
      <span class="sidebar-icon"><UiIcon name="upload" /></span>
      <span class="sidebar-label">Bring files in</span>
      <UiIcon class="upload-arrow" name="chevron" :size="15" />
    </button>
    <div class="sidebar-spacer"></div>
    <div v-if="showQuota" class="storage">
      <div class="storage-header">
        <span class="storage-icon"><UiIcon name="storage" :size="16" /></span>
        <span>My Drive</span>
      </div>
      <div v-if="quota.limitBytes" class="storage-bar"><div class="storage-fill" :style="{ width: quotaPct + '%', background: quotaColor }"></div></div>
      <div class="storage-label">{{ quotaText }}</div>
    </div>
    <div v-else-if="!storageError" class="storage">
      <div class="storage-header">
        <span class="storage-icon"><UiIcon name="storage" :size="16" /></span>
        <span>Storage</span>
      </div>
      <div class="storage-bar"><div class="storage-fill" :style="{ width: usagePercent + '%', background: fillColor }"></div></div>
      <div class="storage-label">{{ formatSize(usedBytes) }} of {{ formatSize(totalBytes) }} used</div>
    </div>
    <div class="account-wrapper">
      <button class="sidebar-item" :class="{ active: showAccountMenu }" @click="showAccountMenu = !showAccountMenu">
        <span class="account-avatar">{{ accountInitial }}</span>
        <span class="sidebar-label">{{ auth.user?.displayName || auth.user?.username || 'Account' }}</span>
        <UiIcon class="account-arrow" name="chevron" :size="14" />
      </button>
      <div v-if="showAccountMenu" class="account-backdrop" @click="showAccountMenu = false"></div>
      <div v-if="showAccountMenu" class="account-menu">
        <div class="account-menu-header">
          <div class="account-identity">
            <strong>{{ auth.user?.displayName || auth.user?.username }}</strong>
            <span>UID {{ auth.user?.uid }} · @{{ auth.user?.username }}</span>
          </div>
          <span v-if="auth.user?.permissions?.admin" class="admin-badge">Admin</span>
        </div>
        <div v-if="showQuota" class="storage account-storage">
          <div class="storage-header">
            <span class="storage-icon"><UiIcon name="storage" :size="16" /></span>
            <span>My Drive</span>
          </div>
          <div v-if="quota.limitBytes" class="storage-bar"><div class="storage-fill" :style="{ width: quotaPct + '%', background: quotaColor }"></div></div>
          <div class="storage-label">{{ quotaText }}</div>
        </div>
        <div v-else-if="!storageError" class="storage account-storage">
          <div class="storage-header">
            <span class="storage-icon"><UiIcon name="storage" :size="16" /></span>
            <span>Storage</span>
          </div>
          <div class="storage-bar"><div class="storage-fill" :style="{ width: usagePercent + '%', background: fillColor }"></div></div>
          <div class="storage-label">{{ formatSize(usedBytes) }} of {{ formatSize(totalBytes) }} used</div>
        </div>
        <button @click="openAccountSettings">Account settings</button>
        <button v-if="auth.user?.permissions?.admin" @click="openManageUsers">Manage users</button>
        <button class="danger" @click="auth.signOut()">Sign out</button>
      </div>
    </div>
  </nav>
  <AccountSettingsDialog v-if="showAccountSettings" @close="showAccountSettings = false" />
  <ManageUsersDialog v-if="showManageUsers" @close="showManageUsers = false" />
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
.sidebar-brand { margin: 2px 10px 22px; }
.nav-label { margin: 0 12px 5px; color: var(--text-muted); letter-spacing: .14em; text-transform: uppercase; font-size: 9px; font-weight: 700; }
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
.sidebar-item:disabled { color: var(--text-muted); cursor: not-allowed; opacity: .55; }
.sidebar-item:disabled:hover { background: transparent; }
.sidebar-icon { display: grid; width: 24px; place-items: center; flex-shrink: 0; }
.sidebar-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.upload-arrow, .account-arrow { margin-left: auto; opacity: .45; }
.account-avatar { display: grid; width: 26px; height: 26px; flex: 0 0 auto; place-items: center; border: 1px solid var(--border); border-radius: 9px; color: var(--accent); font-size: 11px; font-weight: 750; }
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
.account-identity { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
.account-identity strong { color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.account-identity span { font-size: 10px; font-weight: 400; white-space: nowrap; }
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
.account-menu .danger { color: var(--danger); }

@media (max-width: 640px) {
  .sidebar {
    width: 100%; height: 56px; flex-direction: row; align-items: center;
    border-right: none; border-top: 1px solid var(--border);
    order: 2; padding: 6px 8px; gap: 4px; overflow-x: auto;
  }
  .sidebar-brand, .nav-label, .sidebar-label, .upload-arrow, .account-arrow { display: none; }
  .sidebar-item { width: auto; padding: 8px; }
  .storage { display: none; }
}
</style>
