// Model architecture presets shared by the inference widgets, plus KV-cache sizing.
// Source: each model's official Hugging Face config.json (Llama 3.1 via unsloth mirrors of the gated
// meta-llama repos). Parameter counts are computed from the config and match the HF safetensors totals
// (DeepSeek-V3 excludes its 14B multi-token-prediction module: 671B main model).

export type Model = {
  name: string
  layers: number
  d_model: number
  heads: number // query heads
  kv_heads: number // native K/V heads (GQA); for MLA, the heads of the equivalent MHA form
  head_dim: number // per-head Q/K dimension
  v_head_dim: number // per-head V dimension
  params: number // total parameters (all experts)
  active_params: number // parameters used per token
  expert_params: number // routed-expert parameters (0 for dense); shared experts are not counted here
  experts: number // routed experts per MoE layer (0 for dense)
  experts_per_token: number
  mla?: { kv_lora_rank: number; rope_dim: number } // Multi-head Latent Attention: cache a latent per layer
}

const presets = {
  llama31_8b: {
    name: 'Llama-3.1 8B', layers: 32, d_model: 4096, heads: 32, kv_heads: 8, head_dim: 128, v_head_dim: 128,
    params: 8.03e9, active_params: 8.03e9, expert_params: 0, experts: 0, experts_per_token: 0,
  },
  llama31_70b: {
    name: 'Llama-3.1 70B', layers: 80, d_model: 8192, heads: 64, kv_heads: 8, head_dim: 128, v_head_dim: 128,
    params: 70.55e9, active_params: 70.55e9, expert_params: 0, experts: 0, experts_per_token: 0,
  },
  llama31_405b: {
    name: 'Llama-3.1 405B', layers: 126, d_model: 16384, heads: 128, kv_heads: 8, head_dim: 128, v_head_dim: 128,
    params: 405.85e9, active_params: 405.85e9, expert_params: 0, experts: 0, experts_per_token: 0,
  },
  qwen3_32b: {
    name: 'Qwen3 32B', layers: 64, d_model: 5120, heads: 64, kv_heads: 8, head_dim: 128, v_head_dim: 128,
    params: 32.76e9, active_params: 32.76e9, expert_params: 0, experts: 0, experts_per_token: 0,
  },
  qwen3_235b_a22b: {
    name: 'Qwen3 235B-A22B (MoE)', layers: 94, d_model: 4096, heads: 64, kv_heads: 4, head_dim: 128, v_head_dim: 128,
    params: 235.09e9, active_params: 22.19e9, expert_params: 94 * 128 * 3 * 4096 * 1536, experts: 128, experts_per_token: 8,
  },
  mixtral_8x7b: {
    name: 'Mixtral 8x7B (MoE)', layers: 32, d_model: 4096, heads: 32, kv_heads: 8, head_dim: 128, v_head_dim: 128,
    params: 46.70e9, active_params: 12.88e9, expert_params: 32 * 8 * 3 * 4096 * 14336, experts: 8, experts_per_token: 2,
  },
  deepseek_v3: {
    // MLA: K head dim = 128 (no-RoPE) + 64 (RoPE) = 192, V head dim = 128. 3 dense + 58 MoE layers.
    name: 'DeepSeek-V3 (MoE, MLA)', layers: 61, d_model: 7168, heads: 128, kv_heads: 128, head_dim: 192, v_head_dim: 128,
    params: 671.03e9, active_params: 37.55e9, expert_params: 58 * 256 * 3 * 7168 * 2048, experts: 256, experts_per_token: 8,
    mla: { kv_lora_rank: 512, rope_dim: 64 },
  },
} satisfies Record<string, Model>

export type ModelId = keyof typeof presets
export const models: Record<ModelId, Model> = presets
export const modelIds = Object.keys(models) as ModelId[]

/** Attention variant for KV sizing: K/V heads cached per layer, or MLA's compressed latent. */
export type Attn = { id: 'MHA' | 'GQA' | 'MQA' | 'MLA'; kv_heads: number; native: boolean }

/** The variants worth comparing for a model. GQA uses the model's own group count, or 8 if it is not GQA. */
export function attnVariants(m: Model): Attn[] {
  const nativeId = m.mla ? 'MLA' : m.kv_heads === m.heads ? 'MHA' : m.kv_heads === 1 ? 'MQA' : 'GQA'
  const gqa = nativeId === 'GQA' ? m.kv_heads : 8
  const list: Attn[] = [
    { id: 'MHA', kv_heads: m.heads, native: nativeId === 'MHA' },
    { id: 'GQA', kv_heads: gqa, native: nativeId === 'GQA' },
    { id: 'MQA', kv_heads: 1, native: nativeId === 'MQA' },
  ]
  if (m.mla) list.push({ id: 'MLA', kv_heads: 0, native: true })
  return list
}

export function nativeAttn(m: Model): Attn {
  return attnVariants(m).find((a) => a.native)!
}

/** KV-cache bytes per token for the whole model: 2·layers·kv_heads·head_dim·bytes (K and V),
 *  or for MLA layers·(kv_lora_rank + rope_dim)·bytes (one shared latent plus the decoupled RoPE key). */
export function kvBytesPerToken(m: Model, a: Attn, dtypeBytes: number): number {
  if (a.id === 'MLA') return m.layers * (m.mla!.kv_lora_rank + m.mla!.rope_dim) * dtypeBytes
  return m.layers * a.kv_heads * (m.head_dim + m.v_head_dim) * dtypeBytes
}

/** KV bytes per token held by each GPU under tensor parallelism `tp`. K/V heads are split across ranks,
 *  but a rank holds at least one head (heads are replicated when tp > kv_heads). The MLA latent is
 *  shared by all heads, so every rank holds a full copy. */
export function kvBytesPerTokenPerGpu(m: Model, a: Attn, dtypeBytes: number, tp: number): number {
  if (a.id === 'MLA') return kvBytesPerToken(m, a, dtypeBytes)
  return m.layers * Math.ceil(a.kv_heads / tp) * (m.head_dim + m.v_head_dim) * dtypeBytes
}
