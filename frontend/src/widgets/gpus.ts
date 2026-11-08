// Accelerator specs shared by widgets. Dense (non-sparse) peak tensor throughput, per GPU.
// Verified 2026-10 against vendor pages (NVIDIA lists Hopper/Blackwell tensor rates "with sparsity";
// dense = half of that):
//   A100: nvidia.com/en-us/data-center/a100      H100 / H200: nvidia.com/en-us/data-center/h100, /h200
//   B200: nvidia.com/en-us/data-center/hgx and /dgx-b200 (8-GPU totals: 1.44 TB memory, 64 TB/s HBM,
//         72 PF FP8 / 36 PF BF16 / 72 POPS INT8 sparse, 1.8 TB/s NVLink per GPU)
//   MI300X: rocm.docs.amd.com MI300 microarchitecture (matrix BF16 1307.4, FP8/INT8 2614.9) and AMD
//           platform data sheet (7 Infinity Fabric links x 128 GB/s bidirectional = 448 GB/s per direction)
//   RTX 4090: NVIDIA Ada architecture whitepaper, appendix A (rates with FP32 accumulate)
//   RX 7900 XTX: AMD product page (matrix FP16 122.8 TFLOPS, 960 GB/s)
export type Gpu = {
  name: string
  memory_gb: number // vendor "GB"; for these parts this matches GiB (2^30 B) as reported by nvidia-smi/rocm-smi
  hbm_tbps: number // memory bandwidth, TB/s
  bf16_tflops: number
  fp8_tflops: number | null // null: no FP8 tensor support
  int8_tops: number // dense INT8 tensor TOPS
  interconnect_gbps: number // per-GPU scale-up bandwidth (NVLink / Infinity Fabric / PCIe), GB/s, one direction
}

export const gpus = {
  A100_SXM_80GB: { name: 'A100 SXM 80GB', memory_gb: 80, hbm_tbps: 2.039, bf16_tflops: 312, fp8_tflops: null, int8_tops: 624, interconnect_gbps: 300 },
  H100_SXM: { name: 'H100 SXM', memory_gb: 80, hbm_tbps: 3.35, bf16_tflops: 989, fp8_tflops: 1979, int8_tops: 1979, interconnect_gbps: 450 },
  H200_SXM: { name: 'H200 SXM', memory_gb: 141, hbm_tbps: 4.8, bf16_tflops: 989, fp8_tflops: 1979, int8_tops: 1979, interconnect_gbps: 450 },
  B200: { name: 'B200 (HGX)', memory_gb: 180, hbm_tbps: 8, bf16_tflops: 2250, fp8_tflops: 4500, int8_tops: 4500, interconnect_gbps: 900 },
  // Infinity Fabric is a full mesh of 64 GB/s-per-direction links: one peer pair gets 1/7 of the 448 GB/s.
  MI300X: { name: 'MI300X', memory_gb: 192, hbm_tbps: 5.3, bf16_tflops: 1307, fp8_tflops: 2615, int8_tops: 2615, interconnect_gbps: 448 },
  RTX_4090: { name: 'RTX 4090', memory_gb: 24, hbm_tbps: 1.008, bf16_tflops: 165, fp8_tflops: 330, int8_tops: 661, interconnect_gbps: 32 },
  RX_7900_XTX: { name: 'RX 7900 XTX', memory_gb: 24, hbm_tbps: 0.96, bf16_tflops: 123, fp8_tflops: null, int8_tops: 123, interconnect_gbps: 32 },
} satisfies Record<string, Gpu>

export type GpuId = keyof typeof gpus
export const gpuIds = Object.keys(gpus) as GpuId[]

export const dtypeBytes = { fp32: 4, bf16: 2, fp16: 2, fp8: 1, int8: 1, int4: 0.5 } as const
export type Dtype = keyof typeof dtypeBytes

/** Peak tensor TFLOPS (TOPS for int8) for a dtype. fp8 falls back to the BF16 rate on GPUs without FP8
 *  (weights stored in FP8, math in BF16); int4 likewise means 4-bit weights with BF16 math.
 *  fp32 uses the TF32 tensor rate: BF16/2 on every GPU listed (RX 7900 XTX: its FP32 vector rate). */
export function peakTflops(gpu: Gpu, dtype: Dtype): number {
  if (dtype === 'fp8') return gpu.fp8_tflops ?? gpu.bf16_tflops
  if (dtype === 'int8') return gpu.int8_tops
  if (dtype === 'fp32') return gpu.bf16_tflops / 2
  return gpu.bf16_tflops
}
