import { describe, it, expect } from 'vitest'
import {
  CHUNK_SIZE, MAX_CHUNK_ATTEMPTS, shouldChunk, planChunks, overallProgress, isRetryable,
  isPartialUpload, partialUploadsFor,
} from '../../src/components/chunkPlan.js'

describe('chunk planning', () => {
  it('uses 10 MiB chunks and three attempts', () => {
    expect(CHUNK_SIZE).toBe(10 * 1024 * 1024)
    expect(MAX_CHUNK_ATTEMPTS).toBe(3)
  })
  it('only chunks files strictly larger than the chunk size', () => {
    expect(shouldChunk(CHUNK_SIZE)).toBe(false)
    expect(shouldChunk(CHUNK_SIZE + 1)).toBe(true)
    expect(shouldChunk(10, 4)).toBe(true)
  })
  it('plans contiguous chunks with an exclusive end and a short last chunk', () => {
    expect(planChunks(10, 4)).toEqual([{ offset: 0, end: 4 }, { offset: 4, end: 8 }, { offset: 8, end: 10 }])
    expect(planChunks(8, 4)).toEqual([{ offset: 0, end: 4 }, { offset: 4, end: 8 }])
    expect(planChunks(0, 4)).toEqual([])
  })
  it('reports overall progress across chunks as a rounded percentage', () => {
    expect(overallProgress(0, 0, 100)).toBe(0)
    expect(overallProgress(50, 25, 100)).toBe(75)
    expect(overallProgress(75, 25, 100)).toBe(100)
    expect(overallProgress(0, 0, 0)).toBe(100)
    expect(overallProgress(90, 20, 100)).toBe(100)
  })
})

describe('isRetryable', () => {
  const net = new Error('Network error during upload')
  it('retries network errors and 5xx while attempts remain', () => {
    expect(isRetryable(net, 1)).toBe(true)
    expect(isRetryable(net, 2)).toBe(true)
    expect(isRetryable(net, 3)).toBe(false)
    expect(isRetryable(Object.assign(new Error('x'), { status: 502 }), 1)).toBe(true)
  })
  it('never retries 4xx or an abort', () => {
    expect(isRetryable(Object.assign(new Error('x'), { status: 409 }), 1)).toBe(false)
    expect(isRetryable(Object.assign(new Error('x'), { status: 413 }), 1)).toBe(false)
    expect(isRetryable(Object.assign(new Error('Upload cancelled'), { name: 'AbortError' }), 1)).toBe(false)
  })
})

describe('partial upload names', () => {
  const md5 = 'a'.repeat(32)
  it('recognises FBQ temp files and nothing else', () => {
    expect(isPartialUpload(`movie.mp4.${md5}.uploading.tmp`)).toBe(true)
    expect(isPartialUpload('movie.mp4')).toBe(false)
    expect(isPartialUpload(`movie.mp4.${'g'.repeat(32)}.uploading.tmp`)).toBe(false)
  })
  it('finds the partials that belong to one file name only', () => {
    const entries = [
      { name: `movie.mp4.${md5}.uploading.tmp` },
      { name: `other.mp4.${md5}.uploading.tmp` },
      { name: 'movie.mp4' },
    ]
    expect(partialUploadsFor('movie.mp4', entries)).toEqual([entries[0]])
    expect(partialUploadsFor('none.mp4', entries)).toEqual([])
  })
})
