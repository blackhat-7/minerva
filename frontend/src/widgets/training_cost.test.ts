import { describe, expect, it } from 'vitest'
import { CHINCHILLA_TOKENS_PER_PARAM, estimate, references, trainingFlops } from './training_cost.math'

describe('training cost', () => {
  it('Llama 3.1 405B on 15.6T tokens: 6ND ≈ 3.8e25 FLOPs', () => {
    const llama = references.find((r) => r.name === 'Llama 3.1 405B')!
    expect(trainingFlops(llama.n, llama.tokens) / 3.8e25).toBeCloseTo(1, 2)
  })

  it('16K H100s at 40% MFU: ~68 days and ~27M GPU-hours (reported: 30.84M)', () => {
    const e = estimate(405.85e9, 15.6e12, 16384, 989e12, 0.4, 2)
    expect(e.seconds / 86400).toBeCloseTo(67.8, 0)
    expect(e.gpuHours / 1e6).toBeCloseTo(26.7, 0)
    expect(e.cost).toBeCloseTo(e.gpuHours * 2)
  })

  it('GPT-3: 6ND = 3.15e23, matching the paper’s 3.14e23', () => {
    expect(trainingFlops(175e9, 300e9)).toBeCloseTo(3.15e23, -20)
  })

  it('Chinchilla 70B is compute-optimal at 1.4T tokens', () => {
    expect(70e9 * CHINCHILLA_TOKENS_PER_PARAM).toBe(1.4e12)
  })

  it('GPU-hours do not depend on GPU count, only wall-clock time does', () => {
    const a = estimate(7e9, 1e12, 64, 989e12, 0.5, 2)
    const b = estimate(7e9, 1e12, 512, 989e12, 0.5, 2)
    expect(a.gpuHours).toBeCloseTo(b.gpuHours)
    expect(a.seconds).toBeCloseTo(b.seconds * 8)
  })
})
