import { describe, expect, it } from 'vitest'
import spec from '../../shared/scene.json'
import { highlight } from './highlight'
import type { Actor, Step } from './lesson'
import {
  center,
  counter,
  footprints,
  layout,
  lineRanges,
  pointAt,
  route,
  routeAll,
  sceneAt,
  stageActors,
  stepAt,
  stepStarts,
  tagSpot,
  type Box,
  type Curve,
} from './scene'
import { sceneIcons } from './sceneIcons'
import { sentences } from './speech'

const actor = (id: string, col: number, row: number, more: Partial<Actor> = {}): Actor => ({
  id,
  label: id,
  icon: 'cpu',
  color: 'blue',
  col,
  row,
  value: '',
  count: 1,
  level: null,
  ...more,
})

const step = (more: Partial<Step> = {}): Step => ({
  at: '',
  caption: '',
  lines: '',
  show: [],
  hide: [],
  link: [],
  flow: [],
  highlight: [],
  change: [],
  ...more,
})

describe('scene.json', () => {
  it('has a Lucide component for every icon name', () => {
    expect(spec.icons.filter((name) => typeof sceneIcons[name] !== 'object')).toEqual([])
    expect(Object.keys(sceneIcons).sort()).toEqual([...spec.icons].sort())
  })

  it('highlights every code language but plaintext', () => {
    expect(spec.languages.filter((l) => (highlight('x = 1', l) === null) !== (l === 'plaintext'))).toEqual([])
    expect(highlight('<b>"&', 'xml')).not.toContain('<b>')
  })
})

describe('stageActors', () => {
  it('keeps one actor per id and per cell, inside the grid, with known icons and colors', () => {
    const actors = stageActors([
      actor('a', 0, 0),
      actor('a', 1, 0),
      actor('b', 0, 0),
      actor('c', 9, -2, { icon: 'no-such-icon', color: 'teal' as Actor['color'] }),
    ])
    expect(actors.map((a) => [a.id, a.col, a.row, a.icon, a.color])).toEqual([
      ['a', 0, 0, 'cpu', 'blue'],
      ['c', spec.cols - 1, 0, '', 'blue'],
    ])
  })
})

describe('sceneAt', () => {
  const actors = [actor('a', 0, 0, { value: '1 request' }), actor('b', 1, 0), actor('c', 2, 0)]
  const steps = [
    step({ link: [['a', 'b']], flow: [{ path: ['a', 'b'], label: 'x', speed: 'slow', color: '' }], highlight: ['a'] }),
    step({ show: ['c'], link: [['b', 'c', 'nope']], change: [{ id: 'a', value: '8 requests', count: 8, level: null }] }),
    step({ hide: ['b'], change: [{ id: 'a', value: null, count: null, level: 2 }, { id: 'zz', value: 'x', count: 1, level: 1 }] }),
  ]

  it('shows actors no step shows from the start', () => {
    expect([...sceneAt(actors, steps, 0).shown]).toEqual(['a', 'b'])
    expect([...sceneAt(actors, steps, 1).shown]).toEqual(['a', 'b', 'c'])
  })

  it('adds up links and changes, keeps flows and highlights to their own step', () => {
    const s0 = sceneAt(actors, steps, 0)
    expect(s0.links).toEqual([['a', 'b']])
    expect(s0.flows).toEqual([{ path: ['a', 'b'], label: 'x', speed: 'slow', color: 'blue' }])
    expect([...s0.highlight]).toEqual(['a'])
    const s1 = sceneAt(actors, steps, 1)
    expect(s1.links).toEqual([['a', 'b'], ['b', 'c']])
    expect(s1.flows).toEqual([])
    expect(s1.highlight.size).toBe(0)
    expect(s1.actors.get('a')).toEqual({ value: '8 requests', count: 8, level: null })
  })

  it('drops arrows to hidden actors, keeps unchanged fields and clamps levels', () => {
    const s2 = sceneAt(actors, steps, 2)
    expect(s2.links).toEqual([])
    expect(s2.actors.get('a')).toEqual({ value: '8 requests', count: 8, level: 1 })
    expect(s2.actors.has('zz')).toBe(false)
  })

  it('is the initial scene without steps', () => {
    const s = sceneAt(actors, [], 0)
    expect([...s.shown]).toEqual(['a', 'b', 'c'])
    expect(s.links).toEqual([])
  })
})

describe('layout', () => {
  it('uses the columns and rows the actors occupy and fills the width', () => {
    const l = layout(400, [actor('a', 0, 0), actor('b', 3, 1)], [])
    expect(l.width).toBe(400)
    expect(l.cell).toBe(100)
    expect(l.height).toBe(2 * l.row)
    expect(l.font).toBeGreaterThanOrEqual(12)
  })

  it('centers a narrower stage when a few columns would spread too far', () => {
    expect(layout(1000, [actor('a', 0, 0), actor('b', 1, 0)], []).width).toBeLessThan(600)
  })

  it('makes rows room for every value, meter and stack any step brings', () => {
    const actors = [actor('a', 0, 0)]
    const plain = layout(400, actors, []).row
    const changed = layout(400, actors, [step({ change: [{ id: 'a', value: '1 GB', count: 9, level: 0.5 }] })]).row
    expect(changed).toBeGreaterThan(plain)
  })
})

const inside = (p: { x: number; y: number }, b: Box) => p.x > b.x0 && p.x < b.x1 && p.y > b.y0 && p.y < b.y1
const samples = (q: Curve) => Array.from({ length: 21 }, (_, i) => pointAt(q, i / 20))
const box = (x: number, y: number, r = 20): Box => ({ x0: x - r, y0: y - r, x1: x + r, y1: y + r })
const stage = { x0: 0, y0: 0, x1: 600, y1: 400 }

describe('route', () => {
  it('is a straight line trimmed to just outside both ends when nothing is in the way', () => {
    const q = route({ x: 50, y: 100 }, { x: 250, y: 100 }, [box(50, 100)], [box(250, 100)], [box(150, 300)], stage)!
    expect(q.from.y).toBeCloseTo(100)
    expect(q.to.y).toBeCloseTo(100)
    expect(q.from.x).toBeGreaterThan(70)
    expect(q.from.x).toBeLessThan(80)
    expect(q.to.x).toBeGreaterThan(220)
    expect(q.to.x).toBeLessThan(230)
    expect(q.c.y).toBeCloseTo(100)
  })

  it('bends gently around an actor in the way', () => {
    const blocker = box(150, 100)
    const q = route({ x: 50, y: 100 }, { x: 250, y: 100 }, [box(50, 100)], [box(250, 100)], [blocker], stage)!
    expect(samples(q).some((p) => inside(p, { x0: 124, y0: 74, x1: 176, y1: 126 }))).toBe(false)
    expect(Math.abs(q.c.y - 100)).toBeLessThan(150)
  })

  it('stays on the stage: a link along the top row bends down', () => {
    const q = route({ x: 50, y: 30 }, { x: 250, y: 30 }, [box(50, 30)], [box(250, 30)], [box(150, 30)], stage)!
    expect(samples(q).every((p) => p.y >= 0)).toBe(true)
    expect(q.c.y).toBeGreaterThan(30)
  })

  it('is null when the ends overlap', () => {
    expect(route({ x: 50, y: 50 }, { x: 60, y: 50 }, [box(50, 50)], [box(60, 50)], [], stage)).toBeNull()
  })
})

describe('routeAll', () => {
  it('routes links and flows once per pair, the reverse along the same curve, past the actors between', () => {
    const actors = [actor('a', 0, 1), actor('b', 1, 1), actor('c', 2, 1)]
    const steps = [step({ link: [['a', 'c']], flow: [{ path: ['c', 'a'], label: '', speed: 'fast', color: '' }] })]
    const l = layout(600, actors, steps)
    const routes = routeAll(l, actors, steps, footprints(l, actors, steps))
    const there = routes.get('a→c')!
    expect(routes.get('c→a')).toEqual({ from: there.to, c: there.c, to: there.from })
    const b = center(l, actors[1])
    expect(samples(there).some((p) => inside(p, box(b.x, b.y, l.tile / 2)))).toBe(false)
  })
})

describe('footprints', () => {
  it('cover the tile, any stacked copies above it, and the text below', () => {
    const actors = [actor('a', 0, 0, { label: 'A long label here', value: '8 GB' }), actor('b', 1, 0, { label: '' })]
    const steps = [step({ change: [{ id: 'a', value: null, count: 3, level: null }] })]
    const l = layout(400, actors, steps)
    const [a, b] = footprints(l, actors, steps)
    const c = center(l, actors[0])
    expect(a[0].y0).toBeLessThan(c.y - l.tile / 2)
    expect(a[1].y1).toBeGreaterThan(c.y + l.tile / 2 + 2 * l.line)
    expect(a[1].x1 - a[1].x0).toBeLessThanOrEqual(l.cell - 8)
    expect(b).toHaveLength(1)
  })
})

describe('tagSpot', () => {
  const q = { from: { x: 80, y: 100 }, c: { x: 110, y: 100 }, to: { x: 140, y: 100 } }

  it('is the middle of the hop when the label fits there', () => {
    expect(tagSpot(q, 40, 20, [box(40, 100), box(180, 100)], stage)).toEqual({ x: 110, y: 100 })
  })

  it('moves a label that would cover an actor to the nearest clear spot', () => {
    const p = tagSpot(q, 80, 20, [box(60, 100), box(160, 100)], stage)
    expect(p).toEqual({ x: 110, y: 64 })
    const q2 = { ...q, from: { x: 80, y: 30 }, c: { x: 110, y: 30 }, to: { x: 140, y: 30 } }
    expect(tagSpot(q2, 80, 20, [box(60, 30), box(160, 30), box(110, 60, 16)], stage).y).toBeGreaterThan(80)
  })

  it('stays on the stage', () => {
    const p = tagSpot({ from: { x: 0, y: 10 }, c: { x: 5, y: 10 }, to: { x: 10, y: 10 } }, 60, 20, [], stage)
    expect(p.x).toBeGreaterThanOrEqual(30)
    expect(p.y).toBeGreaterThanOrEqual(10)
  })
})

describe('counting values', () => {
  it('counts between numbers with the same unit, plural or not, written like the target', () => {
    const up = counter('1 request', '8 requests')!
    expect([0, 0.5, 0.99, 1].map(up)).toEqual(['1 request', '5 requests', '8 requests', '8 requests'])
    expect(counter('8 requests', '1 request')!(0.5)).toBe('5 requests')
    expect(counter('90%', '35%')!(0.5)).toBe('63%')
    expect(counter('1,024 tokens', '2,048 tokens')!(0.5)).toBe('1,536 tokens')
    expect(counter('~1 ms', '~2.5 ms')!(0.2)).toBe('~1.3 ms')
  })

  it('does not count between different units, words or equal values', () => {
    expect(counter('128 KiB', '16 GiB')).toBeNull()
    expect(counter('busy', '8 requests')).toBeNull()
    expect(counter('8 GB', '8 GB')).toBeNull()
  })
})

describe('lineRanges', () => {
  it('parses, sorts, clamps and merges', () => {
    expect(lineRanges('8, 3-5', 10)).toEqual([[3, 5], [8, 8]])
    expect(lineRanges('5-3,4,6', 10)).toEqual([[3, 6]])
    expect(lineRanges('9-12, x, 0, 2–2', 10)).toEqual([[2, 2], [9, 10]])
    expect(lineRanges('', 10)).toEqual([])
  })
})

describe('narration sync', () => {
  const narration =
    'A GPU keeps the weights in “HBM” memory. To make one token, the cores read every weight! ' +
    'They mostly wait.  Batching helps: one read serves eight requests. The cores get busier.'

  it('matches the sentences the TTS reads', () => {
    expect(sentences(narration)).toHaveLength(5)
  })

  it('starts each step at the sentence holding its words, normalized like the backend', () => {
    const steps = [
      { at: 'keeps the weights in "hbm"' },
      { at: '“To make ONE token,' },
      { at: '' },
      { at: 'batching   helps' },
      { at: 'not in the narration' },
      { at: 'the cores' },
    ]
    expect(stepStarts(narration, steps)).toEqual([0, 1, 1, 3, 3, 4])
  })

  it('ignores punctuation the model dropped or added inside the words', () => {
    expect(stepStarts(narration, [{ at: 'batching helps one read' }, { at: 'the cores, get busier!' }])).toEqual([3, 4])
  })

  it('looks for words after the previous step’s, so a repeated phrase moves forward', () => {
    expect(stepStarts(narration, [{ at: 'the cores' }, { at: 'the cores' }])).toEqual([1, 1])
    expect(stepStarts(narration, [{ at: 'they mostly wait' }, { at: 'the cores' }])).toEqual([2, 4])
  })

  it('starts everything at sentence 0 without narration', () => {
    expect(stepStarts('', [{ at: 'x' }, { at: '' }])).toEqual([0, 0])
  })

  it('shows the last step that has started, or none before the first', () => {
    const starts = [0, 1, 1, 3, 3, 4]
    expect(stepAt(starts, 0)).toBe(0)
    expect(stepAt(starts, 2)).toBe(2)
    expect(stepAt(starts, 3)).toBe(4)
    expect(stepAt(starts, 9)).toBe(5)
    expect(stepAt([2, 3], 0)).toBe(-1) // the scene before any step until the voice reaches step 1
  })
})
