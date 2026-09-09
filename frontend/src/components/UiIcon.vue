<script setup>
defineProps({ name: { type: String, required: true }, size: { type: Number, default: 20 } })
</script>

<template>
  <svg class="ui-icon" :width="size" :height="size" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <g v-if="name === 'more'"><circle cx="4" cy="10" r="1" class="icon-fill" /><circle cx="10" cy="10" r="1" class="icon-fill" /><circle cx="16" cy="10" r="1" class="icon-fill" /></g>
    <g v-else-if="name === 'folder'"><path d="M2 5a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2Z" /></g>
    <g v-else-if="name === 'home'">
      <path d="M3.1 5.4 10 2.7l6.9 2.7v9.2L10 17.3l-6.9-2.7V5.4Z" />
      <path d="M6.2 8.1h7.6M6.2 11.1h7.6M8 14h4" />
    </g>
    <g v-else-if="name === 'starred'">
      <path d="m10 2 2.45 5 5.5.8-4 3.9.95 5.5-4.9-2.6-4.9 2.6.95-5.5-4-3.9L7.55 7Z" />
    </g>
    <g v-else-if="name === 'trash'">
      <path d="M5.1 6.4h9.8l-.7 10H5.8l-.7-10Z" />
      <path d="M3.8 6.4h12.4M7.3 6.4V3.7h5.4v2.7M8.2 9v4.7M11.8 9v4.7" />
    </g>
    <g v-else-if="name === 'link'">
      <path d="M8.2 11.8a3 3 0 0 0 4.2 0l2.4-2.4a3 3 0 0 0-4.2-4.2l-1 1" />
      <path d="M11.8 8.2a3 3 0 0 0-4.2 0L5.2 10.6a3 3 0 0 0 4.2 4.2l1-1" />
    </g>
    <g v-else-if="name === 'upload'">
      <path d="M3 13.1v3.1h14v-3.1M10 13V3.2M6.6 6.7 10 3.2l3.4 3.5" />
      <path d="M6.2 10.2h7.6" opacity=".45" />
    </g>
    <g v-else-if="name === 'storage'">
      <path d="M3 4.1h14v11.8H3V4.1Z" />
      <path d="M6 7.2h8M6 10h8M6 12.8h4.7" />
      <circle cx="13.8" cy="12.8" r=".8" class="icon-fill" />
    </g>
    <g v-else-if="name === 'grid'">
      <rect x="3" y="3" width="5.2" height="5.2" rx="1.2" />
      <rect x="11.3" y="3" width="5.7" height="3.8" rx="1.2" />
      <rect x="3" y="11.2" width="5.2" height="5.8" rx="1.2" />
      <rect x="11.3" y="9.8" width="5.7" height="7.2" rx="1.2" />
    </g>
    <g v-else-if="name === 'list'">
      <path d="M7.2 4.5H17M7.2 10H17M7.2 15.5H17" />
      <path d="M3 4.5h1.3M3 10h1.3M3 15.5h1.3" stroke-width="2.2" />
    </g>
    <g v-else-if="name === 'folder-plus'">
      <path d="M2.7 5.5h5l1.5 1.7h8.1v8.2H2.7V5.5Z" />
      <path d="M12.3 9.3v4.1M10.25 11.35h4.1" />
    </g>
    <g v-else-if="name === 'search'">
      <circle cx="8.7" cy="8.7" r="5.2" />
      <path d="m12.6 12.6 4 4" />
    </g>
    <g v-else-if="name === 'chevron'">
      <path d="m7.2 4.8 5.1 5.2-5.1 5.2" />
    </g>
    <g v-else-if="name === 'arrow-left'">
      <path d="M15.5 10H4.5M9 4.5 3.5 10 9 15.5" />
    </g>
    <g v-else-if="name === 'sun'">
      <circle cx="10" cy="10" r="3.2" />
      <path d="M10 2.4v1.5M10 16.1v1.5M2.4 10h1.5M16.1 10h1.5M4.6 4.6l1.1 1.1M14.3 14.3l1.1 1.1M15.4 4.6l-1.1 1.1M5.7 14.3l-1.1 1.1" />
    </g>
    <g v-else-if="name === 'moon'">
      <path d="M15.8 12.5A6.3 6.3 0 0 1 7.5 4.2 6.3 6.3 0 1 0 15.8 12.5Z" />
    </g>
  </svg>
</template>

<style scoped>
.ui-icon { display: block; stroke: currentColor; stroke-width: 1.45; stroke-linecap: round; stroke-linejoin: round; }
.icon-fill { fill: currentColor; stroke: none; }
</style>
