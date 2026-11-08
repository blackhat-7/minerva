// Numeric answers: parse what a learner types and grade it by ratio, the way estimates are judged.

const SUFFIX: Record<string, number> = { k: 1e3, K: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15 }

/** Parses `1.2e12`, `3.5T`, `400G`, `20k`, `1,000`, `-2.5`. Returns null if it is not a number. */
export function parseNumber(input: string): number | null {
  const s = input.replace(/[,_\s]/g, '')
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([kKMGTP]?)$/i.exec(s)
  if (!m) return null
  // The `i` flag lets `E` through for exponents; suffixes stay case-sensitive (m is not M).
  if (m[2] && !(m[2] in SUFFIX)) return null
  return Number(m[1]) * (m[2] ? SUFFIX[m[2]] : 1)
}

export type NumericGrade = { correct: boolean; ratio: number; feedback: string }

/** Correct iff the signs match and max(a/v, v/a) <= tolerance. */
export function gradeNumeric(answer: number, value: number, tolerance: number): NumericGrade {
  if (Math.sign(answer) !== Math.sign(value)) {
    return { correct: false, ratio: Infinity, feedback: 'Wrong sign.' }
  }
  const ratio = Math.max(answer / value, value / answer)
  const correct = ratio <= tolerance
  const direction = Math.abs(answer) > Math.abs(value) ? 'high' : 'low'
  const feedback =
    ratio < 1.05
      ? 'Spot on.'
      : correct
        ? `Within ${ratio.toFixed(1)}x (${direction}).`
        : `Off by ${ratio.toFixed(1)}x (too ${direction}).`
  return { correct, ratio, feedback }
}

/** Compact number for display: 1.2e12 -> "1.2T", 0.004 -> "0.004", 3.5e-7 -> "3.5e-7". */
export function formatNumber(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1e3 && abs < 1e18) {
    const units = [['P', 1e15], ['T', 1e12], ['G', 1e9], ['M', 1e6], ['k', 1e3]] as const
    const [suffix, scale] = units.find(([, s]) => abs >= s)!
    return `${+(n / scale).toPrecision(3)}${suffix}`
  }
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e18)) return n.toExponential(1).replace('e+', 'e')
  return String(+n.toPrecision(3))
}
