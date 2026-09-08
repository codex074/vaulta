import { authorizedFetch, apiError } from './http.js'

export async function getOfficeConfig(source, path) {
  const params = new URLSearchParams({ source, path })
  const response = await authorizedFetch(`/api/office/config?${params.toString()}`)
  if (!response.ok) throw await apiError(response)
  return response.json()
}
