<script setup>
import { ref } from 'vue'
import { useAuthStore } from '../stores/auth.js'
import VaultaBrand from './VaultaBrand.vue'
import PasswordInput from './PasswordInput.vue'

const auth = useAuthStore()
const username = ref('')
const password = ref('')
const remember = ref(false)
const errorMessage = ref('')
const submitting = ref(false)
const host = window.location.hostname || 'nas.local'

async function onSubmit() {
  errorMessage.value = ''
  submitting.value = true
  try {
    await auth.signIn(username.value, password.value, { remember: remember.value })
  } catch (err) {
    errorMessage.value = err.status === 401 ? 'Wrong username or password.' : 'Sign-in failed. Try again.'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="login-screen">
    <form class="login-panel" @submit.prevent="onSubmit">
      <div class="login-brand-row">
        <VaultaBrand />
        <span class="node-status"><i></i> Personal cloud</span>
      </div>

      <div class="login-welcome"><h1>Your files.<br />Right at home.</h1><p>All your things, in your own space.</p></div>
      <p class="host">{{ host }}</p>

      <div class="rule"></div>

      <label class="field">
        <span class="field-label">Username</span>
        <input v-model="username" autocomplete="username" autocapitalize="none" :spellcheck="false" placeholder="Your username" required />
      </label>

      <label class="field">
        <span class="field-label">Password</span>
        <PasswordInput v-model="password" autocomplete="current-password" placeholder="Your password" required />
      </label>

      <label class="remember-row">
        <input class="remember" v-model="remember" type="checkbox" />
        <span>Keep me signed in</span>
      </label>
      <p v-if="auth.signedOutReason" class="login-notice" role="status">{{ auth.signedOutReason }}</p>

      <p v-if="errorMessage" class="login-error" role="alert">{{ errorMessage }}</p>

      <button type="submit" :disabled="submitting">{{ submitting ? 'Signing in…' : 'Continue' }}</button>
      <p class="login-footnote">Your storage. Your space.</p>
    </form>
  </div>
</template>

<style scoped>
.login-screen {
  --ink: #14171c;
  --panel: #1b2029;
  --edge: #2b3340;
  --edge-hi: #3a4354;
  --paper: #eef1f6;
  --slate: #9aa3b5;
  --signal: #ff9142;
  --danger: #ff6b5e;

  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ink);
  padding: max(24px, env(safe-area-inset-top)) max(24px, env(safe-area-inset-right))
    max(24px, env(safe-area-inset-bottom)) max(24px, env(safe-area-inset-left));
}

.login-panel {
  width: 320px;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  gap: 14px;
  background: var(--panel);
  border: 1px solid var(--edge);
  border-top-color: var(--edge-hi);
  border-radius: 6px;
  padding: 28px 28px 24px;
  box-shadow: 0 20px 40px -20px rgba(0, 0, 0, 0.6);
}

.login-brand-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 2px;
}
.node-status { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; font-size: 10px; color: var(--slate); }
.node-status i { width: 6px; height: 6px; border-radius: 50%; background: var(--signal); box-shadow: 0 0 8px var(--signal); animation: pulse 2.4s ease-in-out infinite; }
.login-footnote { margin: 2px 0 0; text-align: center; color: var(--slate); letter-spacing: .08em; text-transform: uppercase; font-size: 9px; }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

@media (prefers-reduced-motion: reduce) {
  .node-status i { animation: none; }
}

.login-panel h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  color: var(--paper);
  letter-spacing: -0.01em;
}

.host {
  margin: 2px 0 0;
  font-family: ui-monospace, "SF Mono", "Cascadia Mono", Menlo, monospace;
  font-size: 12px;
  color: var(--slate);
}

.rule {
  height: 1px;
  background: var(--edge);
  margin: 4px 0 2px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-size: 12.5px;
  color: var(--slate);
}

.field input {
  background: var(--ink);
  border: 1px solid var(--edge);
  border-radius: 5px;
  padding: 9px 10px;
  color: var(--paper);
  font-size: 14px;
  font-family: inherit;
}

.field input::placeholder,
.field :deep(input)::placeholder {
  color: var(--slate);
}

.field input:focus,
.field :deep(input):focus {
  outline: none;
  border-color: var(--signal);
  box-shadow: 0 0 0 3px rgba(255, 145, 66, 0.18);
}

.remember-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  color: var(--slate);
  min-height: 44px;
}
.remember-row input {
  width: 18px;
  height: 18px;
  accent-color: var(--signal);
}

.login-notice {
  margin: 0;
  font-size: 13px;
  color: var(--slate);
}

.login-error {
  margin: 0;
  font-size: 13px;
  color: var(--danger);
}

.login-panel button[type='submit'] {
  margin-top: 4px;
  background: var(--signal);
  color: #1a1206;
  border: none;
  border-radius: 5px;
  padding: 10px;
  font-size: 14px;
  font-weight: 600;
  transition: filter 0.15s ease;
}

.login-panel button[type='submit']:hover:not(:disabled) {
  filter: brightness(1.08);
}

.login-panel button[type='submit']:focus-visible {
  outline: 2px solid var(--paper);
  outline-offset: 2px;
}

.login-panel button[type='submit']:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
