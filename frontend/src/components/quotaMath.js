import { formatSize } from './fileFormat.js'

export function quotaPercent(usedBytes, limitBytes) {
  if (!limitBytes) return 0
  return Math.min(100, Math.round((usedBytes / limitBytes) * 100))
}

export function quotaFillColor(percent) {
  if (percent >= 90) return 'var(--danger)'
  if (percent >= 75) return 'var(--warning)'
  return 'var(--accent)'
}

export function quotaLabel(quota) {
  if (!quota.hasDrive) return ''
  if (quota.unlimited) return `${formatSize(quota.usedBytes)} used`
  if (!quota.limitBytes) return 'No quota set — ask an admin'
  return `${formatSize(quota.usedBytes)} of ${formatSize(quota.limitBytes)} used`
}
