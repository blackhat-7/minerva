import { useState } from 'react'
import { Link, useLocation } from 'wouter'
import { api, lessonProviderKey, type LessonSummary } from './api'
import { unlock } from './audio'
import { errorMessage, useAsync, usePersistentState } from './hooks'
import { Icon } from './icons'
import { profile, profiles, switchProfile } from './profile'
import { Avatar } from './Profiles'
import { Button, ErrorNote, IconButton, Skeleton, Spinner } from './ui'

const SUGGESTIONS = [
  'GPU rooflines for LLM inference',
  'FSDP vs tensor vs pipeline parallelism',
  'NCCL ring and tree all-reduce',
  'KV cache and continuous batching',
]

const navLink = 'flex min-h-11 items-center gap-2 rounded-full px-4 text-sm text-muted transition hover:bg-white/[0.06] hover:text-fg'

export default function Home() {
  const [, navigate] = useLocation()
  const status = useAsync(api.status)
  const lessons = useAsync(api.lessons)
  const [topic, setTopic] = useState('')
  const [provider, setProvider] = usePersistentState(lessonProviderKey(), '')
  const [busy, setBusy] = useState(false)
  const me = profile()
  const [error, setError] = useState('')

  const providers = status.data?.providers ?? []
  const chosen = providers.some((p) => p.name === provider) ? provider : ''
  const due = status.data?.due ?? 0

  async function start() {
    if (!topic.trim() || busy) return
    unlock() // this tap lets narration play later on iOS
    setBusy(true)
    setError('')
    try {
      const record = await api.createLesson(topic.trim(), chosen || undefined)
      navigate(`/lesson/${record.id}`)
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-[radial-gradient(60rem_30rem_at_50%_-10rem,color-mix(in_srgb,var(--color-accent)_9%,transparent),transparent)]">
      <header className="mx-auto flex h-16 w-full max-w-5xl items-center gap-1 px-3 lg:px-6">
        <div className="flex flex-1 items-center gap-2.5 px-2 font-medium tracking-tight">
          <img src="/favicon.svg" alt="" className="size-6" />
          Minerva
        </div>
        {me && profiles().length > 1 && (
          <button
            onClick={switchProfile}
            aria-label={`${me.name}: switch profile`}
            title="Switch profile"
            className="grid size-11 place-items-center rounded-full transition hover:bg-white/[0.06]"
          >
            <Avatar profile={me} className="size-7 rounded-lg text-sm" />
          </button>
        )}
        <Link href="/settings" aria-label="Settings" title="Settings" className={`${navLink} w-11 justify-center px-0`}>
          <Icon name="sliders" />
        </Link>
        <Link href="/drill" className={navLink}>
          Drill
        </Link>
        <Link href="/review" className={navLink}>
          Review
          {due > 0 && (
            <span className="tabular grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-fg">
              {due}
            </span>
          )}
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-col px-4 pt-[12vh] pb-16 lg:pt-[16vh]">
        <h1 className="text-center text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          What do you want to understand?
        </h1>

        <form
          className="mt-10 flex flex-col rounded-[28px] border border-white/[0.08] bg-surface/80 p-2 shadow-2xl shadow-black/40 backdrop-blur transition focus-within:border-accent/50"
          onSubmit={(e) => {
            e.preventDefault()
            start()
          }}
        >
          <input
            autoFocus
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Why decode is memory-bound on an H100"
            className="min-h-14 w-full bg-transparent px-4 text-lg placeholder:text-muted/50 focus:outline-none focus-visible:outline-none"
            aria-label="Topic"
          />
          <div className="flex items-center gap-2 pl-2">
            <label className="relative flex items-center text-sm text-muted">
              <span className="sr-only">Model</span>
              <select
                value={chosen}
                onChange={(e) => setProvider(e.target.value)}
                className="min-h-10 cursor-pointer rounded-full bg-transparent py-1 pr-8 pl-3 transition hover:bg-white/[0.06] hover:text-fg focus:outline-none [&>option]:bg-raised [&>option]:text-fg"
              >
                <option value="">Auto</option>
                {providers.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                    {p.available ? '' : ' (offline)'}
                  </option>
                ))}
              </select>
              <Icon name="chevron" className="pointer-events-none absolute right-3" />
            </label>
            {busy ? (
              <Button variant="primary" disabled className="ml-auto">
                <Spinner />
                Preparing
              </Button>
            ) : (
              <IconButton icon="next" label="Start" type="submit" variant="primary" disabled={!topic.trim()} className="ml-auto" />
            )}
          </div>
        </form>

        <div className="mt-4 flex flex-col gap-3">
          {error && <ErrorNote error={error} onRetry={start} />}
          {status.error && <ErrorNote error={status.error} onRetry={status.reload} />}
        </div>

        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setTopic(s)}
              className="min-h-9 rounded-full px-3.5 text-sm text-muted transition hover:bg-white/[0.06] hover:text-fg"
            >
              {s}
            </button>
          ))}
        </div>

        <section className="mt-20 flex flex-col">
          {lessons.error ? (
            <ErrorNote error={lessons.error} onRetry={lessons.reload} />
          ) : !lessons.data ? (
            <div className="flex flex-col gap-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : (
            lessons.data.length > 0 && (
              <>
                <h2 className="mb-2 px-4 text-sm text-muted">Your lessons</h2>
                {lessons.data.map((l) => (
                  <LessonRow
                    key={l.id}
                    lesson={l}
                    onOpen={() => navigate(`/lesson/${l.id}`)}
                    onDeleted={() => lessons.setData(lessons.data!.filter((x) => x.id !== l.id))}
                  />
                ))}
              </>
            )
          )}
        </section>
      </main>
    </div>
  )
}

const STATUS = {
  diagnostic: { label: 'Quick check', tone: 'text-accent' },
  generating: { label: 'Building', tone: 'text-warn' },
  ready: { label: '', tone: '' },
  failed: { label: 'Failed', tone: 'text-bad' },
}

function LessonRow({ lesson, onOpen, onDeleted }: { lesson: LessonSummary; onOpen: () => void; onDeleted: () => void }) {
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState('')
  const s = STATUS[lesson.status]
  return (
    <div className="group flex items-center gap-1 rounded-2xl pr-1 transition hover:bg-white/[0.04]">
      <button onClick={onOpen} className="flex min-h-16 min-w-0 flex-1 items-center gap-4 px-4 py-2 text-left">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px]">{lesson.title || lesson.topic}</span>
          <span className="flex gap-2 text-xs text-muted">
            {s.label && <span className={s.tone}>{s.label}</span>}
            <span>{new Date(lesson.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
            {error && <span className="text-bad">{error}</span>}
          </span>
        </span>
      </button>
      {confirm ? (
        <>
          <Button variant="ghost" className="px-4 text-muted" onClick={() => setConfirm(false)}>
            Cancel
          </Button>
          <Button
            variant="ghost"
            className="px-4 text-bad"
            onClick={() => api.deleteLesson(lesson.id).then(onDeleted, (e) => setError(errorMessage(e)))}
          >
            Delete
          </Button>
        </>
      ) : (
        <IconButton
          icon="trash"
          label="Delete lesson"
          className="text-muted opacity-100 transition lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100"
          onClick={() => setConfirm(true)}
        />
      )}
    </div>
  )
}
