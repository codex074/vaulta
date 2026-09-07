<script setup>
defineProps({ uploads: { type: Array, required: true } })
</script>

<template>
  <div v-if="uploads.length" class="tray">
    <div v-for="u in uploads" :key="u.id" class="row">
      <span class="name">{{ u.name }}</span>
      <div class="bar"><div class="fill" :style="{ width: u.progress + '%' }"></div></div>
      <span class="pct">{{ u.error ? u.message : u.progress + '%' }}</span>
    </div>
  </div>
</template>

<style scoped>
.tray { position: fixed; bottom: 16px; right: 16px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; width: 260px; box-shadow: 0 8px 24px rgba(0,0,0,0.12); z-index: 20; }
.row { display: flex; align-items: center; gap: 8px; font-size: 12px; padding: 4px 0; }
.name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar { width: 60px; height: 6px; background: var(--border); border-radius: 3px; overflow: hidden; }
.fill { height: 100%; background: var(--accent); }
</style>
