import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getOnlyOfficeUrl, __resetOnlyOfficeUrlCache } from '../../src/api/config.js'

describe('getOnlyOfficeUrl', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
    __resetOnlyOfficeUrlCache()
  })

  it('returns the configured URL from /nasapi/config', async () => {
    global.fetch.mockResolvedValue({
      ok: true, status: 200, json: () => Promise.resolve({ onlyOfficeUrl: 'https://office.codex074.com' }),
    })
    await expect(getOnlyOfficeUrl()).resolves.toBe('https://office.codex074.com')
    expect(global.fetch.mock.calls[0][0]).toBe('/nasapi/config')
  })

  it('caches the result — a second call does not fetch again', async () => {
    global.fetch.mockResolvedValue({
      ok: true, status: 200, json: () => Promise.resolve({ onlyOfficeUrl: 'https://office.codex074.com' }),
    })
    await getOnlyOfficeUrl()
    await getOnlyOfficeUrl()
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('degrades to an empty string when the request fails', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 500 })
    await expect(getOnlyOfficeUrl()).resolves.toBe('')
  })

  it('degrades to an empty string when fetch itself throws', async () => {
    global.fetch.mockRejectedValue(new Error('network down'))
    await expect(getOnlyOfficeUrl()).resolves.toBe('')
  })

  it('__resetOnlyOfficeUrlCache allows a fresh fetch afterward', async () => {
    global.fetch.mockResolvedValue({
      ok: true, status: 200, json: () => Promise.resolve({ onlyOfficeUrl: 'https://office.codex074.com' }),
    })
    await getOnlyOfficeUrl()
    __resetOnlyOfficeUrlCache()
    await getOnlyOfficeUrl()
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })
})
