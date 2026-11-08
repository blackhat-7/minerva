import { describe, expect, it } from 'vitest'
import { bubbleFormula, simulate } from './pipeline_schedule.math'

describe('pipeline schedules', () => {
  it('GPipe p=4, m=8: bubble is 3/11 of total time', () => {
    const s = simulate('gpipe', 4, 8, 1, 2)
    expect(s.makespan).toBeCloseTo((8 + 3) * 3)
    expect(s.bubbleOfTotal).toBeCloseTo(3 / 11)
    expect(s.bubbleOverIdeal).toBeCloseTo(bubbleFormula('gpipe', 4, 8, 1))
    expect(s.peakInflight).toEqual([8, 8, 8, 8])
  })

  it('1F1B has the same bubble as GPipe but stores at most p microbatches', () => {
    for (const [p, m, r] of [[4, 8, 2], [8, 32, 2], [5, 3, 1], [16, 64, 2.5]]) {
      const s = simulate('1f1b', p, m, 1, r)
      expect(s.makespan).toBeCloseTo((m + p - 1) * (1 + r))
      expect(s.bubbleOfTotal).toBeCloseTo((p - 1) / (m + p - 1))
      expect(s.peakInflight).toEqual(Array.from({ length: p }, (_, d) => Math.min(p - d, m)))
    }
  })

  it('interleaved 1F1B divides the bubble by v (Narayanan et al. 2021)', () => {
    for (const [p, m, v] of [[4, 8, 2], [4, 16, 4], [8, 16, 2], [2, 4, 3]]) {
      const s = simulate('interleaved', p, m, v, 2)
      expect(s.bubbleOverIdeal).toBeCloseTo(bubbleFormula('interleaved', p, m, v))
      expect(s.bubbleOverIdeal).toBeCloseTo((p - 1) / (v * m))
    }
  })

  it('interleaving stores slightly more activations than 1F1B on the first device', () => {
    const s = simulate('interleaved', 4, 8, 2, 2)
    expect(s.peakInflight[0]).toBeGreaterThan(4)
    expect(s.peakInflight[0]).toBeLessThan(8)
  })

  it('respects dependencies and never overlaps ops on a device', () => {
    const s = simulate('interleaved', 4, 8, 2, 2)
    const end = new Map(s.ops.map((o) => [`${o.kind}${o.stage}:${o.mb}`, o.end]))
    for (const o of s.ops) {
      if (o.kind === 'F' && o.stage > 0) expect(o.start).toBeGreaterThanOrEqual(end.get(`F${o.stage - 1}:${o.mb}`)!)
      if (o.kind === 'B' && o.stage < 7) expect(o.start).toBeGreaterThanOrEqual(end.get(`B${o.stage + 1}:${o.mb}`)!)
    }
    for (let d = 0; d < 4; d++) {
      const mine = s.ops.filter((o) => o.device === d).sort((a, b) => a.start - b.start)
      for (let i = 1; i < mine.length; i++) expect(mine[i].start).toBeGreaterThanOrEqual(mine[i - 1].end - 1e-9)
    }
  })

  it('rejects interleaving when m is not a multiple of p', () => {
    expect(() => simulate('interleaved', 4, 6, 2, 2)).toThrow()
  })
})
