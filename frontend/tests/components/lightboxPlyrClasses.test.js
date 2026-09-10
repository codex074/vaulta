import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The lightbox lifts its size caps while Plyr is fullscreen by excluding the
// fullscreen state in CSS. That only works if the selector matches something
// Plyr actually sets: a class name Plyr never adds (this bit us with
// `.plyr--fullscreen-active`) silently leaves the caps on, and "fullscreen"
// becomes a 75vh box on a black screen. Every `plyr--*` class the lightbox
// styles reference must exist in Plyr's own stylesheet.
describe('Lightbox Plyr selectors', () => {
  it('only references plyr-- classes that Plyr 3.x really uses', () => {
    const lightbox = readFileSync(resolve(__dirname, '../../src/components/Lightbox.vue'), 'utf8')
    const plyrCss = readFileSync(resolve(__dirname, '../../node_modules/plyr/dist/plyr.css'), 'utf8')
    const style = lightbox.slice(lightbox.indexOf('<style'))
    const referenced = [...new Set(style.match(/plyr--[a-z-]+/g) ?? [])]
    expect(referenced.length).toBeGreaterThan(0)
    const missing = referenced.filter((cls) => !plyrCss.includes(`.${cls}`))
    expect(missing).toEqual([])
  })

  it('drops the caps in native fullscreen, not only in the CSS fallback', () => {
    const lightbox = readFileSync(resolve(__dirname, '../../src/components/Lightbox.vue'), 'utf8')
    const style = lightbox.slice(lightbox.indexOf('<style'))
    expect(style).toMatch(/\.plyr:not\(:fullscreen\)/)
  })
})
