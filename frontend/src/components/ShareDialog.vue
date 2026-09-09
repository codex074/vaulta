<script setup>
import { computed, onMounted, ref } from 'vue'
import { dialogFocus as vDialogFocus } from './dialogFocus.js'
import { createShare, sharesFor, deleteShare } from '../api/share.js'
import { EXPIRY_OPTIONS, formatExpiry, guestUrlFor } from './shareLinks.js'
import { showError } from '../errorToast.js'

const props = defineProps({
  entry: { type: Object, required: true },
  source: { type: String, required: true },
  path: { type: String, required: true },
})
const emit = defineEmits(['close'])

const expiry = ref('7d')
const password = ref('')
const creating = ref(false)
const created = ref(null)
const existing = ref([])
const copied = ref('')

const createdUrl = computed(() => (created.value ? guestUrlFor(created.value.hash) : ''))
const driveLabel = computed(() => (props.source === 'home' ? 'My Drive' : 'Shared'))

async function loadExisting() {
  try {
    existing.value = await sharesFor(props.source, props.path)
  } catch (err) {
    showError(err.message || 'Could not load links.')
  }
}
onMounted(loadExisting)

async function doCreate() {
  creating.value = true
  try {
    created.value = await createShare(props.source, props.path, { expiry: expiry.value, password: password.value })
    password.value = ''
    await loadExisting()
  } catch (err) {
    showError(err.status === 403 ? "This item can't be shared." : err.message || 'Could not create link.')
  } finally {
    creating.value = false
  }
}

async function doRevoke(hash) {
  try {
    await deleteShare(hash)
    if (created.value?.hash === hash) created.value = null
    await loadExisting()
  } catch (err) {
    showError(err.message || 'Could not revoke link.')
  }
}

async function copy(url) {
  try {
    await navigator.clipboard.writeText(url)
    copied.value = url
    setTimeout(() => { if (copied.value === url) copied.value = '' }, 1500)
  } catch {
    showError('Copy failed. Select the link and copy it manually.')
  }
}
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <div class="menu share-dialog" v-dialog-focus="() => emit('close')" role="dialog" aria-modal="true" aria-label="Share link">
      <div class="menu-heading"><strong>{{ entry.displayName ?? entry.name }}</strong><span>{{ driveLabel }}</span></div>

      <label class="field">
        <span>Link expires</span>
        <select class="expiry" v-model="expiry">
          <option v-for="option in EXPIRY_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
      </label>
      <label class="field">
        <span>Password (optional)</span>
        <input class="password" v-model="password" type="password" autocomplete="new-password" placeholder="Leave empty for no password" />
      </label>
      <button class="create" :disabled="creating" @click="doCreate">{{ creating ? 'Creating…' : 'Create link' }}</button>

      <div v-if="created" class="created">
        <input class="guest-url" :value="createdUrl" readonly @focus="$event.target.select()" />
        <button type="button" @click="copy(createdUrl)">{{ copied === createdUrl ? 'Copied' : 'Copy' }}</button>
      </div>

      <p class="section-label">Existing links</p>
      <p v-if="!existing.length" class="hint">No links for this item yet.</p>
      <ul v-else class="share-list">
        <li v-for="share in existing" :key="share.hash" class="share-row">
          <span class="share-expiry">{{ formatExpiry(share.expire) }}</span>
          <span v-if="share.hasPassword" class="lock" title="Password protected">🔒</span>
          <button type="button" @click="copy(guestUrlFor(share.hash))">{{ copied === guestUrlFor(share.hash) ? 'Copied' : 'Copy' }}</button>
          <button type="button" class="danger revoke" @click="doRevoke(share.hash)">Revoke</button>
        </li>
      </ul>

      <button class="menu-cancel" @click="emit('close')">Done</button>
    </div>
  </div>
</template>

<style scoped>
.backdrop { position: fixed; inset: 0; background: rgba(15, 18, 25, 0.45); display: flex; align-items: flex-end; justify-content: center; z-index: 40; }
.menu { width: min(480px, 100%); background: var(--bg-elevated); border-radius: 16px 16px 0 0; padding: 16px; display: flex; flex-direction: column; gap: 10px; max-height: 85dvh; overflow: auto; }
@media (min-width: 641px) { .backdrop { align-items: center; } .menu { border-radius: 16px; } }
.menu-heading { display: flex; flex-direction: column; gap: 2px; margin-bottom: 4px; }
.menu-heading span { font-size: 12px; color: var(--text-muted); }
.field { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--text-muted); }
.field select, .field input, .guest-url { padding: 10px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg); color: var(--text); font-size: 15px; }
.created { display: flex; gap: 8px; }
.created .guest-url { flex: 1; min-width: 0; }
.section-label { margin: 8px 0 0; font-size: 12px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .04em; }
.share-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.share-row { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 10px; }
.share-expiry { flex: 1; font-size: 13px; }
.hint { font-size: 13px; color: var(--text-muted); margin: 0; }
button { min-height: 40px; padding: 0 14px; border-radius: 10px; border: 1px solid var(--border); background: var(--bg); color: var(--text); font-size: 14px; }
button.create { background: var(--accent); color: #fff; border-color: transparent; }
button.danger { color: #d33; }
.menu-cancel { margin-top: 4px; }
</style>
