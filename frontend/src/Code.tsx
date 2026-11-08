// Code walked through step by step: highlighted, with line numbers, and a band behind the current step's lines
// (an overlay, so a comment or string spanning lines stays one highlighted token).
import { useEffect, useRef } from 'react'
import { highlight } from './highlight'
import { lineRanges } from './scene'

const LINE = 1.6 // line height, in em
const PAD = 12 // px above the first line

export function Code({ code, language, lines }: { code: string; language: string; lines: string }) {
  const text = code.replace(/\s+$/, '')
  const count = text.split('\n').length
  const html = highlight(text, language)
  const ranges = lineRanges(lines, count)
  const marked = (n: number) => ranges.some(([lo, hi]) => n >= lo && n <= hi)

  // Bring the marked lines into view when the step moves them out of it.
  const box = useRef<HTMLDivElement>(null)
  const [first, end] = [ranges[0]?.[0] ?? 0, ranges.at(-1)?.[1] ?? 0]
  useEffect(() => {
    const el = box.current
    if (!el || !first) return
    const line = parseFloat(getComputedStyle(el.firstElementChild!).lineHeight)
    const [top, bottom] = [PAD + (first - 1) * line, PAD + end * line]
    if (top < el.scrollTop || bottom > el.scrollTop + el.clientHeight)
      el.scrollTo({ top: Math.max(0, (top + bottom - el.clientHeight) / 2), behavior: 'smooth' })
  }, [first, end])

  return (
    <div ref={box} className="max-h-[min(36rem,70dvh)] overflow-auto rounded-2xl bg-raised text-[13px] sm:text-sm">
      <div className="relative flex w-max min-w-full font-mono" style={{ lineHeight: LINE, paddingBlock: PAD }}>
        {ranges.map(([lo, hi], i) => (
          <div
            key={i}
            className="absolute inset-x-0 border-l-2 border-accent bg-accent/[0.12] transition-all duration-300 ease-out"
            style={{ top: `calc(${PAD}px + ${(lo - 1) * LINE}em)`, height: `${(hi - lo + 1) * LINE}em` }}
          />
        ))}
        <div aria-hidden className="tabular relative shrink-0 px-4 text-right text-muted/60 select-none">
          {Array.from({ length: count }, (_, i) => (
            <div key={i} className={marked(i + 1) ? 'text-accent' : undefined}>
              {i + 1}
            </div>
          ))}
        </div>
        <pre className="relative pr-6">
          {html === null ? <code>{text}</code> : <code dangerouslySetInnerHTML={{ __html: html }} />}
        </pre>
      </div>
    </div>
  )
}
