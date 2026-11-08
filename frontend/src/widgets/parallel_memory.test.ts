import { describe, expect, it } from 'vitest'
import { activationBytesPerLayer, commPerStep, memory, modelStates, type Config } from './parallel_memory.math'

const base: Config = {
  params: 70e9, layers: 80, hidden: 8192, heads: 64, seq: 4096, microBatch: 1, microBatches: 8,
  dp: 1, tp: 1, pp: 1, zero: 0, recompute: 'none', sequenceParallel: false,
}
const sum = (s: ReturnType<typeof modelStates>) => s.params + s.grads + s.optimizer

describe('model states', () => {
  it('70B with mixed-precision Adam = 16 B/param = 1.12 TB', () => {
    expect(sum(modelStates({ params: 70e9, dp: 1, tp: 1, pp: 1, zero: 0 }))).toBe(1.12e12)
  })

  it('ZeRO paper figure 1: 7.5B params, N_d = 64 -> 120, 31.4, 16.6, 1.9 GB', () => {
    const at = (zero: 0 | 1 | 2 | 3) => sum(modelStates({ params: 7.5e9, dp: 64, tp: 1, pp: 1, zero })) / 1e9
    expect(at(0)).toBeCloseTo(120, 6)
    expect(at(1)).toBeCloseTo(31.4, 1)
    expect(at(2)).toBeCloseTo(16.6, 1)
    expect(at(3)).toBeCloseTo(1.875, 6)
  })

  it('TP and PP divide parameters', () => {
    expect(sum(modelStates({ params: 70e9, dp: 1, tp: 8, pp: 4, zero: 0 }))).toBeCloseTo(1.12e12 / 32, 0)
  })
})

describe('activations (Korthikanti et al. 2022, Table 2)', () => {
  // GPT-3 175B: s = 2048, h = 12288, a = 96, so 5as/h = 80 and with t = 8, 5as/(ht) = 10.
  const g = { seq: 2048, microBatch: 1, hidden: 12288, heads: 96 }
  const sbh = 2048 * 12288
  const per = (tp: number, sp: boolean, recompute: 'none' | 'selective' | 'full') =>
    activationBytesPerLayer({ ...g, tp, sequenceParallel: sp, recompute }) / sbh
  it('no parallelism: sbh(34 + 5as/h)', () => expect(per(1, false, 'none')).toBeCloseTo(34 + 80, 9))
  it('TP: sbh(10 + 24/t + 5as/(ht))', () => expect(per(8, false, 'none')).toBeCloseTo(10 + 3 + 10, 9))
  it('TP + SP: sbh(34/t + 5as/(ht))', () => expect(per(8, true, 'none')).toBeCloseTo(4.25 + 10, 9))
  it('TP + selective: sbh(10 + 24/t)', () => expect(per(8, false, 'selective')).toBeCloseTo(13, 9))
  it('TP + SP + selective: 34·sbh/t', () => expect(per(8, true, 'selective')).toBeCloseTo(4.25, 9))
  it('full recompute: 2sbh', () => expect(per(8, true, 'full')).toBe(2))
  it('SP makes no difference at t = 1', () => expect(per(1, true, 'none')).toBeCloseTo(per(1, false, 'none'), 9))

  it('1F1B: first stage stores p micro-batches of L/p layers, so activations do not shrink with PP', () => {
    const one = memory(base).activations
    const four = memory({ ...base, pp: 4 })
    expect(four.inflight).toBe(4)
    expect(four.layersPerStage).toBe(20)
    expect(four.activations).toBeCloseTo(one, 0)
    expect(memory({ ...base, pp: 4, microBatches: 2 }).activations).toBeCloseTo(one / 2, 0)
  })
})

describe('communication per step', () => {
  it('DP all-reduce of bf16 grads: 2·(2Ψ)·(N-1)/N; ZeRO-1 equal; ZeRO-3 (m = 1) is 1.5x', () => {
    const c = { ...base, params: 8e9, layers: 32, hidden: 4096, heads: 32, dp: 8, microBatches: 1 }
    const ddp = commPerStep(c).dp
    expect(ddp).toBeCloseTo(2 * 2 * 8e9 * (7 / 8), 0)
    expect(commPerStep({ ...c, zero: 1 }).dp).toBeCloseTo(ddp, 0)
    expect(commPerStep({ ...c, zero: 2 }).dp).toBeCloseTo(ddp, 0)
    expect(commPerStep({ ...c, zero: 3 }).dp).toBeCloseTo(1.5 * ddp, 0)
  })

  it('TP: 4 all-reduces of a bf16 [s, b, h] tensor per layer per micro-batch', () => {
    const c = { ...base, tp: 8, microBatches: 1 }
    expect(commPerStep(c).tp).toBeCloseTo(80 * 4 * (2 * 7 / 8) * 2 * 4096 * 8192, 0)
    expect(commPerStep({ ...c, recompute: 'full' }).tp).toBeCloseTo(1.5 * commPerStep(c).tp, 0)
  })

  it('no DP / TP / PP traffic on a single GPU', () => {
    expect(commPerStep(base).total).toBe(0)
  })
})
