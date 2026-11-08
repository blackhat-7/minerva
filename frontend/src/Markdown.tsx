import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { GlossaryContext, rehypeGlossary } from './glossary'

const remarkPlugins = [remarkGfm, remarkMath]

/** Markdown with `$inline$` and `$$display$$` math (\( \) and \[ \] too). Inside a lesson, glossary terms
 * are underlined and define themselves on hover or tap. */
export function Markdown({ children, className = '' }: { children: string; className?: string }) {
  const glossary = useContext(GlossaryContext)
  const [rehypePlugins, components] = useMemo((): [never[], Components] => {
    const components: Components = {
      a: ({ href, children }) => (
        <a href={href} target="_blank" rel="noreferrer">
          {children}
        </a>
      ),
      dfn: ({ children, ...props }) => {
        const data = props as Record<string, string>
        const [name, definition] = [data['data-term'], data['data-definition']]
        return definition ? (
          <Term name={name} definition={definition}>
            {children}
          </Term>
        ) : (
          <>{children}</>
        )
      },
    }
    const plugins = glossary ? [rehypeGlossary(glossary), rehypeKatex] : [rehypeKatex]
    return [plugins as never[], components]
  }, [glossary])
  const text = children
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => `$$${m}$$`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => `$${m}$`)
  return (
    <div className={`md ${className}`}>
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
}

/** A glossary term: dotted underline; definition in a popover (portal, so overflow and transforms can't clip it). */
function Term({ name, definition, children }: { name: string; definition: string; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [at, setAt] = useState<{ left: number; top?: number; bottom?: number } | null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const show = () => {
    const r = ref.current!.getBoundingClientRect()
    const left = Math.max(8, Math.min(r.left, window.innerWidth - 296))
    setAt(r.bottom > window.innerHeight - 180 ? { left, bottom: window.innerHeight - r.top + 6 } : { left, top: r.bottom + 6 })
  }
  const toggle = () => (at ? setAt(null) : show())

  useEffect(() => {
    if (!at) return
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return
      if (e.type === 'pointerdown' && ref.current?.contains(e.target as Node)) return
      setAt(null)
    }
    const events = ['pointerdown', 'keydown', 'scroll', 'resize']
    events.forEach((t) => window.addEventListener(t, close, true))
    return () => events.forEach((t) => window.removeEventListener(t, close, true))
  }, [at])

  return (
    <>
      <span
        ref={ref}
        role="button"
        tabIndex={0}
        aria-label={`${name}: show definition`}
        onClick={(e) => {
          e.stopPropagation() // a term inside a choice option shouldn't select the option
          toggle()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            toggle()
          }
        }}
        onPointerEnter={(e) => {
          if (e.pointerType === 'mouse') hoverTimer.current = setTimeout(show, 250)
        }}
        onPointerLeave={(e) => {
          if (e.pointerType !== 'mouse') return
          clearTimeout(hoverTimer.current)
          setAt(null)
        }}
        className="cursor-help underline decoration-muted/60 decoration-dotted underline-offset-[3px] transition-colors hover:decoration-accent"
      >
        {children}
      </span>
      {at &&
        createPortal(
          <div
            role="tooltip"
            style={at}
            className="fixed z-50 w-72 animate-enter rounded-2xl border border-white/[0.08] bg-raised/95 p-4 text-sm shadow-2xl shadow-black/60 backdrop-blur-xl"
          >
            <div className="font-medium text-fg">{name}</div>
            <div className="mt-1 leading-relaxed text-muted">{definition}</div>
          </div>,
          document.body,
        )}
    </>
  )
}
