// Spaced review by free recall: see the front, recall (optionally type), reveal, rate.
import { useState } from 'react'
import { Link } from 'wouter'
import { api } from './api'
import { errorMessage, useAsync, useHotkeys } from './hooks'
import { Icon } from './icons'
import { Markdown } from './Markdown'
import { Button, ErrorNote, field, Kbd, Panel, Skeleton } from './ui'

const RATINGS = [
  { rating: 1, label: 'Again', tone: 'hover:text-bad' },
  { rating: 2, label: 'Hard', tone: 'hover:text-warn' },
  { rating: 3, label: 'Good', tone: 'hover:text-good' },
  { rating: 4, label: 'Easy', tone: 'hover:text-accent' },
] as const

export function ReviewDeck({ compact = false }: { compact?: boolean }) {
  const cards = useAsync(api.due)
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [recall, setRecall] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const card = cards.data?.[index]

  async function rate(rating: 1 | 2 | 3 | 4) {
    if (!card || !revealed || busy) return
    setBusy(true)
    setError('')
    try {
      await api.review(card.id, rating)
      setIndex(index + 1)
      setRevealed(false)
      setRecall('')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  useHotkeys({
    ' ': () => setRevealed(true),
    '1': () => rate(1),
    '2': () => rate(2),
    '3': () => rate(3),
    '4': () => rate(4),
  })

  if (cards.error) return <ErrorNote error={cards.error} onRetry={cards.reload} />
  if (!cards.data) return <Skeleton className="h-56" />
  if (!card)
    return (
      <Panel className="flex flex-col items-center gap-2 py-12 text-center">
        <div className="mb-2 grid size-11 place-items-center rounded-full bg-good/12 text-good">
          <Icon name="check" />
        </div>
        <div className="font-medium">{cards.data.length ? 'All caught up' : 'Nothing due'}</div>
        <div className="text-sm text-muted">
          {cards.data.length ? `${cards.data.length} reviewed.` : 'Cards from your lessons show up here when due.'}
        </div>
      </Panel>
    )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between text-xs text-muted">
        <span className="truncate">{card.topic}</span>
        <span className="tabular font-mono">
          {index + 1} / {cards.data.length}
        </span>
      </div>
      <Panel key={card.id} className={`flex animate-enter flex-col gap-5 ${compact ? '' : 'sm:p-8'}`}>
        <Markdown className="text-lg leading-relaxed">{card.front}</Markdown>
        {revealed ? (
          <>
            {recall && (
              <div className="rounded-2xl bg-white/[0.03] px-4 py-3 text-sm text-muted">
                <span className="text-xs">You recalled</span>
                <p className="mt-1 whitespace-pre-wrap text-fg/80">{recall}</p>
              </div>
            )}
            <Markdown className="animate-enter border-t border-white/[0.06] pt-5 text-[15px] leading-relaxed text-fg/85">{card.back}</Markdown>
          </>
        ) : (
          <textarea
            value={recall}
            onChange={(e) => setRecall(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) setRevealed(true)
            }}
            rows={compact ? 2 : 3}
            placeholder="Type what you remember (optional)"
            className={`${field} resize-y text-sm`}
          />
        )}
      </Panel>
      {error && <ErrorNote error={error} />}
      {revealed ? (
        <div className="grid grid-cols-4 gap-2">
          {RATINGS.map((r) => (
            <Button key={r.rating} onClick={() => rate(r.rating)} disabled={busy} className={`px-2 ${r.tone}`}>
              <span>{r.label}</span>
              <Kbd>{r.rating}</Kbd>
            </Button>
          ))}
        </div>
      ) : (
        <Button variant="primary" className="self-center px-8" onClick={() => setRevealed(true)}>
          Reveal <Kbd>Space</Kbd>
        </Button>
      )}
    </div>
  )
}

export default function ReviewScreen() {
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
        <h1 className="text-3xl font-semibold tracking-tight">Review</h1>
        <p className="mt-2 text-muted">Recall it first, then reveal.</p>
      </div>
      <ReviewDeck />
    </div>
  )
}
