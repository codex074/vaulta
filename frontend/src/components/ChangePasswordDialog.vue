<script setup>
import { ref } from 'vue'
import { useAuthStore } from '../stores/auth.js'

const emit = defineEmits(['close'])
const auth = useAuthStore()
const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const errorMessage = ref('')
const submitting = ref(false)

async function onSubmit() {
  errorMessage.value = ''
  if (!currentPassword.value || !newPassword.value) {
    errorMessage.value = 'Please fill in all fields.'
    return
  }
  if (newPassword.value.length < 5) {
    errorMessage.value = 'New password must be at least 5 characters.'
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    errorMessage.value = 'New passwords do not match.'
    return
  }
  submitting.value = true
  try {
    await auth.changePassword(currentPassword.value, newPassword.value)
    emit('close')
  } catch (err) {
    errorMessage.value = err.status === 401 ? 'Current password is incorrect.' : (err.message || 'Could not change password.')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <form class="dialog" @submit.prevent="onSubmit">
      <h3>Change password</h3>
      <input v-model="currentPassword" type="password" placeholder="Current password" autocomplete="current-password" autofocus />
      <input v-model="newPassword" type="password" placeholder="New password" autocomplete="new-password" />
      <input v-model="confirmPassword" type="password" placeholder="Confirm new password" autocomplete="new-password" />
      <p v-if="errorMessage" class="error">{{ errorMessage }}</p>
      <div class="actions">
        <button type="button" @click="emit('close')">Cancel</button>
        <button type="submit" :disabled="submitting">{{ submitting ? 'Saving…' : 'Save' }}</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.backdrop { position: fixed; inset: 0; background: rgba(20, 25, 35, 0.4); display: flex; align-items: center; justify-content: center; z-index: 20; }
.dialog { background: var(--bg-elevated); border-radius: var(--radius); padding: 24px; width: 320px; display: flex; flex-direction: column; gap: 10px; }
.dialog h3 { margin: 0 0 4px; }
.dialog input { padding: 10px; border: 1px solid var(--border); border-radius: 8px; }
.error { color: #d92d20; font-size: 13px; margin: 0; }
.actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
