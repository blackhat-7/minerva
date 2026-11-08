import { useEffect, useMemo, useState, type PointerEvent } from 'react'
import { Segmented, Slider, Stat } from '../ui'
import { gpuIds, gpus, peakTflops, type GpuId } from './gpus'
import { decodeKnee, decodeStep, maxBatch, run, weightBytesRead, type Setup } from './inference_latency.math'
import { kvBytesPerTokenPerGpu, modelIds, models, nativeAttn, type ModelId } from './models'
import type { WidgetProps } from './types'
import { bytes, duration, si } from './units'
import { useWidth } from './useWidth'

type Props = {
  model: ModelId
  gpu: GpuId
  tp: number
  weight_dtype: 'bf16' | 'fp8' | 'int4'
  kv_dtype: 'bf16' | 'fp8'
  prompt_len: number
  output_len: number
  batch: number
  mfu: number
  bw_efficiency: number
  overhead_ms: number
  mem_util: number
}

const defaults: Props = {
  model: 'llama31_70b',
  gpu: 'H100_SXM',
  tp: 4,
  weight_dtype: 'bf16',
  kv_dtype: 'bf16',
  prompt_len: 1024,
  output_len: 256,
  batch: 16,
  mfu: 0.5,
  bw_efficiency: 0.8,
  overhead_ms: 0,
  mem_util: 0.9,
}

const dtypeBytes = { bf16: 2, fp8: 1, int4: 0.5 } as const
const tpOptions = ['1', '2', '4', '8'] as const
const pct = (x: number) => `${Math.round(x * 100)}%`
const ms = (s: number) => `${Number((s * 1e3).toPrecision(3))} ms`
const tokens = (n: number) => (n >= 1024 && n % 1024 === 0 ? `${n / 1024}K` : String(n))

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

export default function InferenceLatency({ props, onState }: WidgetProps<Props>) {
  const init = { ...defaults, ...props }
  const [modelId, setModelId] = useState(init.model)
  const [gpuId, setGpuId] = useState(init.gpu)
  const [tp, setTp] = useState(init.tp)
  const [wDtype, setWDtype] = useState(init.weight_dtype)
  const [kvDtype, setKvDtype] = useState(init.kv_dtype)
  const [promptLog, setPromptLog] = useState(Math.log2(init.prompt_len))
  const [outputLog, setOutputLog] = useState(Math.log2(init.output_len))
  const [batchLog, setBatchLog] = useState(Math.log2(init.batch))
  const [mfu, setMfu] = useState(init.mfu)
  const [bwEff, setBwEff] = useState(init.bw_efficiency)
  const [overheadMs, setOverheadMs] = useState(init.overhead_ms)

  const model = models[modelId]
  const gpu = gpus[gpuId]
  const P = Math.round(2 ** promptLog)
  const O = Math.round(2 ** outputLog)
  const B = Math.round(2 ** batchLog)
  // FP8 weights run FP8 tensor math where the GPU has it; int4 is weight-only (BF16 math).
  const computeDtype = wDtype === 'fp8' && gpu.fp8_tflops !== null ? 'fp8' : 'bf16'
  const s: Setup = useMemo(
    () => ({
      model,
      attn: nativeAttn(model),
      gpu,
      tp,
      weightBytes: dtypeBytes[wDtype],
      kvBytes: dtypeBytes[kvDtype],
      peakFlops: peakTflops(gpu, computeDtype) * 1e12,
      mfu,
      bwEff,
      overheadS: overheadMs / 1e3,
    }),
    [model, gpu, tp, wDtype, kvDtype, computeDtype, mfu, bwEff, overheadMs],
  )

  const r = useMemo(() => run(s, B, P, O), [s, B, P, O])
  const meanCtx = P + O / 2
  const knee = useMemo(() => decodeKnee(s, meanCtx), [s, meanCtx])
  const limit = maxBatch(s, P, O, init.mem_util)
  const fits = B <= limit
  const curve = useMemo(
    () =>
      Array.from({ length: 41 }, (_, i) => {
        const b = 2 ** (i / 4)
        return { b, ...run(s, b, P, O) }
      }),
    [s, P, O],
  )
  const step = decodeStep(s, B, meanCtx)
  const weightTime = weightBytesRead(model, s.weightBytes, B) / tp / (gpu.hbm_tbps * 1e12 * bwEff)
  const kvTime = step.memory - weightTime
  const bound = step.compute >= step.memory ? 'compute' : 'memory'

  const verdict =
    limit === 0
      ? `weights do not fit on ${tp}× ${gpu.name}; raise TP or quantize`
      : !fits
        ? `batch ${B} needs more KV memory than fits (max ${limit}); these latencies are not achievable`
        : knee === null
          ? 'decode stays memory-bound at every batch: reading one sequence’s KV takes longer than its compute'
          : B < knee
            ? `decode is memory-bound (weights + KV reads); raising batch toward ~${Math.round(knee)} adds throughput almost for free`
            : 'decode is compute-bound; larger batches raise TPOT with little throughput gain'

  // Report on mount and whenever a reported value changes (compared by content, not object identity).
  const stateJson = JSON.stringify({
    model: model.name,
    gpu: gpu.name,
    tp,
    weight_dtype: wDtype,
    kv_dtype: kvDtype,
    compute_dtype: computeDtype,
    prompt_tokens: P,
    output_tokens: O,
    batch: B,
    mfu,
    bw_efficiency: bwEff,
    overhead_ms_per_pass: overheadMs,
    ttft_ms: Number((r.ttft * 1e3).toPrecision(4)),
    tpot_ms: Number((r.tpot * 1e3).toPrecision(4)),
    per_request_tokens_per_s: Number(r.perRequestTps.toPrecision(4)),
    throughput_tokens_per_s: Number(r.throughput.toPrecision(4)),
    throughput_tokens_per_s_per_gpu: Number((r.throughput / tp).toPrecision(4)),
    decode_bound_at_mean_context: bound,
    knee_batch_compute_bound: knee === null ? null : Number(knee.toPrecision(3)),
    max_batch_kv_fits: limit,
    batch_fits: fits,
    verdict,
  })
  useEffect(() => onState?.(JSON.parse(stateJson)), [onState, stateJson])

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Model" value={modelId} options={modelIds.map((id) => ({ value: id, label: models[id].name }))} onChange={setModelId} />
        <Select label="GPU" value={gpuId} options={gpuIds.map((id) => ({ value: id, label: gpus[id].name }))} onChange={setGpuId} />
        <Segmented label="Tensor parallel GPUs" value={String(tp) as (typeof tpOptions)[number]} options={tpOptions} onChange={(v) => setTp(Number(v))} />
        <div className="grid gap-3 sm:grid-cols-2 sm:gap-2">
          <Segmented label="Weights" value={wDtype} options={['bf16', 'fp8', 'int4'] as const} onChange={setWDtype} />
          <Segmented label="KV cache" value={kvDtype} options={['bf16', 'fp8'] as const} onChange={setKvDtype} />
        </div>
        <Slider label="Prompt length" value={promptLog} min={4} max={15} step={0.25} onChange={setPromptLog} format={() => `${tokens(P)} tokens`} />
        <Slider label="Output length" value={outputLog} min={1} max={12} step={0.25} onChange={setOutputLog} format={() => `${tokens(O)} tokens`} />
        <Slider label="Batch (concurrent requests)" value={batchLog} min={0} max={10} step={0.125} onChange={setBatchLog} format={() => String(B)} />
        <Slider label="Per-pass overhead" value={overheadMs} min={0} max={10} step={0.25} onChange={setOverheadMs} format={(v) => `${v} ms`} />
        <Slider label="Compute efficiency (MFU)" value={mfu} min={0.1} max={1} step={0.05} onChange={setMfu} format={pct} />
        <Slider label="Memory bandwidth efficiency" value={bwEff} min={0.3} max={1} step={0.05} onChange={setBwEff} format={pct} />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="TTFT (prefill)" value={duration(r.ttft)} tone={fits ? undefined : 'bad'} />
        <Stat label="TPOT (per output token)" value={duration(r.tpot)} tone={fits ? undefined : 'bad'} />
        <Stat label="Tokens/s per request" value={si(r.perRequestTps)} />
        <Stat label={`Throughput (${tp} GPU${tp > 1 ? 's' : ''})`} value={`${si(r.throughput)} tok/s`} />
        <Stat label="Decode is" value={`${bound}-bound`} tone={bound === 'compute' ? 'good' : 'warn'} />
        <Stat label="Max batch (KV memory)" value={limit === 0 ? 'weights don’t fit' : limit} tone={fits ? 'good' : 'bad'} />
      </div>

      <StepBar compute={step.compute} weights={weightTime} kv={kvTime} ctx={meanCtx} />

      <Charts curve={curve} batch={B} current={r} knee={knee} limit={limit} onBatch={(b) => setBatchLog(Math.log2(b))} />

      <p className="text-xs leading-relaxed text-muted">
        Each pass takes max(compute, memory) + overhead. Compute = (2·N<sub>active</sub> per token + attention 2·layers·heads·(d<sub>k</sub>+d<sub>v</sub>) per cached
        token) ÷ ({tp} × {si(s.peakFlops, 'FLOP/s')} {computeDtype} × MFU). Memory = weights read
        {model.experts ? ' (MoE: only experts some token picked, uniform routing)' : ''} + KV ({bytes(kvBytesPerTokenPerGpu(model, s.attn, s.kvBytes, tp))}/token/GPU), ÷ (
        {gpu.hbm_tbps} TB/s × efficiency). Static batch: all {B} prompts prefilled together, then {O - 1} decode steps; no continuous batching, chunked prefill or
        speculative decoding; TP communication ignored. int4 is weight-only (BF16 math).
        {model.mla && ' MLA: prefill FLOPs use the MHA form (d_k 192, d_v 128), decode the absorbed latent form (d_k 576, d_v 512); the latent cache is replicated on every TP GPU.'}
      </p>
    </div>
  )
}

/** Where one decode step's time goes, at the mean context length. */
function StepBar({ compute, weights, kv, ctx }: { compute: number; weights: number; kv: number; ctx: number }) {
  const max = Math.max(compute, weights + kv)
  const row = (label: string, parts: { v: number; color: string }[], total: number) => (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 shrink-0 text-muted">{label}</span>
      <span className="flex h-3 flex-1 overflow-hidden rounded bg-raised">
        {parts.map((p, i) => (
          <span key={i} className="h-3 transition-all" style={{ width: `${(p.v / max) * 100}%`, background: p.color }} />
        ))}
      </span>
      <span className="w-16 shrink-0 text-right font-mono">{ms(total)}</span>
    </div>
  )
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-muted">One decode step at mean context ({Math.round(ctx)} tokens); the longer bar sets the step time</span>
      {row('compute', [{ v: compute, color: 'var(--color-chart-3)' }], compute)}
      {row(
        'memory',
        [
          { v: weights, color: 'var(--color-chart-5)' },
          { v: kv, color: 'var(--color-chart-1)' },
        ],
        weights + kv,
      )}
      <div className="flex flex-wrap gap-x-4 text-xs text-muted">
        <Legend color="var(--color-chart-5)" label={`weights ${ms(weights)}`} />
        <Legend color="var(--color-chart-1)" label={`KV cache ${ms(kv)}`} />
      </div>
    </div>
  )
}

type Point = { b: number; tpot: number; throughput: number }

function Charts({
  curve,
  batch,
  current,
  knee,
  limit,
  onBatch,
}: {
  curve: Point[]
  batch: number
  current: { tpot: number; throughput: number }
  knee: number | null
  limit: number
  onBatch: (b: number) => void
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const left = 58
  const right = 14
  const panelH = 140
  const gap = 36
  const top = 18
  const plotW = Math.max(120, width - left - right)
  const bottom = top + 2 * panelH + gap
  const height = bottom + 36
  const x = (b: number) => left + (Math.log2(b) / 10) * plotW
  const xTicks = Array.from({ length: 11 }, (_, i) => 2 ** i).filter((_, i) => plotW > 360 || i % 2 === 0)
  const limitX = x(Math.max(1, limit))

  const panels = [
    { key: 'throughput' as const, title: 'Throughput (output tokens/s, all GPUs)', color: 'var(--color-chart-3)', fmt: (v: number) => si(v), y0: top },
    { key: 'tpot' as const, title: 'TPOT (time per output token)', color: 'var(--color-chart-2)', fmt: (v: number) => duration(v), y0: top + panelH + gap },
  ]

  const setFromPointer = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left - left) / plotW))
    onBatch(Math.max(1, Math.round(2 ** (frac * 10))))
  }

  return (
    <div ref={ref} className="flex w-full flex-col gap-2">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block cursor-crosshair touch-pan-y select-none"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          setFromPointer(e)
        }}
        onPointerMove={(e) => e.buttons && setFromPointer(e)}
      >
        {panels.map((pn) => {
          const vals = curve.map((c) => c[pn.key])
          const lo = Math.floor(Math.log10(Math.min(...vals)))
          const hi = Math.max(lo + 1, Math.ceil(Math.log10(Math.max(...vals))))
          const y = (v: number) => pn.y0 + panelH - ((Math.log10(v) - lo) / (hi - lo)) * panelH
          const decades = Array.from({ length: hi - lo + 1 }, (_, i) => 10 ** (lo + i))
          const yTicks = decades.length > 4 ? decades.filter((_, i) => i % 2 === (decades.length - 1) % 2) : decades
          const path = curve.map((c, i) => `${i ? 'L' : 'M'}${x(c.b).toFixed(1)},${y(c[pn.key]).toFixed(1)}`).join('')
          return (
            <g key={pn.key}>
              <text x={left} y={pn.y0 - 6} fontSize={11} fill="var(--color-muted)">
                {pn.title}
              </text>
              {yTicks.map((v) => (
                <g key={v}>
                  <line x1={left} x2={left + plotW} y1={y(v)} y2={y(v)} stroke="var(--color-line)" />
                  <text x={left - 6} y={y(v)} dy="0.35em" textAnchor="end" fontSize={10} fill="var(--color-muted)">
                    {pn.fmt(v)}
                  </text>
                </g>
              ))}
              {limit < 1024 && <rect x={limitX} y={pn.y0} width={left + plotW - limitX} height={panelH} fill="var(--color-bad)" opacity={0.1} />}
              <path d={path} fill="none" stroke={pn.color} strokeWidth={2} />
              <circle cx={x(batch)} cy={y(current[pn.key])} r={5} fill={pn.color} stroke="var(--color-surface)" strokeWidth={2} />
            </g>
          )
        })}
        {knee !== null && knee <= 1024 && (
          <line x1={x(knee)} x2={x(knee)} y1={top} y2={bottom} stroke="var(--color-warn)" strokeDasharray="4 3" />
        )}
        <line x1={x(batch)} x2={x(batch)} y1={top} y2={bottom} stroke="var(--color-fg)" strokeOpacity={0.35} />
        {xTicks.map((b) => (
          <text key={b} x={x(b)} y={bottom + 14} textAnchor="middle" fontSize={10} fill="var(--color-muted)">
            {b}
          </text>
        ))}
        <text x={left + plotW / 2} y={height - 4} textAnchor="middle" fontSize={10} fill="var(--color-muted)">
          batch (concurrent requests, log scale) · tap or drag to set
        </text>
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 border-l-2 border-dashed border-warn" />
          {knee === null ? 'decode never compute-bound at this context' : knee > 1024 ? `compute-bound only above batch ${Math.round(knee)}` : `compute-bound from batch ${Math.round(knee)}`}
        </span>
        <Legend color="color-mix(in srgb, var(--color-bad) 30%, transparent)" label={limit === 0 ? 'weights don’t fit' : `KV memory full above batch ${limit}`} />
        <span>dot: current batch</span>
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
