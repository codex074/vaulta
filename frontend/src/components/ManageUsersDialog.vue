<script setup>
import { ref, onMounted } from 'vue'
import { useAuthStore } from '../stores/auth.js'
import { listUsers, createUser, deleteUser } from '../api/users.js'

const emit = defineEmits(['close'])
const auth = useAuthStore()

const users = ref([])
const loading = ref(true)
const errorMessage = ref('')
const actorPassword = ref('')

const newUsername = ref('')
const newPassword = ref('')
const newIsAdmin = ref(false)
const creating = ref(false)

const deletingId = ref(null)

async function refresh() {
  loading.value = true
  try {
    users.value = await listUsers()
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
    await createUser(actorPassword.value, {
      username: newUsername.value.trim(),
      password: newPassword.value,
      admin: newIsAdmin.value,
    })
    newUsername.value = ''
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
            <span class="username">{{ user.username }}</span>
            <span v-if="user.permissions?.admin" class="admin-badge">Admin</span>
            <span v-if="user.username === auth.user?.username" class="you-badge">You</span>
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
        <input v-model="newUsername" placeholder="Username" autocomplete="off" />
        <input v-model="newPassword" type="password" placeholder="Password" autocomplete="new-password" />
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
.username { flex: 1; font-size: 13px; }
.admin-badge { background: var(--accent); color: var(--accent-contrast); font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 999px; }
.you-badge { background: var(--border); color: var(--text-muted); font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 999px; }
.user-list button.danger { border: none; background: none; color: #d92d20; font-size: 12px; cursor: pointer; padding: 4px 6px; }
.checkbox { display: flex; align-items: center; gap: 6px; font-size: 13px; margin-bottom: 8px; }
.checkbox input { width: auto; margin: 0; }
.actions { display: flex; justify-content: flex-end; }
.actions button, .section > button { border: 1px solid var(--border); background: var(--bg-elevated); border-radius: 8px; padding: 8px 14px; cursor: pointer; }
</style>
