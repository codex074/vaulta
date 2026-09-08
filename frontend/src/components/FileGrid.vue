<script setup>
defineProps({
  entries: { type: Array, required: true },
  disableOpen: { type: Boolean, default: false },
})
defineEmits(['open', 'menu', 'changed', 'folder-opened'])
</script>

<template>
  <div class="grid">
    <FileTile
      v-for="entry in entries"
      :key="`${entry.source || ''}:${entry.path || entry.name}`"
      :entry="entry"
      :disable-open="disableOpen"
      @open="$emit('open', $event)"
      @folder-opened="$emit('folder-opened')"
      @menu="$emit('menu', $event)"
      @changed="$emit('changed')"
    />
  </div>
</template>

<script>
import FileTile from './FileTile.vue'
export default { components: { FileTile } }
</script>

<style scoped>
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 14px; padding: 20px; }
@media (max-width: 640px) { .grid { grid-template-columns: repeat(2, 1fr); } }
</style>
