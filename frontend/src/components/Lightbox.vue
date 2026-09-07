<script setup>
import { computed, ref, watch } from 'vue'
import { downloadUrl, previewUrl } from '../api/resources.js'
import { pickImageSource } from './lightboxSrc.js'

const props = defineProps({ entry: { type: Object, required: true } })
defineEmits(['close'])

const kind = computed(() => {
  if (props.entry.type.startsWith('image/')) return 'image'
  if (props.entry.type.startsWith('video/')) return 'video'
  if (props.entry.type === 'application/pdf') return 'pdf'
  return 'other'
})
const src = computed(() => downloadUrl(props.entry.path))
const imagePreviewFailed = ref(false)
const originalLoaded = ref(false)
const imageSrc = computed(() =>
  pickImageSource({
    hasPreview: props.entry.hasPreview,
    previewFailed: imagePreviewFailed.value,
    originalLoaded: originalLoaded.value,
  }) === 'preview'
    ? previewUrl(props.entry.path, 'large')
    : src.value
)

// Always ends up showing the true original — the preview above is only an
// instant-loading placeholder while the full-quality file downloads in the background.
watch(
  () => props.entry.path,
  (path) => {
    imagePreviewFailed.value = false
    originalLoaded.value = false
    if (!props.entry.type.startsWith('image/')) return
    const original = new Image()
    original.onload = () => {
      if (props.entry.path === path) originalLoaded.value = true
    }
    original.src = downloadUrl(path)
  },
  { immediate: true }
)
</script>

<template>
  <div class="backdrop" @click.self="$emit('close')">
    <div class="frame">
      <button class="close" @click="$emit('close')">✕</button>
      <img v-if="kind === 'image'" :src="imageSrc" :alt="entry.name" @error="imagePreviewFailed = true" />
      <video v-else-if="kind === 'video'" :src="src" controls autoplay />
      <iframe v-else-if="kind === 'pdf'" :src="src" title="PDF preview" />
      <div v-else class="fallback">
        <p>{{ entry.name }}</p>
        <a :href="src" target="_blank">Download</a>
      </div>
    </div>
  </div>
</template>

<style scoped>
.backdrop { position: fixed; inset: 0; background: rgba(15, 18, 25, 0.75); display: flex; align-items: center; justify-content: center; z-index: 30; }
.frame { position: relative; max-width: 85vw; max-height: 85vh; background: var(--bg-elevated); border-radius: var(--radius); padding: 20px; display: flex; align-items: center; justify-content: center; }
.frame img, .frame video { max-width: 100%; max-height: 75vh; }
.frame iframe { width: 70vw; height: 80vh; border: none; }
.close { position: absolute; top: 8px; right: 8px; border: none; background: none; font-size: 18px; }
.fallback { text-align: center; }
</style>
