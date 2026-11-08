// Number formatting for widgets. SI prefixes, 3 significant figures.
const prefixes = ['', 'K', 'M', 'G', 'T', 'P', 'E', 'Z']

export function si(value: number, unit = ''): string {
  if (!Number.isFinite(value)) return '∞'
  if (value === 0) return `0 ${unit}`.trim()
  let i = 0
  let v = Math.abs(value)
  while (v >= 1000 && i < prefixes.length - 1) {
    v /= 1000
    i++
  }
  const sign = value < 0 ? '-' : ''
  return `${sign}${Number(v.toPrecision(3))} ${prefixes[i]}${unit}`.trim()
}

export const bytes = (b: number) => si(b, 'B')
export const flops = (f: number) => si(f, 'FLOP')

export function duration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '∞'
  if (seconds < 1e-3) return `${Number((seconds * 1e6).toPrecision(3))} µs`
  if (seconds < 1) return `${Number((seconds * 1e3).toPrecision(3))} ms`
  if (seconds < 120) return `${Number(seconds.toPrecision(3))} s`
  if (seconds < 7200) return `${Number((seconds / 60).toPrecision(3))} min`
  if (seconds < 172800) return `${Number((seconds / 3600).toPrecision(3))} h`
  return `${Number((seconds / 86400).toPrecision(3))} days`
}
