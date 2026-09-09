<script setup>
import { onMounted, ref } from 'vue'
import { listShares, deleteShare } from '../api/share.js'
import { shareDisplayName, driveLabelFor, formatExpiry, guestUrlFor } from './shareLinks.js'
import { useAuthStore } from '../stores/auth.js'
import { showError } from '../errorToast.js'

const auth = useAuthStore()
const shares = ref([])
const loading = ref(true)
const copied = ref('')

async function load() {
  loading.value = true
  try {
    shares.value = await listShares()
  } catch (err) {
    showError(err.message || 'Could not load links.')
  } finally {
    loading.value = false
  }
}
onMounted(load)

async function revoke(hash) {
  try {
    await deleteShare(hash)
    shares.value = shares.value.filter((s) => s.hash !== hash)
  } catch (err) {
    showError(err.message || 'Could not revoke link.')
  }
}

async function copy(hash) {
  const url = guestUrlFor(hash)
  try {
    await navigator.clipboard.writeText(url)
    copied.value = hash
    setTimeout(() => { if (copied.value === hash) copied.value = '' }, 1500)
  } catch {
    showError('Copy failed.')
  }
}
</script>

<template>
  <section class="links-view" aria-label="Share links">
    <div v-if="loading" class="empty-state" role="status"><span class="loading-spinner"></span><h2>Loading links…</h2></div>
    <div v-else-if="!shares.length" class="empty-state" role="status"><h2>No links yet</h2><p>Use “Share link” on any file or folder to create one.</p></div>
    <div v-else class="table-wrap">
      <table class="links-table">
        <thead>
          <tr>
            <th>Item</th><th>Drive</th><th v-if="auth.isAdmin" class="owner">Owner</th><th>Expires</th><th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="share in shares" :key="share.hash" class="link-row">
            <td class="item">{{ shareDisplayName(share) }} <span v-if="share.hasPassword" class="lock" title="Password protected">🔒</span></td>
            <td>{{ driveLabelFor(share) }}</td>
            <td v-if="auth.isAdmin">{{ share.username }}</td>
            <td>{{ formatExpiry(share.expire) }}</td>
            <td class="actions">
              <button type="button" @click="copy(share.hash)">{{ copied === share.hash ? 'Copied' : 'Copy' }}</button>
              <button type="button" class="revoke danger" @click="revoke(share.hash)">Revoke</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.links-view { padding: 0 16px 16px; }
.table-wrap { overflow-x: auto; }
.links-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.links-table th { text-align: left; font-weight: 600; color: var(--text-muted); font-size: 12px; padding: 8px; border-bottom: 1px solid var(--border); }
.links-table td { padding: 10px 8px; border-bottom: 1px solid var(--border); vertical-align: middle; }
.actions { display: flex; gap: 6px; justify-content: flex-end; }
button { min-height: 36px; padding: 0 12px; border-radius: 10px; border: 1px solid var(--border); background: var(--bg); color: var(--text); }
button.danger { color: #d33; }
.empty-state { text-align: center; padding: 48px 16px; color: var(--text-muted); }
</style>
