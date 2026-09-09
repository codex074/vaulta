<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import VaultaBrand from './VaultaBrand.vue'
import GuestFileList from './GuestFileList.vue'
import Lightbox from './Lightbox.vue'
import PasswordInput from './PasswordInput.vue'
import { getShareInfo, listPublic, fetchPublicBlobUrl, publicDownloadUrl } from '../api/publicShare.js'
import { buildGuestUrls, mediaPlanFor } from './guestMedia.js'

const props = defineProps({ hash: { type: String, required: true } })

const state = ref('loading') // loading | password | browse | unavailable | error
const info = ref(null)
const password = ref('')
const passwordInput = ref('')
const passwordError = ref('')
const currentPath = ref('/')
const entries = ref([])
const listingError = ref('')
const previewing = ref(null)
const previewUrls = ref(null)
let revokePreview = () => {}

const hasPassword = computed(() => Boolean(info.value?.hasPassword))
// Set when the share's target is a single file rather than a folder.
const sharedFile = ref(null)
const title = computed(() => info.value?.title || sharedFile.value?.name || 'Shared with you')
const crumbs = computed(() => currentPath.value.split('/').filter(Boolean))

function withPaths(listing, base) {
  const prefix = base.endsWith('/') ? base : `${base}/`
  const stamp = (e) => ({ ...e, path: `${prefix}${e.name}` })
  return [...(listing.folders || []).map(stamp), ...(listing.files || []).map(stamp)]
}

async function load(path) {
  listingError.value = ''
  try {
    const listing = await listPublic(props.hash, path, password.value)
    currentPath.value = path
    if (listing.type !== 'directory') {
      // FBQ answers a single-file share with the file resource itself, and
      // the file is addressed as "/" inside the share — never stamp a name
      // onto its path or downloads/thumbnails 404.
      const file = { ...listing, path: '/' }
      sharedFile.value = file
      entries.value = [file]
      state.value = 'browse'
      if (mediaPlanFor(file, { hasPassword: hasPassword.value }).kind !== 'other') await openEntry(file)
      return
    }
    sharedFile.value = null
    entries.value = withPaths(listing, path)
    state.value = 'browse'
  } catch (err) {
    if (err.status === 404) {
      // A 404 while already browsing usually means the subfolder vanished,
      // not the share itself — keep the current listing on screen. But the
      // share could also have been revoked/expired out from under an
      // already-browsing guest, so re-check it before assuming it's just
      // the folder. Only the initial load (still 'loading', or right after
      // the password gate) otherwise treats 404 as the share being gone.
      if (state.value === 'browse') {
        try {
          await getShareInfo(props.hash)
        } catch (infoErr) {
          if (infoErr.status === 404) {
            state.value = 'unavailable'
            return
          }
        }
        listingError.value = 'This folder no longer exists.'
        return
      }
      state.value = 'unavailable'
      return
    }
    throw err
  }
}

async function start() {
  try {
    info.value = await getShareInfo(props.hash)
  } catch (err) {
    if (err.status === 401) {
      info.value = { hasPassword: true }
      state.value = 'password'
      return
    }
    state.value = err.status === 404 ? 'unavailable' : 'error'
    return
  }
  if (info.value.hasPassword) { state.value = 'password'; return }
  try {
    await load('/')
  } catch (err) {
    state.value = 'error'
    listingError.value = err.message || 'Could not open this link.'
  }
}
start()

async function submitPassword() {
  passwordError.value = ''
  password.value = passwordInput.value
  try {
    await load('/')
  } catch (err) {
    if (err.status === 401) {
      password.value = ''
      passwordError.value = 'รหัสไม่ถูกต้อง'
      state.value = 'password'
      return
    }
    passwordError.value = err.message || 'Could not open this link.'
    state.value = 'password'
  }
}

function navigateTo(path) {
  return load(path).catch((err) => {
    if (err.status === 401) {
      // The link's password was revoked/rotated out from under an
      // already-browsing guest — never leave them silently stuck.
      if (hasPassword.value) {
        password.value = ''
        passwordError.value = 'Please enter the password again.'
        state.value = 'password'
      } else {
        listingError.value = 'Access to this link was revoked.'
      }
      return
    }
    listingError.value = err.message || 'Could not load this folder.'
  })
}
function crumbPath(index) { return `/${crumbs.value.slice(0, index + 1).join('/')}` }

async function openEntry(entry) {
  if (entry.type === 'directory') return navigateTo(entry.path)
  const plan = mediaPlanFor(entry, { hasPassword: hasPassword.value })
  if (plan.kind === 'other') return downloadEntry(entry)
  try {
    const built = await buildGuestUrls(entry, { hash: props.hash, password: password.value })
    revokePreview() // opening a new preview without closing the last one must not leak its blob URL
    revokePreview = built.revoke
    previewUrls.value = built.urls
    previewing.value = entry
  } catch (err) {
    listingError.value = err.message || 'Could not open this file.'
  }
}

function closePreview() {
  previewing.value = null
  previewUrls.value = null
  revokePreview()
  revokePreview = () => {}
}
onBeforeUnmount(closePreview)

async function downloadEntry(entry) {
  try {
    const url = hasPassword.value
      ? await fetchPublicBlobUrl(props.hash, entry.path, password.value)
      : null
    const a = document.createElement('a')
    a.href = url ?? publicDownloadUrl(props.hash, entry.path)
    a.download = entry.name
    document.body.appendChild(a)
    a.click()
    a.remove()
    if (url) setTimeout(() => URL.revokeObjectURL(url), 10_000)
  } catch (err) {
    listingError.value = err.message || 'Download failed.'
  }
}
</script>

<template>
  <div class="guest-shell">
    <header class="guest-header">
      <VaultaBrand compact />
      <div class="guest-title"><h1>{{ title }}</h1><p>Shared with you · read only</p></div>
    </header>

    <main class="guest-main">
      <div v-if="state === 'loading'" class="guest-status" role="status">Opening…</div>

      <div v-else-if="state === 'unavailable'" class="guest-status">
        <h2>ลิงก์นี้ใช้ไม่ได้แล้ว</h2>
        <p>The link may have expired or been revoked.</p>
        <a href="/">Back to Vaulta</a>
      </div>

      <div v-else-if="state === 'error'" class="guest-status">
        <h2>Something went wrong</h2>
        <p>{{ listingError || 'Please try again.' }}</p>
        <button type="button" @click="start">Retry</button>
      </div>

      <form v-else-if="state === 'password'" class="password-gate" @submit.prevent="submitPassword">
        <label>This link needs a password
          <PasswordInput class="guest-password" v-model="passwordInput" autocomplete="off" autofocus />
        </label>
        <p v-if="passwordError" class="gate-error" role="alert">{{ passwordError }}</p>
        <button type="submit">Open</button>
      </form>

      <template v-else>
        <nav class="crumbs" aria-label="Breadcrumb">
          <button type="button" class="crumb-root" @click="navigateTo('/')">{{ title }}</button>
          <template v-for="(crumb, index) in crumbs" :key="index">
            <span class="crumb-sep">/</span>
            <button type="button" class="crumb" @click="navigateTo(crumbPath(index))">{{ crumb }}</button>
          </template>
        </nav>
        <p v-if="listingError" class="gate-error" role="alert">{{ listingError }}</p>
        <p v-if="!entries.length" class="guest-status">This folder is empty.</p>
        <GuestFileList v-else :entries="entries" :hash="hash" :has-password="hasPassword" @open="openEntry" @download="downloadEntry" />
      </template>
    </main>

    <Lightbox v-if="previewing" :entry="previewing" :urls="previewUrls" @close="closePreview" />
  </div>
</template>

<style scoped>
.guest-shell { min-height: 100dvh; background: var(--bg); color: var(--text); display: flex; flex-direction: column; }
.guest-header { display: flex; align-items: center; gap: 14px; padding: max(12px, env(safe-area-inset-top)) 16px 12px; border-bottom: 1px solid var(--border); background: var(--bg-elevated); }
.guest-title h1 { margin: 0; font-size: 18px; }
.guest-title p { margin: 0; font-size: 12px; color: var(--text-muted); }
.guest-main { flex: 1; width: min(760px, 100%); margin: 0 auto; padding: 16px; box-sizing: border-box; }
.guest-status { text-align: center; padding: 48px 16px; color: var(--text-muted); }
.guest-status h2 { color: var(--text); margin: 0 0 8px; }
.password-gate { display: flex; flex-direction: column; gap: 10px; max-width: 360px; margin: 48px auto; }
.password-gate label { display: flex; flex-direction: column; gap: 6px; font-size: 14px; }
.password-gate :deep(input) { padding: 10px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg-elevated); color: var(--text); font-size: 16px; }
.password-gate button, .guest-status button { min-height: 44px; border-radius: 10px; border: none; background: var(--accent); color: #fff; font-size: 15px; }
.gate-error { color: #d33; font-size: 13px; margin: 0; }
.crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-bottom: 12px; font-size: 14px; }
.crumbs button { border: none; background: none; color: var(--accent); padding: 4px 2px; font-size: inherit; }
.crumb-sep { color: var(--text-muted); }
</style>
