// KV-cache capacity and allocation (contiguous preallocation vs PagedAttention blocks).
import { kvBytesPerTokenPerGpu, type Attn, type Model } from './models'

export type Capacity = {
  weightsPerGpu: number // bytes
  freePerGpu: number // bytes left for KV after weights
  kvPerSeqPerGpu: number // bytes of KV one full-length sequence needs on each GPU
  maxSeqs: number // concurrent full-length sequences that fit
}

/** How many sequences of `seqLen` tokens fit. GPU memory is memory_gb GiB (see gpus.ts), of which `memUtil`
 *  is usable (like vLLM's gpu_memory_utilization); weights are split evenly over `tp` GPUs. */
export function capacity(
  m: Model,
  a: Attn,
  kvDtypeBytes: number,
  weightDtypeBytes: number,
  gpuMemoryGb: number,
  tp: number,
  seqLen: number,
  memUtil: number,
): Capacity {
  const weightsPerGpu = (m.params * weightDtypeBytes) / tp
  const freePerGpu = gpuMemoryGb * 2 ** 30 * memUtil - weightsPerGpu
  const kvPerSeqPerGpu = kvBytesPerTokenPerGpu(m, a, kvDtypeBytes, tp) * seqLen
  return { weightsPerGpu, freePerGpu, kvPerSeqPerGpu, maxSeqs: Math.max(0, Math.floor(freePerGpu / kvPerSeqPerGpu)) }
}

/** Deterministic PRNG (mulberry32) so a seed always gives the same requests. */
export function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Current lengths (prompt + tokens generated so far) of `count` requests, each starting with the
 *  `prefix`-token system prompt. Uniform² skews toward short requests, as in real traffic. */
export function requestLengths(count: number, seed: number, maxLen: number, prefix: number): number[] {
  const r = rng(seed)
  return Array.from({ length: count }, () => prefix + 1 + Math.floor(r() ** 2 * (maxLen - prefix)))
}

export type Block = { id: number; owner: number | 'shared'; used: number } // used tokens of blockSize
export type Allocation = {
  usedTokens: number // logical tokens across all requests
  contiguousReserved: number // tokens reserved by max-length preallocation
  pagedReserved: number // tokens in allocated blocks
  sharedBlocks: number // prefix blocks stored once and shared by every request
  blocks: Block[] // physical blocks in allocation order
}

/** PagedAttention allocation. With `share`, the prefix's full blocks are stored once and ref-counted;
 *  its partly filled last block is copied on write, so it stays private to each request. Blocks are
 *  handed out from a free list as requests grow token by token in lockstep, so a request's blocks are
 *  interleaved with other requests' in physical memory. */
export function allocate(lengths: number[], maxLen: number, blockSize: number, prefix: number, share: boolean): Allocation {
  const sharedBlocks = share ? Math.floor(prefix / blockSize) : 0
  const blocks: Block[] = Array.from({ length: sharedBlocks }, (_, id) => ({ id, owner: 'shared' as const, used: blockSize }))
  const events: { start: number; owner: number; used: number }[] = []
  lengths.forEach((len, owner) => {
    for (let start = sharedBlocks * blockSize; start < len; start += blockSize)
      events.push({ start, owner, used: Math.min(blockSize, len - start) })
  })
  events.sort((a, b) => a.start - b.start || a.owner - b.owner)
  for (const e of events) blocks.push({ id: blocks.length, owner: e.owner, used: e.used })
  return {
    usedTokens: lengths.reduce((s, l) => s + l, 0),
    contiguousReserved: lengths.length * maxLen,
    pagedReserved: blocks.length * blockSize,
    sharedBlocks,
    blocks,
  }
}
