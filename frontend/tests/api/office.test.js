import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getOfficeConfig } from '../../src/api/office.js'

describe('getOfficeConfig', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  it('requests the document config with source=share and the given path', async () => {
    const config = { document: { fileType: 'docx', key: 'abc', title: 'a.docx', url: 'https://...' } }
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(config) })
    await expect(getOfficeConfig('/Documents/a.docx')).resolves.toEqual(config)
    expect(global.fetch.mock.calls[0][0]).toBe('/api/office/config?source=share&path=%2FDocuments%2Fa.docx')
  })

  it('throws with the server message when the request fails', async () => {
    global.fetch.mockResolvedValue({
      ok: false, status: 500, statusText: 'Internal Server Error',
      clone() { return this },
      json: () => Promise.resolve({ message: 'only-office integration must be configured in settings' }),
    })
    await expect(getOfficeConfig('/a.docx')).rejects.toThrow('only-office integration must be configured in settings')
  })
})
