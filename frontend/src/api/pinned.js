import { authorizedFetch, apiError } from './http.js'

export async function togglePinned({ name, path, source }, action = 'add') {
  const response = await authorizedFetch(`/api/users/pinnedItems?action=${action}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, path, source }),
  })
  if (!response.ok) throw await apiError(response)
}
