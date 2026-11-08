import { useEffect, useMemo, useState } from 'react'
import { Button, Segmented, Slider, Stat } from '../ui'
import { bubbleFormula, inflightAt, simulate, type Schedule } from './pipeline_schedule.math'
import type { WidgetProps } from './types'
import { useWidth } from './useWidth'

type Props = {
  schedule: Schedule
  stages: number
  microbatches: number
  virtual_stages: number
  bwd_fwd_ratio: number
}

const defaults: Props = { schedule: '1f1b', stages: 4, microbatches: 8, virtual_stages: 2, bwd_fwd_ratio: 2 }
const scheduleOptions = [
  { value: 'gpipe' as const, label: 'GPipe' },
  { value: '1f1b' as const, label: '1F1B' },
  { value: 'interleaved' as const, label: 'Interleaved' },
]
const pct = (x: number) => `${(x * 100).toFixed(1)}%`
const num = (x: number) => String(Number(x.toPrecision(4)))
const sig3 = (x: number) => String(Number(x.toPrecision(3)))

/** Round axis step (1, 2 or 5 × 10^k) giving at most `maxTicks` ticks over [0, span]. */
function tickStep(span: number, maxTicks: number) {
  const raw = span / maxTicks
  const pow = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 5, 10].map((k) => k * pow).find((s) => s >= raw)!
}

export default function PipelineSchedule({ props, onState }: WidgetProps<Props>) {
  const init = { ...defaults, ...props }
  const [schedule, setSchedule] = useState(init.schedule)
  const [p, setP] = useState(init.stages)
  const [mRaw, setM] = useState(init.microbatches)
  const [v, setV] = useState(init.virtual_stages)
  const [ratio, setRatio] = useState(init.bwd_fwd_ratio)
  const [selectedMb, setSelectedMb] = useState<number | null>(null)

  const interleaved = schedule === 'interleaved'
  const vv = interleaved ? v : 1
  // Megatron's interleaved schedule runs microbatches in groups of p, so m must be a multiple of p.
  const mMax = interleaved ? Math.floor(64 / p) * p : 64
  const m = interleaved ? Math.min(mMax, Math.max(p, Math.round(mRaw / p) * p)) : mRaw
  const sim = useMemo(() => simulate(schedule, p, m, vv, ratio), [schedule, p, m, vv, ratio])
  const formula = bubbleFormula(schedule, p, m, vv)
  const peak = Math.max(...sim.peakInflight)

  const [t, setT] = useState(Infinity) // cursor time; Infinity = whole schedule shown
  const [playing, setPlaying] = useState(false)
  const cursor = Math.min(t, sim.makespan)
  useEffect(() => {
    if (!playing) return
    const seconds = Math.min(12, Math.max(4, sim.makespan * 0.12))
    let last = performance.now()
    let frame = requestAnimationFrame(function tick(now) {
      // rAF timestamps can precede the performance.now() taken at start, so clamp to avoid moving backwards.
      const dt = Math.max(0, ((now - last) / 1000) * (sim.makespan / seconds))
      last = now
      setT((prev) => Math.min(Math.min(prev, sim.makespan) + dt, sim.makespan))
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [playing, sim.makespan])
  if (playing && cursor >= sim.makespan) setPlaying(false)

  const verdict =
    sim.bubbleOfTotal < 0.1
      ? 'pipeline is well utilized (bubble under 10% of step time)'
      : interleaved
        ? `bubble is ${pct(sim.bubbleOfTotal)} of step time; more microbatches or more virtual stages shrink it`
        : `bubble is ${pct(sim.bubbleOfTotal)} of step time; use m ≫ p or interleave to shrink it`

  // Report on mount and whenever a reported value changes (compared by content, not object identity).
  const stateJson = JSON.stringify({
    schedule,
    stages_p: p,
    microbatches_m: m,
    ...(interleaved && { virtual_stages_v: v }),
    bwd_fwd_ratio: ratio,
    time_unit: 'one microbatch forward through one GPU’s layers',
    step_time_units: Number(sim.makespan.toFixed(3)),
    ideal_time_units: sim.ideal,
    bubble_fraction_of_step: Number(sim.bubbleOfTotal.toFixed(4)),
    bubble_over_ideal_simulated: Number(sim.bubbleOverIdeal.toFixed(4)),
    bubble_over_ideal_formula: Number(formula.toFixed(4)),
    peak_stored_activations_microbatches_per_gpu: sim.peakInflight.map((x) => Number(x.toFixed(2))),
    verdict,
  })
  useEffect(() => onState?.(JSON.parse(stateJson)), [onState, stateJson])

  const [ref, width] = useWidth<HTMLDivElement>()
  const labelW = 48
  const actW = 56
  const plotW = Math.max(100, width - labelW - actW)
  const rowH = p <= 6 ? 30 : p <= 10 ? 24 : 18
  const top = 4
  const axisH = 34
  const height = top + p * rowH + axisH
  const x = (time: number) => labelW + (time / sim.makespan) * plotW
  const step = tickStep(sim.makespan, Math.max(2, Math.floor(plotW / 44)))
  const ticks = Array.from({ length: Math.floor(sim.makespan / step + 1e-9) + 1 }, (_, i) => i * step)

  const blocks = useMemo(
    () =>
      sim.ops.map((o, i) => {
        const x0 = labelW + (o.start / sim.makespan) * plotW
        const w = ((o.end - o.start) / sim.makespan) * plotW
        const y = top + o.device * rowH + 2
        const h = rowH - 4
        const dim = selectedMb !== null && o.mb !== selectedMb
        const shade = vv > 1 ? 1 - (0.45 * o.chunk) / (vv - 1) : 1
        const fontSize = Math.min(11, h - 6)
        const label = String(o.mb + 1)
        const fits = w >= label.length * fontSize * 0.62 + 4 && fontSize >= 8
        return (
          <g key={i} opacity={dim ? 0.18 : 1} onClick={() => setSelectedMb((s) => (s === o.mb ? null : o.mb))} className="cursor-pointer">
            <rect
              x={x0 + 0.5}
              y={y}
              width={Math.max(0.5, w - 1)}
              height={h}
              rx={Math.min(4, w / 4)}
              fill={o.kind === 'F' ? 'var(--color-chart-1)' : 'var(--color-chart-2)'}
              fillOpacity={shade}
            />
            {fits && (
              <text x={x0 + w / 2} y={y + h / 2} dy="0.35em" textAnchor="middle" fontSize={fontSize} fill="var(--color-accent-fg)" className="pointer-events-none font-mono">
                {label}
              </text>
            )}
          </g>
        )
      }),
    [sim, plotW, rowH, selectedMb, vv],
  )

  const inflightNow = Array.from({ length: p }, (_, d) => inflightAt(sim.ops, d, cursor, vv))
  const barW = actW - 32

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Segmented label="Schedule" value={schedule} options={scheduleOptions} onChange={setSchedule} />
        <Slider label="Pipeline stages p (GPUs)" value={p} min={2} max={16} onChange={setP} />
        <Slider
          label={interleaved ? 'Microbatches m (multiple of p)' : 'Microbatches m'}
          value={m}
          min={interleaved ? p : 1}
          max={mMax}
          step={interleaved ? p : 1}
          onChange={setM}
        />
        <Slider label="Backward / forward time" value={ratio} min={1} max={3} step={0.25} onChange={setRatio} format={(r) => `${r}×`} />
        {interleaved && <Slider label="Virtual stages per GPU v" value={v} min={2} max={4} onChange={setV} />}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Step time / ideal" value={`${num(sim.makespan)} / ${num(sim.ideal)}`} />
        <Stat
          label="Bubble, share of step"
          value={pct(sim.bubbleOfTotal)}
          tone={sim.bubbleOfTotal < 0.1 ? 'good' : sim.bubbleOfTotal < 0.25 ? 'warn' : 'bad'}
        />
        <Stat label="Bubble ÷ ideal time" value={`${sig3(sim.bubbleOverIdeal)} (eq. ${sig3(formula)})`} />
        <Stat label="Peak stored activations (microbatches)" value={num(peak)} />
      </div>

      <div ref={ref} className="w-full">
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block select-none">
          <defs>
            <pattern id="ps-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-line)" strokeWidth="2" />
            </pattern>
          </defs>
          {Array.from({ length: p }, (_, d) => (
            <g key={d}>
              <rect x={labelW} y={top + d * rowH + 2} width={plotW} height={rowH - 4} fill="url(#ps-hatch)" rx={4} />
              <text x={labelW - 8} y={top + d * rowH + rowH / 2} dy="0.35em" textAnchor="end" fontSize={11} fill="var(--color-muted)">
                GPU {d + 1}
              </text>
            </g>
          ))}
          {blocks}
          {cursor < sim.makespan && (
            <rect
              x={x(cursor)}
              y={top}
              width={labelW + plotW - x(cursor)}
              height={p * rowH}
              fill="var(--color-surface)"
              opacity={0.75}
              className="pointer-events-none"
            />
          )}
          <line x1={x(cursor)} x2={x(cursor)} y1={top} y2={top + p * rowH} stroke="var(--color-fg)" strokeWidth={1.5} className="pointer-events-none" />
          {inflightNow.map((n, d) => (
            <g key={d}>
              <rect x={labelW + plotW + 6} y={top + d * rowH + rowH / 2 - 3} width={barW} height={6} rx={3} fill="var(--color-raised)" />
              <rect x={labelW + plotW + 6} y={top + d * rowH + rowH / 2 - 3} width={(barW * n) / peak} height={6} rx={3} fill="var(--color-chart-4)" />
              <text x={width - 1} y={top + d * rowH + rowH / 2} dy="0.35em" textAnchor="end" fontSize={10} fill="var(--color-muted)" className="font-mono">
                {num(n)}
              </text>
            </g>
          ))}
          {ticks.map((tk) => (
            <g key={tk}>
              <line x1={x(tk)} x2={x(tk)} y1={top + p * rowH} y2={top + p * rowH + 4} stroke="var(--color-muted)" />
              <text x={x(tk)} y={top + p * rowH + 15} textAnchor="middle" fontSize={10} fill="var(--color-muted)">
                {num(tk)}
              </text>
            </g>
          ))}
          <text x={labelW + plotW / 2} y={height - 3} textAnchor="middle" fontSize={10} fill="var(--color-muted)">
            time (1 = one microbatch forward on one GPU)
          </text>
        </svg>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          className="w-24"
          onClick={() => {
            if (cursor >= sim.makespan) setT(0)
            setPlaying((on) => !on)
          }}
        >
          {playing ? 'Pause' : 'Play'}
        </Button>
        <div className="min-w-48 flex-1">
          <Slider
            label="Time cursor"
            value={cursor}
            min={0}
            max={sim.makespan}
            step={sim.makespan / 500}
            onChange={(val) => {
              setPlaying(false)
              setT(val)
            }}
            format={(c) => `${num(c)} / ${num(sim.makespan)}`}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <Legend color="var(--color-chart-1)" label="forward (number = microbatch)" />
        <Legend color="var(--color-chart-2)" label="backward" />
        <span className="flex items-center gap-1.5">
          <svg width="14" height="10">
            <rect width="14" height="10" rx="2" fill="url(#ps-hatch)" stroke="var(--color-line)" />
          </svg>
          idle (bubble)
        </span>
        <Legend color="var(--color-chart-4)" label="right: activations stored at cursor" />
        {interleaved && <span>lighter = later model chunk</span>}
        <span>tap a block to trace its microbatch</span>
      </div>
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-3.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  )
}
