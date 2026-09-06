const listeners = new Set()

export function onUnauthorized(callback) {
  listeners.add(callback)
  return () => listeners.delete(callback)
}

export async function authorizedFetch(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', ...options })
  if (response.status === 401) {
    for (const callback of listeners) callback()
  }
  return response
}
