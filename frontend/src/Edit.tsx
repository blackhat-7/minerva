// "Edit section": the learner says what a lesson segment should have (a visual, more depth, a simpler
// explanation) and the lesson model rewrites it, possibly adding a segment after it. The player owns the
// request, so it keeps going when this sheet closes.
import { useState } from 'react'
import { Button, ErrorNote, field, Spinner } from './ui'

const SUGGESTIONS = [
  'Animate how this works, step by step',
  'Explain it more simply',
  'Go deeper, with real numbers',
  'Add a worked example',
]

export type EditState = { segmentId: string; title: string; busy: boolean; error: string }

export function EditSection({ edit, onSubmit }: { edit: EditState; onSubmit: (instruction: string) => void }) {
  const [text, setText] = useState('')
  const submit = () => text.trim() && !edit.busy && onSubmit(text.trim())
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-5">
      <p className="text-sm text-muted">
        Rewrites <span className="text-fg">{edit.title}</span> to fit the rest of the lesson, or adds a section after it
        when that fits better.
      </p>
      <textarea
        autoFocus
        aria-label="What should change"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
        }}
        disabled={edit.busy}
        rows={4}
        placeholder="What should change? For example: a small interactive animation of what’s inside a transformer layer"
        className={`${field} resize-y leading-relaxed`}
      />
      {!edit.busy && (
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setText(s)}
              className="min-h-9 rounded-full bg-white/[0.05] px-3.5 text-left text-sm text-muted transition hover:bg-white/[0.09] hover:text-fg"
            >
              {s}
            </button>
          ))}
        </div>
      )}
      {edit.error && <ErrorNote error={edit.error} onRetry={submit} />}
      <Button variant="primary" className="self-start" onClick={submit} disabled={!text.trim() || edit.busy}>
        {edit.busy && <Spinner />}
        {edit.busy ? 'Rewriting' : 'Update section'}
      </Button>
      {edit.busy && (
        <p className="text-sm text-muted">Usually a minute or two. Keep going; the lesson updates when it’s ready.</p>
      )}
    </div>
  )
}
