import { describe, expect, it } from 'vitest'
import { apply, cost, pairPartner, schedule, states, type Cell, type Op, type Step } from './collective.math'

const full = (n: number) => (1 << n) - 1
const ns = [2, 3, 4, 5, 7, 8, 12, 16]

/** Run a schedule, checking a reduction never adds the same rank's data twice. */
function run(op: Op, algo: 'ring' | 'tree' | 'pairwise', n: number) {
  const s = schedule(op, algo, n)
  let st = s.initial
  for (const step of s.steps) {
    if (step.reduce)
      for (const m of step.moves) {
        const a = st[m.from][m.src]!
        const b = st[m.to][m.dst]!
        expect(a.mask & b.mask).toBe(0)
      }
    st = apply(st, step)
  }
  return { s, final: st }
}

const everyCell = (st: Cell[][], f: (c: Cell, r: number, j: number) => boolean) =>
  st.every((row, r) => row.every((c, j) => f(c, r, j)))

describe('collective schedules', () => {
  it('ring all-reduce: every rank ends with every chunk fully reduced in 2(N-1) steps', () => {
    for (const n of ns) {
      const { s, final } = run('all_reduce', 'ring', n)
      expect(s.steps.length).toBe(2 * (n - 1))
      expect(everyCell(final, (c, _r, j) => c!.mask === full(n) && c!.chunk === j)).toBe(true)
    }
  })

  it('ring reduce-scatter: rank r owns fully reduced chunk r after N-1 steps', () => {
    for (const n of ns) {
      const { s, final } = run('reduce_scatter', 'ring', n)
      expect(s.steps.length).toBe(n - 1)
      final.forEach((row, r) => expect(row[r]!.mask).toBe(full(n)))
    }
  })

  it('ring all-gather: everyone has every chunk from its origin', () => {
    for (const n of ns) {
      const { final } = run('all_gather', 'ring', n)
      expect(everyCell(final, (c, _r, j) => c!.mask === 1 << j && c!.chunk === j)).toBe(true)
    }
  })

  it('tree all-reduce and broadcasts reach every rank', () => {
    for (const n of ns) {
      const tree = run('all_reduce', 'tree', n)
      expect(tree.s.steps.length).toBe(2 * Math.ceil(Math.log2(n)))
      expect(everyCell(tree.final, (c) => c!.mask === full(n))).toBe(true)
      for (const algo of ['ring', 'tree'] as const) {
        const b = run('broadcast', algo, n)
        expect(everyCell(b.final, (c, _r, j) => c!.mask === 1 && c!.chunk === j)).toBe(true)
      }
      expect(run('broadcast', 'ring', n).s.steps.length).toBe(2 * n - 2)
    }
  })

  it('pairwise all-to-all transposes the blocks; each pair exchanges once', () => {
    for (const n of ns) {
      const { s, final } = run('all_to_all', 'pairwise', n)
      expect(s.steps.length).toBe(n % 2 === 0 ? n - 1 : n)
      // rank r slot j holds the block rank j had for rank r
      expect(everyCell(final, (c, r, j) => c!.mask === 1 << j && c!.chunk === r)).toBe(true)
      const pairs = new Set(s.steps.flatMap((st: Step) => st.moves.map((m) => `${m.from}>${m.to}`)))
      expect(pairs.size).toBe(n * (n - 1))
      for (let k = 0; k < s.steps.length; k++)
        for (let r = 0; r < n; r++) expect(pairPartner(pairPartner(r, k, n), k, n)).toBe(r)
    }
  })

  it('states has one entry per step plus the initial state', () => {
    const s = schedule('all_reduce', 'ring', 4)
    expect(states(s).length).toBe(s.steps.length + 1)
  })
})

describe('alpha-beta cost matches the closed forms', () => {
  const S = 1e9
  const a = 5e-6
  const b = 450e9
  it('ring all-reduce: 2(N-1)/N·S per rank, time 2(N-1)(α + S/(Nβ)), busbw → β when α = 0', () => {
    for (const n of ns) {
      const c = cost(schedule('all_reduce', 'ring', n), S, a, b)
      expect(c.bytesPerRank).toBeCloseTo((2 * (n - 1) * S) / n, 0)
      expect(c.time).toBeCloseTo(2 * (n - 1) * (a + S / n / b), 12)
      expect(cost(schedule('all_reduce', 'ring', n), S, 0, b).busbw).toBeCloseTo(b, 0)
    }
  })

  it('reduce-scatter and all-gather: (N-1)/N·S, and they sum to an all-reduce', () => {
    for (const n of ns) {
      const rs = cost(schedule('reduce_scatter', 'ring', n), S, a, b)
      const ag = cost(schedule('all_gather', 'ring', n), S, a, b)
      const ar = cost(schedule('all_reduce', 'ring', n), S, a, b)
      expect(rs.bytesPerRank).toBeCloseTo(((n - 1) * S) / n, 0)
      expect(ag.bytesPerRank).toBeCloseTo(((n - 1) * S) / n, 0)
      expect(rs.time + ag.time).toBeCloseTo(ar.time, 12)
      expect(cost(schedule('all_gather', 'ring', n), S, 0, b).busbw).toBeCloseTo(b, 0)
    }
  })

  it('all-to-all sends (N-1)/N·S per rank', () => {
    for (const n of ns) {
      const c = cost(schedule('all_to_all', 'pairwise', n), S, a, b)
      expect(c.bytesPerRank).toBeCloseTo(((n - 1) * S) / n, 0)
      const rounds = n % 2 === 0 ? n - 1 : n
      expect(c.time).toBeCloseTo(rounds * (a + S / n / b), 12)
    }
  })

  it('tree all-reduce: 2⌈log2 N⌉(α + S/β); ring broadcast (2N-2)(α + S/(Nβ))', () => {
    for (const n of ns) {
      const L = Math.ceil(Math.log2(n))
      expect(cost(schedule('all_reduce', 'tree', n), S, a, b).time).toBeCloseTo(2 * L * (a + S / b), 12)
      expect(cost(schedule('broadcast', 'tree', n), S, a, b).time).toBeCloseTo(L * (a + S / b), 12)
      const rb = cost(schedule('broadcast', 'ring', n), S, a, b)
      expect(rb.time).toBeCloseTo((2 * n - 2) * (a + S / n / b), 12)
      expect(rb.bytesPerRank).toBeCloseTo(S, 0)
    }
  })

  it('tree beats ring for small messages, ring wins for large ones (N = 16)', () => {
    const t = (algo: 'ring' | 'tree', bytes: number) => cost(schedule('all_reduce', algo, 16), bytes, a, b).time
    expect(t('tree', 1e3)).toBeLessThan(t('ring', 1e3))
    expect(t('ring', 1e9)).toBeLessThan(t('tree', 1e9))
  })
})
