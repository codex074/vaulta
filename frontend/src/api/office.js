import { authorizedFetch, apiError } from './http.js'

const SOURCE = 'share'

export async function getOfficeConfig(path) {
  const params = new URLSearchParams({ source: SOURCE, path })
  const response = await authorizedFetch(`/api/office/config?${params.toString()}`)
  if (!response.ok) throw await apiError(response)
  return response.json()
}
