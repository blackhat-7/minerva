// Roofline-style LLM serving latency model: static batch of B requests on n tensor-parallel GPUs.
// Each phase takes max(compute time, memory time) plus a fixed per-pass overhead.
//  - Linear-layer FLOPs: 2·N_active per token.
//  - Attention FLOPs: 2·layers·heads·(d_qk + d_v) per (query, cached key) pair (QKᵀ and A·V); prefill is
//    causal. MLA (DeepSeek-V3): prefill uses the un-absorbed MHA form (d_qk 192, d_v 128); decode uses
//    the weight-absorbed form that attends over the cached latent (d_qk 512+64, d_v 512), as FlashMLA does.
//  - Memory traffic: weights read once per pass (MoE: only the experts some token routed to, assuming
//    uniform routing), plus the KV cache read (decode) or written (prefill).
//  - Everything is split evenly over n GPUs; KV per GPU follows kvBytesPerTokenPerGpu (replication).
import type { Gpu } from './gpus'
import { kvBytesPerTokenPerGpu, type Attn, type Model } from './models'

export type Setup = {
  model: Model
  attn: Attn
  gpu: Gpu
  tp: number
  weightBytes: number // bytes per parameter
  kvBytes: number // bytes per KV element
  peakFlops: number // per GPU, FLOP/s, for the chosen compute dtype
  mfu: number // achieved fraction of peak compute
  bwEff: number // achieved fraction of peak memory bandwidth
  overheadS: number // fixed time per forward pass (kernel launches, scheduling)
}

/** Expected fraction of routed experts that at least one of `tokens` tokens selects (uniform routing). */
export function expertFraction(m: Model, tokens: number): number {
  return m.experts ? 1 - (1 - m.experts_per_token / m.experts) ** tokens : 1
}

/** Weight bytes read (whole model) by one forward pass over `tokens` tokens. */
export function weightBytesRead(m: Model, weightBytes: number, tokens: number): number {
  return (m.params - m.expert_params + m.expert_params * expertFraction(m, tokens)) * weightBytes
}

export function attnPairFlops(m: Model, decode: boolean): number {
  const dims = decode && m.mla ? 2 * m.mla.kv_lora_rank + m.mla.rope_dim : m.head_dim + m.v_head_dim
  return 2 * m.layers * m.heads * dims
}

export type Pass = { compute: number; memory: number; time: number } // seconds

function pass(s: Setup, flops: number, bytesPerGpu: number): Pass {
  const compute = flops / (s.tp * s.peakFlops * s.mfu)
  const memory = bytesPerGpu / (s.gpu.hbm_tbps * 1e12 * s.bwEff)
  return { compute, memory, time: Math.max(compute, memory) + s.overheadS }
}

/** Prefill of B prompts of P tokens in one pass. */
export function prefill(s: Setup, B: number, P: number): Pass {
  const flops = B * (2 * s.model.active_params * P + attnPairFlops(s.model, false) * ((P * (P + 1)) / 2))
  const kvPerGpu = kvBytesPerTokenPerGpu(s.model, s.attn, s.kvBytes, s.tp)
  return pass(s, flops, weightBytesRead(s.model, s.weightBytes, B * P) / s.tp + B * P * kvPerGpu)
}

/** One decode step: B sequences each add one token while attending to `ctx` cached tokens. */
export function decodeStep(s: Setup, B: number, ctx: number): Pass {
  const flops = B * (2 * s.model.active_params + attnPairFlops(s.model, true) * ctx)
  const kvPerGpu = kvBytesPerTokenPerGpu(s.model, s.attn, s.kvBytes, s.tp)
  return pass(s, flops, weightBytesRead(s.model, s.weightBytes, B) / s.tp + B * ctx * kvPerGpu)
}

export type Run = {
  ttft: number // s, prefill (it emits the first token)
  tpot: number // s, mean time per output token after the first
  decodeComputeShare: number // fraction of decode steps that are compute-bound
  perRequestTps: number // tokens/s seen by one request during decode
  throughput: number // output tokens/s across the batch during decode
  total: number // s, end-to-end for the batch
}

/** Static batch: all B prompts prefilled together, then O-1 decode steps with context P+1 … P+O-1. */
export function run(s: Setup, B: number, P: number, O: number): Run {
  const ttft = prefill(s, B, P).time
  let decode = 0
  let computeBound = 0
  for (let j = 1; j < O; j++) {
    const step = decodeStep(s, B, P + j)
    decode += step.time
    if (step.compute >= step.memory) computeBound++
  }
  const steps = Math.max(1, O - 1)
  const tpot = decode / steps
  return { ttft, tpot, decodeComputeShare: computeBound / steps, perRequestTps: 1 / tpot, throughput: B / tpot, total: ttft + decode }
}

/** Smallest batch at which a decode step at context `ctx` becomes compute-bound, or null if it never
 *  does (attention's KV reads grow as fast as its FLOPs, so long contexts can stay memory-bound). */
export function decodeKnee(s: Setup, ctx: number): number | null {
  const gap = (B: number) => {
    const p = decodeStep(s, B, ctx)
    return p.compute - p.memory
  }
  if (gap(1) >= 0) return 1
  let lo = 1
  let hi = 2
  while (gap(hi) < 0) {
    if (hi > 1e7) return null
    lo = hi
    hi *= 2
  }
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (gap(mid) < 0) lo = mid
    else hi = mid
  }
  return hi
}

/** Largest batch whose weights + KV for P+O tokens per sequence fit in usable GPU memory. */
export function maxBatch(s: Setup, P: number, O: number, memUtil: number): number {
  const free = s.gpu.memory_gb * 2 ** 30 * memUtil - (s.model.params * s.weightBytes) / s.tp
  const perSeq = kvBytesPerTokenPerGpu(s.model, s.attn, s.kvBytes, s.tp) * (P + O)
  return Math.max(0, Math.floor(free / perSeq))
}
