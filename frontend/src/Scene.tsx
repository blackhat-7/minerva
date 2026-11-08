// A scene: icons on a small grid that appear, link up, pass things along and change as its steps go, drawn
// flat and bright on the dark card. What it shows at each step, and where, comes from scene.ts.
import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import type { Actor, Step } from './lesson'
import {
  METER,
  PALETTE,
  STACK,
  TEXT_GAP,
  allLinks,
  counter,
  curveLength,
  curvePath,
  footprints,
  iconSize,
  layout,
  pointAt,
  routeAll,
  sceneAt,
  stageActors,
  tagSpot,
  type ActorState,
  type Box,
  type Curve,
  type Layout,
  type SceneFlow,
} from './scene'
import { sceneIcons } from './sceneIcons'
import { useWidth } from './widgets/useWidth'

const SPEED = { slow: 0.2, medium: 0.55, fast: 1.5 } // flows, in columns per second
const COUNT_MS = 700 // a number counting to its new value
const TAG_MS = 1600 // at least, for a flow's label to drift across the middle of its hop

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
const onMotionChange = (notify: () => void) => {
  reducedMotion.addEventListener('change', notify)
  return () => reducedMotion.removeEventListener('change', notify)
}

type Stream = SceneFlow & { curves: Curve[]; linked: boolean[] }

export function Scene({ actors, steps, step }: { actors: Actor[]; steps: Step[]; step: number }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const cast = useMemo(() => stageActors(actors), [actors])
  const l = useMemo(() => layout(width, cast, steps), [width, cast, steps])
  const boxes = useMemo(() => footprints(l, cast, steps), [l, cast, steps])
  const routes = useMemo(() => routeAll(l, cast, steps, boxes), [l, cast, steps, boxes])
  const links = useMemo(() => allLinks(cast, steps), [cast, steps])
  const now = useMemo(() => sceneAt(cast, steps, step), [cast, steps, step])
  const still = useSyncExternalStore(onMotionChange, () => reducedMotion.matches)

  const linked = new Set(now.links.map(([a, b]) => `${a}→${b}`))
  const streams = now.flows.map((f): Stream => {
    const hops = f.path.slice(1).map((b, i) => `${f.path[i]}→${b}`).filter((hop) => routes.get(hop))
    return { ...f, curves: hops.map((hop) => routes.get(hop)!), linked: hops.map((hop) => linked.has(hop)) }
  })
  const box = { width: l.width, height: l.height }

  return (
    <div ref={ref}>
      <div className="relative mx-auto" style={box}>
        <svg aria-hidden {...box} className="absolute inset-0 overflow-visible">
          {links.map(([a, b]) => {
            const q = routes.get(`${a}→${b}`)
            return q && <Arrow key={`${a}→${b}`} q={q} on={linked.has(`${a}→${b}`)} />
          })}
          {streams.map((s, i) => (
            <Dots key={`${step}.${i}`} stream={s} l={l} still={still} />
          ))}
        </svg>
        {cast.map((a) => (
          <Figure
            key={a.id}
            actor={a}
            state={now.actors.get(a.id)!}
            l={l}
            shown={now.shown.has(a.id)}
            lit={now.highlight.has(a.id)}
            dim={now.highlight.size > 0 && !now.highlight.has(a.id)}
            still={still}
          />
        ))}
        <svg aria-hidden {...box} className="pointer-events-none absolute inset-0 overflow-visible">
          {streams.map(
            (s, i) => s.label && s.curves.length > 0 && <Tag key={`${step}.${i}`} stream={s} l={l} boxes={boxes.flat()} still={still} />,
          )}
        </svg>
      </div>
    </div>
  )
}

/** A filled arrowhead at the curve's end, along its direction there. */
function head(q: Curve, size = 7) {
  const [dx, dy] = [q.to.x - q.c.x, q.to.y - q.c.y]
  const length = Math.hypot(dx, dy) || 1
  const [ux, uy] = [dx / length, dy / length]
  const [bx, by] = [q.to.x - ux * size, q.to.y - uy * size]
  const w = size * 0.6
  return `M${q.to.x} ${q.to.y}L${bx - uy * w} ${by + ux * w}L${bx + uy * w} ${by - ux * w}Z`
}

/** A link's arrow: draws itself in when it appears and fades when it goes. */
function Arrow({ q, on }: { q: Curve; on: boolean }) {
  return (
    <g className="transition-opacity duration-300 ease-out" style={{ opacity: on ? 1 : 0 }}>
      <path
        d={curvePath(q)}
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={on ? 0 : 1}
        fill="none"
        stroke="var(--color-muted)"
        strokeWidth={2}
        strokeLinecap="round"
        className="transition-[stroke-dashoffset] duration-300 ease-out"
      />
      <path d={head(q)} fill="var(--color-muted)" stroke="var(--color-muted)" strokeWidth={2} strokeLinejoin="round" />
    </g>
  )
}

/** One hop's timing: how long a dot takes to cross it and how many dots are on it at once. */
function pace(q: Curve, l: Layout, speed: Stream['speed']) {
  const length = curveLength(q)
  return { dur: Math.max(0.2, length / (SPEED[speed] * l.cell)), dots: Math.max(1, Math.round(length / (0.4 * l.cell))) }
}

/** A flow's dots travelling each hop, looping; with reduced motion, a dashed arrow per hop instead. */
function Dots({ stream, l, still }: { stream: Stream; l: Layout; still: boolean }) {
  const color = PALETTE[stream.color]
  return stream.curves.map((q, i) => {
    const d = curvePath(q)
    if (still)
      return (
        <g key={i}>
          <path d={d} fill="none" stroke={color} strokeWidth={2} strokeDasharray="5 5" strokeLinecap="round" />
          <path d={head(q)} fill={color} stroke={color} strokeWidth={2} strokeLinejoin="round" />
        </g>
      )
    const { dur, dots } = pace(q, l, stream.speed)
    return (
      <g key={i}>
        {!stream.linked[i] && (
          <path d={d} fill="none" stroke={color} strokeOpacity={0.35} strokeWidth={2} strokeDasharray="0 8" strokeLinecap="round" />
        )}
        {Array.from({ length: dots }, (_, k) => (
          <circle key={k} r={4} fill={color}>
            <Travel d={d} dur={dur} begin={(-k * dur) / dots} />
          </circle>
        ))}
      </g>
    )
  })
}

/** Moves its parent along a path (between `from` and `to`, shares of its length), looping, fading in and out
 * at the ends. SVG animation, so it runs without script. */
function Travel({ d, dur, begin, from = 0, to = 1 }: { d: string; dur: number; begin: number; from?: number; to?: number }) {
  const timing = { dur: `${dur}s`, begin: `${begin}s`, repeatCount: 'indefinite' }
  return (
    <>
      <animateMotion path={d} keyPoints={`${from};${to}`} keyTimes="0;1" calcMode="linear" {...timing} />
      <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.15;0.85;1" {...timing} />
    </>
  )
}

/** What a flow carries, as a pill on its longest hop: drifting across the middle, moved off any actor it would
 * cover (tagSpot); still with reduced motion. */
function Tag({ stream, l, boxes, still }: { stream: Stream; l: Layout; boxes: Box[]; still: boolean }) {
  const q = stream.curves.reduce((a, b) => (curveLength(b) > curveLength(a) ? b : a))
  const [width, height] = [stream.label.length * 7.2 + 16, 20] // 12 px mono
  const mid = pointAt(q, 0.5)
  const spot = tagSpot(q, width, height, boxes, { x0: 0, y0: 0, x1: l.width, y1: l.height })
  const pill = (
    <g>
      <rect x={-width / 2} y={-height / 2} width={width} height={height} rx={height / 2} fill={PALETTE[stream.color]} />
      <text dominantBaseline="central" textAnchor="middle" fontSize={12} fill="var(--color-bg)" className="font-mono">
        {stream.label}
      </text>
    </g>
  )
  if (still) return <g transform={`translate(${spot.x} ${spot.y})`}>{pill}</g>
  return (
    <g transform={`translate(${spot.x - mid.x} ${spot.y - mid.y})`}>
      <g opacity={0}>
        <Travel d={curvePath(q)} dur={Math.max(TAG_MS / 1000, pace(q, l, stream.speed).dur)} begin={0} from={0.3} to={0.7} />
        {pill}
      </g>
    </g>
  )
}

/** An actor: its icon on a tinted tile (a plain dot without one), stacked copies for a count, a meter for a
 * level, the label and value below. Fades and grows in when shown; glows while highlighted. */
function Figure({
  actor: a,
  state: s,
  l,
  shown,
  lit,
  dim,
  still,
}: {
  actor: Actor
  state: ActorState
  l: Layout
  shown: boolean
  lit: boolean
  dim: boolean
  still: boolean
}) {
  const Icon = a.icon ? sceneIcons[a.icon] : null
  const size = iconSize(l, a)
  const radius = Icon ? Math.round(l.tile * 0.3) : size
  const offset = (l.tile - size) / 2
  const copies = Math.min(s.count, STACK)
  const shape = (k: number): CSSProperties => ({
    width: size,
    height: size,
    left: offset,
    top: offset - k * l.stackStep, // copies pile up, leaving the sides free for arrows
    borderRadius: radius,
  })
  return (
    <div
      aria-hidden={!shown}
      className="absolute flex flex-col items-center transition duration-300 ease-out"
      style={
        {
          left: a.col * l.cell,
          top: a.row * l.row + l.top,
          width: l.cell,
          opacity: shown ? (dim ? 0.55 : 1) : 0,
          scale: shown ? 1 : 0.8,
          transformOrigin: `50% ${l.tile / 2}px`,
          '--c': PALETTE[a.color],
        } as CSSProperties
      }
    >
      <div className="relative shrink-0" style={{ width: l.tile, height: l.tile }}>
        {Array.from({ length: STACK - 1 }, (_, i) => STACK - 1 - i).map((k) => (
          <span
            key={k}
            className="absolute border-[1.5px] border-[color-mix(in_srgb,var(--c)_45%,var(--color-surface))] bg-[color-mix(in_srgb,var(--c)_14%,var(--color-surface))] transition-opacity duration-300"
            style={{ ...shape(k), opacity: k < copies ? 1 : 0 }}
          />
        ))}
        <span
          className={`absolute grid place-items-center ${Icon ? 'bg-[color-mix(in_srgb,var(--c)_18%,var(--color-surface))]' : 'bg-[var(--c)]'} ${lit ? 'scene-lit' : ''}`}
          style={shape(0)}
        >
          {Icon && <Icon size={Math.round(l.tile * 0.5)} strokeWidth={1.75} color="var(--c)" aria-hidden />}
        </span>
        {s.count > STACK && (
          <span className="tabular absolute -right-2 -bottom-1.5 rounded-full bg-[var(--c)] px-1.5 font-mono text-[11px] leading-[18px] text-bg">
            <Counting text={`×${s.count}`} still={still} />
          </span>
        )}
      </div>
      {l.levels && (
        <span
          className="block h-1 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--c)_22%,transparent)]"
          style={{ width: l.tile, marginTop: METER - 4, visibility: s.level === null ? 'hidden' : undefined }}
        >
          <span className="block h-full rounded-full bg-[var(--c)] transition-[width] duration-500 ease-out" style={{ width: `${(s.level ?? 0) * 100}%` }} />
        </span>
      )}
      <span
        title={a.label}
        className="line-clamp-2 text-center font-medium [overflow-wrap:anywhere] text-fg hyphens-auto"
        style={{ fontSize: l.font, lineHeight: `${l.line}px`, marginTop: TEXT_GAP, maxWidth: l.cell - 8 }}
      >
        {a.label}
      </span>
      {s.value && (
        <span
          className="tabular font-mono whitespace-nowrap text-[var(--c)]"
          style={{ fontSize: l.valueFont, lineHeight: `${l.valueLine}px` }}
        >
          <Counting text={s.value} still={still} />
        </span>
      )}
    </div>
  )
}

/** Text that counts to a new number with the same unit (scene.ts counter) instead of jumping to it. */
function Counting({ text, still }: { text: string; still: boolean }) {
  const [shown, setShown] = useState(text)
  const last = useRef(text) // what is on screen
  useLayoutEffect(() => {
    const count = still ? null : counter(last.current, text)
    if (!count) {
      last.current = text
      setShown(text)
      return
    }
    const start = performance.now()
    let frame = requestAnimationFrame(function tick(now) {
      const t = Math.min(1, (now - start) / COUNT_MS)
      last.current = count(1 - (1 - t) ** 3)
      setShown(last.current)
      if (t < 1) frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [text, still])
  return shown
}
