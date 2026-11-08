// Select text in the lesson, then "Ask about this": the selection goes to the tutor as a quote.
import { useEffect, useState, type RefObject } from 'react'
import { Icon } from './icons'

const MAX_QUOTE = 1200 // characters; a quote is context for a question, not a document

/** A floating button under a text selection inside `within`. */
export function QuoteSelection({ within, onQuote }: { within: RefObject<HTMLElement | null>; onQuote: (text: string) => void }) {
  const [at, setAt] = useState<{ text: string; left: number; top: number } | null>(null)

  useEffect(() => {
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const sel = document.getSelection()
        const text = sel?.toString().trim() ?? ''
        const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null
        const root = within.current
        if (!range || text.length < 2 || !root?.contains(range.commonAncestorContainer)) return setAt(null)
        const box = range.getBoundingClientRect()
        const left = Math.min(Math.max(box.left + box.width / 2, 90), window.innerWidth - 90)
        // below the selection: iOS puts its own copy menu above it
        setAt({ text: text.slice(0, MAX_QUOTE), left, top: Math.min(box.bottom + 10, window.innerHeight - 60) })
      })
    }
    document.addEventListener('selectionchange', update)
    window.addEventListener('scroll', update, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('selectionchange', update)
      window.removeEventListener('scroll', update)
    }
  }, [within])

  if (!at) return null
  return (
    <button
      style={{ left: at.left, top: at.top }}
      onPointerDown={(e) => e.preventDefault()} // keep the selection while tapping
      onClick={() => {
        onQuote(at.text)
        document.getSelection()?.removeAllRanges()
      }}
      className="fixed z-30 flex min-h-10 -translate-x-1/2 animate-enter items-center gap-2 rounded-full border border-white/[0.1] bg-raised/95 px-4 text-sm shadow-2xl shadow-black/60 backdrop-blur-xl transition hover:bg-raised"
    >
      <Icon name="chat" className="text-accent" />
      Ask about this
    </button>
  )
}
