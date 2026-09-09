import { describe, it, expect } from 'vitest'
import { temperatureLevel, healthLevel, formatHours } from '../../src/components/diskStatus.js'

describe('temperatureLevel', () => {
  it('is unknown when the temperature is null or undefined', () => {
    expect(temperatureLevel('hdd', null)).toBe('unknown')
    expect(temperatureLevel('hdd', undefined)).toBe('unknown')
    expect(temperatureLevel('nvme', null)).toBe('unknown')
  })

  it('uses the hdd bands: ok below 45, warn 45-50, hot above 50', () => {
    expect(temperatureLevel('hdd', 44)).toBe('ok')
    expect(temperatureLevel('hdd', 44.9)).toBe('ok')
    expect(temperatureLevel('hdd', 45)).toBe('warn')
    expect(temperatureLevel('hdd', 47)).toBe('warn')
    expect(temperatureLevel('hdd', 50)).toBe('warn')
    expect(temperatureLevel('hdd', 51)).toBe('hot')
  })

  it('uses the ssd/nvme bands: ok below 60, warn 60-70, hot above 70', () => {
    expect(temperatureLevel('ssd', 59)).toBe('ok')
    expect(temperatureLevel('ssd', 60)).toBe('warn')
    expect(temperatureLevel('ssd', 65)).toBe('warn')
    expect(temperatureLevel('ssd', 70)).toBe('warn')
    expect(temperatureLevel('ssd', 71)).toBe('hot')
    expect(temperatureLevel('nvme', 49)).toBe('ok')
    expect(temperatureLevel('nvme', 71)).toBe('hot')
  })
})

describe('healthLevel', () => {
  it('maps PASSED to ok and FAILED to bad', () => {
    expect(healthLevel('PASSED')).toBe('ok')
    expect(healthLevel('FAILED')).toBe('bad')
  })

  it('maps UNKNOWN and anything unexpected to unknown', () => {
    expect(healthLevel('UNKNOWN')).toBe('unknown')
    expect(healthLevel(null)).toBe('unknown')
    expect(healthLevel(undefined)).toBe('unknown')
    expect(healthLevel('WEIRD')).toBe('unknown')
  })
})

describe('formatHours', () => {
  it('is an em dash when hours is null or undefined', () => {
    expect(formatHours(null)).toBe('—')
    expect(formatHours(undefined)).toBe('—')
  })

  it('formats hours with a thousands separator plus a rounded day count', () => {
    expect(formatHours(5823)).toBe('5,823 h · 243 days')
    expect(formatHours(7249)).toBe('7,249 h · 302 days')
  })

  it('handles zero', () => {
    expect(formatHours(0)).toBe('0 h · 0 days')
  })
})
