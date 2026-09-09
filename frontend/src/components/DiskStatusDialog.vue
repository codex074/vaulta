<script setup>
import { dialogFocus as vDialogFocus } from './dialogFocus.js'
import { ref, onMounted } from 'vue'
import { getDiskStatus } from '../api/system.js'
import { formatSize, formatRelativeTime } from './fileFormat.js'
import { temperatureLevel, healthLevel, formatHours } from './diskStatus.js'

const emit = defineEmits(['close'])

const loading = ref(true)
const notConfigured = ref(false)
const errorMessage = ref('')
const checkedAt = ref(null)
const disks = ref([])

async function load(useRefresh) {
  loading.value = true
  notConfigured.value = false
  errorMessage.value = ''
  try {
    const data = await getDiskStatus({ refresh: useRefresh })
    checkedAt.value = data.checkedAt
    disks.value = data.disks || []
  } catch (err) {
    if (err.status === 503) {
      notConfigured.value = true
    } else {
      errorMessage.value = err.message || 'Could not load disk status.'
    }
  } finally {
    loading.value = false
  }
}

function retry() {
  load(false)
}

function refreshDisks() {
  load(true)
}

onMounted(() => load(false))

function diskStat(disk, key) {
  const value = disk[key]
  return value === null || value === undefined ? '—' : value
}
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <div role="dialog" aria-modal="true" aria-label="Disk status" class="dialog" v-dialog-focus="() => emit('close')">
      <h3>Disk status</h3>

      <p v-if="loading" class="hint">Loading…</p>

      <div v-else-if="notConfigured" class="notice">
        <p>Disk monitoring is not configured.</p>
        <p class="hint">
          Place a <code>proxmox.json</code> file in the nasapi data directory
          (<code>NASAPI_DATA_PATH</code>) to enable this feature.
        </p>
      </div>

      <div v-else-if="errorMessage" class="notice">
        <p class="error">{{ errorMessage }}</p>
        <button type="button" @click="retry">Retry</button>
      </div>

      <template v-else>
        <ul class="disk-list">
          <li v-for="disk in disks" :key="disk.devpath" class="disk-card">
            <div class="disk-header">
              <span class="disk-identity">
                <strong>{{ disk.label || disk.devpath }}</strong>
                <small>{{ [disk.model, disk.serial].filter(Boolean).join(' · ') }} · {{ formatSize(disk.sizeBytes) }}</small>
              </span>
              <span class="health-badge" :class="'health-' + healthLevel(disk.health)">{{ disk.health }}</span>
            </div>
            <div class="disk-stats">
              <span class="temp-chip" :class="'temp-' + temperatureLevel(disk.type, disk.temperatureC)">
                {{ disk.temperatureC ?? '—' }}°C
              </span>
              <span class="stat">{{ formatHours(disk.powerOnHours) }}</span>
              <template v-if="disk.type === 'hdd'">
                <span class="stat">Reallocated: {{ diskStat(disk, 'reallocatedSectors') }}</span>
                <span class="stat">Pending: {{ diskStat(disk, 'pendingSectors') }}</span>
              </template>
              <template v-else>
                <span class="stat">Wear: {{ disk.wearPercent != null ? disk.wearPercent + '%' : '—' }}</span>
                <span class="stat">Media errors: {{ diskStat(disk, 'mediaErrors') }}</span>
              </template>
            </div>
            <p v-if="disk.error" class="disk-error">{{ disk.error }}</p>
          </li>
        </ul>

        <div class="footer">
          <span class="hint">Checked {{ checkedAt ? formatRelativeTime(checkedAt) : '—' }}</span>
          <button type="button" @click="refreshDisks">Refresh</button>
        </div>
      </template>

      <div class="actions">
        <button type="button" @click="emit('close')">Close</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.backdrop { position: fixed; inset: 0; background: rgba(20, 25, 35, 0.4); display: flex; align-items: center; justify-content: center; z-index: 20; }
.dialog { background: var(--bg-elevated); border-radius: var(--radius); padding: 24px; width: 460px; max-width: 100%; max-height: 80vh; max-height: 80dvh; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
.dialog h3 { margin: 0; }
.hint { font-size: 12px; color: var(--text-muted); margin: 0; }
.error { color: var(--danger); font-size: 13px; margin: 0; }
.notice { display: flex; flex-direction: column; gap: 8px; padding: 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; }
.notice button { align-self: flex-start; }
.notice code { background: var(--border); padding: 1px 5px; border-radius: 4px; font-size: 11px; }

.disk-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.disk-card { border: 1px solid var(--border); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 8px; background: var(--bg); }
.disk-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.disk-identity { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.disk-identity strong { font-size: 13px; }
.disk-identity small { color: var(--text-muted); font-size: 11px; }

.health-badge { flex: 0 0 auto; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 999px; letter-spacing: .03em; }
.health-ok { background: var(--success); color: var(--accent-contrast); }
.health-bad { background: var(--danger); color: var(--accent-contrast); }
.health-unknown { background: var(--border); color: var(--text-muted); }

.disk-stats { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 11px; color: var(--text-muted); }
.stat { white-space: nowrap; }

.temp-chip { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; border: 1px solid transparent; }
.temp-ok { color: var(--success); border-color: var(--success); }
.temp-warn { color: var(--warning); border-color: var(--warning); }
.temp-hot { color: var(--danger); border-color: var(--danger); }
.temp-unknown { color: var(--text-muted); border-color: var(--border); }

.disk-error { margin: 0; color: var(--danger); font-size: 11px; }

.footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; border-top: 1px solid var(--border); padding-top: 12px; }
.footer button { border: 1px solid var(--border); background: var(--bg-elevated); border-radius: 8px; padding: 6px 12px; font-size: 12px; cursor: pointer; }

.actions { display: flex; justify-content: flex-end; }
.actions button { border: 1px solid var(--border); background: var(--bg-elevated); border-radius: 8px; padding: 8px 14px; font-size: 13px; cursor: pointer; }
button:disabled { cursor: not-allowed; opacity: 0.6; }

@media (max-width: 560px) {
  .backdrop { align-items: flex-end; padding: 0; }
  .dialog { width: 100%; border-radius: 16px 16px 0 0; max-height: 92vh; max-height: 92dvh; padding: 20px 16px calc(20px + env(safe-area-inset-bottom)); }
  .actions button, .footer button, .notice button { min-height: 40px; }
}
</style>
