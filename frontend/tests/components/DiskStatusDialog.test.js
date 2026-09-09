import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import DiskStatusDialog from '../../src/components/DiskStatusDialog.vue'
import { getDiskStatus } from '../../src/api/system.js'

vi.mock('../../src/api/system.js', () => ({ getDiskStatus: vi.fn() }))

const hddDisk = {
  devpath: '/dev/sda', label: 'NAS data (tank)',
  model: 'ST2000LM007-1R8174', serial: 'WDZQLV5G',
  sizeBytes: 2000398934016, type: 'hdd', usedBy: 'ZFS',
  health: 'PASSED',
  temperatureC: 44,
  powerOnHours: 5823,
  reallocatedSectors: 0, pendingSectors: 0,
  wearPercent: null,
}

const nvmeDisk = {
  devpath: '/dev/nvme0n1', label: 'Proxmox boot / VM system disk',
  type: 'nvme', health: 'PASSED', temperatureC: 49,
  powerOnHours: 7249, wearPercent: 4,
  reallocatedSectors: null, pendingSectors: null, mediaErrors: 0,
}

function payload(overrides = {}) {
  return { checkedAt: '2026-09-09T16:40:00Z', node: 'pve2', disks: [hddDisk, nvmeDisk], ...overrides }
}

describe('DiskStatusDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows a loading state before the request resolves', () => {
    getDiskStatus.mockReturnValue(new Promise(() => {}))
    const wrapper = mount(DiskStatusDialog)
    expect(wrapper.text()).toContain('Loading')
  })

  it('renders one card per disk with the correct temperature/health classes', async () => {
    getDiskStatus.mockResolvedValue(payload())
    const wrapper = mount(DiskStatusDialog)
    await flushPromises()

    const cards = wrapper.findAll('.disk-card')
    expect(cards).toHaveLength(2)

    const hddCard = cards[0]
    expect(hddCard.text()).toContain('NAS data (tank)')
    expect(hddCard.text()).toContain('ST2000LM007-1R8174')
    expect(hddCard.text()).toContain('WDZQLV5G')
    expect(hddCard.find('.health-badge').classes()).toContain('health-ok')
    expect(hddCard.find('.temp-chip').classes()).toContain('temp-ok')
    expect(hddCard.text()).toContain('5,823 h · 243 days')
    expect(hddCard.text()).toContain('Reallocated: 0')
    expect(hddCard.text()).toContain('Pending: 0')

    const nvmeCard = cards[1]
    expect(nvmeCard.text()).toContain('Proxmox boot / VM system disk')
    expect(nvmeCard.find('.health-badge').classes()).toContain('health-ok')
    expect(nvmeCard.find('.temp-chip').classes()).toContain('temp-ok')
    expect(nvmeCard.text()).toContain('Wear: 4%')
    expect(nvmeCard.text()).toContain('Media errors: 0')

    expect(wrapper.text()).toContain('Checked')
    expect(wrapper.find('button.danger').exists()).toBe(false)
  })

  it('shows a disk-level error string when one disk failed to read SMART', async () => {
    const disks = [{ ...hddDisk, health: 'UNKNOWN', error: 'SMART read failed' }]
    getDiskStatus.mockResolvedValue(payload({ disks }))
    const wrapper = mount(DiskStatusDialog)
    await flushPromises()

    expect(wrapper.find('.disk-card').find('.health-badge').classes()).toContain('health-unknown')
    expect(wrapper.text()).toContain('SMART read failed')
  })

  it('shows an error state with a Retry button that re-calls the API', async () => {
    const err = new Error('Proxmox unreachable')
    err.status = 502
    getDiskStatus.mockRejectedValueOnce(err)
    getDiskStatus.mockResolvedValueOnce(payload())

    const wrapper = mount(DiskStatusDialog)
    await flushPromises()

    expect(wrapper.text()).toContain('Proxmox unreachable')
    expect(wrapper.find('.disk-card').exists()).toBe(false)

    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(getDiskStatus).toHaveBeenCalledTimes(2)
    expect(wrapper.findAll('.disk-card')).toHaveLength(2)
  })

  it('shows a not-configured state when the backend answers 503', async () => {
    const err = new Error('Disk monitoring is not configured.')
    err.status = 503
    getDiskStatus.mockRejectedValue(err)

    const wrapper = mount(DiskStatusDialog)
    await flushPromises()

    expect(wrapper.text()).toContain('not configured')
    expect(wrapper.text()).toContain('proxmox.json')
  })

  it('calls getDiskStatus with refresh: true when Refresh is clicked', async () => {
    getDiskStatus.mockResolvedValue(payload())
    const wrapper = mount(DiskStatusDialog)
    await flushPromises()

    expect(getDiskStatus).toHaveBeenNthCalledWith(1, { refresh: false })

    const refreshButton = wrapper.findAll('button').find((b) => b.text() === 'Refresh')
    await refreshButton.trigger('click')
    await flushPromises()

    expect(getDiskStatus).toHaveBeenLastCalledWith({ refresh: true })
  })

  it('closes on backdrop click and Close button', async () => {
    getDiskStatus.mockResolvedValue(payload())
    const wrapper = mount(DiskStatusDialog)
    await flushPromises()

    await wrapper.get('.backdrop').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)

    const closeButton = wrapper.findAll('button').find((b) => b.text() === 'Close')
    await closeButton.trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(2)
  })
})
