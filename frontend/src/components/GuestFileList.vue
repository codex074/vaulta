<script setup>
import FileGlyph from './FileGlyph.vue'
import { canRequestThumbnail, formatSize, formatRelativeTime } from './fileFormat.js'
import { publicPreviewUrl, publicDownloadUrl } from '../api/publicShare.js'

const props = defineProps({
  entries: { type: Array, required: true },
  hash: { type: String, required: true },
  hasPassword: { type: Boolean, default: false },
})
const emit = defineEmits(['open', 'download'])

function thumbFor(entry) {
  // Thumbnails load by URL, which cannot carry the share password header.
  if (props.hasPassword || !canRequestThumbnail(entry)) return null
  return publicPreviewUrl(props.hash, entry.path, 'small')
}
</script>

<template>
  <ul class="guest-list">
    <li v-for="entry in entries" :key="entry.path" class="guest-row">
      <button type="button" class="guest-open" :aria-label="`Open ${entry.name}`" @click="emit('open', entry)">
        <img v-if="thumbFor(entry)" class="guest-thumb" :src="thumbFor(entry)" :alt="entry.name" loading="lazy" />
        <FileGlyph v-else class="guest-glyph" :entry="entry" />
        <span class="guest-text">
          <span class="guest-name">{{ entry.name }}</span>
          <span class="guest-meta">{{ entry.type === 'directory' ? 'Folder' : formatSize(entry.size) }} · {{ formatRelativeTime(entry.modified) }}</span>
        </span>
      </button>
      <template v-if="entry.type !== 'directory'">
        <a v-if="!hasPassword" class="guest-download" :href="publicDownloadUrl(hash, entry.path)" download>Download</a>
        <button v-else type="button" class="guest-download" @click="emit('download', entry)">Download</button>
      </template>
    </li>
  </ul>
</template>

<style scoped>
.guest-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.guest-row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 12px; background: var(--bg-elevated); }
.guest-open { flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; border: none; background: none; color: inherit; text-align: left; padding: 0; min-height: 44px; }
.guest-thumb { width: 44px; height: 44px; object-fit: cover; border-radius: 8px; flex-shrink: 0; }
.guest-glyph { width: 44px; height: 44px; flex-shrink: 0; }
.guest-text { display: flex; flex-direction: column; min-width: 0; }
.guest-name { font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.guest-meta { font-size: 12px; color: var(--text-muted); }
.guest-download { min-height: 36px; padding: 0 12px; border-radius: 10px; border: 1px solid var(--border); background: var(--bg); color: var(--accent); font-size: 13px; text-decoration: none; display: inline-flex; align-items: center; }
</style>
