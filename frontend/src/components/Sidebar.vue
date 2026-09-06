<script setup>
import { useAuthStore } from '../stores/auth.js'

const auth = useAuthStore()
</script>

<template>
  <nav class="sidebar">
    <button class="sidebar-icon active" title="My Files">🗂️</button>
    <div class="sidebar-spacer"></div>
    <button class="sidebar-icon" title="Sign out" @click="auth.signOut()">👤</button>
  </nav>
</template>

<style scoped>
.sidebar {
  width: var(--sidebar-width);
  background: var(--bg-elevated);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 0;
  gap: 8px;
}
.sidebar-spacer { flex: 1; }
.sidebar-icon {
  width: 40px; height: 40px;
  border: none; background: transparent; border-radius: 8px; font-size: 18px;
}
.sidebar-icon.active { background: var(--border); }

@media (max-width: 640px) {
  .sidebar {
    width: 100%; height: 56px; flex-direction: row;
    border-right: none; border-top: 1px solid var(--border);
    order: 2;
  }
}
</style>
