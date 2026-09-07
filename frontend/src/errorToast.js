import { reactive } from 'vue'

let nextId = 0
export const errorToasts = reactive([])

export function showError(message) {
  const id = nextId++
  errorToasts.push({ id, message })
  setTimeout(() => {
    const index = errorToasts.findIndex((t) => t.id === id)
    if (index !== -1) errorToasts.splice(index, 1)
  }, 5000)
}
