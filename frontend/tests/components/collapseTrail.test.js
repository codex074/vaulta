import { describe, it, expect } from 'vitest'
import { collapseTrail } from '../../src/components/pathHelpers.js'

const c = (...labels) => labels.map((label) => ({ label, path: '/' + label }))

describe('collapseTrail', () => {
  it('returns everything, nothing hidden, for a root-only path', () => {
    expect(collapseTrail(c('Root'), 2)).toEqual({ lead: { label: 'Root', path: '/Root' }, hidden: [], tail: [] })
  })

  it('shows all crumbs with no ellipsis when depth is at or below tail+1', () => {
    const crumbs = c('Root', 'A', 'B') // lead + 2 tail = 3 = tail+1
    const t = collapseTrail(crumbs, 2)
    expect(t.hidden).toEqual([])
    expect(t.tail.map((x) => x.label)).toEqual(['A', 'B'])
  })

  it('hides the middle once the path is deeper than tail+1', () => {
    const crumbs = c('Root', 'A', 'B', 'C', 'D')
    const t = collapseTrail(crumbs, 2)
    expect(t.lead.label).toBe('Root')
    expect(t.hidden.map((x) => x.label)).toEqual(['A', 'B'])
    expect(t.tail.map((x) => x.label)).toEqual(['C', 'D'])
  })

  it('handles an empty crumb list', () => {
    expect(collapseTrail([], 2)).toEqual({ lead: null, hidden: [], tail: [] })
  })
})
