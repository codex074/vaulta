import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getMyQuota, listQuotas, setUserQuota, deleteUserQuota, gbToBytes, bytesToGb } from '../../src/api/quota.js'

const GIB = 1024 ** 3

describe('quota API', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  it('getMyQuota GETs /nasapi/quota and returns the parsed body', async () => {
    const body = { hasDrive: true, unlimited: false, limitBytes: 5 * GIB, usedBytes: GIB }
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(body) })
    const result = await getMyQuota()
    expect(global.fetch.mock.calls[0][0]).toBe('/nasapi/quota')
    expect(result).toEqual(body)
  })

  it('getMyQuota throws the API error message on failure', async () => {
    global.fetch.mockResolvedValue({
      ok: false, status: 500, statusText: 'Internal Server Error',
      clone() { return this },
      json: () => Promise.resolve({ message: 'quota store unavailable' }),
    })
    await expect(getMyQuota()).rejects.toThrow('quota store unavailable')
  })

  it('listQuotas GETs /nasapi/quotas and returns the quotas map', async () => {
    const body = { quotas: { 3: { limitBytes: 5 * GIB, usedBytes: GIB, hasDrive: true, unlimited: false } } }
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(body) })
    const result = await listQuotas()
    expect(global.fetch.mock.calls[0][0]).toBe('/nasapi/quotas')
    expect(result).toEqual(body.quotas)
  })

  it('listQuotas throws the API error message on failure (e.g. non-admin)', async () => {
    global.fetch.mockResolvedValue({
      ok: false, status: 403, statusText: 'Forbidden',
      clone() { return this },
      json: () => Promise.resolve({ message: 'admin required' }),
    })
    await expect(listQuotas()).rejects.toThrow('admin required')
  })

  it('setUserQuota PUTs /nasapi/quotas/<uid> with the limit in bytes', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ uid: '3', limitBytes: 5 * GIB }) })
    await setUserQuota('3', 5 * GIB)
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toBe('/nasapi/quotas/3')
    expect(opts.method).toBe('PUT')
    expect(JSON.parse(opts.body)).toEqual({ limitBytes: 5 * GIB })
  })

  it('setUserQuota throws the API error message on failure', async () => {
    global.fetch.mockResolvedValue({
      ok: false, status: 400, statusText: 'Bad Request',
      clone() { return this },
      json: () => Promise.resolve({ message: 'limitBytes must be >= 0' }),
    })
    await expect(setUserQuota('3', -1)).rejects.toThrow('limitBytes must be >= 0')
  })

  it('deleteUserQuota DELETEs /nasapi/quotas/<uid>', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 204 })
    await deleteUserQuota('3')
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toBe('/nasapi/quotas/3')
    expect(opts.method).toBe('DELETE')
  })

  it('deleteUserQuota throws the API error message on failure', async () => {
    global.fetch.mockResolvedValue({
      ok: false, status: 403, statusText: 'Forbidden',
      clone() { return this },
      json: () => Promise.resolve({ message: 'admin required' }),
    })
    await expect(deleteUserQuota('3')).rejects.toThrow('admin required')
  })

  describe('gbToBytes / bytesToGb (GiB math)', () => {
    it('converts whole GB to GiB bytes', () => {
      expect(gbToBytes(1)).toBe(GIB)
      expect(gbToBytes(5)).toBe(5 * GIB)
    })

    it('round-trips through bytesToGb', () => {
      expect(bytesToGb(gbToBytes(10))).toBe(10)
      expect(bytesToGb(gbToBytes(0.5))).toBe(0.5)
    })

    it('bytesToGb divides by 1024**3, not a decimal billion', () => {
      expect(bytesToGb(1_000_000_000)).toBeCloseTo(0.9313, 3)
      expect(bytesToGb(GIB)).toBe(1)
    })

    it('gbToBytes rounds to a whole number of bytes', () => {
      expect(Number.isInteger(gbToBytes(1.5))).toBe(true)
    })
  })
})
