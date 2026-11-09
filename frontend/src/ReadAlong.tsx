// Text that follows the audio: the sentence being read is highlighted (CSS Custom Highlight API) and kept
// in view, and clicking a sentence plays from there. Used by Read mode and the Learn transcript.
import { useEffect, useRef, type PointerEvent } from 'react'
import { useAudio } from './audio'
import { Markdown } from './Markdown'
import { sentences, texToWords } from './speech'

type Span = [start: number, end: number]
/** A text node, or a rendered formula (KaTeX) that the voice reads as words. */
type Piece = { node: Node; text: string }

/** The page's text as the voice reads it, in pieces, and where each sentence of `speech` sits in their joined
 * text. A sentence not found (the page shows it differently) and the ones after it get no span. */
function layout(root: Node, speech: string) {
  const pieces: Piece[] = []
  const walk = (n: Node) => {
    if (n instanceof Text) pieces.push({ node: n, text: n.data })
    else if (n instanceof Element && n.classList.contains('katex'))
      pieces.push({ node: n, text: texToWords(n.querySelector('annotation')?.textContent ?? '') })
    else n.childNodes.forEach(walk)
  }
  walk(root)
  const joined = pieces.map((p) => p.text).join('')
  const spans: Span[] = []
  let from = 0
  for (const s of sentences(speech)) {
    const at = joined.indexOf(s, from) // in order, so a repeated sentence matches the right copy
    if (at < 0) break
    spans.push([at, at + s.length])
    from = at + s.length
  }
  return { pieces, spans }
}

function rangeOf(pieces: Piece[], [start, end]: Span): Range {
  const range = document.createRange()
  let offset = 0
  for (const { node, text } of pieces) {
    const next = offset + text.length
    if (start >= offset && start < next) {
      if (node instanceof Text) range.setStart(node, start - offset)
      else range.setStartBefore(node)
    }
    if (end > offset && end <= next) {
      if (node instanceof Text) range.setEnd(node, end - offset)
      else range.setEndAfter(node)
    }
    offset = next
  }
  return range
}

/** The index of the sentence under a point, or -1. */
function sentenceAt(root: Node, speech: string, x: number, y: number): number {
  const caret = document.caretPositionFromPoint?.(x, y)
  const fallback = caret ? null : document.caretRangeFromPoint?.(x, y)
  const node = caret?.offsetNode ?? fallback?.startContainer
  const offsetInNode = caret?.offset ?? fallback?.startOffset ?? 0
  if (!node || !root.contains(node)) return -1
  const { pieces, spans } = layout(root, speech)
  let offset = 0
  for (const p of pieces) {
    if (p.node === node) {
      offset += offsetInNode
      break
    }
    if (p.node.contains(node)) break // inside a formula: its start
    offset += p.text.length
  }
  return spans.findIndex(([start, end]) => offset >= start && offset <= end)
}

const highlights = () => ('highlights' in CSS ? CSS.highlights : null)

/** Shows `text` (markdown); `speech` is what the voice reads for it (default: `text` itself). */
export function ReadAlong({
  text,
  speech = text,
  onPlayFrom,
  className = '',
}: {
  text: string
  speech?: string
  onPlayFrom: (sentence: number) => void
  className?: string
}) {
  const root = useRef<HTMLDivElement>(null)
  const audio = useAudio()
  const index = (audio.state !== 'idle' || audio.held) && audio.spoken?.text === speech ? audio.spoken.index : -1

  // Highlight the sentence being read; follow it while the learner does (scrolling away stops that).
  const following = useRef(true)
  useEffect(() => {
    const h = highlights()
    if (!h || !root.current || index < 0) return
    const { pieces, spans } = layout(root.current, speech)
    if (!spans[index]) return
    const range = rangeOf(pieces, spans[index])
    const lit = new Highlight(range)
    lit.priority = 1 // over the hover hint
    h.set('narration', lit)
    const box = range.getBoundingClientRect()
    if (following.current && (box.top < 80 || box.bottom > window.innerHeight - 140))
      window.scrollBy({ top: box.top - window.innerHeight / 3, behavior: 'smooth' })
    return () => {
      const box = range.getBoundingClientRect()
      following.current = box.bottom > 0 && box.top < window.innerHeight
      h.delete('narration')
    }
  }, [speech, index])

  // With a mouse, the sentence under the pointer is lit faintly: clicking plays from it.
  const hovered = useRef(-1)
  function hover(e: PointerEvent) {
    const h = highlights()
    if (!h || e.pointerType !== 'mouse' || !root.current) return
    const i = sentenceAt(root.current, speech, e.clientX, e.clientY)
    if (i === hovered.current) return
    hovered.current = i
    const { pieces, spans } = layout(root.current, speech)
    if (spans[i]) h.set('narration-hover', new Highlight(rangeOf(pieces, spans[i])))
    else h.delete('narration-hover')
  }
  function unhover() {
    hovered.current = -1
    highlights()?.delete('narration-hover')
  }

  return (
    <div
      ref={root}
      title="Click a sentence to play from there"
      onPointerMove={hover}
      onPointerLeave={unhover}
      onClick={(e) => {
        if (document.getSelection()?.toString()) return // a drag to select text, e.g. to quote it
        const i = sentenceAt(root.current!, speech, e.clientX, e.clientY)
        if (i >= 0) onPlayFrom(i)
      }}
      className="cursor-pointer"
    >
      <Markdown className={className}>{text}</Markdown>
    </div>
  )
}
