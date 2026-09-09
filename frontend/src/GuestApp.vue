<script setup>
import { watch } from 'vue'
import { useThemeStore } from './stores/theme.js'
import GuestShareView from './components/GuestShareView.vue'

defineProps({ hash: { type: String, required: true } })
const theme = useThemeStore()
watch(() => theme.current, (value) => {
  document.documentElement.dataset.theme = value
}, { immediate: true })
</script>

<template>
  <div id="guest-app">
    <GuestShareView :hash="hash" />
  </div>
</template>
