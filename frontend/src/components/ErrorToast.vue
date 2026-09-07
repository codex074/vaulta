<script setup>
import { errorToasts } from '../errorToast.js'
</script>

<template>
  <div v-if="errorToasts.length" class="error-tray">
    <div v-for="t in errorToasts" :key="t.id" class="error-row">{{ t.message }}</div>
  </div>
</template>

<style scoped>
.error-tray {
  position: fixed;
  bottom: 16px;
  right: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 25;
  max-width: 320px;
}
.error-row {
  background: var(--danger-bg);
  border: 1px solid var(--danger-border);
  color: var(--danger);
  border-radius: var(--radius);
  padding: 10px 14px;
  font-size: 13px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
}
</style>
