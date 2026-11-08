// Narration text that follows the audio: the sentence being read is highlighted (CSS Custom Highlight API)
// and kept in view, and clicking a sentence plays from there. Used by Read mode and the Learn transcript.
import { useEffect, useRef, type PointerEvent } from 'react'
import { useAudio } from './audio'
import { Markdown } from './Markdown'
import { sentences } from './speech'

type Span = [start: number, end: number]

/** The text nodes under `root` and where each sentence of `text` sits in their joined text. A sentence not
 * found (the markdown renders it differently) and the ones after it get no span. */
function layout(root: Node, text: string) {
  const nodes: Text[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text)
  const joined = nodes.map((n) => n.data).join('')
  const spans: Span[] = []
  let from = 0
  for (const s of sentences(text)) {
    const at = joined.indexOf(s, from) // in order, so a repeated sentence matches the right copy
    if (at < 0) break
    spans.push([at, at + s.length])
    from = at + s.length
  }
  return { nodes, spans }
}

function rangeOf(nodes: Text[], [start, end]: Span): Range {
  const range = document.createRange()
  let offset = 0
  for (const n of nodes) {
    const next = offset + n.data.length
    if (start >= offset && start < next) range.setStart(n, start - offset)
    if (end > offset && end <= next) range.setEnd(n, end - offset)
    offset = next
  }
  return range
}

/** The index of the sentence under a point, or -1. */
function sentenceAt(root: Node, text: string, x: number, y: number): number {
  const caret = document.caretPositionFromPoint?.(x, y)
  const fallback = caret ? null : document.caretRangeFromPoint?.(x, y)
  const node = caret?.offsetNode ?? fallback?.startContainer
  const offsetInNode = caret?.offset ?? fallback?.startOffset ?? 0
  if (!node || !root.contains(node)) return -1
  const { nodes, spans } = layout(root, text)
  let offset = 0
  for (const n of nodes) {
    if (n === node) break
    offset += n.data.length
  }
  const at = offset + offsetInNode
  return spans.findIndex(([start, end]) => at >= start && at <= end)
}

const highlights = () => ('highlights' in CSS ? CSS.highlights : null)

export function ReadAlong({
  text,
  onPlayFrom,
  className = '',
}: {
  text: string
  onPlayFrom: (sentence: number) => void
  className?: string
}) {
  const root = useRef<HTMLDivElement>(null)
  const audio = useAudio()
  const index = (audio.state !== 'idle' || audio.held) && audio.spoken?.text === text ? audio.spoken.index : -1

  // Highlight the sentence being read; follow it while the learner does (scrolling away stops that).
  const following = useRef(true)
  useEffect(() => {
    const h = highlights()
    if (!h || !root.current || index < 0) return
    const { nodes, spans } = layout(root.current, text)
    if (!spans[index]) return
    const range = rangeOf(nodes, spans[index])
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
  }, [text, index])

  // With a mouse, the sentence under the pointer is lit faintly: clicking plays from it.
  const hovered = useRef(-1)
  function hover(e: PointerEvent) {
    const h = highlights()
    if (!h || e.pointerType !== 'mouse' || !root.current) return
    const i = sentenceAt(root.current, text, e.clientX, e.clientY)
    if (i === hovered.current) return
    hovered.current = i
    const { nodes, spans } = layout(root.current, text)
    if (spans[i]) h.set('narration-hover', new Highlight(rangeOf(nodes, spans[i])))
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
        const i = sentenceAt(root.current!, text, e.clientX, e.clientY)
        if (i >= 0) onPlayFrom(i)
      }}
      className="cursor-pointer"
    >
      <Markdown className={className}>{text}</Markdown>
    </div>
  )
}
