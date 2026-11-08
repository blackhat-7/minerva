import { useEffect, useState } from 'react'
import { Segmented, Slider, Stat } from '../ui'
import { gpuIds, gpus, type GpuId } from './gpus'
import { models } from './models'
import { commPerStep, memory, type Recompute, type ZeroStage } from './parallel_memory.math'
import type { WidgetProps } from './types'
import { bytes, si } from './units'

type ModelKey = 'llama3_8b' | 'llama3_70b' | 'llama3_405b' | 'custom'
type Props = {
  model: ModelKey
  params_b: number
  layers: number
  hidden: number
  heads: number
  seq_len: number
  micro_batch: number
  micro_batches: number
  dp: number
  tp: number
  pp: number
  zero_stage: ZeroStage
  recompute: Recompute
  sequence_parallel: boolean
  gpu: GpuId
}
const defaults: Props = {
  model: 'llama3_70b', params_b: 13, layers: 40, hidden: 5120, heads: 40, seq_len: 4096, micro_batch: 1,
  micro_batches: 8, dp: 8, tp: 8, pp: 1, zero_stage: 1, recompute: 'selective', sequence_parallel: true, gpu: 'H100_SXM',
}
const presets = { llama3_8b: models.llama31_8b, llama3_70b: models.llama31_70b, llama3_405b: models.llama31_405b }
const modelOptions: { value: ModelKey; label: string }[] = [
  { value: 'llama3_8b', label: '8B' },
  { value: 'llama3_70b', label: '70B' },
  { value: 'llama3_405b', label: '405B' },
  { value: 'custom', label: 'custom' },
]
const zeroOptions: { value: `${ZeroStage}`; label: string }[] = [
  { value: '0', label: '0 (DDP)' },
  { value: '1', label: '1' },
  { value: '2', label: '2' },
  { value: '3', label: '3 (FSDP)' },
]
const GiB = 2 ** 30
const gib = (b: number) => `${Number((b / GiB).toPrecision(3))} GiB`
const pow2 = (v: number) => Math.round(2 ** v)
const segments = [
  { key: 'params', label: 'Params (bf16)', color: 'var(--color-chart-1)' },
  { key: 'grads', label: 'Grads (bf16)', color: 'var(--color-chart-2)' },
  { key: 'optimizer', label: 'Optimizer (fp32 master, m, v)', color: 'var(--color-chart-3)' },
  { key: 'activations', label: 'Activations', color: 'var(--color-chart-4)' },
] as const

export default function ParallelMemory({ props, onState }: WidgetProps<Props>) {
  const init = { ...defaults, ...props }
  const [modelKey, setModel] = useState<ModelKey>(init.model)
  const [custom, setCustom] = useState({ params: init.params_b * 1e9, layers: init.layers, hidden: init.hidden, heads: init.heads })
  const [seq, setSeq] = useState(init.seq_len)
  const [b, setB] = useState(init.micro_batch)
  const [m, setM] = useState(init.micro_batches)
  const [dp, setDp] = useState(init.dp)
  const [tp, setTp] = useState(init.tp)
  const [pp, setPp] = useState(init.pp)
  const [zero, setZero] = useState<ZeroStage>(init.zero_stage)
  const [recompute, setRecompute] = useState<Recompute>(init.recompute)
  const [sp, setSp] = useState(init.sequence_parallel)
  const [gpuId, setGpu] = useState<GpuId>(init.gpu)

  const preset = modelKey === 'custom' ? null : presets[modelKey]
  const arch = preset
    ? { params: preset.params, layers: preset.layers, hidden: preset.d_model, heads: preset.heads }
    : custom
  const cfg = { ...arch, seq, microBatch: b, microBatches: m, dp, tp, pp, zero, recompute, sequenceParallel: sp && tp > 1 }
  const mem = memory(cfg)
  const comm = commPerStep(cfg)
  const gpu = gpus[gpuId]
  const cap = gpu.memory_gb * GiB
  const over = mem.total > cap
  const scale = Math.max(mem.total, cap) * 1.06
  const biggest = segments.reduce((a, s) => (mem[s.key] > mem[a.key] ? s : a))
  const warnings = [
    arch.heads % tp !== 0 && `TP ${tp} does not divide ${arch.heads} heads`,
    arch.layers % pp !== 0 && `PP ${pp} does not divide ${arch.layers} layers (first stage gets ${mem.layersPerStage})`,
    m < pp && `m = ${m} < p = ${pp}: the pipeline is mostly bubble`,
  ].filter(Boolean) as string[]
  const verdict = over
    ? `OOM: needs ${gib(mem.total)} per GPU, ${gpu.name} has ${gpu.memory_gb} GiB; largest part is ${biggest.label.toLowerCase()} (${gib(mem[biggest.key])})`
    : `fits: ${gib(mem.total)} of ${gpu.memory_gb} GiB (${Math.round((mem.total / cap) * 100)}%); largest part is ${biggest.label.toLowerCase()}`

  const state = {
    model: preset?.name ?? 'custom',
    params: arch.params,
    layers: arch.layers,
    hidden: arch.hidden,
    heads: arch.heads,
    seq_len: seq,
    micro_batch: b,
    micro_batches_per_step: m,
    dp,
    tp,
    pp,
    gpus_total: dp * tp * pp,
    global_batch_tokens: seq * b * m * dp,
    zero_stage: zero,
    recompute,
    sequence_parallel: cfg.sequenceParallel,
    gpu: gpu.name,
    gpu_memory_gib: gpu.memory_gb,
    params_gib: +(mem.params / GiB).toPrecision(4),
    grads_gib: +(mem.grads / GiB).toPrecision(4),
    optimizer_gib: +(mem.optimizer / GiB).toPrecision(4),
    activations_gib: +(mem.activations / GiB).toPrecision(4),
    total_gib: +(mem.total / GiB).toPrecision(4),
    fits: !over,
    layers_per_stage: mem.layersPerStage,
    inflight_microbatches_first_stage: mem.inflight,
    comm_dp_gb_per_step: +(comm.dp / 1e9).toPrecision(4),
    comm_tp_gb_per_step: +(comm.tp / 1e9).toPrecision(4),
    comm_pp_gb_per_step: +(comm.pp / 1e9).toPrecision(4),
    warnings,
    verdict,
  }
  const stateKey = JSON.stringify(state)
  useEffect(() => onState?.(JSON.parse(stateKey)), [stateKey, onState])

  return (
    <div className="flex flex-col gap-4">
      <Segmented label="Model (Llama-3)" value={modelKey} options={modelOptions} onChange={setModel} />

      {/* Stacked memory bar vs GPU capacity */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <span className="text-muted">Per-GPU memory (first pipeline stage)</span>
          <span className={`tabular font-mono ${over ? 'text-bad' : 'text-good'}`}>
            {gib(mem.total)} / {gpu.memory_gb} GiB
          </span>
        </div>
        <div className="relative h-12 w-full overflow-hidden rounded-xl bg-raised">
          <div className="flex h-full">
            {segments.map((s) => (
              <div
                key={s.key}
                title={`${s.label}: ${gib(mem[s.key])}`}
                className="h-full transition-[width] duration-200 ease-out"
                style={{ width: `${(mem[s.key] / scale) * 100}%`, background: s.color }}
              />
            ))}
          </div>
          {over && (
            <div
              className="absolute inset-y-0"
              style={{
                left: `${(cap / scale) * 100}%`,
                width: `${((mem.total - cap) / scale) * 100}%`,
                background: 'repeating-linear-gradient(135deg, color-mix(in srgb, var(--color-bad) 55%, transparent) 0 6px, transparent 6px 12px)',
              }}
            />
          )}
          <div
            className={`absolute inset-y-0 w-0.5 ${over ? 'bg-bad' : 'bg-fg'}`}
            style={{ left: `${(cap / scale) * 100}%` }}
          />
        </div>
        <div className="relative h-4 text-xs text-muted">
          <span
            className={`absolute whitespace-nowrap ${over ? 'text-bad' : ''}`}
            style={
              cap / scale > 0.6
                ? { right: `${(1 - cap / scale) * 100}%` }
                : { left: `${(cap / scale) * 100}%` }
            }
          >
            {cap / scale > 0.6 ? `${gpu.name} ${gpu.memory_gb} GiB ▸` : `◂ ${gpu.name} ${gpu.memory_gb} GiB`}
          </span>
        </div>
        <ul className="grid gap-x-10 gap-y-1 text-sm sm:grid-cols-2">
          {segments.map((s) => (
            <li key={s.key} className="flex items-center gap-2">
              <span className="size-3 shrink-0 rounded" style={{ background: s.color }} />
              <span className="text-muted">{s.label}</span>
              <span className="tabular ml-auto whitespace-nowrap font-mono">{gib(mem[s.key])}</span>
            </li>
          ))}
        </ul>
        <p className={`text-sm ${over ? 'text-bad' : 'text-good'}`}>{verdict}.</p>
        {warnings.length > 0 && <p className="text-xs text-warn">{warnings.join(' · ')}</p>}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="GPUs (DP×TP×PP)" value={dp * tp * pp} />
        <Stat label="Global batch" value={`${si(seq * b * m * dp)} tokens`} />
        <Stat label="Layers / stage" value={mem.layersPerStage} />
        <Stat label="Micro-batches in flight" value={mem.inflight} />
        <Stat label="DP traffic / step" value={bytes(comm.dp)} />
        <Stat label="TP traffic / step" value={bytes(comm.tp)} />
        <Stat label="PP traffic / step" value={bytes(comm.pp)} />
        <Stat label="Total sent / GPU / step" value={bytes(comm.total)} />
      </div>

      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {modelKey === 'custom' && (
          <>
            <Slider label="Parameters" value={Math.log10(custom.params / 1e9)} min={-1} max={3.3} step={0.01}
              onChange={(v) => setCustom({ ...custom, params: Number((10 ** v).toPrecision(2)) * 1e9 })}
              format={() => `${Number((custom.params / 1e9).toPrecision(3))}B`} />
            <Slider label="Layers L" value={custom.layers} min={1} max={160} onChange={(v) => setCustom({ ...custom, layers: v })} />
            <Slider label="Hidden h" value={custom.hidden} min={512} max={32768} step={256}
              onChange={(v) => setCustom({ ...custom, hidden: v })} />
            <Slider label="Heads a" value={custom.heads} min={1} max={256} onChange={(v) => setCustom({ ...custom, heads: v })} />
          </>
        )}
        <Slider label="Sequence length s" value={Math.log2(seq)} min={9} max={17} onChange={(v) => setSeq(pow2(v))}
          format={() => String(seq)} />
        <Slider label="Micro-batch b" value={Math.log2(b)} min={0} max={6} onChange={(v) => setB(pow2(v))} format={() => String(b)} />
        <Slider label="Micro-batches per step m" value={m} min={1} max={64} onChange={setM} />
        <Slider label="Data parallel DP" value={Math.log2(dp)} min={0} max={11} onChange={(v) => setDp(pow2(v))}
          format={() => String(dp)} />
        <Segmented label="Tensor parallel TP" value={String(tp)} options={['1', '2', '4', '8', '16']} onChange={(v) => setTp(Number(v))} />
        <Slider label="Pipeline parallel PP" value={pp} min={1} max={32} onChange={setPp} />
        <Segmented label="ZeRO stage" value={`${zero}`} options={zeroOptions} onChange={(v) => setZero(Number(v) as ZeroStage)} />
        <Segmented label="Activation recompute" value={recompute} options={['none', 'selective', 'full'] as const} onChange={setRecompute} />
        <Segmented
          label={`Sequence parallel${tp === 1 ? ' (needs TP > 1)' : ''}`}
          value={sp ? 'on' : 'off'}
          options={['off', 'on'] as const}
          onChange={(v) => setSp(v === 'on')}
        />
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">GPU</span>
          <select value={gpuId} onChange={(e) => setGpu(e.target.value as GpuId)}
            className="min-h-11 rounded-xl border border-line bg-raised px-3 text-fg">
            {gpuIds.map((id) => (
              <option key={id} value={id}>
                {gpus[id].name} ({gpus[id].memory_gb} GiB)
              </option>
            ))}
          </select>
        </label>
      </div>

      <details className="rounded-xl bg-raised px-4 py-3 text-sm text-muted">
        <summary className="min-h-8 cursor-pointer text-fg">How this is computed</summary>
        <div className="mt-2 flex flex-col gap-2 leading-relaxed">
          <p>
            <span className="text-fg">Model states</span> (mixed-precision Adam, 16 bytes/param): Ψ′ = Ψ / (TP·PP);
            params 2Ψ′, grads 2Ψ′, optimizer 12Ψ′ (fp32 master + m + v). ZeRO-1 divides the optimizer by DP, ZeRO-2
            also the grads, ZeRO-3 (= FSDP full shard) also the params. Simplification: TP·PP split every parameter
            evenly (embeddings on the first/last stage and TP-replicated norms ignored).
          </p>
          <p>
            <span className="text-fg">Activations per layer</span> (Korthikanti et al. 2022, Table 2; bytes, 16-bit):
            none: sbh(10 + 24/t + 5as/(ht)), with sequence parallel sbh(34/t + 5as/(ht)); selective recompute:
            sbh(10 + 24/t), with SP 34·sbh/t; full recompute: 2sbh (only each layer’s input). Here s = {seq}, b = {b},
            h = {arch.hidden}, a = {arch.heads}, t = {tp}. Multiplied by ⌈L/PP⌉ = {mem.layersPerStage} layers and, for
            1F1B, min(m, PP) = {mem.inflight} micro-batches in flight on the first stage. The formula is for GPT-style
            blocks (multi-head attention, 4h GELU MLP); Llama’s GQA and SwiGLU change the constants somewhat.
            Excludes embedding/logits activations, temporary buffers, fragmentation and the CUDA context (often
            several GiB).
          </p>
          <p>
            <span className="text-fg">Communication</span> (bytes each GPU sends per optimizer step, ring collectives:
            all-reduce 2(n−1)/n·S, reduce-scatter / all-gather (n−1)/n·S). DP: ZeRO-0 all-reduces bf16 grads once
            (2·2Ψ′·(d−1)/d); ZeRO-1 reduce-scatters grads and all-gathers params once (same volume); ZeRO-2 reduce-
            scatters every micro-batch plus one param all-gather; ZeRO-3 all-gathers params in each micro-batch’s
            forward and backward and reduce-scatters grads (3× per micro-batch, 1.5× DDP at m = 1). TP: 4 all-reduces
            of a bf16 s·b·h tensor per layer per micro-batch (2 fwd, 2 bwd; +2 with full recompute; sequence
            parallel replaces each with all-gather + reduce-scatter, same bytes). PP: one activation forward and one
            gradient backward of s·b·h per micro-batch (÷t with SP). Volumes only; overlap with compute is not
            modelled.
          </p>
          <p>GPU memory is the vendor figure, which for these parts equals GiB (2³⁰ bytes).</p>
        </div>
      </details>
    </div>
  )
}
