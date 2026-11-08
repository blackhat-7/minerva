// /lesson/:id — diagnostic, then generation (with reviews while you wait), then the player.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'wouter'
import { api, type LessonRecord } from './api'
import { errorMessage, useAsync } from './hooks'
import { Icon } from './icons'
import type { Question } from './lesson'
import { Markdown } from './Markdown'
import { Player } from './Player'
import { ReviewDeck } from './Review'
import { Button, ErrorNote, Eyebrow, field, Panel, Skeleton, Spinner } from './ui'

const POLL_MS = 2000

export default function LessonPage({ id }: { id: string }) {
  const record = useAsync(useCallback(() => api.lesson(id), [id]))
  const answers = useRef<string[]>([])
  const r = record.data

  // Poll while generating. A failed poll is retried by the next tick.
  const status = r?.status
  const { setData } = record
  useEffect(() => {
    if (status !== 'generating') return
    const t = setInterval(() => api.lesson(id).then(setData, () => {}), POLL_MS)
    return () => clearInterval(t)
  }, [status, id, setData])

  if (!r)
    return (
      <Shell>
        {record.error ? (
          <ErrorNote error={record.error} onRetry={record.reload} />
        ) : (
          <div className="flex flex-col gap-4">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
          </div>
        )}
      </Shell>
    )

  if (r.status === 'ready' && r.lesson) return <Player record={r} onRecord={record.setData} />

  if (r.status === 'diagnostic')
    return (
      <Shell>
        <Diagnostic
          record={r}
          onBuilding={(next, a) => {
            answers.current = a
            record.setData(next)
          }}
        />
      </Shell>
    )

  if (r.status === 'generating')
    return (
      <Shell>
        <Generating topic={r.topic} />
      </Shell>
    )

  return (
    <Shell>
      <Failed record={r} retry={() => api.generate(id, answers.current, r.provider || undefined)} onRetried={record.setData} />
    </Shell>
  )
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-8 px-4 py-3 lg:py-8">
      <Link
        href="/"
        aria-label="Home"
        title="Home"
        className="-ml-2 grid size-11 place-items-center rounded-full text-muted transition hover:bg-white/[0.07] hover:text-fg"
      >
        <Icon name="back" />
      </Link>
      {children}
    </div>
  )
}

function Diagnostic({
  record,
  onBuilding,
}: {
  record: LessonRecord
  onBuilding: (next: LessonRecord, answers: string[]) => void
}) {
  const questions = record.diagnostic?.questions ?? []
  // null = not answered yet, '' = "don't know"
  const [answers, setAnswers] = useState<(string | null)[]>(() => questions.map(() => null))
  const [busy, setBusy] = useState<'build' | 'skip' | null>(null)
  const [error, setError] = useState('')

  async function build(skip: boolean) {
    setBusy(skip ? 'skip' : 'build')
    setError('')
    const sent = skip ? [] : answers.map((a) => a ?? '')
    try {
      onBuilding(await api.generate(record.id, sent), sent)
    } catch (e) {
      setError(errorMessage(e))
      setBusy(null)
    }
  }

  const set = (i: number, v: string | null) => setAnswers((a) => a.map((x, j) => (j === i ? v : x)))

  return (
    <div className="flex animate-enter flex-col gap-6">
      <div>
        <Eyebrow>Quick check</Eyebrow>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{record.topic}</h1>
        <p className="mt-2 text-muted">So the lesson starts where you are. “Don’t know” is a fine answer.</p>
      </div>
      {questions.map((q, i) => (
        <Panel key={i} className="flex flex-col gap-4">
          <div className="flex gap-3">
            <span className="tabular text-sm leading-7 text-muted">{i + 1}</span>
            <Markdown className="min-w-0 flex-1 text-[16px] leading-relaxed">{q.prompt}</Markdown>
          </div>
          <DiagnosticAnswer question={q} value={answers[i]} onChange={(v) => set(i, v)} />
        </Panel>
      ))}
      {error && <ErrorNote error={error} onRetry={() => build(busy === 'skip')} />}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="ghost" className="text-muted" onClick={() => build(true)} disabled={!!busy}>
          {busy === 'skip' && <Spinner />}
          Skip
        </Button>
        <Button variant="primary" onClick={() => build(false)} disabled={!!busy}>
          {busy === 'build' && <Spinner />}
          Build my lesson
          <Icon name="next" />
        </Button>
      </div>
    </div>
  )
}

function DiagnosticAnswer({
  question: q,
  value,
  onChange,
}: {
  question: Question
  value: string | null
  onChange: (v: string | null) => void
}) {
  const dontKnow = value === ''
  return (
    <div className="flex flex-col gap-2">
      {q.kind === 'choice' ? (
        <div className="flex flex-col gap-2">
          {q.options.map((o, i) => (
            <button
              key={i}
              onClick={() => onChange(o)}
              className={`min-h-12 rounded-2xl border px-4 py-3 text-left text-[15px] transition ${value === o ? 'border-accent/70 bg-accent/[0.08]' : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.14]'}`}
            >
              <Markdown>{o}</Markdown>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <input
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value || null)}
            placeholder={q.kind === 'numeric' ? 'Best estimate' : 'A sentence is enough'}
            className={field}
          />
          {q.kind === 'numeric' && q.unit && <span className="font-mono text-sm text-muted">{q.unit}</span>}
        </div>
      )}
      <button
        onClick={() => onChange(dontKnow ? null : '')}
        aria-pressed={dontKnow}
        className={`min-h-9 self-start rounded-full px-3.5 text-sm transition ${dontKnow ? 'bg-accent/15 text-accent' : 'bg-white/[0.05] text-muted hover:text-fg'}`}
      >
        Don’t know
      </button>
    </div>
  )
}

function Generating({ topic }: { topic: string }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const [started] = useState(Date.now)
  const secs = Math.round((now - started) / 1000)
  return (
    <div className="flex animate-enter flex-col gap-8">
      <div className="flex flex-col items-center gap-4 py-6 text-center">
        <div className="relative grid size-16 place-items-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-accent/15 [animation-duration:2s]" />
          <span className="relative grid size-12 place-items-center rounded-full bg-accent/12 text-xl text-accent">
            <Icon name="layers" />
          </span>
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Building your lesson</h1>
          <p className="mt-1 text-muted">{topic}</p>
        </div>
        <p className="tabular font-mono text-xs text-muted">
          {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')} · usually 1–3 minutes
        </p>
      </div>
      <div>
        <h2 className="mb-3 text-sm text-muted">Meanwhile, a quick review</h2>
        <ReviewDeck compact />
      </div>
    </div>
  )
}

function Failed({
  record,
  retry,
  onRetried,
}: {
  record: LessonRecord
  retry: () => Promise<LessonRecord>
  onRetried: (r: LessonRecord) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <Panel className="flex flex-col gap-3">
      <h1 className="font-medium">Couldn’t build this lesson</h1>
      <p className="text-sm text-muted">{record.topic}</p>
      <pre className="overflow-x-auto rounded-2xl bg-white/[0.03] p-4 font-mono text-xs whitespace-pre-wrap text-bad">
        {record.error || 'Unknown error'}
      </pre>
      {error && <ErrorNote error={error} />}
      <Button
        variant="primary"
        className="self-start"
        disabled={busy}
        onClick={() => {
          setBusy(true)
          setError('')
          retry().then(onRetried, (e) => {
            setError(errorMessage(e))
            setBusy(false)
          })
        }}
      >
        {busy && <Spinner />}
        Try again
      </Button>
    </Panel>
  )
}
