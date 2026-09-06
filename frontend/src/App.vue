<script setup>
import { onMounted } from 'vue'
import { useAuthStore } from './stores/auth.js'
import LoginView from './components/LoginView.vue'

const auth = useAuthStore()
onMounted(() => auth.checkSession())
</script>

<template>
  <LoginView v-if="auth.checked && !auth.user" />
  <div v-else-if="auth.checked" id="app-shell">
    <p>Signed in as {{ auth.user.username }} — browser UI comes in later tasks.</p>
  </div>
</template>
