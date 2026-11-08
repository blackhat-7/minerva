// Pipeline-parallel schedules, simulated from dependencies.
// Each device runs its ops in the schedule's fixed order; an op starts when the device is free and its
// input is ready: F(stage s) needs F(s-1) of the same microbatch, B(s) needs B(s+1) (the last stage's B
// needs its own F). Communication time is ignored.
// Time unit: one microbatch's forward pass through one device's share of the model (1/p of the layers).

export type Schedule = 'gpipe' | '1f1b' | 'interleaved'
export type Kind = 'F' | 'B'
export type Op = { device: number; stage: number; chunk: number; mb: number; kind: Kind; start: number; end: number }

type Step = { kind: Kind; chunk: number; mb: number }

/** Per-device op order. Interleaved follows Megatron-LM's schedule and needs m divisible by p. */
export function deviceOrder(schedule: Schedule, p: number, m: number, v: number, d: number): Step[] {
  const steps: Step[] = []
  if (schedule === 'gpipe') {
    for (let mb = 0; mb < m; mb++) steps.push({ kind: 'F', chunk: 0, mb })
    for (let mb = 0; mb < m; mb++) steps.push({ kind: 'B', chunk: 0, mb })
    return steps
  }
  const vv = schedule === 'interleaved' ? v : 1
  const total = m * vv
  // k-th forward / backward on this device -> (local chunk, microbatch). Microbatches go in groups of p.
  const at = (k: number, kind: Kind): Step => {
    const inGroup = k % (p * vv)
    const c = Math.floor(inGroup / p)
    return { kind, chunk: kind === 'F' ? c : vv - 1 - c, mb: Math.floor(k / (p * vv)) * p + (k % p) }
  }
  const warmup = Math.min(schedule === 'interleaved' ? (p - d - 1) * 2 + (vv - 1) * p : p - d - 1, total)
  for (let k = 0; k < warmup; k++) steps.push(at(k, 'F'))
  for (let k = 0; k < total - warmup; k++) steps.push(at(warmup + k, 'F'), at(k, 'B'))
  for (let k = total - warmup; k < total; k++) steps.push(at(k, 'B'))
  return steps
}

export type Sim = {
  ops: Op[]
  makespan: number
  ideal: number // per-device busy time = m·(1+r); a bubble-free pipeline takes exactly this long
  bubbleOfTotal: number // idle fraction of the makespan
  bubbleOverIdeal: number // bubble time / ideal time (the ratio Narayanan et al. 2021 report)
  peakInflight: number[] // per device, max microbatches whose activations are stored, in full-stage units
}

export function simulate(schedule: Schedule, p: number, m: number, v: number, bwdRatio: number): Sim {
  const vv = schedule === 'interleaved' ? v : 1
  if (schedule === 'interleaved' && m % p !== 0) throw new Error('interleaved schedule needs m divisible by p')
  const S = p * vv // global stages; local chunk c on device d is stage c·p + d
  const tf = 1 / vv
  const tb = bwdRatio / vv
  const orders = Array.from({ length: p }, (_, d) => deviceOrder(schedule, p, m, vv, d))
  const done = new Map<string, number>() // `${kind}${stage}:${mb}` -> end time
  const key = (kind: Kind, stage: number, mb: number) => `${kind}${stage}:${mb}`
  const next = new Array(p).fill(0)
  const free = new Array(p).fill(0)
  const ops: Op[] = []
  for (let progress = true; progress; ) {
    progress = false
    for (let d = 0; d < p; d++) {
      while (next[d] < orders[d].length) {
        const { kind, chunk, mb } = orders[d][next[d]]
        const stage = chunk * p + d
        const dep =
          kind === 'F' ? (stage > 0 ? key('F', stage - 1, mb) : null) : key(stage === S - 1 ? 'F' : 'B', stage === S - 1 ? stage : stage + 1, mb)
        const ready = dep === null ? 0 : done.get(dep)
        if (ready === undefined) break
        const start = Math.max(free[d], ready)
        const end = start + (kind === 'F' ? tf : tb)
        ops.push({ device: d, stage, chunk, mb, kind, start, end })
        done.set(key(kind, stage, mb), end)
        free[d] = end
        next[d]++
        progress = true
      }
    }
  }
  if (ops.length !== 2 * S * m) throw new Error('schedule deadlocked')
  const makespan = Math.max(...free)
  const ideal = m * (1 + bwdRatio)
  const peakInflight = Array.from({ length: p }, (_, d) => {
    // +1 when a forward starts (activations stored), -1 when its backward ends; frees first on ties.
    const events = ops
      .filter((o) => o.device === d)
      .map((o) => (o.kind === 'F' ? [o.start, 1] : [o.end, -1]))
      .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    let cur = 0
    let peak = 0
    for (const [, delta] of events) peak = Math.max(peak, (cur += delta))
    return peak / vv
  })
  return {
    ops,
    makespan,
    ideal,
    bubbleOfTotal: 1 - ideal / makespan,
    bubbleOverIdeal: (makespan - ideal) / ideal,
    peakInflight,
  }
}

/** Closed-form bubble / ideal from Narayanan et al. 2021: (p-1)/m, and (1/v)·(p-1)/m when interleaved. */
export function bubbleFormula(schedule: Schedule, p: number, m: number, v: number): number {
  return (p - 1) / (m * (schedule === 'interleaved' ? v : 1))
}

/** Microbatches holding stored activations on a device at time t (in full-stage units). */
export function inflightAt(ops: Op[], device: number, t: number, v: number): number {
  let n = 0
  for (const o of ops) {
    if (o.device !== device) continue
    if (o.kind === 'F' && o.start < t) n++
    if (o.kind === 'B' && o.end <= t) n--
  }
  return n / v
}
