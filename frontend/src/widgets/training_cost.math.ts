// Training compute and cost: FLOPs ≈ 6·N·D (forward 2ND + backward 4ND; attention FLOPs ignored),
// with N the parameters used per token (active parameters for MoE).

export function trainingFlops(nActive: number, tokens: number): number {
  return 6 * nActive * tokens
}

export type Estimate = { flops: number; seconds: number; gpuHours: number; cost: number }

export function estimate(nActive: number, tokens: number, gpus: number, peakFlops: number, mfu: number, dollarsPerGpuHour: number): Estimate {
  const flops = trainingFlops(nActive, tokens)
  const seconds = flops / (gpus * peakFlops * mfu)
  const gpuHours = (seconds * gpus) / 3600
  return { flops, seconds, gpuHours, cost: gpuHours * dollarsPerGpuHour }
}

/** Chinchilla (Hoffmann et al. 2022): compute-optimal dense training uses about 20 tokens per parameter. */
export const CHINCHILLA_TOKENS_PER_PARAM = 20

/** Published training runs. N is active parameters; gpuHours as reported (includes real-world overheads). */
export const references = [
  { name: 'GPT-3', n: 175e9, tokens: 300e9, note: 'Brown et al. 2020' },
  { name: 'Chinchilla', n: 70e9, tokens: 1.4e12, note: 'Hoffmann et al. 2022' },
  { name: 'Llama 3.1 8B', n: 8.03e9, tokens: 15e12, note: '1.46M H100-hours (model card)' },
  { name: 'Llama 3.1 405B', n: 405.85e9, tokens: 15.6e12, note: '3.8e25 FLOPs, up to 16K H100s, 30.84M H100-hours' },
  { name: 'DeepSeek-V3', n: 37.55e9, tokens: 14.8e12, note: 'MoE, 671B total; 2.788M H800-hours, FP8' },
]
