<script setup>
import { dialogFocus as vDialogFocus } from './dialogFocus.js'
import { ref } from 'vue'
import { useAuthStore } from '../stores/auth.js'

const emit = defineEmits(['close'])
const auth = useAuthStore()

const displayName = ref(auth.user?.displayName || auth.user?.username || '')
const profileError = ref('')
const profileSuccess = ref('')
const profileSubmitting = ref(false)

const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const passwordError = ref('')
const passwordSuccess = ref('')
const passwordSubmitting = ref(false)

async function saveProfile() {
  profileError.value = ''
  profileSuccess.value = ''
  const value = displayName.value.trim()
  if (!value) {
    profileError.value = 'Display name is required.'
    return
  }
  if (Array.from(value).length > 64) {
    profileError.value = 'Display name must be at most 64 characters.'
    return
  }

  profileSubmitting.value = true
  try {
    await auth.updateDisplayName(value)
    displayName.value = auth.user?.displayName || value
    profileSuccess.value = 'Display name updated.'
  } catch (err) {
    profileError.value = err.message || 'Could not update display name.'
  } finally {
    profileSubmitting.value = false
  }
}

async function savePassword() {
  passwordError.value = ''
  passwordSuccess.value = ''
  if (!currentPassword.value || !newPassword.value || !confirmPassword.value) {
    passwordError.value = 'Please fill in all password fields.'
    return
  }
  if (newPassword.value.length < 5) {
    passwordError.value = 'New password must be at least 5 characters.'
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    passwordError.value = 'New passwords do not match.'
    return
  }

  passwordSubmitting.value = true
  try {
    await auth.changePassword(currentPassword.value, newPassword.value)
    currentPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
    passwordSuccess.value = 'Password changed successfully.'
  } catch (err) {
    passwordError.value = err.status === 401
      ? 'Current password is incorrect.'
      : (err.message || 'Could not change password.')
  } finally {
    passwordSubmitting.value = false
  }
}
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <section class="dialog account-settings" v-dialog-focus="() => emit('close')" role="dialog" aria-modal="true" aria-labelledby="account-settings-title">
      <header class="dialog-header">
        <div>
          <h3 id="account-settings-title">Account settings</h3>
          <p class="identity">UID {{ auth.user?.uid }} · @{{ auth.user?.username }}</p>
        </div>
        <button class="close-button" type="button" aria-label="Close account settings" @click="emit('close')">×</button>
      </header>

      <form class="settings-section" @submit.prevent="saveProfile">
        <div class="section-heading">
          <h4>Profile</h4>
          <p>Choose the name shown throughout Vaulta.</p>
        </div>
        <label class="field">
          <span>Display name</span>
          <input v-model="displayName" maxlength="64" autocomplete="name" autofocus />
        </label>
        <p class="hint">Your UID and login username stay unchanged.</p>
        <p v-if="profileError" class="status error" role="alert">{{ profileError }}</p>
        <p v-if="profileSuccess" class="status success" role="status">{{ profileSuccess }}</p>
        <div class="section-actions">
          <button class="primary" type="submit" :disabled="profileSubmitting">
            {{ profileSubmitting ? 'Saving…' : 'Save display name' }}
          </button>
        </div>
      </form>

      <form class="settings-section" @submit.prevent="savePassword">
        <div class="section-heading">
          <h4>Password</h4>
          <p>Use your current password to set a new one.</p>
        </div>
        <label class="field">
          <span>Current password</span>
          <input v-model="currentPassword" type="password" autocomplete="current-password" />
        </label>
        <div class="password-grid">
          <label class="field">
            <span>New password</span>
            <input v-model="newPassword" type="password" autocomplete="new-password" />
          </label>
          <label class="field">
            <span>Confirm new password</span>
            <input v-model="confirmPassword" type="password" autocomplete="new-password" />
          </label>
        </div>
        <p v-if="passwordError" class="status error" role="alert">{{ passwordError }}</p>
        <p v-if="passwordSuccess" class="status success" role="status">{{ passwordSuccess }}</p>
        <div class="section-actions">
          <button class="primary" type="submit" :disabled="passwordSubmitting">
            {{ passwordSubmitting ? 'Saving…' : 'Change password' }}
          </button>
        </div>
      </form>

      <footer class="dialog-footer">
        <button type="button" @click="emit('close')">Done</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(20, 25, 35, 0.48);
}
.account-settings {
  width: 560px;
  max-width: 100%;
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-elevated);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.22);
}
.dialog-header,
.dialog-footer,
.settings-section {
  padding: 20px 24px;
}
.dialog-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 1px solid var(--border);
}
.dialog-header h3,
.section-heading h4 { margin: 0; }
.identity,
.hint,
.section-heading p {
  margin: 5px 0 0;
  color: var(--text-muted);
  font-size: 12px;
}
.close-button {
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  font-size: 22px;
  line-height: 1;
}
.settings-section {
  display: flex;
  flex-direction: column;
  gap: 13px;
  border-bottom: 1px solid var(--border);
}
.section-heading h4 { font-size: 14px; }
.field {
  display: flex;
  flex-direction: column;
  gap: 7px;
  color: var(--text-muted);
  font-size: 12px;
}
.field input {
  width: 100%;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
  color: var(--text);
}
.password-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.status { margin: 0; font-size: 13px; }
.error { color: var(--danger); }
.success { color: var(--success); }
.section-actions,
.dialog-footer {
  display: flex;
  justify-content: flex-end;
}
.section-actions button,
.dialog-footer button {
  padding: 8px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
  color: var(--text);
}
.section-actions .primary {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--accent-contrast);
}
button { cursor: pointer; }
button:disabled { cursor: wait; opacity: 0.65; }

@media (max-width: 560px) {
  .backdrop { align-items: flex-end; padding: 0; }
  .account-settings { max-height: 92vh; border-radius: 16px 16px 0 0; }
  .dialog-header,
  .dialog-footer,
  .settings-section { padding: 18px; }
  .password-grid { grid-template-columns: 1fr; }
}
</style>
