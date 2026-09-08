// A dialog owns keyboard focus until it closes. Keep this independent of
// its visual presentation (a centered panel or a compact bottom sheet).
const states = new WeakMap()
const selector = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'
export const dialogFocus = {
  mounted(element, binding) {
    const previous = document.activeElement
    const focusable = () => Array.from(element.querySelectorAll('*')).filter(node => node.matches(selector) && !node.hidden && node.type !== 'hidden' && getComputedStyle(node).display !== 'none')
    element.tabIndex = -1
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        binding.value?.()
      }
      if (event.key !== 'Tab') return
      const nodes = focusable()
      const first = nodes[0] || element
      const last = nodes.at(-1) || element
      if (event.shiftKey && (document.activeElement === first || document.activeElement === element)) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === element)) {
        event.preventDefault(); first.focus()
      }
    }
    element.addEventListener('keydown', onKey)
    states.set(element, { previous, onKey })
    queueMicrotask(() => {
      if (element.isConnected) (element.querySelector('[autofocus]') || focusable()[0] || element).focus({ preventScroll: true })
    })
  },
  unmounted(element) {
    const state = states.get(element)
    element.removeEventListener('keydown', state.onKey)
    if (state.previous?.isConnected) state.previous.focus({ preventScroll: true })
    states.delete(element)
  },
}
