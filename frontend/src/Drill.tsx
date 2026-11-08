// Estimation drill: one back-of-envelope numeric question, then the full explanation.
import { useState } from 'react'
import { Link } from 'wouter'
import { api } from './api'
import { errorMessage } from './hooks'
import { Icon } from './icons'
import type { Question } from './lesson'
import { QuestionCard, type Attempt } from './Question'
import { Button, ErrorNote, field, Panel, Skeleton, Spinner } from './ui'

export default function Drill() {
  const [topic, setTopic] = useState('')
  const [question, setQuestion] = useState<Question>()
  const [attempt, setAttempt] = useState<Attempt>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setBusy(true)
    setError('')
    try {
      setQuestion(await api.drill(topic.trim()))
      setAttempt(undefined)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

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
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Estimation drill</h1>
        <p className="mt-2 text-muted">Back-of-envelope numbers. Close enough counts.</p>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          load()
        }}
      >
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Any topic, or leave empty for your lessons"
          className={field}
        />
        <Button type="submit" variant="primary" disabled={busy} className="shrink-0">
          {busy && <Spinner />}
          {question ? 'Next' : 'Start'}
        </Button>
      </form>
      {error && <ErrorNote error={error} onRetry={load} />}
      {busy && !question && <Skeleton className="h-48" />}
      {question && (
        <Panel key={question.prompt} className={`transition-opacity sm:p-7 ${busy ? 'opacity-50' : ''}`}>
          <QuestionCard question={question} attempt={attempt} onAttempt={setAttempt} />
        </Panel>
      )}
      {attempt && (
        <Button className="self-center" onClick={load} disabled={busy}>
          Another one <Icon name="next" />
        </Button>
      )}
    </div>
  )
}
