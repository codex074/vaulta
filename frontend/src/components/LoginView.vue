<script setup>
import { ref } from 'vue'
import { useAuthStore } from '../stores/auth.js'

const auth = useAuthStore()
const username = ref('')
const password = ref('')
const errorMessage = ref('')
const submitting = ref(false)

async function onSubmit() {
  errorMessage.value = ''
  submitting.value = true
  try {
    await auth.signIn(username.value, password.value)
  } catch (err) {
    errorMessage.value = err.status === 401 ? 'Wrong username or password.' : 'Sign-in failed.'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="login-screen">
    <form class="login-card" @submit.prevent="onSubmit">
      <h1>NAS</h1>
      <input v-model="username" placeholder="Username" autocomplete="username" />
      <input v-model="password" type="password" placeholder="Password" autocomplete="current-password" />
      <p v-if="errorMessage" class="login-error">{{ errorMessage }}</p>
      <button type="submit" :disabled="submitting">{{ submitting ? 'Signing in…' : 'Sign in' }}</button>
    </form>
  </div>
</template>

<style scoped>
.login-screen { min-height: 100vh; display: flex; align-items: center; justify-content: center; }
.login-card { background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius); padding: 32px; width: 280px; display: flex; flex-direction: column; gap: 12px; }
.login-card input { padding: 10px; border: 1px solid var(--border); border-radius: 8px; }
.login-card button { background: var(--accent); color: var(--accent-contrast); border: none; border-radius: 8px; padding: 10px; }
.login-error { color: #d92d20; font-size: 13px; margin: 0; }
</style>
