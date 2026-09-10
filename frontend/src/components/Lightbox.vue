<script setup>
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Plyr from 'plyr'
import 'plyr/dist/plyr.css'
import { downloadUrl, getFileText, previewUrl } from '../api/resources.js'
import { getOnlyOfficeUrl } from '../api/config.js'
import { getOfficeConfig } from '../api/office.js'
import { documentTypeFor } from './officeDocumentType.js'
import { lightboxKindFor, officeModeLabel } from './lightboxKind.js'
import { pickImageSource } from './lightboxSrc.js'

const props = defineProps({
  entry: { type: Object, required: true },
  // Guest pages hand in ready-made URLs (direct public URLs or blob URLs);
  // with urls set, this component never touches the authenticated API.
  urls: { type: Object, default: null },
})
defineEmits(['close'])

// Callers (FileTile/FileListView) always stamp the entry with its own
// source before emitting 'open'; the fallback keeps this component usable
// on its own without pulling in the files store.
const source = computed(() => props.entry.source ?? 'share')

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
    player = new Plyr(videoEl.value, {
      speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] },
      // iPhone has no element Fullscreen API; iosNative hands the video to
      // Safari's own player instead of Plyr's boxed-in CSS fallback.
      fullscreen: { enabled: true, fallback: true, iosNative: true },
    })
  }
})
onBeforeUnmount(() => {
  player?.destroy()
})

const onlyOfficeAvailable = ref(false)
onMounted(async () => {
  if (props.urls) return
  onlyOfficeAvailable.value = Boolean(await getOnlyOfficeUrl())
})

const kind = computed(() =>
  lightboxKindFor(props.entry, { onlyOfficeAvailable: onlyOfficeAvailable.value })
)
const src = computed(() => props.urls ? props.urls.original : downloadUrl(source.value, props.entry.path))
const pdfSrc = computed(() => props.urls ? props.urls.inline : downloadUrl(source.value, props.entry.path, { inline: true }))
const imagePreviewFailed = ref(false)
const originalLoaded = ref(false)
const imageSrc = computed(() => {
  if (props.urls) return props.urls.original
  return pickImageSource({
    hasPreview: props.entry.hasPreview,
    previewFailed: imagePreviewFailed.value,
    originalLoaded: originalLoaded.value,
  }) === 'preview'
    ? previewUrl(source.value, props.entry.path, 'large')
    : src.value
})

// Always ends up showing the true original — the preview above is only an
// instant-loading placeholder while the full-quality file downloads in the background.
watch(
  () => props.entry.path,
  (path) => {
    imagePreviewFailed.value = false
    originalLoaded.value = false
    if (props.urls) return
    if (!props.entry.type.startsWith('image/')) return
    const original = new Image()
    original.onload = () => {
      if (props.entry.path === path) originalLoaded.value = true
    }
    original.src = downloadUrl(source.value, path)
  },
  { immediate: true }
)

const officeUrl = ref('')
const officeConfig = ref(null)
const officeFailed = ref(false)
const officeMode = computed(() => officeModeLabel(officeConfig.value))

// Plain text is fetched through FileBrowser's content endpoint and shown
// verbatim; nothing here can write it back, by design.
const textContent = ref('')
const textFailed = ref(false)
async function loadText(path) {
  textFailed.value = false
  textContent.value = ''
  if (props.urls) {
    textContent.value = props.urls.text ?? ''
    return
  }
  try {
    textContent.value = await getFileText(source.value, path)
  } catch {
    textFailed.value = true
  }
}

async function loadOffice(path, name) {
  officeFailed.value = false
  officeConfig.value = null
  try {
    const baseUrl = await getOnlyOfficeUrl()
    if (!baseUrl) throw new Error('office viewer not configured')
    const config = await getOfficeConfig(source.value, path)
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
    if (currentKind === 'text') loadText(path)
  },
  { immediate: true }
)

function onOfficeLoadError() {
  officeFailed.value = true
}
</script>

<template>
  <div
    v-if="kind === 'pdf' || (kind === 'text' && !textFailed) || (kind === 'office' && officeConfig && !officeFailed)"
    class="doc-panel"
  >
    <div class="doc-topbar">
      <button class="doc-back" @click="$emit('close')">← กลับ</button>
      <span class="doc-filename">{{ entry.name }}</span>
      <span v-if="kind === 'office'" class="doc-mode">{{ officeMode }}</span>
      <span v-else-if="kind === 'text'" class="doc-mode">ดูอย่างเดียว</span>
    </div>
    <iframe v-if="kind === 'pdf'" class="doc-frame" :src="pdfSrc" title="PDF preview" />
    <pre v-else-if="kind === 'text'" class="doc-frame doc-text">{{ textContent }}</pre>
    <div v-else class="doc-frame">
      <DocumentEditor
        id="vaulta-office-editor"
        :document-server-url="officeUrl"
        :config="officeConfig"
        :on-load-component-error="onOfficeLoadError"
        :events_on-error="onOfficeLoadError"
        :events_on-app-ready="() => {}"
      />
    </div>
  </div>
  <div v-else class="backdrop" @click.self="$emit('close')">
    <div class="frame">
      <button class="close" aria-label="Close preview" @click="$emit('close')">✕</button>
      <img v-if="kind === 'image'" :src="imageSrc" :alt="entry.name" @error="imagePreviewFailed = true" />
      <video v-else-if="kind === 'video'" ref="videoEl" :src="src" controls autoplay playsinline />
      <div v-else class="fallback">
        <p>{{ entry.name }}</p>
        <a :href="src" target="_blank">Download</a>
      </div>
    </div>
  </div>
</template>

<style scoped>
.backdrop { position: fixed; inset: 0; background: rgba(15, 18, 25, 0.75); display: flex; align-items: center; justify-content: center; z-index: 30; }
.frame { position: relative; max-width: 85vw; max-height: 85vh; max-height: 85dvh; background: var(--bg-elevated); border-radius: var(--radius); padding: 20px; display: flex; align-items: center; justify-content: center; }
.frame img { max-width: 100%; max-height: 75vh; max-height: 75dvh; }
/* Size caps apply only while the player sits inside the frame. Plyr has no
   "fullscreen active" class: native fullscreen is only visible as the
   :fullscreen pseudo-class on .plyr, and the CSS fallback (no Fullscreen
   API) as .plyr--fullscreen-fallback. The browser clears max-width/height on
   the fullscreen element itself but not on its descendants, so the wrapper
   and <video> caps must be excluded too, or "fullscreen" is a 75dvh box on a
   black screen. tests/components/lightboxPlyrClasses.test.js guards this. */
.frame :deep(.plyr:not(:fullscreen):not(.plyr--fullscreen-fallback)) { max-width: 80vw; max-height: 75vh; max-height: 75dvh; }
.frame :deep(.plyr:not(:fullscreen):not(.plyr--fullscreen-fallback) .plyr__video-wrapper) { max-height: 75vh; max-height: 75dvh; }
.frame :deep(.plyr:not(:fullscreen):not(.plyr--fullscreen-fallback) video) { max-height: 75vh; max-height: 75dvh; }

@media (max-width: 640px) {
  .frame { max-width: 94vw; padding: 12px; }
  .frame img { max-height: 70dvh; }
}
.close { position: absolute; top: 8px; right: 8px; border: none; background: none; font-size: 18px; }
.fallback { text-align: center; }

/* Full-screen: a slim header strip of our own above the viewer, never
   overlapping OnlyOffice's own toolbar or the browser's native PDF
   controls (both span the full top edge and would otherwise sit under
   a floating close button). Shared by PDF and OnlyOffice documents. */
.doc-panel {
  position: fixed;
  inset: 0;
  z-index: 31;
  display: flex;
  flex-direction: column;
  background: var(--bg-elevated);
}
.doc-topbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--border);
}
.doc-back {
  flex-shrink: 0;
  border: none;
  border-radius: 999px;
  padding: 8px 14px;
  background: var(--bg);
  color: var(--text);
  font-size: 14px;
  font-weight: 600;
}
.doc-filename {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: var(--text-muted);
}
.doc-frame { flex: 1; min-height: 0; border: none; }
.doc-text { margin: 0; padding: 16px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--text); background: var(--bg); }
.doc-mode { margin-left: auto; font-size: 12px; color: var(--text-muted); white-space: nowrap; }
.doc-frame :deep(#vaulta-office-editor) { width: 100%; height: 100%; }
.doc-frame :deep(iframe) { width: 100%; height: 100%; border: none; }
</style>
