async function apiError(response) {
  const err = new Error(response.statusText || 'Request failed')
  err.status = response.status
  return err
}

export async function login(username, password) {
  const url = `/api/auth/login?username=${encodeURIComponent(username)}&recaptcha=`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'X-Password': password, 'X-Secret': '' },
    credentials: 'same-origin',
  })
  if (!response.ok) throw await apiError(response)
}

export async function logout() {
  const response = await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
  })
  if (!response.ok) throw await apiError(response)
}

export async function getCurrentUser() {
  const response = await fetch('/api/users?id=self', { credentials: 'same-origin' })
  if (!response.ok) throw await apiError(response)
  return response.json()
}
