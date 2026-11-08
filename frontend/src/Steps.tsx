// What a model did on the way to its answer, shown like a coding agent's log: thinking, then tool calls
// such as web searches and page fetches.
import { useState } from 'react'
import type { Step } from './api'
import { Icon } from './icons'

const TOOL_NAMES: Record<string, string> = { WebSearch: 'Web Search', WebFetch: 'Fetch' }

/** `live`: the model is still working, so the last step is the one running. */
export function Steps({ steps, live }: { steps: Step[]; live: boolean }) {
  return (
    <ul className="flex flex-col gap-1.5 font-mono text-[13px] text-muted">
      {steps.map((step, i) => (
        <StepRow key={i} step={step} running={live && i === steps.length - 1} />
      ))}
    </ul>
  )
}

function StepRow({ step, running }: { step: Step; running: boolean }) {
  const [open, setOpen] = useState(false)
  if (step.kind === 'tool')
    return (
      <li className="flex min-w-0 gap-2">
        <span className={running ? 'animate-pulse text-accent' : 'text-good'}>●</span>
        <span className="min-w-0 truncate" title={step.detail}>
          <span className="font-semibold text-fg">{TOOL_NAMES[step.name] ?? step.name}</span>({step.detail})
        </span>
      </li>
    )
  const text = step.text.trim()
  const label = running ? 'Thinking…' : 'Thought'
  return (
    <li className="flex flex-col gap-1.5">
      {text ? (
        <button
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex items-center gap-2 self-start italic transition hover:text-fg"
        >
          <span className={`not-italic ${running ? 'animate-pulse text-accent' : ''}`}>✻</span>
          {label}
          <Icon name="chevron" className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      ) : (
        <span className="flex gap-2 italic">
          <span className={`not-italic ${running ? 'animate-pulse text-accent' : ''}`}>✻</span>
          {label}
        </span>
      )}
      {open && (
        <p className="ml-1.5 max-h-60 overflow-y-auto border-l border-line pl-3 font-sans text-sm whitespace-pre-wrap">
          {text}
        </p>
      )}
    </li>
  )
}
