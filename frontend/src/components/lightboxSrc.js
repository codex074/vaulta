export function pickImageSource({ hasPreview, previewFailed, originalLoaded }) {
  if (originalLoaded) return 'original'
  if (hasPreview && !previewFailed) return 'preview'
  return 'original'
}
