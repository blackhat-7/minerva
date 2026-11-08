import { useEffect, useState } from 'react'
import { Segmented, Slider, Stat } from '../ui'
import { gpuIds, gpus, type Dtype, type Gpu, type GpuId } from './gpus'
import { attainable, gemm, mToReachRidge, opTime, roof, type Roof } from './roofline.math'
import type { WidgetProps } from './types'
import { bytes, duration, si } from './units'
import { useWidth } from './useWidth'

type Props = { gpu: GpuId; dtype: Dtype; m: number; k: number; n: number; compare_gpus: GpuId[] }
const defaults: Props = { gpu: 'H100_SXM', dtype: 'bf16', m: 1, k: 8192, n: 8192, compare_gpus: [] }
const dtypes = ['fp32', 'bf16', 'fp16', 'fp8', 'int8'] as const satisfies readonly Dtype[]
const presets = [
  { label: 'decode (batch 1)', m: 1 },
  { label: 'decode (batch 64)', m: 64 },
  { label: 'prefill (2048 tokens)', m: 2048 },
]
const color = (i: number) => `var(--color-chart-${(i % 6) + 1})`
const num = (x: number) => String(Number(x.toPrecision(3)))
const tick = (v: number) => (v >= 1000 ? `${v / 1000}K` : String(v))

// Chart text is monospace 11px, so a label's box is known before it is drawn.
const FONT = 11
const CHAR_W = FONT * 0.6
type Box = { x: number; y: number; w: number; h: number }
type Anchor = 'start' | 'end'
type Label = { text: string; x: number; y: number; anchor: Anchor; fill: string }
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** Place each label at its first candidate baseline (x, y) that stays inside the plot and clear of earlier labels. */
function placeLabels(
  items: { text: string; fill: string; candidates: [number, number, Anchor][] }[],
  bounds: Box,
  obstacles: Box[],
): Label[] {
  const placed: Box[] = [...obstacles]
  const inside = (b: Box) =>
    b.x >= bounds.x && b.x + b.w <= bounds.x + bounds.w && b.y >= bounds.y && b.y + b.h <= bounds.y + bounds.h
  return items.map((it) => {
    const w = it.text.length * CHAR_W
    const options = it.candidates.map(([x, y, anchor]) => ({
      at: { x, y, anchor },
      box: { x: anchor === 'end' ? x - w : x, y: y - FONT, w, h: FONT + 3 },
    }))
    const pick =
      options.find((o) => inside(o.box) && !placed.some((p) => overlaps(p, o.box))) ??
      options.find((o) => inside(o.box)) ??
      options[0]
    placed.push(pick.box)
    return { text: it.text, fill: it.fill, ...pick.at }
  })
}

export default function Roofline({ props, onState }: WidgetProps<Props>) {
  const init = { ...defaults, ...props }
  const [gpuId, setGpu] = useState<GpuId>(init.gpu)
  const [dtype, setDtype] = useState<Dtype>(init.dtype)
  const [m, setM] = useState(init.m)
  const [k, setK] = useState(init.k)
  const [n, setN] = useState(init.n)
  const [compare, setCompare] = useState<GpuId[]>(init.compare_gpus)

  const gpu = gpus[gpuId]
  const r = roof(gpu, dtype)
  const op = gemm(m, k, n, dtype)
  const att = attainable(r, op.intensity)
  const time = opTime(r, op.flops, op.bytes)
  const bound = op.intensity < r.ridge ? 'memory' : 'compute'
  const mRidge = mToReachRidge(r, k, n, dtype)
  const others = compare.filter((g) => g !== gpuId).map((id) => ({ id, gpu: gpus[id], roof: roof(gpus[id], dtype) }))
  const noFp8 = dtype === 'fp8' && gpu.fp8_tflops === null
  const unit = dtype === 'int8' ? 'TOPS' : 'TFLOP/s'

  const verdict =
    bound === 'memory'
      ? `memory-bound: intensity ${num(op.intensity)} FLOP/B is below the ridge ${num(r.ridge)} FLOP/B, so the op runs at ${num((att / r.peak) * 100)}% of peak` +
        (Number.isFinite(mRidge) ? `; M ≈ ${Math.ceil(mRidge)} reaches the ridge` : '; no M reaches the ridge at this K and N')
      : `compute-bound: intensity ${num(op.intensity)} FLOP/B is at or above the ridge ${num(r.ridge)} FLOP/B, so the op runs at peak`

  const state = {
    gpu: gpu.name,
    dtype,
    gemm_m_tokens: m,
    gemm_k: k,
    gemm_n: n,
    flops: op.flops,
    bytes_moved: op.bytes,
    intensity_flop_per_byte: +op.intensity.toPrecision(4),
    ridge_flop_per_byte: +r.ridge.toPrecision(4),
    peak_tflops: r.peak / 1e12,
    hbm_bandwidth_tb_per_s: gpu.hbm_tbps,
    attainable_tflops: +(att / 1e12).toPrecision(4),
    fraction_of_peak: +(att / r.peak).toPrecision(3),
    op_time_us: +(time * 1e6).toPrecision(4),
    bound,
    m_to_reach_ridge: Number.isFinite(mRidge) ? Math.ceil(mRidge) : null,
    compare: others.map((o) => ({
      gpu: o.gpu.name,
      ridge_flop_per_byte: +o.roof.ridge.toPrecision(4),
      attainable_tflops: +(attainable(o.roof, op.intensity) / 1e12).toPrecision(4),
      op_time_us: +(opTime(o.roof, op.flops, op.bytes) * 1e6).toPrecision(4),
    })),
    verdict,
  }
  const stateKey = JSON.stringify(state)
  useEffect(() => onState?.(JSON.parse(stateKey)), [stateKey, onState])

  const tone = bound === 'memory' ? 'warn' : 'good'
  const dimSlider = (label: string, value: number, set: (v: number) => void) => (
    <Slider
      label={label}
      value={Math.log2(value)}
      min={6}
      max={16}
      step={0.125}
      onChange={(v) => set(Math.max(64, Math.round(2 ** v / 64) * 64))}
      format={() => String(value)}
    />
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {presets.map((p) => (
          <button
            key={p.label}
            onClick={() => setM(p.m)}
            className={`min-h-9 rounded-full border px-3 text-sm transition ${
              m === p.m ? 'border-accent bg-accent/15 text-fg' : 'border-line text-muted hover:text-fg'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <Chart roofs={[{ id: gpuId, gpu, roof: r }, ...others]} intensity={op.intensity} unit={unit} />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Intensity" value={`${num(op.intensity)} FLOP/B`} />
        <Stat label="Ridge point" value={`${num(r.ridge)} FLOP/B`} />
        <Stat label="Attainable" value={`${num(att / 1e12)} ${unit}`} tone={tone} />
        <Stat label="Share of peak" value={`${num((att / r.peak) * 100)}%`} tone={tone} />
        <Stat label="Op time" value={duration(time)} />
        <Stat label="Bound" value={`${bound}`} tone={tone} />
        <Stat label="Work (2MNK)" value={si(op.flops, dtype === 'int8' ? 'OP' : 'FLOP')} />
        <Stat label="Bytes moved" value={bytes(op.bytes)} />
      </div>

      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">GPU</span>
          <select
            value={gpuId}
            onChange={(e) => setGpu(e.target.value as GpuId)}
            className="min-h-11 rounded-xl border border-line bg-raised px-3 text-fg"
          >
            {gpuIds.map((id) => (
              <option key={id} value={id}>
                {gpus[id].name}
              </option>
            ))}
          </select>
        </label>
        <Segmented label="dtype (operands and output)" value={dtype} options={dtypes} onChange={setDtype} />
        <Slider
          label="M: batch tokens"
          value={Math.log2(m)}
          min={0}
          max={14}
          step={0.125}
          onChange={(v) => setM(Math.round(2 ** v))}
          format={() => String(m)}
        />
        {dimSlider('K: d_model (input dim)', k, setK)}
        {dimSlider('N: output dim', n, setN)}
        <div className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Compare roofs</span>
          <div className="flex flex-wrap gap-1">
            {gpuIds
              .filter((id) => id !== gpuId)
              .map((id) => {
                const i = others.findIndex((o) => o.id === id)
                return (
                  <button
                    key={id}
                    onClick={() => setCompare(i >= 0 ? compare.filter((g) => g !== id) : [...compare, id])}
                    className={`flex min-h-9 items-center gap-1.5 rounded-full border border-line px-3 text-xs transition ${
                      i >= 0 ? 'bg-raised text-fg' : 'text-muted hover:text-fg'
                    }`}
                  >
                    <span className="size-2 rounded-full" style={{ background: i >= 0 ? color(i + 1) : 'var(--color-line)' }} />
                    {gpus[id].name}
                  </button>
                )
              })}
          </div>
        </div>
      </div>

      <p className="text-sm text-muted">
        <span className={bound === 'memory' ? 'text-warn' : 'text-good'}>{verdict}.</span> FLOPs = 2·M·N·K; bytes ={' '}
        {dtype} size × (M·K + K·N + M·N), each matrix moved through HBM once; time = max(FLOPs / peak, bytes /
        bandwidth). Dense peak rates.
        {dtype === 'fp32' && ' fp32 uses the TF32 tensor-core rate.'}
        {noFp8 && ` ${gpu.name} has no FP8 tensor cores: FP8 storage with BF16 math is assumed.`}
        {dtype === 'int8' && ' int8 peak is integer TOPS.'}
      </p>
    </div>
  )
}

function Chart({ roofs, intensity, unit }: { roofs: { id: GpuId; gpu: Gpu; roof: Roof }[]; intensity: number; unit: string }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const narrow = width < 520
  const height = narrow ? 280 : 340
  const mg = { l: 50, r: 12, t: 12, b: 44 }
  const pw = width - mg.l - mg.r
  const ph = height - mg.t - mg.b
  const bottom = mg.t + ph

  const primary = roofs[0].roof
  const att = attainable(primary, intensity)
  // Whole decades; x always spans 1..10^4 so every ridge in the GPU table is visible.
  const xlo = 10 ** Math.floor(Math.log10(Math.min(1, intensity / 1.5)))
  const xhi = 10 ** Math.ceil(Math.log10(Math.max(1e4, intensity * 1.5)))
  const ylo = 10 ** Math.floor(Math.log10(Math.min(...roofs.map((o) => o.roof.bw * xlo)) / 1e12))
  const yhi = (Math.max(...roofs.map((o) => o.roof.peak)) * 3) / 1e12 // headroom for the peak labels
  const sx = (x: number) => mg.l + (Math.log10(x / xlo) / Math.log10(xhi / xlo)) * pw
  const sy = (tf: number) => bottom - (Math.log10(tf / ylo) / Math.log10(yhi / ylo)) * ph
  const decades = (lo: number, hi: number) =>
    Array.from({ length: Math.floor(Math.log10(hi / lo) + 1e-9) + 1 }, (_, i) => lo * 10 ** i)
  const xt = decades(xlo, xhi)
  const yt = decades(ylo, yhi)
  const xStep = narrow && xt.length > 6 ? 2 : 1
  const minor = (ts: number[], hi: number) =>
    ts.flatMap((t) => [2, 3, 4, 5, 6, 7, 8, 9].map((j) => t * j)).filter((v) => v < hi)

  const roofPath = (r: Roof) =>
    `M${sx(xlo)},${sy((r.bw * xlo) / 1e12)} L${sx(r.ridge)},${sy(r.peak / 1e12)} L${sx(xhi)},${sy(r.peak / 1e12)}`
  const px = sx(intensity)
  const py = sy(att / 1e12)
  const rx = sx(primary.ridge)
  const ry = sy(primary.peak / 1e12)

  // Memory-roof label sits on the line 35% of the way (in log x) from the left edge to the ridge.
  const mx = xlo * (primary.ridge / xlo) ** 0.35
  const mpx = sx(mx)
  const mpy = sy((primary.bw * mx) / 1e12)
  const right = mg.l + pw - 4
  const labels = placeLabels(
    [
      ...roofs.map((o, i) => {
        const y = sy(o.roof.peak / 1e12)
        return {
          text: `${o.gpu.name} ${num(o.roof.peak / 1e12)} ${unit}`,
          fill: color(i),
          candidates: [y - 6, y + 15, y - 20, y + 29, y - 34].map((yy): [number, number, Anchor] => [right, yy, 'end']),
        }
      }),
      {
        text: `HBM ${num(roofs[0].gpu.hbm_tbps)} TB/s`,
        fill: color(0),
        candidates: [
          [mpx - 6, mpy - 6, 'end'],
          [mpx + 8, mpy + 16, 'start'],
          [mpx - 6, mpy - 22, 'end'],
        ],
      },
      {
        text: `${num(intensity)} FLOP/B → ${num(att / 1e12)} ${unit}`,
        fill: 'var(--color-fg)',
        candidates: [
          [px + 10, py + 18, 'start'],
          [px - 10, py + 18, 'end'],
          [px + 10, py + 32, 'start'],
          [px - 10, py + 32, 'end'],
          [px + 10, py + 46, 'start'],
          [px - 10, py + 46, 'end'],
        ],
      },
      {
        text: `ridge ${num(primary.ridge)} FLOP/B`,
        fill: 'var(--color-muted)',
        candidates: [
          [rx + 6, bottom - 6, 'start'],
          [rx - 6, bottom - 6, 'end'],
          [rx + 6, bottom - 20, 'start'],
          [rx - 6, bottom - 20, 'end'],
        ],
      },
    ],
    { x: mg.l, y: mg.t, w: pw, h: ph },
    [py, ...roofs.slice(1).map((o) => sy(attainable(o.roof, intensity) / 1e12))].map((y) => ({ x: px - 8, y: y - 8, w: 16, h: 16 })),
  )

  return (
    <div ref={ref} className="w-full">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block select-none"
        role="img"
        aria-label={`Roofline: intensity ${num(intensity)} FLOP per byte, attainable ${num(att / 1e12)} ${unit}`}
      >
        <defs>
          <linearGradient id="roofline-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--color-chart-1)" stopOpacity="0.18" />
            <stop offset="1" stopColor="var(--color-chart-1)" stopOpacity="0.02" />
          </linearGradient>
          <clipPath id="roofline-plot">
            <rect x={mg.l} y={mg.t} width={pw} height={ph} />
          </clipPath>
        </defs>
        <g className="stroke-line" strokeWidth={1}>
          {minor(xt, xhi).map((v) => (
            <line key={`mx${v}`} x1={sx(v)} x2={sx(v)} y1={mg.t} y2={bottom} strokeOpacity={0.35} />
          ))}
          {minor(yt, yhi).map((v) => (
            <line key={`my${v}`} x1={mg.l} x2={mg.l + pw} y1={sy(v)} y2={sy(v)} strokeOpacity={0.35} />
          ))}
          {xt.map((v) => (
            <line key={`x${v}`} x1={sx(v)} x2={sx(v)} y1={mg.t} y2={bottom} />
          ))}
          {yt.map((v) => (
            <line key={`y${v}`} x1={mg.l} x2={mg.l + pw} y1={sy(v)} y2={sy(v)} />
          ))}
        </g>
        <g className="fill-muted font-mono" fontSize={FONT}>
          {xt.map((v, i) =>
            i % xStep === 0 ? (
              <text key={v} x={sx(v)} y={bottom + 16} textAnchor="middle">
                {tick(v)}
              </text>
            ) : null,
          )}
          {yt.map((v) => (
            <text key={v} x={mg.l - 6} y={sy(v) + 4} textAnchor="end">
              {tick(v)}
            </text>
          ))}
        </g>
        <text x={mg.l + pw / 2} y={height - 6} textAnchor="middle" className="fill-muted" fontSize={12}>
          Arithmetic intensity (FLOP/byte, log)
        </text>
        <text
          x={12}
          y={mg.t + ph / 2}
          textAnchor="middle"
          className="fill-muted"
          fontSize={12}
          transform={`rotate(-90 12 ${mg.t + ph / 2})`}
        >
          Attainable {unit} (log)
        </text>

        <g clipPath="url(#roofline-plot)">
          <path d={`${roofPath(primary)} L${sx(xhi)},${bottom} L${sx(xlo)},${bottom} Z`} fill="url(#roofline-fill)" />
          {roofs.slice(1).map((o, i) => (
            <g key={o.id}>
              <path d={roofPath(o.roof)} fill="none" stroke={color(i + 1)} strokeWidth={1.5} strokeDasharray="5 4" />
              <circle cx={sx(o.roof.ridge)} cy={sy(o.roof.peak / 1e12)} r={3} fill={color(i + 1)} />
              <circle
                cx={px}
                cy={sy(attainable(o.roof, intensity) / 1e12)}
                r={4.5}
                fill="var(--color-surface)"
                stroke={color(i + 1)}
                strokeWidth={2}
              />
            </g>
          ))}
          <path d={roofPath(primary)} fill="none" stroke={color(0)} strokeWidth={2.5} strokeLinejoin="round" />
          <line x1={rx} x2={rx} y1={ry} y2={bottom} className="stroke-muted" strokeDasharray="3 4" />
          <circle cx={rx} cy={ry} r={4} fill={color(0)} />
          <line x1={px} x2={px} y1={py} y2={bottom} stroke="var(--color-fg)" strokeOpacity={0.25} />
          <circle cx={px} cy={py} r={6.5} fill="var(--color-fg)" stroke="var(--color-bg)" strokeWidth={2.5} />
        </g>
        <g className="font-mono" fontSize={FONT} paintOrder="stroke" stroke="var(--color-surface)" strokeWidth={4} strokeLinejoin="round">
          {labels.map((l) => (
            <text key={l.text} x={l.x} y={l.y} textAnchor={l.anchor} fill={l.fill}>
              {l.text}
            </text>
          ))}
        </g>
      </svg>
    </div>
  )
}
