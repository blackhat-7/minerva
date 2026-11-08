import { useEffect, useState, type PointerEvent } from 'react'
import { Button, Segmented, Slider, Stat } from '../ui'
import { gpuIds, gpus, peakTflops, type GpuId } from './gpus'
import { CHINCHILLA_TOKENS_PER_PARAM, estimate, references } from './training_cost.math'
import type { WidgetProps } from './types'
import { duration, si } from './units'
import { useWidth } from './useWidth'

type Props = {
  params_b: number
  active_params_b: number | null
  tokens_t: number
  gpu: GpuId
  gpus: number
  mfu: number
  dollars_per_gpu_hour: number
  dtype: 'bf16' | 'fp8'
}

const defaults: Props = {
  params_b: 70,
  active_params_b: null,
  tokens_t: 1.4,
  gpu: 'H100_SXM',
  gpus: 1024,
  mfu: 0.4,
  dollars_per_gpu_hour: 2.5,
  dtype: 'bf16',
}

// Log10 ranges of the sliders and chart axes.
const N_MIN = 8 // 0.1B params
const N_MAX = Math.log10(2e12)
const D_MIN = 9 // 1B tokens
const D_MAX = 14 // 100T tokens
const sig = (x: number, d = 3) => Number(x.toPrecision(d))
const params = (n: number) => si(n).replace(/ G$/, 'B').replace(/ T$/, 'T').replace(/ M$/, 'M')
const sci = (x: number) => x.toExponential(2).replace('e+', 'e')

function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)} className="min-h-11 rounded-xl border border-line bg-raised px-3 text-fg">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export default function TrainingCost({ props, onState }: WidgetProps<Props>) {
  const init = { ...defaults, ...props }
  const [nLog, setNLog] = useState(Math.log10(init.params_b * 1e9))
  const [moe, setMoe] = useState(init.active_params_b !== null)
  const [activeLog, setActiveLog] = useState(Math.log10((init.active_params_b ?? init.params_b / 8) * 1e9))
  const [dLog, setDLog] = useState(Math.log10(init.tokens_t * 1e12))
  const [gpuId, setGpuId] = useState(init.gpu)
  const [gpuLog, setGpuLog] = useState(Math.log10(init.gpus))
  const [mfu, setMfu] = useState(init.mfu)
  const [price, setPrice] = useState(init.dollars_per_gpu_hour)
  const [dtype, setDtype] = useState(init.dtype)

  const N = sig(10 ** nLog)
  const nActive = moe ? Math.min(N, sig(10 ** activeLog)) : N
  const D = sig(10 ** dLog)
  const count = Math.round(10 ** gpuLog)
  const gpu = gpus[gpuId]
  const peak = peakTflops(gpu, dtype) * 1e12
  const e = estimate(nActive, D, count, peak, mfu, price)
  const ratio = D / N
  const optimalD = CHINCHILLA_TOKENS_PER_PARAM * N

  const verdict =
    ratio < 15
      ? `under-trained vs Chinchilla (${sig(ratio, 2)} tokens/param < 20): a smaller model on more tokens would score better for the same FLOPs`
      : ratio <= 25
        ? `about compute-optimal (${sig(ratio, 2)} tokens/param ≈ 20)`
        : `over-trained vs Chinchilla (${sig(ratio, 2)} tokens/param): more training FLOPs than optimal, but a smaller model is cheaper to serve`

  // Report on mount and whenever a reported value changes (compared by content, not object identity).
  const stateJson = JSON.stringify({
    params_total: N,
    params_active: nActive,
    moe,
    tokens: D,
    training_flops: Number(e.flops.toPrecision(3)),
    tokens_per_param: sig(ratio),
    chinchilla_optimal_tokens: optimalD,
    gpu: gpu.name,
    gpus: count,
    dtype,
    peak_tflops_per_gpu: peak / 1e12,
    mfu,
    dollars_per_gpu_hour: price,
    wall_clock_days: sig(e.seconds / 86400),
    gpu_hours: sig(e.gpuHours),
    cost_usd: sig(e.cost),
    verdict,
  })
  useEffect(() => onState?.(JSON.parse(stateJson)), [onState, stateJson])

  const loadLlama = () => {
    setMoe(false)
    setNLog(Math.log10(405.85e9))
    setDLog(Math.log10(15.6e12))
    setGpuId('H100_SXM')
    setGpuLog(Math.log10(16384))
    setDtype('bf16')
    setMfu(0.4)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Slider label="Parameters N (total)" value={nLog} min={N_MIN} max={N_MAX} step={0.01} onChange={setNLog} format={() => params(N)} />
        <Slider label="Training tokens D" value={dLog} min={D_MIN} max={D_MAX} step={0.01} onChange={setDLog} format={() => si(D)} />
        <Segmented
          label="Architecture"
          value={moe ? 'moe' : 'dense'}
          options={[
            { value: 'dense', label: 'Dense' },
            { value: 'moe', label: 'MoE' },
          ]}
          onChange={(v) => setMoe(v === 'moe')}
        />
        {moe ? (
          <Slider label="Active parameters per token" value={Math.min(activeLog, nLog)} min={N_MIN} max={nLog} step={0.01} onChange={setActiveLog} format={() => params(nActive)} />
        ) : (
          <div className="hidden sm:block" />
        )}
        <Select label="GPU" value={gpuId} options={gpuIds.map((id) => ({ value: id, label: gpus[id].name }))} onChange={setGpuId} />
        <Segmented label="Training precision" value={dtype} options={['bf16', 'fp8'] as const} onChange={setDtype} />
        <Slider label="Number of GPUs" value={gpuLog} min={0} max={5} step={0.01} onChange={setGpuLog} format={() => count.toLocaleString()} />
        <Slider label="MFU (achieved / peak FLOP/s)" value={mfu} min={0.1} max={0.7} step={0.01} onChange={setMfu} format={(v) => `${Math.round(v * 100)}%`} />
        <Slider label="Price per GPU-hour" value={price} min={0.5} max={10} step={0.1} onChange={setPrice} format={(v) => `$${v.toFixed(2)}`} />
        <div className="flex items-end gap-2">
          <Button className="flex-1" onClick={() => setDLog(Math.log10(optimalD))} disabled={optimalD > 10 ** D_MAX}>
            D = 20·N
          </Button>
          <Button className="flex-1" onClick={loadLlama}>
            Llama 405B run
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label={`FLOPs = 6 × ${params(nActive)} × ${si(D)}`} value={sci(e.flops)} />
        <Stat label="Tokens per param (optimal ≈ 20)" value={sig(ratio, 3)} tone={ratio >= 15 && ratio <= 25 ? 'good' : 'warn'} />
        <Stat label="Wall-clock time" value={duration(e.seconds)} />
        <Stat label="GPU-hours" value={si(e.gpuHours)} />
        <Stat label="Cost" value={`$${si(e.cost)}`} />
        <Stat label={`Peak per GPU (${dtype === 'fp8' && gpu.fp8_tflops === null ? 'no FP8: bf16 rate' : dtype})`} value={si(peak, 'FLOP/s')} />
      </div>

      <Chart
        n={nActive}
        d={D}
        moe={moe}
        onPick={(n, d) => {
          if (moe) setActiveLog(Math.min(n, nLog))
          else setNLog(n)
          setDLog(d)
        }}
      />

      <p className="text-xs leading-relaxed text-muted">
        FLOPs ≈ 6·N·D: forward 2 and backward 4 FLOPs per parameter per token; attention FLOPs and activation recomputation are ignored. MoE counts only active
        parameters. Time = FLOPs ÷ (GPUs × peak × MFU). Chinchilla’s 20 tokens/param was fit on dense models. Sanity check: Llama 3.1 405B (3.8e25 FLOPs) at
        40% MFU on 16,384 H100s gives about 27M GPU-hours; Meta reports 30.84M, since real runs also lose time to failures, restarts and evaluation.
      </p>
    </div>
  )
}

/** Log-log map of model size vs training tokens with the Chinchilla line, iso-FLOP lines and real runs. */
function Chart({ n, d, moe, onPick }: { n: number; d: number; moe: boolean; onPick: (nLog: number, dLog: number) => void }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const left = 48
  const right = 12
  const top = 10
  const plotH = 260
  const plotW = Math.max(160, width - left - right)
  const height = top + plotH + 40
  const x = (lg: number) => left + ((lg - N_MIN) / (N_MAX - N_MIN)) * plotW
  const y = (lg: number) => top + plotH - ((lg - D_MIN) / (D_MAX - D_MIN)) * plotH
  const xTicks = [8, 9, 10, 11, 12]
  const yTicks = [9, 10, 11, 12, 13, 14]
  const font = 10
  const textW = (s: string) => s.length * font * 0.6

  type Box = { x0: number; y0: number; x1: number; y1: number }
  type Label = { text: string; tx: number; ty: number; anchor: 'start' | 'end' | 'middle'; color: string }
  const box = (l: Omit<Label, 'color'>): Box => {
    const w = textW(l.text)
    const x0 = l.anchor === 'start' ? l.tx : l.anchor === 'end' ? l.tx - w : l.tx - w / 2
    return { x0, y0: l.ty - 6, x1: x0 + w, y1: l.ty + 6 }
  }

  // Iso-FLOP lines: log D = log(C/6) − log N. Label each where it enters the plot (top, right or left edge),
  // on the side of the line that stays clear of it.
  const isoFlops = [21, 23, 25, 27].map((c) => ({ c, k: c - Math.log10(6) }))
  const fixed: Label[] = []
  for (const { c, k } of isoFlops) {
    const text = `1e${c} FLOPs`
    const color = 'var(--color-muted)'
    if (k - D_MAX >= N_MIN + 0.05 && k - D_MAX <= N_MAX - 1) fixed.push({ text, tx: x(k - D_MAX) + 4, ty: top + 10, anchor: 'start', color })
    else if (k - N_MAX >= D_MIN + 0.3 && k - N_MAX <= D_MAX - 0.3) fixed.push({ text, tx: left + plotW - 4, ty: y(k - N_MAX) + 12, anchor: 'end', color })
    else if (k - N_MIN >= D_MIN + 0.3 && k - N_MIN <= D_MAX - 0.3) fixed.push({ text, tx: left + 4, ty: y(k - N_MIN) - 8, anchor: 'start', color })
  }
  const chinX = N_MIN + 0.6
  fixed.push({ text: 'Chinchilla D = 20·N', tx: x(chinX), ty: y(chinX + Math.log10(CHINCHILLA_TOKENS_PER_PARAM)) + 12, anchor: 'start', color: 'var(--color-accent)' })

  // Place reference labels greedily (right, left, above, below), avoiding the fixed labels and each other.
  const dots = references.map((r) => ({ px: x(Math.log10(r.n)), py: y(Math.log10(r.tokens)) }))
  const placed: Box[] = [...fixed.map(box), ...dots.map(({ px, py }) => ({ x0: px - 4, y0: py - 4, x1: px + 4, y1: py + 4 }))]
  const labels = references.map((r, i) => {
    const { px, py } = dots[i]
    const text = r.name
    const options = [
      { text, tx: px + 7, ty: py, anchor: 'start' as const },
      { text, tx: px - 7, ty: py, anchor: 'end' as const },
      { text, tx: px, ty: py - 13, anchor: 'middle' as const },
      { text, tx: px, ty: py + 14, anchor: 'middle' as const },
      { text, tx: px + 4, ty: py - 13, anchor: 'start' as const },
      { text, tx: px - 4, ty: py - 13, anchor: 'end' as const },
      { text, tx: px + 4, ty: py + 14, anchor: 'start' as const },
      { text, tx: px - 4, ty: py + 14, anchor: 'end' as const },
    ]
    const fitsPlot = (b: Box) => b.x0 >= left && b.x1 <= left + plotW && b.y0 >= top && b.y1 <= top + plotH
    const free = (b: Box) => placed.every((p) => b.x1 < p.x0 || b.x0 > p.x1 || b.y1 < p.y0 || b.y0 > p.y1)
    const choice = options.find((o) => fitsPlot(box(o)) && free(box(o))) ?? options.find((o) => fitsPlot(box(o))) ?? options[0]
    placed.push(box(choice))
    return { r, px, py, ...choice }
  })

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const fx = Math.min(1, Math.max(0, (e.clientX - rect.left - left) / plotW))
    const fy = Math.min(1, Math.max(0, (e.clientY - rect.top - top) / plotH))
    onPick(N_MIN + fx * (N_MAX - N_MIN), D_MAX - fy * (D_MAX - D_MIN))
  }

  return (
    <div ref={ref} className="w-full">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block cursor-crosshair touch-pan-y select-none"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          pick(e)
        }}
        onPointerMove={(e) => e.buttons && pick(e)}
      >
        <defs>
          <clipPath id="tc-plot">
            <rect x={left} y={top} width={plotW} height={plotH} />
          </clipPath>
        </defs>
        {xTicks.map((t) => (
          <g key={`x${t}`}>
            <line x1={x(t)} x2={x(t)} y1={top} y2={top + plotH} stroke="var(--color-line)" />
            <text x={x(t)} y={top + plotH + 14} textAnchor="middle" fontSize={font} fill="var(--color-muted)">
              {params(10 ** t)}
            </text>
          </g>
        ))}
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line x1={left} x2={left + plotW} y1={y(t)} y2={y(t)} stroke="var(--color-line)" />
            <text x={left - 6} y={y(t)} dy="0.35em" textAnchor="end" fontSize={font} fill="var(--color-muted)">
              {si(10 ** t)}
            </text>
          </g>
        ))}
        <g clipPath="url(#tc-plot)">
          {isoFlops.map((l) => (
            <line key={l.c} x1={x(N_MIN)} y1={y(l.k - N_MIN)} x2={x(N_MAX)} y2={y(l.k - N_MAX)} stroke="var(--color-muted)" strokeOpacity={0.4} strokeDasharray="2 4" />
          ))}
          <line
            x1={x(N_MIN)}
            y1={y(N_MIN + Math.log10(CHINCHILLA_TOKENS_PER_PARAM))}
            x2={x(N_MAX)}
            y2={y(N_MAX + Math.log10(CHINCHILLA_TOKENS_PER_PARAM))}
            stroke="var(--color-accent)"
            strokeWidth={1.5}
            strokeDasharray="6 4"
          />
        </g>
        {fixed.map((l) => (
          <text key={l.text} x={l.tx} y={l.ty} dy="0.35em" textAnchor={l.anchor} fontSize={font} fill={l.color}>
            {l.text}
          </text>
        ))}
        {labels.map((l) => (
          <g key={l.r.name}>
            <circle cx={l.px} cy={l.py} r={3.5} fill="var(--color-chart-4)" />
            <text x={l.tx} y={l.ty} dy="0.35em" textAnchor={l.anchor} fontSize={font} fill="var(--color-fg)">
              {l.r.name}
            </text>
          </g>
        ))}
        <circle cx={x(Math.log10(n))} cy={y(Math.log10(d))} r={7} fill="var(--color-chart-2)" stroke="var(--color-surface)" strokeWidth={2} />
        <text x={left + plotW / 2} y={height - 4} textAnchor="middle" fontSize={font} fill="var(--color-muted)">
          {moe ? 'active parameters per token' : 'parameters'} (log) · vertical: training tokens (log) · tap to set
        </text>
      </svg>
    </div>
  )
}
