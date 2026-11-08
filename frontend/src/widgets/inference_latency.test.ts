import { describe, expect, it } from 'vitest'
import { gpus } from './gpus'
import { attnPairFlops, decodeKnee, decodeStep, expertFraction, maxBatch, prefill, run, weightBytesRead, type Setup } from './inference_latency.math'
import { models, nativeAttn, type ModelId } from './models'

const setup = (id: ModelId, over: Partial<Setup> = {}): Setup => ({
  model: models[id],
  attn: nativeAttn(models[id]),
  gpu: gpus.H100_SXM,
  tp: 1,
  weightBytes: 2,
  kvBytes: 2,
  peakFlops: 989e12,
  mfu: 1,
  bwEff: 1,
  overheadS: 0,
  ...over,
})

describe('decode', () => {
  it('batch-1 decode of Llama-3.1 8B in bf16 is bound by reading 16 GB of weights', () => {
    const s = setup('llama31_8b')
    const step = decodeStep(s, 1, 0)
    expect(step.memory).toBeCloseTo((8.03e9 * 2) / 3.35e12, 6) // ≈ 4.8 ms
    expect(step.compute).toBeCloseTo((2 * 8.03e9) / 989e12, 9)
    expect(step.time).toBe(step.memory)
  })

  it('dense knee at zero context = peak·bytes_per_param / (2·bandwidth) ≈ 295 for bf16 on H100', () => {
    expect(decodeKnee(setup('llama31_70b'), 0)).toBeCloseTo((989e12 * 2) / (2 * 3.35e12), 3)
  })

  it('long contexts can keep decode memory-bound at any batch', () => {
    // Llama-3.1 8B: attention does 2·32·32·256 FLOPs per cached token per step but reads 131 KB of KV.
    expect(decodeKnee(setup('llama31_8b'), 32768)).toBeNull()
  })

  it('tensor parallelism splits both compute and weight reads', () => {
    const one = decodeStep(setup('llama31_70b'), 8, 1000)
    const four = decodeStep(setup('llama31_70b', { tp: 4 }), 8, 1000)
    expect(four.compute).toBeCloseTo(one.compute / 4, 9)
    expect(four.memory).toBeCloseTo(one.memory / 4, 9)
  })
})

describe('attention FLOPs per cached token', () => {
  it('GQA: 2·layers·heads·(d_k+d_v), same in prefill and decode', () => {
    expect(attnPairFlops(models.llama31_70b, true)).toBe(2 * 80 * 64 * 256)
    expect(attnPairFlops(models.llama31_70b, false)).toBe(2 * 80 * 64 * 256)
  })

  it('MLA: MHA form in prefill, absorbed latent form (576 + 512) in decode', () => {
    expect(attnPairFlops(models.deepseek_v3, false)).toBe(2 * 61 * 128 * (192 + 128))
    expect(attnPairFlops(models.deepseek_v3, true)).toBe(2 * 61 * 128 * (576 + 512))
  })
})

describe('MoE weight traffic', () => {
  it('one token reads about the active parameters', () => {
    for (const id of ['mixtral_8x7b', 'qwen3_235b_a22b', 'deepseek_v3'] as const) {
      const m = models[id]
      expect(weightBytesRead(m, 1, 1) / m.active_params).toBeCloseTo(1, 2)
    }
  })

  it('large batches touch every expert', () => {
    expect(expertFraction(models.mixtral_8x7b, 1)).toBe(0.25)
    expect(expertFraction(models.mixtral_8x7b, 64)).toBeGreaterThan(0.9999)
    expect(weightBytesRead(models.deepseek_v3, 1, 4096)).toBeCloseTo(models.deepseek_v3.params, -6)
  })
})

describe('prefill and runs', () => {
  it('prefill FLOPs = 2·N·P plus causal attention', () => {
    const s = setup('llama31_70b', { mfu: 0.5 })
    const P = 2048
    const flops = 2 * 70.55e9 * P + 2 * 80 * 64 * 256 * ((P * (P + 1)) / 2)
    expect(prefill(s, 1, P).compute).toBeCloseTo(flops / (989e12 * 0.5), 9)
  })

  it('TPOT for two output tokens is one decode step at context P+1', () => {
    const s = setup('llama31_8b', { overheadS: 0.002 })
    const r = run(s, 4, 512, 2)
    expect(r.tpot).toBeCloseTo(decodeStep(s, 4, 513).time, 12)
    expect(r.ttft).toBeCloseTo(prefill(s, 4, 512).time, 12)
    expect(r.throughput).toBeCloseTo(4 / r.tpot, 9)
  })

  it('KV capacity limits the batch: Llama-3.1 70B on 4x H100, 4K tokens per sequence', () => {
    // free per GPU = 80 GiB·0.9 − 141.1 GB/4 = 42.0 GB; per sequence 4096·327,680/4 B = 335.5 MB
    expect(maxBatch(setup('llama31_70b', { tp: 4 }), 3072, 1024, 0.9)).toBe(125)
  })
})
