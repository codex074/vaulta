import { describe, it, expect } from 'vitest'
import { pickImageSource } from '../../src/components/lightboxSrc.js'

describe('pickImageSource', () => {
  it('shows the fast preview while the original is still loading', () => {
    expect(pickImageSource({ hasPreview: true, previewFailed: false, originalLoaded: false })).toBe('preview')
  })

  it('switches to the original once it has loaded', () => {
    expect(pickImageSource({ hasPreview: true, previewFailed: false, originalLoaded: true })).toBe('original')
  })

  it('goes straight to the original when there is no server preview', () => {
    expect(pickImageSource({ hasPreview: false, previewFailed: false, originalLoaded: false })).toBe('original')
  })

  it('falls back to the original if the preview request failed', () => {
    expect(pickImageSource({ hasPreview: true, previewFailed: true, originalLoaded: false })).toBe('original')
  })
})
