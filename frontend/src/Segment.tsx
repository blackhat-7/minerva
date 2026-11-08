// One segment: commit to a prediction, then the visual with narration as audio and key points on screen,
// a task for the visual, a check question, and finally how the prediction compared.
// The narration controls and voice status live in the lesson dock (see Player), through portals.
import { useCallback, useEffect } from 'react'
import { isUnlocked, narrate, prefetch, stopNarration, unlock } from './audio'
import { useLatest, usePersistentState } from './hooks'
import { Icon } from './icons'
import type { Segment } from './lesson'
import { Markdown } from './Markdown'
import { MenuItem, Narration, type Dock } from './Narration'
import { ReadAlong } from './ReadAlong'
import { PredictionReview, QuestionCard, type Attempt } from './Question'
import { Visual } from './Visual'
import { Button, Eyebrow, Panel, Switch } from './ui'

type Props = {
  segment: Segment
  lessonId: string
  nextNarration?: string
  prediction?: Attempt
  check?: Attempt
  onPredict: (a: Attempt) => void
  onCheck: (a: Attempt) => void
  onDraft: (text: string) => void
  onWidgetState: (state: Record<string, unknown>) => void
  canContinue: boolean
  onContinue: () => void
  dock: Dock
  onEdit: () => void
}

export function SegmentStep(props: Props) {
  const { segment: seg, prediction } = props

  useEffect(() => prefetch(seg.narration), [seg.narration])

  if (seg.predict && !prediction)
    return (
      <div className="mx-auto flex w-full max-w-2xl animate-enter flex-col gap-6 lg:pt-10">
        <div>
          <Eyebrow>Predict first</Eyebrow>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{seg.title}</h1>
          <p className="mt-2 text-muted">A guess before the explanation makes the answer stick.</p>
        </div>
        <Panel id="pending-question" className="sm:p-7">
          <QuestionCard
            predict
            question={seg.predict}
            lessonId={props.lessonId}
            onAttempt={(a) => {
              unlock() // this tap lets the narration that follows play on iOS
              props.onPredict(a)
            }}
            onDraft={props.onDraft}
          />
        </Panel>
      </div>
    )
  return <Learn {...props} />
}

function Learn({
  segment: seg,
  lessonId,
  nextNarration,
  prediction,
  check,
  onCheck,
  onDraft,
  onWidgetState,
  canContinue,
  onContinue,
  dock,
  onEdit,
}: Props) {
  const [autoAdvance, setAutoAdvance] = usePersistentState('minerva.autoAdvance', false)
  const [transcript, setTranscript] = usePersistentState('minerva.transcript', false)
  const onEnd = useLatest(() => autoAdvance && canContinue && onContinue())

  const play = useCallback(() => narrate(seg.narration, () => onEnd.current()), [seg.narration, onEnd])
  useEffect(() => {
    if (isUnlocked()) play() // without a prior tap (fresh page load) the play button starts it
    if (nextNarration) prefetch(nextNarration)
    return stopNarration // leaving the segment also forgets a position held for a conversation
  }, [play, nextNarration])

  const hasVisual = seg.visual.kind !== 'none'

  return (
    <div className="flex animate-enter flex-col gap-6 lg:gap-8">
      <Narration
        dock={dock}
        lessonId={lessonId}
        play={play}
        menu={
          <>
            <Switch on={transcript} onChange={setTranscript}>
              Show transcript
            </Switch>
            <Switch on={autoAdvance} onChange={setAutoAdvance}>
              Continue when narration ends
            </Switch>
            <MenuItem icon="replay" onClick={play}>
              Replay from the start
            </MenuItem>
          </>
        }
      />

      <div className={`flex flex-col gap-2 ${hasVisual ? '' : 'mx-auto w-full max-w-2xl'}`}>
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-balance lg:text-3xl">{seg.title}</h1>
          <Button variant="ghost" onClick={onEdit} title="Change this section: add a visual, go deeper…" className="shrink-0 px-3 text-muted hover:text-fg">
            <Icon name="pencil" />
            <span className="max-sm:hidden">Edit</span>
          </Button>
        </div>
        {seg.one_line && <Markdown className="max-w-3xl text-lg text-fg/70">{seg.one_line}</Markdown>}
      </div>

      <div
        className={`grid grid-cols-[minmax(0,1fr)] gap-6 lg:gap-10 ${hasVisual ? 'lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px]' : 'mx-auto w-full max-w-2xl'}`}
      >
        {hasVisual && (
          <Panel className="flex min-h-72 flex-col overflow-x-auto p-3 sm:p-6 lg:min-h-[calc(100dvh-17rem)] lg:self-start">
            <Visual visual={seg.visual} onState={onWidgetState} />
          </Panel>
        )}

        <div className="flex min-w-0 flex-col gap-6">
          {seg.task && (
            <div className="flex gap-3 rounded-2xl bg-accent/[0.07] p-4">
              <Icon name="target" className="mt-1 text-accent" />
              <div className="min-w-0">
                <div className="text-sm font-medium text-accent">Try it</div>
                <Markdown className="mt-0.5 text-[15px]">{seg.task}</Markdown>
              </div>
            </div>
          )}

          {seg.key_points.length > 0 && (
            <ul className="flex flex-col gap-3">
              {seg.key_points.map((p, i) => (
                <li key={i} className="flex gap-3 text-[15px] leading-relaxed">
                  <span className="mt-[0.7em] h-px w-3 shrink-0 bg-accent" />
                  <Markdown className="min-w-0">{p}</Markdown>
                </li>
              ))}
            </ul>
          )}

          {transcript && (
            <div className="animate-enter">
              <ReadAlong
                text={seg.narration}
                onPlayFrom={(sentence) => narrate(seg.narration, () => onEnd.current(), sentence)}
                className="text-[15px] leading-relaxed text-muted"
              />
            </div>
          )}

          {seg.check && (
            <Panel id={check ? undefined : 'pending-question'} className="flex flex-col gap-3">
              <div className="text-sm text-muted">Check</div>
              <QuestionCard
                key={seg.id}
                question={seg.check}
                attempt={check}
                lessonId={lessonId}
                onAttempt={onCheck}
                onDraft={onDraft}
              />
            </Panel>
          )}

          {seg.predict && prediction && (check || !seg.check) && (
            <PredictionReview q={seg.predict} attempt={prediction} />
          )}
        </div>
      </div>
    </div>
  )
}
