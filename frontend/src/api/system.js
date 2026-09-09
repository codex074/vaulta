import { authorizedFetch, apiError } from './http.js'

export async function getDiskStatus({ refresh = false } = {}) {
  const url = refresh ? '/nasapi/system/disks?refresh=1' : '/nasapi/system/disks'
  const response = await authorizedFetch(url)
  if (!response.ok) throw await apiError(response)
  return response.json()
}
