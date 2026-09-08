<script setup>
import { dialogFocus as vDialogFocus } from './dialogFocus.js'
import { ref, onMounted } from 'vue'
import { useAuthStore } from '../stores/auth.js'
import { listUsers, createUser, deleteUser, isValidUsername, updateUserScopes } from '../api/users.js'
import { listProfiles, updateUserDisplayName, deleteUserProfile } from '../api/profiles.js'
import { listQuotas, setUserQuota, deleteUserQuota, gbToBytes, bytesToGb } from '../api/quota.js'
import { makeDirectory } from '../api/resources.js'
import { formatSize } from './fileFormat.js'
import { driveStatus } from './quotaMath.js'

const emit = defineEmits(['close'])
const auth = useAuthStore()

const users = ref([])
const loading = ref(true)
const errorMessage = ref('')
const actorPassword = ref('')

const newUsername = ref('')
const newDisplayName = ref('')
const newPassword = ref('')
const newIsAdmin = ref(false)
const newQuotaGb = ref('')
const creating = ref(false)

const deletingId = ref(null)
const editingUid = ref(null)
const editQuotaGb = ref('')
const savingQuotaUid = ref(null)
const assigningUid = ref(null)
const bootstrapping = ref(false)

function hasHomeScope(user) {
  return Boolean(user.scopes?.some((s) => s.name === 'home'))
}

// A non-admin whose home scope isn't their own folder (e.g. `/` after an
// FBQ restart with the source still defaultEnabled) needs the same
// mkdir + scope PUT as a user with no drive at all; the button just reads
// "Fix drive" instead of "Assign drive".
function needsDriveFix(user) {
  return !driveStatus(user).ok && user.id !== auth.user?.id
}

function quotaRowText(user) {
  const status = driveStatus(user)
  if (status.hasScope && !status.ok) return `Drive scope is ${status.scope} — should be ${status.expected}`
  const q = user.quota
  if (!q || !q.hasDrive) return 'No drive'
  if (q.unlimited) return `${formatSize(q.usedBytes)} used · Unlimited`
  if (!q.limitBytes) return `${formatSize(q.usedBytes)} used · No quota set`
  return `${formatSize(q.usedBytes)} of ${bytesToGb(q.limitBytes)} GB`
}

async function refresh() {
  loading.value = true
  try {
    const backendUsers = await listUsers()
    let profiles = {}
    try {
      profiles = await listProfiles()
    } catch {
      // User management remains available if the optional profile service is unavailable.
    }
    let quotaMap = {}
    try {
      quotaMap = await listQuotas()
    } catch {
      // Non-admins can't reach this dialog at all, but a quota-store hiccup
      // shouldn't block the rest of user management.
    }
    users.value = backendUsers.map((user) => {
      const uid = String(user.id)
      return {
        ...user,
        uid,
        displayName: profiles[uid]?.displayName || user.username,
        quota: quotaMap[uid] || {
          hasDrive: hasHomeScope(user),
          unlimited: Boolean(user.permissions?.admin),
          limitBytes: 0,
          usedBytes: 0,
        },
      }
    })
  } catch (err) {
    errorMessage.value = err.message || 'Could not load users.'
  } finally {
    loading.value = false
  }
}

onMounted(refresh)

async function onCreate() {
  errorMessage.value = ''
  const loginUsername = newUsername.value.trim()
  if (!isValidUsername(loginUsername)) {
    errorMessage.value = 'Username may only use letters, numbers, dot, underscore or hyphen (max 32 characters).'
    return
  }
  if (!newPassword.value) {
    errorMessage.value = 'Password is required.'
    return
  }
  const quotaGb = Number(newQuotaGb.value)
  if (!newIsAdmin.value && (!newQuotaGb.value || !(quotaGb > 0))) {
    errorMessage.value = 'A storage quota (GB) is required for non-admin users.'
    return
  }
  if (!actorPassword.value) {
    errorMessage.value = 'Enter your own password to confirm this action.'
    return
  }
  creating.value = true
  try {
    const displayName = newDisplayName.value.trim()
    await createUser(actorPassword.value, {
      username: loginUsername,
      password: newPassword.value,
      admin: newIsAdmin.value,
    })
    await refresh()
    const created = users.value.find((user) => user.username === loginUsername)
    if (created && displayName && displayName !== loginUsername) {
      await updateUserDisplayName(created.uid, displayName)
    }
    if (created && !newIsAdmin.value) {
      try {
        await setUserQuota(created.uid, gbToBytes(quotaGb))
      } catch (err) {
        errorMessage.value = `User created, but its quota could not be set: ${err.message}`
      }
    }
    newUsername.value = ''
    newDisplayName.value = ''
    newPassword.value = ''
    newIsAdmin.value = false
    newQuotaGb.value = ''
    await refresh()
  } catch (err) {
    errorMessage.value = err.message || 'Could not create user.'
  } finally {
    creating.value = false
  }
}

async function onDelete(user) {
  errorMessage.value = ''
  if (!actorPassword.value) {
    errorMessage.value = 'Enter your own password to confirm this action.'
    return
  }
  deletingId.value = user.id
  try {
    await deleteUser(user.id, actorPassword.value)
    await deleteUserProfile(user.uid).catch(() => {})
    await deleteUserQuota(user.uid).catch(() => {})
    await refresh()
  } catch (err) {
    errorMessage.value = err.message || 'Could not delete user.'
  } finally {
    deletingId.value = null
  }
}

function startEditQuota(user) {
  errorMessage.value = ''
  editingUid.value = user.uid
  editQuotaGb.value = user.quota?.limitBytes ? String(bytesToGb(user.quota.limitBytes)) : ''
}
function cancelEditQuota() {
  editingUid.value = null
  editQuotaGb.value = ''
}
async function saveQuota(user) {
  errorMessage.value = ''
  const gb = Number(editQuotaGb.value)
  if (!(gb >= 0)) {
    errorMessage.value = 'Quota must be a number of GB, 0 or more.'
    return
  }
  savingQuotaUid.value = user.uid
  try {
    await setUserQuota(user.uid, gbToBytes(gb))
    editingUid.value = null
    await refresh()
  } catch (err) {
    errorMessage.value = err.message || 'Could not update quota.'
  } finally {
    savingQuotaUid.value = null
  }
}

// Grants a legacy user (created before this feature) a home scope: the
// folder must exist before FBQ's scope-update path will accept it (see
// design spec's Verified Facts — PUT /api/users with which:['scopes']
// does not create folders, unlike creation time), so mkdir first,
// tolerating a 409 if a previous attempt already made it.
async function assignDrive(user) {
  errorMessage.value = ''
  if (!actorPassword.value) {
    errorMessage.value = 'Enter your own password to confirm this action.'
    return
  }
  assigningUid.value = user.uid
  try {
    try {
      await makeDirectory('home', `/${user.username}`)
    } catch (err) {
      if (err.status !== 409) throw err
    }
    const freshUsers = await listUsers()
    const fresh = freshUsers.find((u) => u.id === user.id)
    if (!fresh) throw new Error('User no longer exists.')
    const scopes = [
      ...(fresh.scopes || []).filter((s) => s.name !== 'home'),
      { name: 'home', scope: `/${user.username}` },
    ]
    await updateUserScopes(fresh, actorPassword.value, scopes)
    await refresh()
  } catch (err) {
    errorMessage.value = err.message || 'Could not assign a drive.'
  } finally {
    assigningUid.value = null
  }
}

async function enableMyDriveAccess() {
  errorMessage.value = ''
  if (!actorPassword.value) {
    errorMessage.value = 'Enter your own password to confirm this action.'
    return
  }
  bootstrapping.value = true
  try {
    const freshUsers = await listUsers()
    const fresh = freshUsers.find((u) => u.id === auth.user.id)
    if (!fresh) throw new Error('Could not find your own user record.')
    const scopes = [
      ...(fresh.scopes || []).filter((s) => s.name !== 'home'),
      { name: 'home', scope: '/' },
    ]
    await updateUserScopes(fresh, actorPassword.value, scopes)
    await auth.checkSession()
    await refresh()
  } catch (err) {
    errorMessage.value = err.message || 'Could not enable your drive access.'
  } finally {
    bootstrapping.value = false
  }
}
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <div role="dialog" aria-modal="true" aria-label="Manage users" class="dialog" v-dialog-focus="() => emit('close')">
      <h3>Manage users</h3>

      <label class="field">
        Your password
        <input v-model="actorPassword" type="password" placeholder="Required to create, edit or delete users" autocomplete="current-password" />
      </label>

      <p v-if="errorMessage" class="error">{{ errorMessage }}</p>

      <div v-if="!auth.hasHomeDrive" class="bootstrap-banner">
        <p>You don't have a private drive yet. Enable it so you can also assign one to other users.</p>
        <button type="button" :disabled="bootstrapping" @click="enableMyDriveAccess">
          {{ bootstrapping ? 'Enabling…' : 'Enable my drive access' }}
        </button>
      </div>

      <div class="section">
        <h4>Users</h4>
        <p v-if="loading" class="hint">Loading…</p>
        <ul v-else class="user-list">
          <li v-for="user in users" :key="user.id">
            <span class="user-identity">
              <strong>{{ user.displayName }}</strong>
              <small>UID {{ user.uid }} · @{{ user.username }}</small>
            </span>
            <span v-if="user.permissions?.admin" class="admin-badge">Admin</span>
            <span v-if="user.id === auth.user?.id" class="you-badge">You</span>

            <span v-if="editingUid === user.uid" class="quota-edit">
              <input v-model="editQuotaGb" type="number" min="0" step="0.5" class="quota-input" />
              <button type="button" :disabled="savingQuotaUid === user.uid" @click="saveQuota(user)">Save</button>
              <button type="button" @click="cancelEditQuota">Cancel</button>
            </span>
            <template v-else>
              <small class="quota-text">{{ quotaRowText(user) }}</small>
              <button v-if="!user.permissions?.admin" type="button" class="link-button" @click="startEditQuota(user)">Edit</button>
            </template>

            <button
              v-if="needsDriveFix(user)"
              type="button"
              :disabled="!auth.hasHomeDrive || assigningUid === user.uid"
              @click="assignDrive(user)"
            >
              {{ assigningUid === user.uid ? 'Assigning…' : (hasHomeScope(user) ? 'Fix drive' : 'Assign drive') }}
            </button>

            <button
              v-if="user.id !== auth.user?.id"
              class="danger"
              :disabled="deletingId === user.id"
              @click="onDelete(user)"
            >
              {{ deletingId === user.id ? 'Deleting…' : 'Delete' }}
            </button>
          </li>
        </ul>
      </div>

      <div class="section">
        <h4>Add user</h4>
        <label class="field">
          Login username
          <input v-model="newUsername" placeholder="Immutable sign-in name" autocomplete="off" />
        </label>
        <label class="field">
          Display name
          <input v-model="newDisplayName" placeholder="Defaults to login username" autocomplete="off" maxlength="64" />
        </label>
        <label class="field">
          Password
          <input v-model="newPassword" type="password" placeholder="Initial password" autocomplete="new-password" />
        </label>
        <label class="checkbox">
          <input v-model="newIsAdmin" type="checkbox" />
          Admin
        </label>
        <label v-if="!newIsAdmin" class="field">
          Quota (GB)
          <input v-model="newQuotaGb" type="number" min="0" step="0.5" placeholder="Required for this user's private drive" />
        </label>
        <button type="button" :disabled="creating" @click="onCreate">
          {{ creating ? 'Adding…' : 'Add user' }}
        </button>
      </div>

      <div class="actions">
        <button type="button" @click="emit('close')">Close</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.backdrop { position: fixed; inset: 0; background: rgba(20, 25, 35, 0.4); display: flex; align-items: center; justify-content: center; z-index: 20; }
.dialog { background: var(--bg-elevated); border-radius: var(--radius); padding: 24px; width: 420px; max-width: 100%; max-height: 80vh; max-height: 80dvh; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
.dialog h3 { margin: 0; }
.dialog h4 { margin: 0 0 6px; font-size: 12px; color: var(--text-muted); font-weight: 600; }
.field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-muted); }
.dialog input[type="text"], .dialog input[type="password"], .dialog input[type="number"], .dialog input:not([type]) { padding: 10px; border: 1px solid var(--border); border-radius: 8px; width: 100%; margin-bottom: 8px; }
.error { color: var(--danger); font-size: 13px; margin: 0; }
.hint { font-size: 12px; color: var(--text-muted); margin: 0; }
.bootstrap-banner { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; font-size: 12px; color: var(--text-muted); }
.bootstrap-banner button { align-self: flex-start; }
.section { border-top: 1px solid var(--border); padding-top: 12px; }
.user-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.user-list li { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 6px 0; }
.user-identity { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
.user-identity strong { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.user-identity small { color: var(--text-muted); font-size: 10px; white-space: nowrap; }
.admin-badge { background: var(--accent); color: var(--accent-contrast); font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 999px; }
.you-badge { background: var(--border); color: var(--text-muted); font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 999px; }
.quota-text { color: var(--text-muted); font-size: 11px; white-space: nowrap; }
.quota-edit { display: flex; align-items: center; gap: 4px; }
.quota-input { width: 60px; padding: 4px 6px; border: 1px solid var(--border); border-radius: 6px; margin: 0; }
.link-button { border: none; background: none; color: var(--accent); font-size: 11px; cursor: pointer; padding: 2px 4px; }
.user-list button.danger { border: none; background: none; color: var(--danger); font-size: 12px; cursor: pointer; padding: 4px 6px; }
.checkbox { display: flex; align-items: center; gap: 6px; font-size: 13px; margin-bottom: 8px; }
.checkbox input { width: auto; margin: 0; }
.actions { display: flex; justify-content: flex-end; }
.actions button, .section > button, .user-list li > button:not(.danger):not(.link-button) {
  border: 1px solid var(--border); background: var(--bg-elevated); border-radius: 8px; padding: 6px 10px; font-size: 11px; cursor: pointer;
}
.actions button, .section > button { padding: 8px 14px; font-size: 13px; }
button:disabled { cursor: not-allowed; opacity: 0.6; }

@media (max-width: 560px) {
  .backdrop { align-items: flex-end; padding: 0; }
  .dialog {
    width: 100%;
    border-radius: 16px 16px 0 0;
    max-height: 92vh;
    max-height: 92dvh;
    padding: 20px 16px calc(20px + env(safe-area-inset-bottom));
  }
  .user-list button.danger, .actions button, .section > button,
  .user-list li > button:not(.link-button) { min-height: 40px; }
}
</style>
