import { useEffect, useState } from 'react'
import { Button, Segmented, Slider, Stat } from '../ui'
import { algorithmsFor, cost, popcount, schedule, states, type Algo, type Cell, type Op, type Schedule } from './collective.math'
import type { WidgetProps } from './types'
import { bytes, duration } from './units'
import { useWidth } from './useWidth'

type Props = { op: Op; algorithm: Algo; ranks: number; message_mb: number; link_gbps: number; latency_us: number }
const defaults: Props = { op: 'all_reduce', algorithm: 'ring', ranks: 4, message_mb: 64, link_gbps: 450, latency_us: 5 }
// Non-breaking hyphens keep each label on one line when the buttons wrap on phones.
const ops: { value: Op; label: string }[] = [
  { value: 'all_reduce', label: 'all‑reduce' },
  { value: 'reduce_scatter', label: 'reduce‑scatter' },
  { value: 'all_gather', label: 'all‑gather' },
  { value: 'broadcast', label: 'broadcast' },
  { value: 'all_to_all', label: 'all‑to‑all' },
]
const algoLabel: Record<Algo, string> = { ring: 'ring', tree: 'tree', pairwise: 'pairwise exchange' }
const STEP_MS = 750
const num = (x: number) => String(Number(x.toPrecision(3)))
const gbps = (bps: number) => `${num(bps / 1e9)} GB/s`

// Closed forms shown next to the simulated numbers (S = full buffer per rank, N ranks, L = ⌈log2 N⌉).
const formula: Record<string, { steps: string; bytes: string; time: string }> = {
  'all_reduce/ring': { steps: '2(N−1)', bytes: '2(N−1)/N · S', time: '2(N−1)·(α + S/(Nβ))' },
  'all_reduce/tree': { steps: '2L', bytes: 'up to L · S (rank 0)', time: '2L·(α + S/β)' },
  'reduce_scatter/ring': { steps: 'N−1', bytes: '(N−1)/N · S', time: '(N−1)·(α + S/(Nβ))' },
  'all_gather/ring': { steps: 'N−1', bytes: '(N−1)/N · S', time: '(N−1)·(α + S/(Nβ))' },
  'broadcast/ring': { steps: '2N−2', bytes: 'S (last rank: 0)', time: '(2N−2)·(α + S/(Nβ))' },
  'broadcast/tree': { steps: 'L', bytes: 'root: L · S', time: 'L·(α + S/β)' },
  'all_to_all/pairwise': { steps: 'N−1 (odd N: N)', bytes: '(N−1)/N · S', time: 'rounds·(α + S/(Nβ))' },
}
const busFormula: Record<Op, string> = {
  all_reduce: '2(N−1)/N',
  reduce_scatter: '(N−1)/N',
  all_gather: '(N−1)/N',
  broadcast: '1',
  all_to_all: '(N−1)/N',
}

/** Chunk/rank color: the six series colors when they suffice, else evenly spaced hues. */
const hue = (i: number, n: number) => (n <= 6 ? `var(--color-chart-${i + 1})` : `hsl(${(228 + (i * 360) / n) % 360} 78% 66%)`)
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

export default function Collective({ props, onState }: WidgetProps<Props>) {
  const init = { ...defaults, ...props }
  const [op, setOp] = useState<Op>(init.op)
  const [algoPick, setAlgo] = useState<Algo>(init.algorithm)
  const [n, setN] = useState(init.ranks)
  const [mb, setMb] = useState(init.message_mb)
  const [link, setLink] = useState(init.link_gbps)
  const [lat, setLat] = useState(init.latency_us)

  const algos = algorithmsFor(op)
  const algo = algos.includes(algoPick) ? algoPick : algos[0]
  const sched = schedule(op, algo, n)
  const frames = states(sched)
  const T = sched.steps.length
  const S = mb * 1e6
  const alpha = lat * 1e-6
  const beta = link * 1e9
  const c = cost(sched, S, alpha, beta)

  // Playback: pos = completed steps, fractional while a step animates toward stopAt.
  const [pos, setPos] = useState(0)
  const [stopAt, setStopAt] = useState(0)
  const key = `${op}/${algo}/${n}`
  const [shown, setShown] = useState(key)
  if (shown !== key) {
    setShown(key)
    setPos(0)
    setStopAt(0)
  }
  const running = pos < stopAt
  useEffect(() => {
    if (!running) return
    let last = performance.now()
    let frame = requestAnimationFrame(function tick(now) {
      const dt = Math.max(0, now - last) / STEP_MS // the first frame's timestamp can precede `last`
      last = now
      setPos((p) => Math.min(stopAt, p + dt))
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [running, stopAt])
  const done = Math.min(T, Math.floor(pos + 1e-9))
  const frac = reducedMotion() ? 0 : pos - done
  const playing = running && stopAt === T
  const phase = sched.steps[Math.min(running ? done : done - 1, T - 1)]?.phase ?? ''

  const other = algos.find((a) => a !== algo)
  const otherCost = other ? cost(schedule(op, other, n), S, alpha, beta) : null
  const rs = cost(schedule('reduce_scatter', 'ring', n), S, alpha, beta)
  const ag = cost(schedule('all_gather', 'ring', n), S, alpha, beta)
  const latShare = c.latencyTime / c.time
  const f = formula[`${op}/${algo}`]

  const verdict =
    `${algoLabel[algo]} ${op} on ${n} ranks: ${c.steps} steps, ${bytes(c.bytesPerRank)} sent per rank, ${duration(c.time)}; ` +
    (latShare > 0.5
      ? `latency-dominated (${Math.round(latShare * 100)}% of the time is per-step latency)`
      : `bandwidth-dominated (bus bandwidth ${gbps(c.busbw)} vs ${gbps(beta)} link)`) +
    (otherCost ? `; ${other} would take ${duration(otherCost.time)}` : '')

  const state = {
    op,
    algorithm: algo,
    ranks: n,
    message_bytes: S,
    link_gb_per_s: link,
    latency_us: lat,
    steps: c.steps,
    bytes_sent_per_rank_max: c.bytesPerRank,
    time_us: +(c.time * 1e6).toPrecision(4),
    latency_share_of_time: +latShare.toPrecision(3),
    algbw_gb_per_s: +(c.algbw / 1e9).toPrecision(4),
    busbw_gb_per_s: +(c.busbw / 1e9).toPrecision(4),
    ...(otherCost && other ? { [`${other}_time_us`]: +(otherCost.time * 1e6).toPrecision(4) } : {}),
    animation_steps_completed: done,
    animation_phase: phase,
    verdict,
  }
  const stateKey = JSON.stringify(state)
  useEffect(() => onState?.(JSON.parse(stateKey)), [stateKey, onState])

  return (
    <div className="flex flex-col gap-4">
      <Segmented value={op} options={ops} onChange={setOp} />
      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <Segmented
          label="Algorithm"
          value={algo}
          options={algos.map((a) => ({ value: a, label: algoLabel[a] }))}
          onChange={setAlgo}
        />
        <Slider label="Ranks N" value={n} min={2} max={16} onChange={setN} />
      </div>

      <Matrix sched={sched} frames={frames} done={done} frac={frac} />

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => setStopAt(playing ? Math.ceil(pos) : T)} disabled={done >= T}>
          {playing ? 'Pause' : 'Play'}
        </Button>
        <Button onClick={() => setStopAt(done + 1)} disabled={running || done >= T}>
          Step
        </Button>
        <Button
          onClick={() => {
            setPos(0)
            setStopAt(0)
          }}
          disabled={pos === 0}
        >
          Reset
        </Button>
        <span className="tabular ml-auto font-mono text-sm text-muted">
          step {running ? done + 1 : done} / {T}
          {phase && <span className="text-fg"> · {phase}</span>}
        </span>
      </div>

      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
        <Slider
          label="Message size S"
          value={Math.log10(mb)}
          min={-3}
          max={4}
          step={0.05}
          onChange={(v) => setMb(Number((10 ** v).toPrecision(2)))}
          format={() => bytes(S)}
        />
        <Slider
          label="Link bandwidth β"
          value={Math.log10(link)}
          min={0}
          max={3.3}
          step={0.025}
          onChange={(v) => setLink(Number((10 ** v).toPrecision(2)))}
          format={() => `${num(link)} GB/s`}
        />
        <Slider
          label="Latency α per step"
          value={Math.log10(lat)}
          min={-1}
          max={2}
          step={0.05}
          onChange={(v) => setLat(Number((10 ** v).toPrecision(2)))}
          format={() => `${num(lat)} µs`}
        />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat label="Steps" value={c.steps} />
        <Stat label="Sent per rank (max)" value={bytes(c.bytesPerRank)} />
        <Stat label="Est. time" value={duration(c.time)} tone={latShare > 0.5 ? 'warn' : undefined} />
        <Stat label="Algorithm BW" value={gbps(c.algbw)} />
        <Stat label="Bus BW" value={gbps(c.busbw)} />
      </div>

      <div className="flex flex-col gap-2 text-sm text-muted">
        <p className="text-fg">{verdict}.</p>
        <p className="font-mono text-xs leading-relaxed">
          steps = {f.steps} · bytes/rank = {f.bytes} · time = {f.time}
          <br />
          algbw = S / time · busbw = algbw × {busFormula[op]} (NCCL)
          {algo === 'tree' && <> · L = ⌈log₂N⌉ = {Math.ceil(Math.log2(n))}</>}
        </p>
        {op === 'all_reduce' && algo === 'ring' && (
          <p className="rounded-xl bg-raised px-3 py-2">
            all-reduce = reduce-scatter ({rs.steps} steps, {duration(rs.time)}) + all-gather ({ag.steps} steps,{' '}
            {duration(ag.time)}) = {c.steps} steps, {duration(c.time)}.
          </p>
        )}
        {(op === 'reduce_scatter' || op === 'all_gather') && (
          <p className="rounded-xl bg-raised px-3 py-2">
            reduce-scatter ({duration(rs.time)}) + all-gather ({duration(ag.time)}) = ring all-reduce (
            {duration(rs.time + ag.time)}).
          </p>
        )}
        <p className="text-xs">
          α-β model: S is the full buffer per rank, split into N chunks; each step costs α plus the busiest rank’s
          bytes / β (one direction per link, sends and receives overlap).{' '}
          {algo === 'tree' &&
            'Tree = binomial tree on whole messages (reduce to rank 0, then broadcast), not pipelined. NCCL’s double binary tree pipelines small chunks over two complementary trees, keeping log-depth latency while approaching ring bandwidth; that is not modelled here.'}
          {op === 'broadcast' && algo === 'ring' && 'Ring broadcast is a pipelined chain from rank 0 using N chunks; more, smaller chunks push its time toward S/β.'}
          {op === 'all_to_all' &&
            'Pairwise exchange: each round, disjoint pairs swap the blocks meant for each other (assumes a switched fabric such as NVSwitch). NCCL posts all N−1 sends at once instead; the bytes per rank are the same.'}
        </p>
      </div>
    </div>
  )
}

function Matrix({ sched, frames, done, frac }: { sched: Schedule; frames: Cell[][][]; done: number; frac: number }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [sel, setSel] = useState<{ r: number; j: number } | null>(null)
  const n = sched.n
  const labelW = 58
  const headH = 20
  const cell = Math.max(12, Math.min(56, Math.floor((width - labelW) / n), Math.floor(560 / n))) // matrix ≤ ~560px tall
  const gap = cell >= 24 ? 4 : 2
  const rx = Math.min(8, cell / 5)
  const w = labelW + n * cell
  const h = headH + n * cell
  const st = frames[done]
  const step = frac > 0 ? sched.steps[done] : undefined
  const a2a = sched.op === 'all_to_all'
  const reduction = sched.op === 'all_reduce' || sched.op === 'reduce_scatter'
  const cx = (j: number) => labelW + j * cell
  const cy = (r: number) => headH + r * cell
  const t = frac < 0.5 ? 2 * frac * frac : 1 - (-2 * frac + 2) ** 2 / 2 // ease in-out
  const busy = new Set(step?.moves.flatMap((m) => [m.from, m.to]))
  const origin = (c: NonNullable<Cell>) => Math.log2(c.mask) // single-rank cells only

  const opacity = (c: NonNullable<Cell>) => (reduction ? 0.25 + (0.75 * popcount(c.mask)) / n : 1)
  const block = (c: NonNullable<Cell>, x: number, y: number, key: string) => (
    <g key={key} transform={`translate(${x},${y})`}>
      <rect
        x={gap / 2}
        y={gap / 2}
        width={cell - gap}
        height={cell - gap}
        rx={rx}
        fill={hue(a2a ? origin(c) : c.chunk, n)}
        fillOpacity={opacity(c)}
      />
      {cell >= 22 && (reduction || a2a) && (
        <text x={cell / 2} y={cell / 2 + 4} textAnchor="middle" fontSize={11} className="font-mono"
          fill={opacity(c) > 0.6 ? 'var(--color-bg)' : 'var(--color-fg)'}>
          {a2a ? origin(c) : popcount(c.mask) === n ? 'Σ' : popcount(c.mask)}
        </text>
      )}
    </g>
  )

  const describe = (r: number, j: number) => {
    const c = st[r][j]
    if (!c) return `rank ${r}, slot ${j}: empty (not received yet)`
    const who = Array.from({ length: n }, (_, i) => i).filter((i) => c.mask & (1 << i))
    if (a2a) return `rank ${r}, slot ${j}: block from rank ${who[0]} destined for rank ${c.chunk}`
    if (who.length === 1) return `rank ${r}, slot ${j}: chunk ${c.chunk} of rank ${who[0]}'s data`
    return `rank ${r}, slot ${j}: chunk ${c.chunk} summed over ranks {${who.join(', ')}}${who.length === n ? ' (complete)' : ''}`
  }

  return (
    <div ref={ref} className="flex w-full flex-col gap-2">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="mx-auto block select-none">
        <g className="font-mono" fontSize={11}>
          {Array.from({ length: n }, (_, j) =>
            cell >= 24 || j % 2 === 0 ? (
              <text key={j} x={cx(j) + cell / 2} y={13} textAnchor="middle" className="fill-muted">
                {a2a ? `↔${j}` : `c${j}`}
              </text>
            ) : null,
          )}
          {Array.from({ length: n }, (_, r) => (
            <text key={r} x={labelW - 8} y={cy(r) + cell / 2 + 4} textAnchor="end" className={busy.has(r) ? 'fill-fg' : 'fill-muted'}>
              rank {r}
            </text>
          ))}
        </g>
        {st.map((row, r) =>
          row.map((c, j) =>
            c ? (
              block(c, cx(j), cy(r), `${r},${j}`)
            ) : (
              <rect
                key={`${r},${j}`}
                x={cx(j) + gap / 2 + 0.5}
                y={cy(r) + gap / 2 + 0.5}
                width={cell - gap - 1}
                height={cell - gap - 1}
                rx={rx}
                className="fill-raised stroke-line"
              />
            ),
          ),
        )}
        {step?.moves.map((m, i) => (
          <rect key={`o${i}`} x={cx(m.src) + 1} y={cy(m.from) + 1} width={cell - 2} height={cell - 2} rx={rx + 1}
            fill="none" stroke="var(--color-fg)" strokeWidth={1.5} />
        ))}
        {step?.moves.map((m, i) =>
          block(st[m.from][m.src]!, cx(m.src) + (cx(m.dst) - cx(m.src)) * t, cy(m.from) + (cy(m.to) - cy(m.from)) * t, `g${i}`),
        )}
        {st.map((row, r) =>
          row.map((_, j) => {
            const on = sel?.r === r && sel?.j === j
            return (
              <rect key={`h${r},${j}`} x={cx(j)} y={cy(r)} width={cell} height={cell} rx={rx + 1} fill="transparent"
                stroke={on ? 'var(--color-accent)' : 'none'} strokeWidth={2} className="cursor-pointer"
                onClick={() => setSel(on ? null : { r, j })} />
            )
          }),
        )}
      </svg>
      <p className="min-h-5 text-xs text-muted">
        {sel
          ? describe(sel.r, sel.j)
          : a2a
            ? 'Rows are ranks; slot j holds the block exchanged with rank j, colored and numbered by the rank that produced it. Tap a cell.'
            : reduction
              ? 'Rows are ranks, columns are chunks (colored by chunk). The number is how many ranks are summed in; Σ = all N. Tap a cell.'
              : 'Rows are ranks, columns are chunks (colored by chunk); outlines are not received yet. Tap a cell.'}
      </p>
    </div>
  )
}
