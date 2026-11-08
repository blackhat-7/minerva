import { describe, expect, it } from 'vitest'
import { gpus } from './gpus'
import { attainable, gemm, mToReachRidge, opTime, roof } from './roofline.math'

describe('roofline', () => {
  it('H100 bf16 ridge is about 295 FLOP/B', () => {
    expect(roof(gpus.H100_SXM, 'bf16').ridge).toBeCloseTo(989 / 3.35, 6)
    expect(roof(gpus.H100_SXM, 'bf16').ridge).toBeGreaterThan(295)
    expect(roof(gpus.H100_SXM, 'bf16').ridge).toBeLessThan(296)
  })

  it('A100 bf16 ridge is about 153 FLOP/B; int8 uses the INT8 rate', () => {
    expect(roof(gpus.A100_SXM_80GB, 'bf16').ridge).toBeCloseTo(312 / 2.039, 6)
    expect(roof(gpus.A100_SXM_80GB, 'int8').peak).toBe(624e12)
  })

  it('GEMM flops and bytes', () => {
    const g = gemm(2, 3, 5, 'bf16')
    expect(g.flops).toBe(2 * 2 * 3 * 5)
    expect(g.bytes).toBe(2 * (6 + 15 + 10))
  })

  it('batch-1 decode GEMV has intensity about 1 FLOP/B in bf16', () => {
    const g = gemm(1, 8192, 8192, 'bf16')
    expect(g.intensity).toBeCloseTo((2 * 8192 * 8192) / (2 * (8192 + 8192 * 8192 + 8192)), 9)
    expect(g.intensity).toBeGreaterThan(0.999)
    expect(g.intensity).toBeLessThan(1)
  })

  it('memory-bound op time is bytes / bandwidth; compute-bound is flops / peak', () => {
    const r = roof(gpus.H100_SXM, 'bf16')
    const decode = gemm(1, 8192, 8192, 'bf16')
    expect(opTime(r, decode.flops, decode.bytes)).toBeCloseTo(decode.bytes / 3.35e12, 15)
    expect(attainable(r, decode.intensity)).toBeCloseTo(decode.intensity * 3.35e12, 0)
    const prefill = gemm(4096, 8192, 8192, 'bf16')
    expect(opTime(r, prefill.flops, prefill.bytes)).toBeCloseTo(prefill.flops / 989e12, 15)
    expect(attainable(r, prefill.intensity)).toBe(989e12)
  })

  it('M at the ridge makes intensity equal the ridge', () => {
    const r = roof(gpus.H100_SXM, 'bf16')
    const m = mToReachRidge(r, 8192, 8192, 'bf16')
    expect(m).toBeGreaterThan(300)
    expect(m).toBeLessThan(330)
    expect(gemm(m, 8192, 8192, 'bf16').intensity).toBeCloseTo(r.ridge, 6)
  })

  it('ridge unreachable when K and N are too small', () => {
    // Max intensity with K = N = 256 in bf16 is 2·256·256/(2·512) = 128 < 295.
    expect(mToReachRidge(roof(gpus.H100_SXM, 'bf16'), 256, 256, 'bf16')).toBe(Infinity)
  })
})
