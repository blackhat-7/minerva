// Scene and code visuals, the pure parts: what a scene shows at each step and where it is drawn, arrows that
// bend around actors, numbers that count up, code lines to mark, and which step goes with the sentence read aloud.
import spec from '../../shared/scene.json'
import type { Actor, Color, Flow, Step } from './lesson'
import { sentences } from './speech'

export const PALETTE: Record<Color, string> = {
  blue: 'var(--color-chart-1)',
  pink: 'var(--color-chart-2)',
  green: 'var(--color-chart-3)',
  yellow: 'var(--color-chart-4)',
  purple: 'var(--color-chart-5)',
  cyan: 'var(--color-chart-6)',
  gray: 'var(--color-muted)',
}

/** Copies drawn for an actor's count; a larger count also shows "×N". */
export const STACK = 6

const ICONS = new Set(spec.icons)
const int = (v: unknown, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number(v)) || 0))
const level = (v: unknown) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Math.min(1, Math.max(0, Number(v))))
const isColor = (c: unknown): c is Color => typeof c === 'string' && c in PALETTE

/** The actors that can be drawn: one per id and per grid cell, unknown icons as dots, unknown colors blue. */
export function stageActors(actors: Actor[]): Actor[] {
  const ids = new Set<string>()
  const cells = new Set<string>()
  return actors.flatMap((a) => {
    const col = int(a.col, 0, spec.cols - 1)
    const row = int(a.row, 0, spec.rows - 1)
    if (!a.id || ids.has(a.id) || cells.has(`${col},${row}`)) return []
    ids.add(a.id)
    cells.add(`${col},${row}`)
    return [{ ...a, col, row, icon: ICONS.has(a.icon) ? a.icon : '', color: isColor(a.color) ? a.color : 'blue' }]
  })
}

export type ActorState = { value: string; count: number; level: number | null }
export type SceneFlow = { path: string[]; label: string; speed: Flow['speed']; color: Color }
export type SceneState = {
  shown: Set<string>
  actors: Map<string, ActorState>
  links: [string, string][] // arrows between shown actors
  flows: SceneFlow[] // this step's, through shown actors
  highlight: Set<string>
}

const pairs = (path: string[]) => path.slice(1).flatMap((b, i): [string, string][] => (path[i] === b ? [] : [[path[i], b]]))

/** Every arrow the steps draw, once each, in order. Ids of unknown actors are skipped. */
export function allLinks(actors: Actor[], steps: Step[]): [string, string][] {
  const known = new Set(actors.map((a) => a.id))
  const links = new Map<string, [string, string]>()
  for (const path of steps.flatMap((s) => s.link))
    for (const [a, b] of pairs(path.filter((id) => known.has(id)))) links.set(`${a}→${b}`, [a, b])
  return [...links.values()]
}

/** The scene at step k: the initial actors with steps 0..k applied. Links, shows, hides and changes add up;
 * flows and highlights are step k's own. Ids of unknown actors are ignored. */
export function sceneAt(actors: Actor[], steps: Step[], k: number): SceneState {
  const known = new Map(actors.map((a) => [a.id, a]))
  const ids = (list: string[]) => list.filter((id) => known.has(id))
  const later = new Set(steps.flatMap((s) => s.show))
  const shown = new Set(actors.filter((a) => !later.has(a.id)).map((a) => a.id))
  const state = new Map(actors.map((a) => [a.id, { value: a.value, count: int(a.count, 1, 9999), level: level(a.level) }]))
  for (const s of steps.slice(0, k + 1)) {
    ids(s.show).forEach((id) => shown.add(id))
    ids(s.hide).forEach((id) => shown.delete(id))
    for (const c of s.change) {
      const now = state.get(c.id)
      if (now)
        state.set(c.id, {
          value: c.value ?? now.value,
          count: c.count === null ? now.count : int(c.count, 1, 9999),
          level: level(c.level) ?? now.level,
        })
    }
  }
  const step: Step | undefined = steps[k]
  const flows = (step?.flow ?? []).flatMap((f): SceneFlow[] => {
    const path = ids(f.path).filter((id, i, all) => shown.has(id) && id !== all[i - 1])
    if (path.length < 2) return []
    const speed = ['slow', 'medium', 'fast'].includes(f.speed) ? f.speed : 'medium'
    return [{ path, label: f.label, speed, color: isColor(f.color) ? f.color : known.get(path[0])!.color }]
  })
  return {
    shown,
    actors: state,
    links: allLinks(actors, steps.slice(0, k + 1)).filter(([a, b]) => shown.has(a) && shown.has(b)),
    flows,
    highlight: new Set(ids(step?.highlight ?? []).filter((id) => shown.has(id))),
  }
}

/** Where things go on the stage, in px. Rows have a fixed height, so the stage keeps its size at every step. */
export type Layout = {
  width: number
  height: number
  cell: number // column width
  row: number // row height
  tile: number // icon tile size
  top: number // space above a tile in its row: for stacked copies, and arrows arching over it
  stackStep: number // offset between stacked copies
  font: number // label size
  line: number // label line height
  valueFont: number
  valueLine: number
  levels: boolean // some actor has a meter at some step
  values: boolean // some actor has a value at some step
}

const MAX_CELL = 240 // wider cards center a narrower stage instead of spreading few columns out
export const TEXT_GAP = 6 // between a tile and its text
export const METER = 10 // a level meter with the space around it
const ROW_GAP = 40 // at least, between a row's text and the next row's tiles: room for an arrow

export function layout(width: number, actors: Actor[], steps: Step[]): Layout {
  const cols = Math.max(1, ...actors.map((a) => a.col + 1))
  const rows = Math.max(1, ...actors.map((a) => a.row + 1))
  const changes = steps.flatMap((s) => s.change)
  const cell = Math.min(MAX_CELL, width / cols)
  const tile = Math.round(Math.min(64, Math.max(44, cell * 0.5)))
  const stackStep = Math.round(tile * 0.08)
  const stacks = [...actors, ...changes].some((a) => (a.count ?? 1) > 1)
  const levels = [...actors, ...changes].some((a) => level(a.level) !== null)
  const values = [...actors, ...changes].some((a) => a.value)
  const font = cell < 110 ? 12 : cell < 170 ? 13 : 14
  const valueFont = font - 1
  const line = Math.round(font * 1.3)
  const valueLine = Math.round(valueFont * 1.4)
  const top = Math.max(Math.round(tile * 0.6), stacks ? (STACK - 1) * stackStep + 6 : 0)
  const row = top + tile + TEXT_GAP + (levels ? METER : 0) + 2 * line + (values ? valueLine : 0) + Math.max(16, ROW_GAP - top)
  return { width: cols * cell, height: rows * row, cell, row, tile, top, stackStep, font, line, valueFont, valueLine, levels, values }
}

export type Pt = { x: number; y: number }
export type Box = { x0: number; y0: number; x1: number; y1: number }

/** The middle of an actor's tile: where its arrows point. */
export const center = (l: Layout, a: Actor): Pt => ({ x: (a.col + 0.5) * l.cell, y: a.row * l.row + l.top + l.tile / 2 })

/** An icon's tile, or the smaller plain dot drawn when it has none. */
export const iconSize = (l: Layout, a: Actor) => (a.icon ? l.tile : Math.round(l.tile * 0.45))

/** What arrows and labels keep clear of, for each actor: its tile with any stacked copies, and the text under it
 * (meter, label and value; text widths estimated). Sized for every step, so arrows don't move between steps. */
export function footprints(l: Layout, actors: Actor[], steps: Step[]): Box[][] {
  const changes = steps.flatMap((s) => s.change)
  return actors.map((a) => {
    const states = [a, ...changes.filter((c) => c.id === a.id)]
    const values = states.flatMap((x) => (x.value ? [x.value] : []))
    const hasLevel = states.some((x) => level(x.level) !== null)
    const stack = states.some((x) => (x.count ?? 1) > 1) ? (STACK - 1) * l.stackStep : 0
    const c = center(l, a)
    const half = iconSize(l, a) / 2
    const room = l.cell - 8
    const labelWidth = a.label.length * l.font * 0.55
    const valueWidth = Math.max(0, ...values.map((v) => v.length * l.valueFont * 0.6))
    const textWidth = Math.min(room, Math.max(labelWidth, valueWidth, hasLevel ? l.tile : 0))
    const text = (labelWidth > room ? 2 : a.label ? 1 : 0) * l.line + (values.length ? l.valueLine : 0)
    const bottom = c.y + l.tile / 2 + (l.levels ? METER : 0) + (text ? TEXT_GAP + text : 0)
    const boxes = [{ x0: c.x - half, y0: c.y - half - stack, x1: c.x + half, y1: c.y + half }]
    if (hasLevel || text) boxes.push({ x0: c.x - textWidth / 2, y0: c.y + l.tile / 2, x1: c.x + textWidth / 2, y1: bottom })
    return boxes
  })
}

/** A quadratic Bézier curve; a straight line when `c` is on the line between the ends. */
export type Curve = { from: Pt; c: Pt; to: Pt }

export function pointAt(q: Curve, t: number): Pt {
  const u = 1 - t
  return { x: u * u * q.from.x + 2 * u * t * q.c.x + t * t * q.to.x, y: u * u * q.from.y + 2 * u * t * q.c.y + t * t * q.to.y }
}

/** The piece of `q` between t0 and t1, itself a quadratic curve. */
function piece(q: Curve, t0: number, t1: number): Curve {
  const blossom = (k: 'x' | 'y') =>
    (1 - t0) * (1 - t1) * q.from[k] + ((1 - t0) * t1 + t0 * (1 - t1)) * q.c[k] + t0 * t1 * q.to[k]
  return { from: pointAt(q, t0), c: { x: blossom('x'), y: blossom('y') }, to: pointAt(q, t1) }
}

const within = (p: Pt, boxes: Box[], grow: number) =>
  boxes.some((b) => p.x > b.x0 - grow && p.x < b.x1 + grow && p.y > b.y0 - grow && p.y < b.y1 + grow)

const END_GAP = 4 // between an arrow's ends and its actors
const CLEARANCE = 6 // an arrow keeps this far from other actors
// Control point offsets to try, as a share of the length: half that is how far the curve's middle moves.
const BENDS = [0, 0.15, -0.15, 0.25, -0.25, 0.35, -0.35, 0.45, -0.45, 0.6, -0.6, 0.8, -0.8, 1, -1]
const SAMPLES = 32

/** The first t, going from `start` toward `end`, where the curve is clear of `boxes` (grown by END_GAP). */
function leave(q: Curve, boxes: Box[], start: number, end: number): number {
  let inside = start
  for (let i = 1; i <= SAMPLES * 2; i++) {
    const t = start + ((end - start) * i) / (SAMPLES * 2)
    if (within(pointAt(q, t), boxes, END_GAP)) {
      inside = t
      continue
    }
    let outside = t
    for (let j = 0; j < 12; j++) {
      const mid = (inside + outside) / 2
      if (within(pointAt(q, mid), boxes, END_GAP)) inside = mid
      else outside = mid
    }
    return outside
  }
  return end
}

/** How many points of the curve run through other actors, back through its own, or off the stage. */
function collisions(q: Curve, own: Box[], others: Box[], stage: Box): number {
  let hits = 0
  for (let i = 0; i <= SAMPLES; i++) {
    const p = pointAt(q, i / SAMPLES)
    const off = p.x < stage.x0 || p.x > stage.x1 || p.y < stage.y0 || p.y > stage.y1
    if (off || within(p, others, CLEARANCE) || (i > 0 && i < SAMPLES && within(p, own, 0))) hits++
  }
  return hits
}

/** The arrow from a to b: the straight line between their tiles, or if that runs through another actor, the
 * gentlest bend that misses them all and stays on the stage. It starts and ends just outside a and b; null if
 * they are too close for one. */
export function route(a: Pt, b: Pt, aBoxes: Box[], bBoxes: Box[], others: Box[], stage: Box): Curve | null {
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  if (!length) return null
  const normal = { x: (a.y - b.y) / length, y: (b.x - a.x) / length }
  let best: { q: Curve; hits: number } | null = null
  for (const bend of BENDS) {
    const c = { x: (a.x + b.x) / 2 + normal.x * bend * length, y: (a.y + b.y) / 2 + normal.y * bend * length }
    const whole = { from: a, c, to: b }
    const t0 = leave(whole, aBoxes, 0, 1)
    const t1 = leave(whole, bBoxes, 1, 0)
    if (t0 >= t1) continue
    const q = piece(whole, t0, t1)
    const hits = collisions(q, [...aBoxes, ...bBoxes], others, stage)
    if (!hits) return q
    if (!best || hits < best.hits) best = { q, hits }
  }
  return best?.q ?? null
}

/** Arrows for every pair of actors the scene links or sends flows between, keyed "a→b" (both directions share
 * one curve, so a flow runs along its link). `boxes` are the actors' footprints. Every actor is an obstacle,
 * shown yet or not, so arrows don't move when actors appear. */
export function routeAll(l: Layout, actors: Actor[], steps: Step[], boxes: Box[][]): Map<string, Curve | null> {
  const index = new Map(actors.map((a, i) => [a.id, i]))
  const stage = { x0: 0, y0: 0, x1: l.width, y1: l.height }
  const routes = new Map<string, Curve | null>()
  const paths = steps.flatMap((s) => [...s.link, ...s.flow.map((f) => f.path)])
  for (const path of paths)
    for (const [a, b] of pairs(path.filter((id) => index.has(id)))) {
      if (routes.has(`${a}→${b}`)) continue
      const [i, j] = [index.get(a)!, index.get(b)!].sort((x, y) => x - y)
      const others = boxes.filter((_, k) => k !== i && k !== j).flat()
      const q = route(center(l, actors[i]), center(l, actors[j]), boxes[i], boxes[j], others, stage)
      const back = q && { from: q.to, c: q.c, to: q.from }
      routes.set(`${actors[i].id}→${actors[j].id}`, q)
      routes.set(`${actors[j].id}→${actors[i].id}`, back)
    }
  return routes
}

/** Where to center a flow's w × h label: the middle of its hop, or the nearest spot around it that is clear of
 * every actor and on the stage (a hop between neighbors on a phone is shorter than its label); the middle if
 * nothing near is clear. */
export function tagSpot(q: Curve, w: number, h: number, boxes: Box[], stage: Box): Pt {
  const mid = pointAt(q, 0.5)
  const spots: Pt[] = []
  for (let dx = -60; dx <= 60; dx += 4) for (let dy = -80; dy <= 80; dy += 4) spots.push({ x: mid.x + dx, y: mid.y + dy })
  const clear = ({ x, y }: Pt) =>
    x - w / 2 >= stage.x0 &&
    x + w / 2 <= stage.x1 &&
    y - h / 2 >= stage.y0 &&
    y + h / 2 <= stage.y1 &&
    boxes.every((b) => x + w / 2 < b.x0 - 2 || x - w / 2 > b.x1 + 2 || y + h / 2 < b.y0 - 2 || y - h / 2 > b.y1 + 2)
  const away = (p: Pt) => Math.hypot(p.x - mid.x, p.y - mid.y)
  return spots.sort((a, b) => away(a) - away(b)).find(clear) ?? mid
}

const n = (v: number) => Math.round(v * 10) / 10

export const curvePath = (q: Curve) => `M${n(q.from.x)} ${n(q.from.y)}Q${n(q.c.x)} ${n(q.c.y)} ${n(q.to.x)} ${n(q.to.y)}`

export function curveLength(q: Curve): number {
  let length = 0
  for (let i = 1, p = q.from; i <= 16; i++) {
    const next = pointAt(q, i / 16)
    length += Math.hypot(next.x - p.x, next.y - p.y)
    p = next
  }
  return length
}

/** A value split around its number: "~1.5 ms" → "~", 1.5, " ms". */
function quantity(text: string) {
  const m = /^(.*?)(-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?)(.*)$/s.exec(text)
  if (!m) return null
  return { prefix: m[1], number: Number(m[2].replaceAll(',', '')), decimals: m[3]?.length ?? 0, grouped: m[2].includes(','), unit: m[4] }
}

const singular = (unit: string) => unit.trim().replace(/(\p{L}{3,})s\b/gu, '$1')

/** How a value counts from `from` to `to`: the text at progress t (0 to 1), or null unless both are numbers with
 * the same words around them, plural or not ("1 request" → "8 requests" counts, "128 KiB" → "16 GiB" doesn't). */
export function counter(from: string, to: string): ((t: number) => string) | null {
  const [a, b] = [quantity(from), quantity(to)]
  if (!a || !b || from === to || a.prefix.trim() !== b.prefix.trim() || singular(a.unit) !== singular(b.unit)) return null
  const [one, many] = a.unit.length <= b.unit.length ? [a.unit, b.unit] : [b.unit, a.unit]
  const digits = { minimumFractionDigits: b.decimals, maximumFractionDigits: b.decimals }
  return (t) => {
    if (t >= 1) return to
    const value = a.number + (b.number - a.number) * t
    const number = b.grouped ? value.toLocaleString('en-US', digits) : value.toFixed(b.decimals)
    return b.prefix + number + (number === '1' ? one : many)
  }
}

/** "3-5,8" → [[3, 5], [8, 8]]: sorted, merged line ranges within 1..count. Parts that aren't lines are skipped. */
export function lineRanges(lines: string, count: number): [number, number][] {
  const ranges = lines.split(',').flatMap((part): [number, number][] => {
    const m = /^\s*(\d+)\s*(?:[-–]\s*(\d+)\s*)?$/.exec(part)
    if (!m) return []
    const [a, b] = [Number(m[1]), Number(m[2] ?? m[1])]
    const [lo, hi] = [Math.max(1, Math.min(a, b)), Math.min(count, Math.max(a, b))]
    return lo <= hi ? [[lo, hi]] : []
  })
  const merged: [number, number][] = []
  for (const [lo, hi] of ranges.sort((x, y) => x[0] - y[0])) {
    const last = merged.at(-1)
    if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi)
    else merged.push([lo, hi])
  }
  return merged
}

/** Lowercase words and numbers, punctuation dropped, single spaces: how the backend (scene.py `_words`) matches a
 * step's `at` words to the narration, so a comma the model left out doesn't lose the step. */
const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** The narration sentence (an index into `sentences(narration)`) each step starts at: the one its `at` words
 * are in, looked for from where the previous step's were found. Words that are "" or not found start the step
 * with the one before (step 0 at sentence 0). */
export function stepStarts(narration: string, steps: Pick<Step, 'at'>[]): number[] {
  const starts: number[] = [] // where each sentence begins in `text`
  let text = ''
  for (const s of sentences(narration)) {
    if (text) text += ' '
    starts.push(text.length)
    text += normalize(s)
  }
  let from = 0
  let sentence = 0
  return steps.map(({ at }) => {
    const words = normalize(at)
    const found = words ? text.indexOf(words, from) : -1
    if (found >= 0) {
      from = found
      sentence = starts.findLastIndex((s) => s <= found)
    }
    return sentence
  })
}

/** The step to show while sentence `sentence` is read: the last one starting at or before it, or -1 (the scene
 * before any step) while the voice hasn't reached the first one. */
export const stepAt = (starts: number[], sentence: number) => starts.findLastIndex((s) => s <= sentence)
