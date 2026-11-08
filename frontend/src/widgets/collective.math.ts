// Collectives on N ranks, simulated chunk by chunk. Each rank's buffer has N slots (chunks of S/N bytes).
// A schedule is a list of steps; in a step every listed move happens at once, reading the pre-step state.
// Costs come from the simulated schedule (alpha-beta model), so the closed forms are checked, not assumed.

export type Op = 'all_reduce' | 'reduce_scatter' | 'all_gather' | 'broadcast' | 'all_to_all'
export type Algo = 'ring' | 'tree' | 'pairwise'
/** mask: bitmask of the ranks whose data is summed into this cell; chunk: which piece of the data it is
 *  (for all_to_all: the destination rank of the block). null = empty slot. */
export type Cell = { mask: number; chunk: number } | null
export type Move = { from: number; to: number; src: number; dst: number }
export type Step = { moves: Move[]; reduce: boolean; phase: string }
export type Schedule = { op: Op; algo: Algo; n: number; initial: Cell[][]; steps: Step[] }

export const algorithmsFor = (op: Op): Algo[] =>
  op === 'all_to_all' ? ['pairwise'] : op === 'all_reduce' || op === 'broadcast' ? ['ring', 'tree'] : ['ring']

/** NCCL bus-bandwidth factor: busbw = algbw × factor (nccl-tests PERFORMANCE.md). */
export function busFactor(op: Op, n: number): number {
  if (op === 'all_reduce') return (2 * (n - 1)) / n
  if (op === 'broadcast') return 1
  return (n - 1) / n
}

const mod = (a: number, n: number) => ((a % n) + n) % n
const range = (n: number) => Array.from({ length: n }, (_, i) => i)
const log2ceil = (n: number) => Math.ceil(Math.log2(n))

function initial(op: Op, n: number): Cell[][] {
  return range(n).map((r) =>
    range(n).map((c) => {
      if (op === 'all_reduce' || op === 'reduce_scatter' || op === 'all_to_all') return { mask: 1 << r, chunk: c }
      if (op === 'all_gather') return r === c ? { mask: 1 << r, chunk: c } : null
      return r === 0 ? { mask: 1, chunk: c } : null // broadcast from rank 0
    }),
  )
}

// Ring reduce-scatter: at step k rank r adds chunk (r-k-1) into rank r+1; after N-1 steps rank r owns chunk r.
const ringReduceScatter = (n: number, phase: string): Step[] =>
  range(n - 1).map((k) => ({
    reduce: true,
    phase,
    moves: range(n).map((r) => ({ from: r, to: mod(r + 1, n), src: mod(r - k - 1, n), dst: mod(r - k - 1, n) })),
  }))

// Ring all-gather: rank r starts with chunk r; at step k it forwards chunk (r-k) to rank r+1.
const ringAllGather = (n: number, phase: string): Step[] =>
  range(n - 1).map((k) => ({
    reduce: false,
    phase,
    moves: range(n).map((r) => ({ from: r, to: mod(r + 1, n), src: mod(r - k, n), dst: mod(r - k, n) })),
  }))

const whole = (from: number, to: number, n: number): Move[] => range(n).map((c) => ({ from, to, src: c, dst: c }))

// Binomial tree reduce to rank 0: in round k, ranks r ≡ 2^k (mod 2^(k+1)) send everything to r - 2^k.
const treeReduce = (n: number): Step[] =>
  range(log2ceil(n)).map((k) => ({
    reduce: true,
    phase: 'reduce',
    moves: range(n)
      .filter((r) => r % 2 ** (k + 1) === 2 ** k)
      .flatMap((r) => whole(r, r - 2 ** k, n)),
  }))

// Binomial tree broadcast from rank 0: in round k (high to low), ranks r ≡ 0 (mod 2^(k+1)) send to r + 2^k.
const treeBroadcast = (n: number): Step[] =>
  range(log2ceil(n))
    .reverse()
    .map((k) => ({
      reduce: false,
      phase: 'broadcast',
      moves: range(n)
        .filter((r) => r % 2 ** (k + 1) === 0 && r + 2 ** k < n)
        .flatMap((r) => whole(r, r + 2 ** k, n)),
    }))

// Pipelined chain broadcast 0 → 1 → … → N-1 with N chunks: at step k rank i forwards chunk k-i. 2N-2 steps.
const ringBroadcast = (n: number): Step[] =>
  range(2 * n - 2).map((k) => ({
    reduce: false,
    phase: 'broadcast',
    moves: range(n - 1)
      .filter((i) => k - i >= 0 && k - i < n)
      .map((i) => ({ from: i, to: i + 1, src: k - i, dst: k - i })),
  }))

/** Partner of rank r in round k of a round-robin pairing (circle method); r itself means idle.
 *  Even N: N-1 rounds, everyone paired every round. Odd N: N rounds, one rank idle per round. */
export function pairPartner(r: number, k: number, n: number): number {
  if (n % 2 === 1) return mod(k - r, n)
  const m = n - 1
  if (r === m) return mod(k * (n / 2), m) // solves 2p ≡ k (mod N-1)
  const q = mod(k - r, m)
  return q === r ? m : q
}

// Pairwise exchange all-to-all: each round, paired ranks swap the blocks meant for each other.
const pairwiseAllToAll = (n: number): Step[] =>
  range(n % 2 === 0 ? n - 1 : n).map((k) => ({
    reduce: false,
    phase: 'exchange',
    moves: range(n)
      .filter((r) => pairPartner(r, k, n) !== r)
      .map((r) => {
        const p = pairPartner(r, k, n)
        return { from: r, to: p, src: p, dst: r }
      }),
  }))

export function schedule(op: Op, requested: Algo, n: number): Schedule {
  const algos = algorithmsFor(op)
  const algo = algos.includes(requested) ? requested : algos[0]
  let steps: Step[]
  if (op === 'all_reduce')
    steps =
      algo === 'tree'
        ? [...treeReduce(n), ...treeBroadcast(n)]
        : [...ringReduceScatter(n, 'reduce-scatter'), ...ringAllGather(n, 'all-gather')]
  else if (op === 'reduce_scatter') steps = ringReduceScatter(n, 'reduce-scatter')
  else if (op === 'all_gather') steps = ringAllGather(n, 'all-gather')
  else if (op === 'broadcast') steps = algo === 'tree' ? treeBroadcast(n) : ringBroadcast(n)
  else steps = pairwiseAllToAll(n)
  return { op, algo, n, initial: initial(op, n), steps }
}

export function apply(state: Cell[][], step: Step): Cell[][] {
  const next = state.map((row) => [...row])
  for (const m of step.moves) {
    const payload = state[m.from][m.src]
    if (!payload) throw new Error(`rank ${m.from} sends empty slot ${m.src}`)
    const cur = next[m.to][m.dst]
    next[m.to][m.dst] = step.reduce && cur ? { mask: cur.mask | payload.mask, chunk: cur.chunk } : payload
  }
  return next
}

/** Buffer states before step 0, after step 0, …, after the last step. */
export function states(s: Schedule): Cell[][][] {
  const out = [s.initial]
  for (const step of s.steps) out.push(apply(out[out.length - 1], step))
  return out
}

/** Alpha-beta cost. S = full buffer per rank (bytes), alpha = per-step latency (s), beta = per-rank link
 *  bandwidth (B/s, one direction). Each step costs alpha + (bytes the busiest sender sends) / beta. */
export function cost(s: Schedule, bytes: number, alpha: number, beta: number) {
  const chunk = bytes / s.n
  const sent = new Array(s.n).fill(0)
  let time = 0
  for (const step of s.steps) {
    const perRank = new Array(s.n).fill(0)
    for (const m of step.moves) perRank[m.from] += chunk
    perRank.forEach((b, r) => (sent[r] += b))
    time += alpha + Math.max(...perRank) / beta
  }
  const algbw = bytes / time
  return {
    steps: s.steps.length,
    bytesPerRank: Math.max(...sent),
    time,
    latencyTime: s.steps.length * alpha,
    algbw,
    busbw: algbw * busFactor(s.op, s.n),
  }
}

export const popcount = (x: number) => {
  let c = 0
  for (; x; x &= x - 1) c++
  return c
}
