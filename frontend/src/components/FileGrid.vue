<script setup>
defineProps({ entries: { type: Array, required: true } })
defineEmits(['open', 'menu'])
</script>

<template>
  <div class="grid">
    <FileTile
      v-for="entry in entries"
      :key="entry.name"
      :entry="entry"
      @open="$emit('open', $event)"
      @menu="$emit('menu', $event)"
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
