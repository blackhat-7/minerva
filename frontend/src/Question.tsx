// Answering one question: choice, numeric (graded here) or free (graded by the backend), with graduated hints.
// Every miss becomes a review card.
import { useState } from 'react'
import { api } from './api'
import { errorMessage } from './hooks'
import { Icon } from './icons'
import type { Question } from './lesson'
import { GlossaryContext } from './glossary'
import { Markdown } from './Markdown'
import { formatNumber, gradeNumeric, parseNumber } from './numeric'
import { Button, ErrorNote, field, Spinner } from './ui'

/** A submitted answer. `answer` is "" for "don't know"; `correct` is null when not graded (free predictions). */
export type Attempt = { answer: string; correct: boolean | null; feedback: string }

function answerOf(q: Question): string {
  if (q.kind === 'choice') return q.options[q.correct ?? 0] ?? ''
  if (q.kind === 'numeric') return `${formatNumber(q.value ?? 0)} ${q.unit}`.trim()
  return q.reference
}

/** `predict` mode: no hints, "Not sure" instead of "Don't know", and no reveal (the segment reveals later). */
export function QuestionCard({
  question: q,
  attempt,
  onAttempt,
  lessonId,
  predict = false,
  onDraft,
}: {
  question: Question
  attempt?: Attempt
  onAttempt: (a: Attempt) => void
  lessonId?: string
  predict?: boolean
  onDraft?: (text: string) => void
}) {
  const [choice, setChoice] = useState<number | null>(null)
  const [text, setText] = useState('')
  const [hints, setHints] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [cardFailed, setCardFailed] = useState(false)

  const parsed = q.kind === 'numeric' ? parseNumber(text) : null
  const ready = q.kind === 'choice' ? choice !== null : text.trim() !== ''

  function addCard() {
    setCardFailed(false)
    const back = `**Answer:** ${answerOf(q)}\n\n${q.explanation}`
    api.addCard(q.prompt, back, lessonId).catch(() => setCardFailed(true))
  }

  async function submit(dontKnow = false) {
    setError('')
    let a: Attempt
    if (dontKnow) a = { answer: '', correct: predict ? null : false, feedback: '' }
    else if (!ready || busy) return
    else if (q.kind === 'choice') a = { answer: q.options[choice!], correct: choice === q.correct, feedback: '' }
    else if (q.kind === 'numeric') {
      if (parsed === null) return setError('Couldn’t read that number. Try 3.5e12, 3.5T, 400G or 1,000.')
      const g = gradeNumeric(parsed, q.value!, q.tolerance)
      a = { answer: text.trim(), correct: g.correct, feedback: g.feedback }
    } else if (predict) a = { answer: text.trim(), correct: null, feedback: '' }
    else {
      setBusy(true)
      try {
        a = { answer: text.trim(), ...(await api.grade(lessonId ?? '', q, text.trim())) }
      } catch (e) {
        return setError(errorMessage(e))
      } finally {
        setBusy(false)
      }
    }
    onAttempt(a)
    if (a.correct === false) addCard()
  }

  const draft = (v: string) => {
    setText(v)
    onDraft?.(v)
  }

  if (attempt && predict) return null

  return (
    <div className="flex flex-col gap-4">
      <Markdown className="text-[16px] leading-relaxed">{q.prompt}</Markdown>

      {attempt ? (
        <Reveal q={q} attempt={attempt} />
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          {q.kind === 'choice' ? (
            <div className="flex flex-col gap-2" role="radiogroup">
              {q.options.map((o, i) => (
                <button
                  key={i}
                  type="button"
                  role="radio"
                  aria-checked={choice === i}
                  onClick={() => {
                    setChoice(i)
                    onDraft?.(o)
                  }}
                  className={`flex min-h-12 items-start gap-3 rounded-2xl border px-4 py-3 text-left text-[15px] transition duration-150 ${
                    choice === i
                      ? 'border-accent/70 bg-accent/[0.08]'
                      : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.14] hover:bg-white/[0.04]'
                  }`}
                >
                  <span
                    className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-medium transition ${choice === i ? 'bg-accent text-accent-fg' : 'bg-white/[0.07] text-muted'}`}
                  >
                    {String.fromCharCode(65 + i)}
                  </span>
                  {/* no glossary popovers here: tapping anywhere on an option selects it */}
                  <GlossaryContext.Provider value={null}>
                    <Markdown className="min-w-0">{o}</Markdown>
                  </GlossaryContext.Provider>
                </button>
              ))}
            </div>
          ) : q.kind === 'numeric' ? (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <input
                  value={text}
                  onChange={(e) => draft(e.target.value)}
                  placeholder="e.g. 3.5e12, 400G, 20k"
                  inputMode="text"
                  autoCapitalize="off"
                  autoComplete="off"
                  spellCheck={false}
                  className={`${field} tabular font-mono`}
                />
                {q.unit && <span className="shrink-0 font-mono text-sm text-muted">{q.unit}</span>}
              </div>
              <span className="tabular h-4 font-mono text-xs text-muted">
                {parsed !== null && text.trim() !== String(parsed) ? `= ${parsed.toExponential(2)}` : ''}
              </span>
            </div>
          ) : (
            <textarea
              value={text}
              onChange={(e) => draft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  submit()
                }
              }}
              rows={4}
              placeholder={predict ? 'Your best guess, in a sentence or two' : 'Your answer'}
              className={`${field} resize-y`}
            />
          )}

          {!predict && hints > 0 && (
            <ol className="flex flex-col gap-2">
              {q.hints.slice(0, hints).map((h, i) => (
                <li key={i} className="flex animate-enter gap-2.5 rounded-2xl bg-warn/[0.07] px-4 py-3 text-sm">
                  <Icon name="bulb" className="mt-0.5 text-warn" />
                  <Markdown className="min-w-0">{h}</Markdown>
                </li>
              ))}
            </ol>
          )}

          {error && <ErrorNote error={error} />}

          <div className="flex flex-wrap items-center gap-1">
            <Button type="submit" variant="primary" disabled={!ready || busy}>
              {busy && <Spinner />}
              {predict ? 'Lock in prediction' : busy ? 'Grading' : 'Submit'}
            </Button>
            <Button type="button" variant="ghost" className="text-muted" onClick={() => submit(true)} disabled={busy}>
              {predict ? 'Not sure' : 'Don’t know'}
            </Button>
            {!predict && q.hints.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                className="ml-auto px-4 text-warn"
                onClick={() => setHints((h) => h + 1)}
                disabled={hints >= q.hints.length}
              >
                <Icon name="bulb" />
                {hints >= q.hints.length ? 'No more hints' : hints ? 'Another hint' : 'Hint'}
              </Button>
            )}
          </div>
        </form>
      )}

      {cardFailed && <ErrorNote error="Couldn’t save this to your review deck." onRetry={addCard} />}
    </div>
  )
}

/** Verdict, the right answer and the explanation, after answering. */
function Reveal({ q, attempt }: { q: Question; attempt: Attempt }) {
  const verdict =
    attempt.answer === ''
      ? { tone: 'text-muted', label: 'Here’s how it works' }
      : attempt.correct
        ? { tone: 'text-good', label: 'Correct' }
        : { tone: 'text-bad', label: 'Not quite' }
  return (
    <div className="flex animate-enter flex-col gap-3 rounded-2xl bg-white/[0.03] p-4">
      <div className={`flex items-center gap-2 text-sm font-medium ${verdict.tone}`}>
        {attempt.answer !== '' && <Icon name={attempt.correct ? 'check' : 'close'} />}
        {verdict.label}
        {attempt.feedback && q.kind === 'numeric' && <span className="font-normal text-muted">· {attempt.feedback}</span>}
      </div>
      {attempt.answer && (
        <div className="text-sm">
          <span className="text-muted">You said </span>
          <span className="font-mono">{attempt.answer}</span>
        </div>
      )}
      {attempt.feedback && q.kind === 'free' && <Markdown className="text-sm">{attempt.feedback}</Markdown>}
      {!attempt.correct && (
        <div className="text-sm">
          <span className="text-muted">Answer: </span>
          <Markdown className="inline-block font-medium">{answerOf(q)}</Markdown>
        </div>
      )}
      <Markdown className="text-[15px] leading-relaxed text-fg/85">{q.explanation}</Markdown>
    </div>
  )
}

/** After a segment: what the learner predicted next to what is actually true. */
export function PredictionReview({ q, attempt }: { q: Question; attempt: Attempt }) {
  const verdict =
    attempt.answer === ''
      ? 'You weren’t sure. Now you know:'
      : attempt.correct === true
        ? 'Your prediction was right.'
        : attempt.correct === false
          ? 'Your prediction was off. Compare:'
          : 'Compare with what you predicted:'
  return (
    <div className="flex animate-enter flex-col gap-3 rounded-3xl border border-white/[0.06] bg-surface p-5 text-[15px]">
      <div className="flex items-center gap-2 font-medium">
        <Icon name="target" className={attempt.correct ? 'text-good' : 'text-accent'} />
        {verdict}
      </div>
      <Markdown className="text-muted">{q.prompt}</Markdown>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted">You</dt>
        <dd className="font-mono">
          {attempt.answer || '—'}
          {attempt.feedback && <span className="ml-2 font-sans text-muted">{attempt.feedback}</span>}
        </dd>
        <dt className="text-muted">Actual</dt>
        <dd>
          <Markdown>{answerOf(q)}</Markdown>
        </dd>
      </dl>
      <Markdown className="leading-relaxed text-fg/85">{q.explanation}</Markdown>
    </div>
  )
}
