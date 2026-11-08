// A lesson being built, as a live timeline: what the model searched and read, its thinking (when the model
// shares it), and the lesson taking shape section by section as it is written.
import { useState, type ReactNode } from 'react'
import type { Draft, Step } from './api'
import { Icon, type IconName } from './icons'

const PARTS: Record<string, string> = {
  problems: 'Practice problems',
  pitfalls: 'Pitfalls',
  explain_back: 'Explain it back',
  cards: 'Review cards',
}

export function Building({ steps, draft }: { steps: Step[]; draft?: Draft }) {
  return (
    <ol className="flex flex-col">
      {steps.map((step, i) => {
        const running = i === steps.length - 1 // the last step is the one in progress
        if (step.kind === 'thinking') return <Thinking key={i} text={step.text} running={running} />
        if (step.name === 'Write' && step.detail === 'Lesson')
          return (
            <Item key={i} icon="pencil" running={running} title={draft?.title ? `Writing “${draft.title}”` : 'Writing the lesson'}>
              {draft && <Outline draft={draft} running={running} />}
            </Item>
          )
        if (step.name === 'Write')
          return <Item key={i} icon="target" running={running} title="Read your answers" />
        if (step.name === 'WebFetch')
          return <Item key={i} icon="book" running={running} title="Read" detail={host(step.detail)} />
        return <Item key={i} icon="search" running={running} title="Searched the web" detail={`“${step.detail}”`} />
      })}
    </ol>
  )
}

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** One step: an icon on the rail (glowing while it runs), a title, and optional detail or content below. */
function Item({
  icon,
  title,
  detail,
  running,
  children,
}: {
  icon: IconName
  title: ReactNode
  detail?: string
  running: boolean
  children?: ReactNode
}) {
  return (
    <li className="relative flex animate-enter gap-3 pb-5">
      {!running && <span aria-hidden className="absolute top-8 bottom-0 left-[15px] w-px bg-line" />}
      <span
        className={`relative grid size-8 shrink-0 place-items-center rounded-full text-sm ${
          running ? 'bg-accent/15 text-accent shadow-[0_0_18px] shadow-accent/40' : 'bg-white/[0.05] text-muted'
        }`}
      >
        {running && <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-accent/20 [animation-duration:2s]" />}
        <Icon name={running ? icon : 'check'} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2 pt-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className={`shrink-0 text-sm font-medium ${running ? 'text-fg' : 'text-fg/80'}`}>{title}</span>
          {detail && <span className="min-w-0 truncate text-sm text-muted" title={detail}>{detail}</span>}
        </div>
        {children}
      </div>
    </li>
  )
}

/** Thinking: while it runs, the latest lines scroll past; afterwards it folds away (tap to read). */
function Thinking({ text, running }: { text: string; running: boolean }) {
  const [open, setOpen] = useState(false)
  const shown = text.trim()
  return (
    <Item icon="bulb" running={running} title={running ? 'Thinking…' : 'Thought it through'}>
      {running && shown && (
        <p className="max-h-24 overflow-hidden font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted [mask-image:linear-gradient(to_bottom,transparent,black_60%)]">
          {/* Bottom-aligned: the newest words stay in view while older ones fade out at the top. */}
          <span className="flex min-h-24 flex-col justify-end">{shown.slice(-600)}</span>
        </p>
      )}
      {!running && shown && (
        <button
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex items-center gap-1 self-start text-xs text-muted transition hover:text-fg"
        >
          {open ? 'Hide' : 'Show'} thinking
          <Icon name="chevron" className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      )}
      {open && (
        <p className="max-h-60 overflow-y-auto border-l border-line pl-3 text-sm whitespace-pre-wrap text-muted">{shown}</p>
      )}
    </Item>
  )
}

/** The lesson's sections as they are written, then the parts after them. */
function Outline({ draft, running }: { draft: Draft; running: boolean }) {
  const writingParts = draft.parts.length > 0
  return (
    <div className="flex flex-col gap-3">
      {draft.segments.length > 0 && (
        <ol className="flex flex-col gap-2.5">
          {draft.segments.map((s, i) => {
            const current = running && !writingParts && i === draft.segments.length - 1
            return (
              <li key={i} className="flex animate-enter gap-3">
                <span
                  className={`tabular grid size-6 shrink-0 place-items-center rounded-md text-xs ${
                    current ? 'bg-accent text-accent-fg' : 'bg-white/[0.06] text-muted'
                  }`}
                >
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-fg">
                    {s.title}
                    {current && !s.one_line && <Caret />}
                  </span>
                  {s.one_line && (
                    <span className="block text-sm text-muted">
                      {s.one_line}
                      {current && <Caret />}
                    </span>
                  )}
                </span>
              </li>
            )
          })}
        </ol>
      )}
      {draft.segments.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(PARTS).map(([key, label]) => {
            const at = draft.parts.indexOf(key)
            const state = at < 0 ? 'todo' : running && at === draft.parts.length - 1 ? 'now' : 'done'
            return (
              <span
                key={key}
                className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition ${
                  { todo: 'bg-white/[0.03] text-muted/50', now: 'animate-pulse bg-accent/15 text-accent', done: 'bg-good/10 text-good' }[state]
                }`}
              >
                {state === 'done' && <Icon name="check" />}
                {label}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Caret() {
  return <span aria-hidden className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-accent" />
}
