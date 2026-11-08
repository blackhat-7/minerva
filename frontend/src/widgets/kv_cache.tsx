import { useEffect, useMemo, useState } from 'react'
import { Button, Segmented, Slider, Stat } from '../ui'
import { gpuIds, gpus, type GpuId } from './gpus'
import { allocate, capacity, requestLengths } from './kv_cache.math'
import { attnVariants, kvBytesPerToken, kvBytesPerTokenPerGpu, modelIds, models, nativeAttn, type Attn, type ModelId } from './models'
import type { WidgetProps } from './types'
import { useWidth } from './useWidth'
import { bytes } from './units'

type Props = {
  view: 'both' | 'sizing' | 'allocation'
  model: ModelId
  attention: Attn['id']
  kv_dtype: 'bf16' | 'fp8'
  weight_dtype: 'bf16' | 'fp8' | 'int4'
  gpu: GpuId
  tp: number
  seq_len: number
  batch: number
  mem_util: number
  requests: number
  seed: number
  max_len: number
  block_size: number
  prefix_tokens: number
  share_prefix: boolean
}

const defaults: Props = {
  view: 'both',
  model: 'llama31_70b',
  attention: 'GQA',
  kv_dtype: 'bf16',
  weight_dtype: 'bf16',
  gpu: 'H100_SXM',
  tp: 4,
  seq_len: 8192,
  batch: 32,
  mem_util: 0.9,
  requests: 12,
  seed: 1,
  max_len: 2048,
  block_size: 16,
  prefix_tokens: 256,
  share_prefix: false,
}

const dtypeBytes = { bf16: 2, fp8: 1, int4: 0.5 } as const
const tpOptions = ['1', '2', '4', '8'] as const
const blockOptions = ['8', '16', '32', '64', '128'] as const
const reqColors = ['var(--color-chart-1)', 'var(--color-chart-3)', 'var(--color-chart-4)', 'var(--color-chart-6)', 'var(--color-chart-2)']
const SHARED = 'var(--color-fg)'
const pct = (x: number) => `${(x * 100).toFixed(1)}%`
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

export default function KvCache({ props, onState }: WidgetProps<Props>) {
  const init = { ...defaults, ...props }
  const [modelId, setModelId] = useState(init.model)
  const [attnId, setAttnId] = useState(init.attention)
  const [kvDtype, setKvDtype] = useState(init.kv_dtype)
  const [wDtype, setWDtype] = useState(init.weight_dtype)
  const [gpuId, setGpuId] = useState(init.gpu)
  const [tp, setTp] = useState(init.tp)
  const [seqLog, setSeqLog] = useState(Math.round(Math.log2(init.seq_len)))
  const [batchLog, setBatchLog] = useState(Math.round(Math.log2(init.batch)))
  const [requests, setRequests] = useState(init.requests)
  const [seed, setSeed] = useState(init.seed)
  const [maxLen, setMaxLen] = useState(init.max_len)
  const [blockSize, setBlockSize] = useState(init.block_size)
  const [prefix, setPrefix] = useState(init.prefix_tokens)
  const [share, setShare] = useState(init.share_prefix)
  const [selected, setSelected] = useState<number | null>(null)

  const model = models[modelId]
  const gpu = gpus[gpuId]
  const variants = attnVariants(model)
  const attn = variants.find((a) => a.id === attnId) ?? nativeAttn(model)
  const seqLen = 2 ** seqLog
  const batch = 2 ** batchLog
  const kvB = dtypeBytes[kvDtype]
  const perToken = kvBytesPerToken(model, attn, kvB)
  const perTokenGpu = kvBytesPerTokenPerGpu(model, attn, kvB, tp)
  const cap = capacity(model, attn, kvB, dtypeBytes[wDtype], gpu.memory_gb, tp, seqLen, init.mem_util)
  const usable = gpu.memory_gb * 2 ** 30 * init.mem_util
  const batchKvPerGpu = batch * cap.kvPerSeqPerGpu
  const fits = cap.freePerGpu >= batchKvPerGpu

  const prefixEff = Math.min(prefix, maxLen - 64)
  const lengths = useMemo(() => requestLengths(requests, seed, maxLen, prefixEff), [requests, seed, maxLen, prefixEff])
  const paged = useMemo(() => allocate(lengths, maxLen, blockSize, prefixEff, false), [lengths, maxLen, blockSize, prefixEff])
  const alloc = useMemo(() => allocate(lengths, maxLen, blockSize, prefixEff, share), [lengths, maxLen, blockSize, prefixEff, share])
  const contigWaste = 1 - alloc.usedTokens / alloc.contiguousReserved
  const slack = alloc.blocks.reduce((s, b) => s + blockSize - b.used, 0)
  const fragFrac = slack / alloc.pagedReserved
  const sharingSaved = 1 - alloc.pagedReserved / paged.pagedReserved
  // Requests with this length mix that fit in the free KV memory, per scheme (shared blocks stored once).
  const freeTokens = Math.max(0, cap.freePerGpu) / perTokenGpu
  const sharedTokens = alloc.sharedBlocks * blockSize
  const fitContig = Math.floor(freeTokens / maxLen)
  const fitPaged = Math.max(0, Math.floor((freeTokens - sharedTokens) / ((alloc.pagedReserved - sharedTokens) / requests)))

  const showSizing = init.view !== 'allocation'
  const showAlloc = init.view !== 'sizing'
  const verdict = [
    showSizing &&
      (cap.freePerGpu <= 0
        ? 'weights alone do not fit; raise TP or quantize'
        : `${cap.maxSeqs} sequences of ${seqLen} tokens fit per TP group; batch ${batch} ${fits ? 'fits' : 'does not fit'}`),
    showAlloc &&
      `contiguous preallocation wastes ${pct(contigWaste)}; paged wastes ${pct(fragFrac)}${share ? `, sharing the prefix saves ${pct(sharingSaved)} more` : ''}`,
  ]
    .filter(Boolean)
    .join('; ')

  // Report on mount and whenever a reported value changes (compared by content, not object identity).
  const stateJson = JSON.stringify({
    model: model.name,
    ...(showSizing && {
      attention: attn.id,
      kv_heads: attn.id === 'MLA' ? 'latent 512+64' : attn.kv_heads,
      kv_dtype: kvDtype,
      weight_dtype: wDtype,
      gpu: gpu.name,
      tp,
      seq_len_tokens: seqLen,
      batch,
      kv_bytes_per_token: perToken,
      kv_bytes_per_sequence: perToken * seqLen,
      kv_bytes_for_batch: perToken * seqLen * batch,
      weights_gb_per_gpu: Number((cap.weightsPerGpu / 1e9).toFixed(2)),
      free_for_kv_gb_per_gpu: Number((cap.freePerGpu / 1e9).toFixed(2)),
      max_concurrent_sequences: cap.maxSeqs,
      batch_fits: fits,
    }),
    ...(showAlloc && {
      requests,
      max_len_tokens: maxLen,
      block_size_tokens: blockSize,
      prefix_tokens: prefixEff,
      share_prefix: share,
      used_tokens: alloc.usedTokens,
      contiguous_reserved_tokens: alloc.contiguousReserved,
      contiguous_waste_fraction: Number(contigWaste.toFixed(4)),
      paged_reserved_tokens: alloc.pagedReserved,
      paged_internal_fragmentation_fraction: Number(fragFrac.toFixed(4)),
      shared_prefix_blocks: alloc.sharedBlocks,
      requests_that_fit_contiguous: fitContig,
      requests_that_fit_paged: fitPaged,
    }),
    verdict,
  })
  useEffect(() => onState?.(JSON.parse(stateJson)), [onState, stateJson])

  const maxVariant = Math.max(...variants.map((a) => kvBytesPerToken(model, a, kvB)))
  const total = gpu.memory_gb * 2 ** 30
  const memScale = Math.max(total, cap.weightsPerGpu + batchKvPerGpu)

  return (
    <div className="flex flex-col gap-6">
      {showSizing && (
        <section className="flex flex-col gap-4">
          <h3 className="text-sm font-semibold">KV cache size</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Model"
              value={modelId}
              options={modelIds.map((id) => ({ value: id, label: models[id].name }))}
              onChange={(id) => {
                setModelId(id)
                setAttnId(nativeAttn(models[id]).id)
              }}
            />
            <Select label="GPU" value={gpuId} options={gpuIds.map((id) => ({ value: id, label: `${gpus[id].name} · ${gpus[id].memory_gb} GB` }))} onChange={setGpuId} />
            <Segmented
              label="Attention (what is cached)"
              value={attn.id}
              options={variants.map((a) => ({ value: a.id, label: a.native ? `${a.id} ✓` : a.id }))}
              onChange={setAttnId}
            />
            <Segmented label="Tensor parallel GPUs" value={String(tp) as (typeof tpOptions)[number]} options={tpOptions} onChange={(v) => setTp(Number(v))} />
            <Segmented label="KV dtype" value={kvDtype} options={['bf16', 'fp8'] as const} onChange={setKvDtype} />
            <Segmented label="Weights dtype" value={wDtype} options={['bf16', 'fp8', 'int4'] as const} onChange={setWDtype} />
            <Slider label="Sequence length" value={seqLog} min={9} max={17} onChange={setSeqLog} format={(v) => `${tokens(2 ** v)} tokens`} />
            <Slider label="Batch (concurrent sequences)" value={batchLog} min={0} max={9} onChange={setBatchLog} format={(v) => String(2 ** v)} />
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="KV per token" value={bytes(perToken)} />
            <Stat label={`Per sequence (${tokens(seqLen)})`} value={bytes(perToken * seqLen)} />
            <Stat label={`Batch of ${batch}`} value={bytes(perToken * seqLen * batch)} tone={fits ? undefined : 'bad'} />
            <Stat label="Max sequences that fit" value={cap.freePerGpu <= 0 ? 'weights don’t fit' : cap.maxSeqs} tone={cap.maxSeqs < batch ? 'bad' : 'good'} />
          </div>

          <div className="flex flex-col gap-2 text-xs">
            <span className="text-muted">
              Bytes per token = {attn.id === 'MLA'
                ? `layers ${model.layers} × (latent ${model.mla!.kv_lora_rank} + RoPE key ${model.mla!.rope_dim}) × ${kvB} B`
                : `2 (K,V) × layers ${model.layers} × KV heads ${attn.kv_heads} × head dim ${model.head_dim}${model.v_head_dim !== model.head_dim ? `/${model.v_head_dim}` : ''} × ${kvB} B`}{' '}
              = {perToken.toLocaleString()} B ({(perToken / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KiB)
            </span>
            {variants.map((a) => {
              const b = kvBytesPerToken(model, a, kvB)
              return (
                <button key={a.id} onClick={() => setAttnId(a.id)} className="flex min-h-7 items-center gap-2 text-left">
                  <span className={`w-12 shrink-0 font-mono ${a.id === attn.id ? 'text-fg' : 'text-muted'}`}>{a.id}</span>
                  <span className="h-3 flex-1 rounded bg-raised">
                    <span
                      className="block h-3 rounded transition-all"
                      style={{ width: `${Math.max(0.5, (b / maxVariant) * 100)}%`, background: a.id === attn.id ? 'var(--color-accent)' : 'var(--color-muted)' }}
                    />
                  </span>
                  <span className="w-20 shrink-0 text-right font-mono">{bytes(b)}/tok</span>
                </button>
              )
            })}
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs text-muted">One GPU’s memory ({gpu.memory_gb} GiB = {bytes(total)}, {pct(init.mem_util)} usable), batch {batch} × {tokens(seqLen)} tokens</span>
            <div className="relative flex h-7 w-full overflow-hidden rounded-lg bg-raised">
              <span className="h-full bg-chart-5" style={{ width: `${(cap.weightsPerGpu / memScale) * 100}%` }} />
              <span className="h-full bg-chart-1" style={{ width: `${(batchKvPerGpu / memScale) * 100}%` }} />
              <span className="absolute inset-y-0 border-l-2 border-dashed border-fg" style={{ left: `${(usable / memScale) * 100}%` }} />
              {memScale > total && <span className="absolute inset-y-0 right-0 bg-bad/40" style={{ width: `${(1 - total / memScale) * 100}%` }} />}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              <Legend color="var(--color-chart-5)" label={`weights ${bytes(cap.weightsPerGpu)}`} />
              <Legend color="var(--color-chart-1)" label={`KV ${bytes(batchKvPerGpu)} (${bytes(perTokenGpu)}/token on this GPU)`} />
              <span>dashed: usable limit · red: over capacity</span>
              {attn.id === 'MLA' && tp > 1 && <span>MLA latent is replicated on every TP rank</span>}
              {attn.id !== 'MLA' && tp > attn.kv_heads && <span>TP {tp} &gt; {attn.kv_heads} KV heads: heads replicated</span>}
            </div>
          </div>
        </section>
      )}

      {showAlloc && (
        <section className="flex flex-col gap-4">
          <h3 className="text-sm font-semibold">Allocating KV memory: contiguous vs paged</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Segmented label="Block size (tokens)" value={String(blockSize) as (typeof blockOptions)[number]} options={blockOptions} onChange={(v) => setBlockSize(Number(v))} />
            <Segmented
              label="Shared system prompt"
              value={share ? 'shared' : 'copied'}
              options={[{ value: 'copied', label: 'Copy per request' }, { value: 'shared', label: 'Share blocks' }]}
              onChange={(v) => setShare(v === 'shared')}
            />
            <Slider label="Requests" value={requests} min={2} max={32} onChange={setRequests} />
            <Slider label="System prompt" value={prefix} min={0} max={1024} step={16} onChange={setPrefix} format={(v) => `${Math.min(v, maxLen - 64)} tokens`} />
            <Slider label="Max length (reserved per request)" value={maxLen} min={512} max={4096} step={512} onChange={setMaxLen} format={(v) => `${v} tokens`} />
            <div className="flex items-end">
              <Button onClick={() => setSeed((s) => s + 1)} className="w-full">
                New random requests
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Tokens actually stored" value={alloc.usedTokens.toLocaleString()} />
            <Stat label="Contiguous: wasted" value={pct(contigWaste)} tone="bad" />
            <Stat label="Paged: internal fragmentation" value={pct(fragFrac)} tone={fragFrac < 0.1 ? 'good' : 'warn'} />
            <Stat label="Requests that fit: contig → paged" value={`${fitContig} → ${fitPaged}`} />
          </div>

          <MemoryMaps alloc={alloc} lengths={lengths} maxLen={maxLen} blockSize={blockSize} share={share} selected={selected} onSelect={setSelected} />

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            <span>each cell = one {blockSize}-token block · solid = filled with tokens · faint = reserved but empty</span>
            {share && <Legend color={SHARED} label={`shared prefix: ${alloc.sharedBlocks} blocks stored once for ${requests} requests`} />}
            {share && prefixEff % blockSize !== 0 && <span>the prompt’s partly filled last block is copied on write</span>}
            {selected !== null && (
              <span className="text-fg">
                request {selected + 1}: {lengths[selected]} tokens, {alloc.blocks.filter((b) => b.owner === selected).length} private blocks
              </span>
            )}
            <span>tap a request to highlight it</span>
          </div>
        </section>
      )}
    </div>
  )
}

/** Physical KV memory, drawn at the same scale for both schemes: contiguous reserves max_len per request,
 *  paged allocates blocks on demand from a shared pool. */
function MemoryMaps({
  alloc,
  lengths,
  maxLen,
  blockSize,
  share,
  selected,
  onSelect,
}: {
  alloc: ReturnType<typeof allocate>
  lengths: number[]
  maxLen: number
  blockSize: number
  share: boolean
  selected: number | null
  onSelect: (i: number | null) => void
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const perReq = maxLen / blockSize // cells reserved per request when contiguous
  // Each contiguous request gets a band of whole rows; pick the band height that makes the map ~220px tall.
  const layouts = Array.from({ length: perReq }, (_, i) => {
    const cols = Math.ceil(perReq / (i + 1))
    const cell = Math.min(24, Math.floor(width / cols))
    return { rowsPerReq: Math.ceil(perReq / cols), cols, cell, height: lengths.length * Math.ceil(perReq / cols) * cell }
  }).filter((l) => l.cell >= 3)
  const { rowsPerReq, cols, cell } = layouts.reduce((a, b) => (Math.abs(b.height - 220) < Math.abs(a.height - 220) ? b : a))
  const rows = (n: number) => Math.ceil(n / cols)
  const gap = cell >= 6 ? 1 : 0
  const color = (owner: number | 'shared') => (owner === 'shared' ? SHARED : reqColors[owner % reqColors.length])
  const dim = (owner: number | 'shared') => selected !== null && owner !== selected && owner !== 'shared'
  const toggle = (owner: number | 'shared') => onSelect(owner === 'shared' || owner === selected ? null : owner)

  // Split a run of cells [start, start+len) of the linear address space into one rect per row.
  const segments = (start: number, len: number) => {
    const out: { x: number; y: number; w: number }[] = []
    for (let pos = start, left = len; left > 1e-9; ) {
      const row = Math.floor(pos / cols)
      const col = pos - row * cols
      const n = Math.min(left, cols - col)
      out.push({ x: col * cell, y: row * cell, w: n * cell })
      pos += n
      left -= n
    }
    return out
  }

  const contigH = lengths.length * rowsPerReq * cell
  const pagedH = Math.max(cell, rows(alloc.blocks.length) * cell)
  const grid = (id: string) => (
    <pattern id={id} width={cell} height={cell} patternUnits="userSpaceOnUse">
      <path d={`M ${cell} 0 V ${cell} M 0 ${cell} H ${cell}`} stroke="var(--color-surface)" strokeWidth={gap} />
    </pattern>
  )

  return (
    <div ref={ref} className="flex w-full flex-col gap-3">
      <div className="flex justify-between text-xs">
        <span className="text-muted">Contiguous: every request reserves {maxLen} tokens</span>
        <span className="font-mono">{alloc.contiguousReserved.toLocaleString()} tokens</span>
      </div>
      <svg width={width} height={contigH} viewBox={`0 0 ${width} ${contigH}`} className="block">
        <defs>{grid('kv-grid-c')}</defs>
        {lengths.map((len, i) => (
          <g key={i} opacity={dim(i) ? 0.2 : 1} onClick={() => toggle(i)} className="cursor-pointer">
            {segments(i * rowsPerReq * cols, perReq).map((s, k) => (
              <rect key={`r${k}`} x={s.x} y={s.y} width={s.w} height={cell} fill={color(i)} fillOpacity={0.14} />
            ))}
            {segments(i * rowsPerReq * cols, len / blockSize).map((s, k) => (
              <rect key={`u${k}`} x={s.x} y={s.y} width={s.w} height={cell} fill={color(i)} />
            ))}
          </g>
        ))}
        {gap > 0 && <rect width={cols * cell} height={contigH} fill="url(#kv-grid-c)" className="pointer-events-none" />}
      </svg>

      <div className="flex justify-between text-xs">
        <span className="text-muted">Paged: blocks of {blockSize} tokens from a shared pool{share ? ', prefix shared' : ''}</span>
        <span className="font-mono">{alloc.pagedReserved.toLocaleString()} tokens</span>
      </div>
      <svg width={width} height={pagedH} viewBox={`0 0 ${width} ${pagedH}`} className="block">
        <defs>{grid('kv-grid-p')}</defs>
        {alloc.blocks.map((b) => {
          const x = (b.id % cols) * cell
          const y = Math.floor(b.id / cols) * cell
          return (
            <g key={b.id} opacity={dim(b.owner) ? 0.2 : 1} onClick={() => toggle(b.owner)} className="cursor-pointer">
              {b.used < blockSize && <rect x={x} y={y} width={cell} height={cell} fill={color(b.owner)} fillOpacity={0.14} />}
              <rect x={x} y={y} width={(cell * b.used) / blockSize} height={cell} fill={color(b.owner)} />
            </g>
          )
        })}
        {gap > 0 && <rect width={cols * cell} height={pagedH} fill="url(#kv-grid-p)" className="pointer-events-none" />}
      </svg>
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
