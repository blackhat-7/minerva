// Roofline model for a GEMM [M×K]·[K×N] on one GPU. All rates in SI units (FLOP/s, B/s).
import { dtypeBytes, peakTflops, type Dtype, type Gpu } from './gpus'

export type Roof = { peak: number; bw: number; ridge: number } // FLOP/s, B/s, FLOP/B

export function roof(gpu: Gpu, dtype: Dtype): Roof {
  const peak = peakTflops(gpu, dtype) * 1e12
  const bw = gpu.hbm_tbps * 1e12
  return { peak, bw, ridge: peak / bw }
}

/** FLOPs = 2MNK; bytes = each operand and the output moved once: b·(MK + KN + MN). */
export function gemm(m: number, k: number, n: number, dtype: Dtype) {
  const flops = 2 * m * n * k
  const bytes = dtypeBytes[dtype] * (m * k + k * n + m * n)
  return { flops, bytes, intensity: flops / bytes }
}

/** Attainable throughput at an intensity: min(peak, intensity · bandwidth). */
export const attainable = (r: Roof, intensity: number) => Math.min(r.peak, intensity * r.bw)

/** Lower bound on op time: the slower of doing the math and moving the bytes. */
export const opTime = (r: Roof, flops: number, bytes: number) => Math.max(flops / r.peak, bytes / r.bw)

/** Smallest M whose GEMM intensity reaches the ridge, for fixed K and N.
 *  Solves 2MNK = ridge·b·(MK + KN + MN) for M; Infinity if the ridge is unreachable at any M
 *  (as M → ∞ intensity tends to 2KN / (b·(K + N))). */
export function mToReachRidge(r: Roof, k: number, n: number, dtype: Dtype): number {
  const rb = r.ridge * dtypeBytes[dtype]
  const denom = 2 * n * k - rb * (k + n)
  return denom > 0 ? (rb * k * n) / denom : Infinity
}
