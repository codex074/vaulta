<script setup>
import { computed } from 'vue'
const props = defineProps({ entry: { type: Object, required: true } })
const extension = computed(() => props.entry.name.split('.').at(-1).slice(0, 4).toUpperCase())
const tone = computed(() => props.entry.type?.startsWith('image/') ? 'photo' : props.entry.type?.startsWith('video/') ? 'video' : /pdf/i.test(extension.value) ? 'pdf' : /xls|csv/i.test(extension.value) ? 'sheet' : 'document')
</script>

<template>
  <svg v-if="entry.type === 'directory'" class="file-glyph folder-glyph" viewBox="0 0 100 80" fill="none" aria-hidden="true">
    <path d="M5 16a7 7 0 0 1 7-7h23c3 0 4 1 6 3l6 6h41a7 7 0 0 1 7 7v42a7 7 0 0 1-7 7H12a7 7 0 0 1-7-7Z" fill="#299ce8" />
    <path d="M7 26h86v38H7Z" fill="#bce9ff" />
    <path d="M5 32a7 7 0 0 1 7-7h76a7 7 0 0 1 7 7v35a7 7 0 0 1-7 7H12a7 7 0 0 1-7-7Z" fill="#63c6f5" />
    <path d="M12 26h76" stroke="#a3e3ff" stroke-width="1.5" stroke-linecap="round" />
  </svg>
  <svg v-else class="file-glyph document-glyph" :class="tone" viewBox="0 0 76 90" fill="none" aria-hidden="true">
    <path class="document-paper" d="M12 2h34l18 19v59a7 7 0 0 1-7 7H12a7 7 0 0 1-7-7V9a7 7 0 0 1 7-7Z" />
    <path d="M46 2v14a5 5 0 0 0 5 5h13" stroke="currentColor" stroke-opacity=".28" />
    <path d="M18 35h31M18 42h25M18 49h29" stroke="currentColor" stroke-opacity=".28" stroke-width="3" stroke-linecap="round" />
    <rect x="0" y="59" width="48" height="22" rx="5" fill="currentColor" />
    <text x="24" y="74" fill="white" text-anchor="middle" font-size="11" font-weight="700" font-family="-apple-system, sans-serif">{{ extension }}</text>
  </svg>
</template>
