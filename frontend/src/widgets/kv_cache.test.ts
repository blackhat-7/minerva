import { describe, expect, it } from 'vitest'
import { allocate, capacity, requestLengths } from './kv_cache.math'
import { attnVariants, kvBytesPerToken, kvBytesPerTokenPerGpu, models, nativeAttn } from './models'

describe('KV bytes per token', () => {
  it('Llama-3.1 70B in bf16: 2·80·8·128·2 = 327,680 B (320 KiB)', () => {
    const m = models.llama31_70b
    expect(kvBytesPerToken(m, nativeAttn(m), 2)).toBe(327_680)
  })

  it('native GQA sizes for other presets', () => {
    expect(kvBytesPerToken(models.llama31_8b, nativeAttn(models.llama31_8b), 2)).toBe(131_072)
    expect(kvBytesPerToken(models.llama31_405b, nativeAttn(models.llama31_405b), 2)).toBe(516_096)
    expect(kvBytesPerToken(models.qwen3_235b_a22b, nativeAttn(models.qwen3_235b_a22b), 2)).toBe(192_512)
    expect(kvBytesPerToken(models.mixtral_8x7b, nativeAttn(models.mixtral_8x7b), 1)).toBe(65_536)
  })

  it('MHA / GQA / MQA scale with K/V head count', () => {
    const m = models.llama31_70b
    const [mha, gqa, mqa] = attnVariants(m).map((a) => kvBytesPerToken(m, a, 2))
    expect(mha).toBe(8 * gqa)
    expect(gqa).toBe(8 * mqa)
  })

  it('DeepSeek-V3 MLA caches a 512+64 latent per layer: 61·576·2 = 70,272 B', () => {
    const m = models.deepseek_v3
    expect(nativeAttn(m).id).toBe('MLA')
    expect(kvBytesPerToken(m, nativeAttn(m), 2)).toBe(70_272)
    // MHA form: 128 heads of K (192) and V (128) dims
    expect(kvBytesPerToken(m, attnVariants(m)[0], 2)).toBe(61 * 128 * 320 * 2)
  })

  it('tensor parallelism splits K/V heads but replicates once tp > kv_heads; MLA is replicated', () => {
    const m = models.llama31_70b
    const a = nativeAttn(m)
    expect(kvBytesPerTokenPerGpu(m, a, 2, 8)).toBe(327_680 / 8)
    expect(kvBytesPerTokenPerGpu(m, a, 2, 16)).toBe(327_680 / 8)
    const d = models.deepseek_v3
    expect(kvBytesPerTokenPerGpu(d, nativeAttn(d), 2, 8)).toBe(70_272)
  })
})

describe('capacity', () => {
  it('Llama-3.1 70B bf16 on 2x H100 (80 GiB) leaves room for five 8k sequences', () => {
    const m = models.llama31_70b
    const c = capacity(m, nativeAttn(m), 2, 2, 80, 2, 8192, 0.9)
    expect(c.weightsPerGpu).toBeCloseTo(70.55e9)
    expect(c.freePerGpu).toBeCloseTo(80 * 2 ** 30 * 0.9 - 70.55e9)
    expect(c.kvPerSeqPerGpu).toBe(163_840 * 8192)
    expect(c.maxSeqs).toBe(5) // (77.31e9 - 70.55e9) / 1.342e9 = 5.04
  })

  it('weights that do not fit give zero sequences', () => {
    const m = models.llama31_405b
    expect(capacity(m, nativeAttn(m), 2, 2, 80, 1, 1024, 0.9).maxSeqs).toBe(0)
  })
})

describe('paged allocation', () => {
  it('rounds each request up to whole blocks', () => {
    const a = allocate([100, 50], 512, 16, 0, false)
    expect(a.usedTokens).toBe(150)
    expect(a.contiguousReserved).toBe(1024)
    expect(a.blocks.length).toBe(7 + 4)
    expect(a.pagedReserved).toBe(176)
  })

  it('shares only the full blocks of the common prefix', () => {
    const a = allocate([100, 50], 512, 16, 40, true)
    expect(a.sharedBlocks).toBe(2) // 40 tokens = 2 full blocks + an 8-token tail copied per request
    expect(a.blocks.length).toBe(2 + Math.ceil(68 / 16) + Math.ceil(18 / 16))
    expect(a.blocks.filter((b) => b.owner === 'shared').length).toBe(2)
  })

  it('interleaves requests in physical memory as they grow together', () => {
    const a = allocate([40, 40], 512, 16, 0, false)
    expect(a.blocks.map((b) => b.owner)).toEqual([0, 1, 0, 1, 0, 1])
    expect(a.blocks.map((b) => b.used)).toEqual([16, 16, 16, 16, 8, 8])
  })

  it('request lengths are seeded and include the prefix', () => {
    const l = requestLengths(16, 7, 2048, 200)
    expect(requestLengths(16, 7, 2048, 200)).toEqual(l)
    for (const x of l) {
      expect(x).toBeGreaterThan(200)
      expect(x).toBeLessThanOrEqual(2048)
    }
  })
})
