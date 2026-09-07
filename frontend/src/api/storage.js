export async function getStorageUsage() {
  const response = await fetch('/nasapi/storage', { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`Could not load storage usage (${response.status})`)
  return response.json()
}
