<script setup>
defineProps({ compact: { type: Boolean, default: false } })
</script>

<template>
  <div class="vaulta-brand" :class="{ compact }">
    <svg class="vaulta-mark" viewBox="0 0 48 48" aria-hidden="true">
      <path class="mark-field" d="M7.5 8.5h12.2L24 19.4l4.3-10.9h12.2l-8.9 26.8C30.4 39 27.7 41.5 24 41.5S17.6 39 16.4 35.3L7.5 8.5Z" />
      <path class="mark-fold" d="M12.7 12.5h4.2L24 30.8l7.1-18.3h4.2l-7.5 21.7c-.6 1.8-2 3.1-3.8 3.1s-3.2-1.3-3.8-3.1l-7.5-21.7Z" />
      <path class="mark-slots" d="M19.2 28.7h9.6M20.5 33h7" />
      <circle class="mark-pulse" cx="24" cy="23.8" r="2.1" />
    </svg>
    <span v-if="!compact" class="brand-copy">
      <strong>vaulta</strong>
      <small>private storage</small>
    </span>
  </div>
</template>

<style scoped>
.vaulta-brand { display: inline-flex; align-items: center; gap: 11px; color: var(--accent); }
.vaulta-mark { width: 38px; height: 38px; flex: 0 0 auto; overflow: visible; }
.mark-field { fill: currentColor; opacity: .11; }
.mark-fold { fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linejoin: round; }
.mark-slots { fill: none; stroke: currentColor; stroke-width: 1.65; stroke-linecap: round; opacity: .62; }
.mark-pulse { fill: currentColor; filter: drop-shadow(0 0 5px currentColor); }
.brand-copy { display: flex; min-width: 0; flex-direction: column; gap: 1px; }
.brand-copy strong { color: var(--text); letter-spacing: -.045em; font-size: 19px; font-weight: 720; line-height: 1; }
.brand-copy small { color: var(--text-muted); letter-spacing: .12em; text-transform: uppercase; font-size: 8px; font-weight: 650; }
.compact .vaulta-mark { width: 34px; height: 34px; }
</style>
