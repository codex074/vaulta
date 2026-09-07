import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getStorageUsage } from '../../src/api/storage.js'

describe('storage API', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  it('fetches /nasapi/storage and returns the parsed JSON', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ usedBytes: 100, totalBytes: 1000 }),
    })
    const usage = await getStorageUsage()
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toBe('/nasapi/storage')
    expect(opts.credentials).toBe('same-origin')
    expect(usage).toEqual({ usedBytes: 100, totalBytes: 1000 })
  })

  it('throws with the response status when the request fails', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 502 })
    await expect(getStorageUsage()).rejects.toThrow('Could not load storage usage (502)')
  })
})
