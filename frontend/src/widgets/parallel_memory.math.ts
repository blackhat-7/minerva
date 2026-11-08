// Per-GPU training memory and communication for DP × TP × PP with ZeRO, mixed-precision Adam.
// Model states (ZeRO paper, Rajbhandari et al. 2020): bf16 params 2 B + bf16 grads 2 B + fp32 master
// weights, Adam m and v 12 B = 16 B per parameter. Activations: Korthikanti et al. 2022, "Reducing
// Activation Recomputation in Large Transformer Models", Table 2 (16-bit activations, GPT-style block).

export type Recompute = 'none' | 'selective' | 'full'
export type ZeroStage = 0 | 1 | 2 | 3
export type Config = {
  params: number // total parameters Ψ
  layers: number // L
  hidden: number // h
  heads: number // a
  seq: number // s
  microBatch: number // b
  microBatches: number // m per optimizer step (gradient accumulation)
  dp: number
  tp: number
  pp: number
  zero: ZeroStage
  recompute: Recompute
  sequenceParallel: boolean
}

/** Parameter, gradient and optimizer bytes per GPU. TP × PP split every parameter evenly (simplification:
 *  ignores embeddings living on the first/last stage and norms replicated across TP); ZeRO-1 shards the
 *  optimizer over DP, ZeRO-2 also the gradients, ZeRO-3 also the parameters. */
export function modelStates(c: Pick<Config, 'params' | 'dp' | 'tp' | 'pp' | 'zero'>) {
  const psi = c.params / (c.tp * c.pp)
  return {
    params: (2 * psi) / (c.zero >= 3 ? c.dp : 1),
    grads: (2 * psi) / (c.zero >= 2 ? c.dp : 1),
    optimizer: (12 * psi) / (c.zero >= 1 ? c.dp : 1),
  }
}

/** Activation bytes stored per transformer layer per micro-batch on one GPU (Korthikanti Table 2). */
export function activationBytesPerLayer(c: Pick<Config, 'seq' | 'microBatch' | 'hidden' | 'heads' | 'tp' | 'sequenceParallel' | 'recompute'>) {
  const { seq: s, microBatch: b, hidden: h, heads: a, tp: t } = c
  const sbh = s * b * h
  const attn = (5 * a * s) / (h * t) // softmax/dropout/score buffers, sharded by TP heads
  if (c.recompute === 'full') return 2 * sbh // only each layer's input is kept
  if (c.recompute === 'selective') return c.sequenceParallel ? (sbh * 34) / t : sbh * (10 + 24 / t)
  return c.sequenceParallel ? sbh * (34 / t + attn) : sbh * (10 + 24 / t + attn)
}

export function memory(c: Config) {
  const states = modelStates(c)
  const layersPerStage = Math.ceil(c.layers / c.pp)
  // 1F1B: the first stage holds activations for min(m, p) micro-batches in flight.
  const inflight = Math.min(c.microBatches, c.pp)
  const activations = activationBytesPerLayer(c) * layersPerStage * inflight
  return { ...states, activations, total: states.params + states.grads + states.optimizer + activations, layersPerStage, inflight }
}

/** Bytes each GPU sends per optimizer step, ring collectives (all-reduce 2(n-1)/n·S, RS/AG (n-1)/n·S). */
export function commPerStep(c: Config) {
  const psi = c.params / (c.tp * c.pp)
  const grad = 2 * psi // bf16 gradients (and bf16 params for the gathers)
  const d = (c.dp - 1) / c.dp
  const m = c.microBatches
  // ZeRO-0/1 reduce gradients once per step (local accumulation); ZeRO-2/3 shard gradients, so they
  // reduce-scatter every micro-batch; ZeRO-3 also all-gathers params for each micro-batch's fwd and bwd.
  const dp = [2 * d * grad, 2 * d * grad, (m + 1) * d * grad, 3 * m * d * grad][c.zero]
  const sbh2 = 2 * c.seq * c.microBatch * c.hidden // one bf16 activation tensor [s, b, h]
  const layers = Math.ceil(c.layers / c.pp)
  // Megatron TP: 2 all-reduces in fwd + 2 in bwd per layer (SP swaps each for all-gather + reduce-scatter,
  // same bytes); full recompute re-runs the forward, adding 2 more.
  const tpCollectives = 4 + (c.recompute === 'full' ? 2 : 0)
  const tp = c.tp > 1 ? m * layers * tpCollectives * ((2 * (c.tp - 1)) / c.tp) * sbh2 : 0
  // PP: an interior stage sends one activation forward and one gradient backward per micro-batch;
  // with SP the boundary tensor is already sharded over TP.
  const pp = c.pp > 1 ? (m * 2 * sbh2) / (c.sequenceParallel ? c.tp : 1) : 0
  return { dp, tp, pp, total: dp + tp + pp }
}
