import { authorizedFetch, apiError, notifyUnauthorized } from './http.js'

const SOURCE = 'share'

function resourcesUrl(path, extraParams = {}) {
  const params = new URLSearchParams({ path, source: SOURCE, ...extraParams })
  return `/api/resources?${params.toString()}`
}

export async function listDirectory(path) {
  const response = await authorizedFetch(resourcesUrl(path))
  if (!response.ok) throw await apiError(response)
  return response.json()
}

export async function makeDirectory(path) {
  const response = await authorizedFetch(resourcesUrl(path, { override: 'false', isDir: 'true' }), {
    method: 'POST',
  })
  if (!response.ok) throw await apiError(response)
}

export function uploadFile(path, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', resourcesUrl(path, { override: 'false' }), true)
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    xhr.withCredentials = true
    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100))
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
      } else {
        if (xhr.status === 401) notifyUnauthorized()
        let message = 'Upload failed'
        try {
          const body = JSON.parse(xhr.responseText)
          if (body && body.message) message = body.message
        } catch {
          // non-JSON response body, keep the fallback message
        }
        reject(Object.assign(new Error(message), { status: xhr.status }))
      }
    }
    xhr.onerror = () => reject(new Error('Network error during upload'))
    xhr.send(file)
  })
}

export async function deleteItem(path) {
  const response = await authorizedFetch(resourcesUrl(path), { method: 'DELETE' })
  if (!response.ok) throw await apiError(response)
}

export async function moveItem(fromPath, toPath, action = 'move') {
  const response = await authorizedFetch('/api/resources', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: [{ fromSource: SOURCE, fromPath, toSource: SOURCE, toPath }],
      action,
      overwrite: false,
      rename: false,
    }),
  })
  if (!response.ok) throw await apiError(response)
}

export async function copyItem(fromPath, toPath) {
  return moveItem(fromPath, toPath, 'copy')
}

export async function renameItem(path, newName) {
  const lastSlash = path.lastIndexOf('/')
  const parent = lastSlash <= 0 ? '' : path.slice(0, lastSlash)
  const toPath = `${parent}/${newName}`
  return moveItem(path, toPath)
}

export function downloadUrl(path) {
  const params = new URLSearchParams({ file: path, source: SOURCE })
  return `/api/resources/download?${params.toString()}`
}

export async function getFileText(path) {
  const response = await authorizedFetch(resourcesUrl(path, { content: 'true' }))
  if (!response.ok) throw await apiError(response)
  const data = await response.json()
  return data.content
}
