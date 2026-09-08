<script setup>
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Plyr from 'plyr'
import 'plyr/dist/plyr.css'
import { downloadUrl, previewUrl } from '../api/resources.js'
import { getOnlyOfficeUrl } from '../api/config.js'
import { getOfficeConfig } from '../api/office.js'
import { documentTypeFor } from './officeDocumentType.js'
import { pickImageSource } from './lightboxSrc.js'

const props = defineProps({ entry: { type: Object, required: true } })
defineEmits(['close'])

// Deferred: most Lightbox opens are images/video, and this package (~85KB
// gzipped, lodash inlined) would otherwise ship in the main bundle for
// every visitor even if they never open a document.
const DocumentEditor = defineAsyncComponent(() =>
  import('@onlyoffice/document-editor-vue').then((m) => m.DocumentEditor)
)

const videoEl = ref(null)
let player = null
onMounted(() => {
  if (videoEl.value) {
    player = new Plyr(videoEl.value, { speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] } })
  }
})
onBeforeUnmount(() => {
  player?.destroy()
})

const onlyOfficeAvailable = ref(false)
onMounted(async () => {
  onlyOfficeAvailable.value = Boolean(await getOnlyOfficeUrl())
})

const kind = computed(() => {
  if (props.entry.type.startsWith('image/')) return 'image'
  if (props.entry.type.startsWith('video/')) return 'video'
  if (props.entry.type === 'application/pdf') return 'pdf'
  if (onlyOfficeAvailable.value && documentTypeFor(props.entry.name)) return 'office'
  return 'other'
})
const src = computed(() => downloadUrl(props.entry.path))
const pdfSrc = computed(() => downloadUrl(props.entry.path, { inline: true }))
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

const officeUrl = ref('')
const officeConfig = ref(null)
const officeFailed = ref(false)

async function loadOffice(path, name) {
  officeFailed.value = false
  officeConfig.value = null
  try {
    const baseUrl = await getOnlyOfficeUrl()
    if (!baseUrl) throw new Error('office viewer not configured')
    const config = await getOfficeConfig(path)
    const documentType = documentTypeFor(name)
    officeUrl.value = baseUrl
    officeConfig.value = {
      ...config,
      documentType,
      type: /Mobi|Android|iPhone/i.test(navigator.userAgent) ? 'mobile' : 'desktop',
      width: '100%',
      height: '100%',
    }
  } catch {
    officeFailed.value = true
  }
}

watch(
  () => [kind.value, props.entry.path],
  ([currentKind, path]) => {
    if (currentKind === 'office') loadOffice(path, props.entry.name)
  },
  { immediate: true }
)

function onOfficeLoadError() {
  officeFailed.value = true
}
</script>

<template>
  <div class="backdrop" @click.self="$emit('close')">
    <div class="frame">
      <button class="close" @click="$emit('close')">✕</button>
      <img v-if="kind === 'image'" :src="imageSrc" :alt="entry.name" @error="imagePreviewFailed = true" />
      <video v-else-if="kind === 'video'" ref="videoEl" :src="src" controls autoplay playsinline />
      <iframe v-else-if="kind === 'pdf'" :src="pdfSrc" title="PDF preview" />
      <div v-else-if="kind === 'office' && officeConfig && !officeFailed" class="office-frame">
        <DocumentEditor
          id="vaulta-office-editor"
          :document-server-url="officeUrl"
          :config="officeConfig"
          :on-load-component-error="onOfficeLoadError"
          :events_on-error="onOfficeLoadError"
          :events_on-app-ready="() => {}"
        />
      </div>
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
.frame img { max-width: 100%; max-height: 75vh; }
.frame :deep(.plyr) { max-width: 80vw; max-height: 75vh; }
.frame :deep(.plyr__video-wrapper) { max-height: 75vh; }
.frame :deep(video) { max-height: 75vh; }
.frame iframe { width: 70vw; height: 80vh; border: none; }
.office-frame { width: calc(80vw - 40px); height: calc(85vh - 40px); }
.office-frame :deep(#vaulta-office-editor) { width: 100%; height: 100%; }
.office-frame :deep(iframe) { width: 100%; height: 100%; border: none; }
.close { position: absolute; top: 8px; right: 8px; border: none; background: none; font-size: 18px; }
.fallback { text-align: center; }
</style>
