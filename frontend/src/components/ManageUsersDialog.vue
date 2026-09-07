<script setup>
import { ref, onMounted } from 'vue'
import { useAuthStore } from '../stores/auth.js'
import { listUsers, createUser, deleteUser } from '../api/users.js'
import { listProfiles, updateUserDisplayName, deleteUserProfile } from '../api/profiles.js'

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
const creating = ref(false)

const deletingId = ref(null)

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
    users.value = backendUsers.map((user) => {
      const uid = String(user.id)
      return {
        ...user,
        uid,
        displayName: profiles[uid]?.displayName || user.username,
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
  if (!newUsername.value.trim() || !newPassword.value) {
    errorMessage.value = 'Username and password are required.'
    return
  }
  if (!actorPassword.value) {
    errorMessage.value = 'Enter your own password to confirm this action.'
    return
  }
  creating.value = true
  try {
    const loginUsername = newUsername.value.trim()
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
      await refresh()
    }
    newUsername.value = ''
    newDisplayName.value = ''
    newPassword.value = ''
    newIsAdmin.value = false
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
    await refresh()
  } catch (err) {
    errorMessage.value = err.message || 'Could not delete user.'
  } finally {
    deletingId.value = null
  }
}
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <div class="dialog">
      <h3>Manage users</h3>

      <label class="field">
        Your password
        <input v-model="actorPassword" type="password" placeholder="Required to create or delete users" autocomplete="current-password" />
      </label>

      <p v-if="errorMessage" class="error">{{ errorMessage }}</p>

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
            <button
              v-else
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
.dialog { background: var(--bg-elevated); border-radius: var(--radius); padding: 24px; width: 380px; max-height: 80vh; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
.dialog h3 { margin: 0; }
.dialog h4 { margin: 0 0 6px; font-size: 12px; color: var(--text-muted); font-weight: 600; }
.field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-muted); }
.dialog input[type="text"], .dialog input[type="password"], .dialog input:not([type]) { padding: 10px; border: 1px solid var(--border); border-radius: 8px; width: 100%; margin-bottom: 8px; }
.error { color: #d92d20; font-size: 13px; margin: 0; }
.hint { font-size: 12px; color: var(--text-muted); margin: 0; }
.section { border-top: 1px solid var(--border); padding-top: 12px; }
.user-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.user-list li { display: flex; align-items: center; gap: 8px; padding: 6px 0; }
.user-identity { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
.user-identity strong { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.user-identity small { color: var(--text-muted); font-size: 10px; white-space: nowrap; }
.admin-badge { background: var(--accent); color: var(--accent-contrast); font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 999px; }
.you-badge { background: var(--border); color: var(--text-muted); font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 999px; }
.user-list button.danger { border: none; background: none; color: #d92d20; font-size: 12px; cursor: pointer; padding: 4px 6px; }
.checkbox { display: flex; align-items: center; gap: 6px; font-size: 13px; margin-bottom: 8px; }
.checkbox input { width: auto; margin: 0; }
.actions { display: flex; justify-content: flex-end; }
.actions button, .section > button { border: 1px solid var(--border); background: var(--bg-elevated); border-radius: 8px; padding: 8px 14px; cursor: pointer; }
</style>
