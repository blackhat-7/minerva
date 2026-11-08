// The lesson player: segments → problems → pitfalls → explain-back → done, or the whole lesson as a document
// (Read mode). Progress is saved to the backend so the lesson resumes on any device.
import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react'
import { Link, useLocation } from 'wouter'
import { api, type ChatMessage, type ExplainResult, type LessonRecord } from './api'
import { stop, unlock } from './audio'
import { stopListening, toggleAsk, useListening } from './listen'
import { compileGlossary, GlossaryContext } from './glossary'
import { errorMessage, useDraggable, useHotkeys } from './hooks'
import { Icon } from './icons'
import type { GlossaryTerm, Lesson, Pitfall } from './lesson'
import { Markdown } from './Markdown'
import { Mic } from './Mic'
import { QuestionCard, type Attempt } from './Question'
import { ReadView } from './Read'
import type { Dock } from './Narration'
import { SegmentStep } from './Segment'
import { ListeningBadge } from './Talk'
import { EditSection, type EditState } from './Edit'
import { QuoteSelection } from './Quote'
import { SettingsPanel } from './Settings'
import { Tutor } from './Tutor'
import { tutorQuestion } from './tutorQuestion'
import { Button, ErrorNote, Eyebrow, field, IconButton, Notice, Panel, Segmented, Sheet, Spinner, Stat } from './ui'

/** What the frontend saves in LessonRecord.progress. */
type Progress = {
  mode: 'learn' | 'read'
  step: number
  furthest: number
  predictions: Record<string, Attempt> // by segment id
  checks: Record<string, Attempt> // by segment id
  problems: Record<string, Attempt> // by problem index
  explain: { text: string; result: ExplainResult } | null
  completed: boolean
  chats: Chat[] // tutor conversations, kept with the lesson
  chatId: string // the open one; '' = a new chat, saved once it has a message
}

export type Chat = { id: string; messages: ChatMessage[]; updated: string }

const fresh: Progress = {
  mode: 'learn',
  step: 0,
  furthest: 0,
  predictions: {},
  checks: {},
  problems: {},
  explain: null,
  completed: false,
  chats: [],
  chatId: '',
}

/** Saved progress, filling in fields added since it was saved. Progress from before multiple chats has
 * one `chat` list; it becomes the first chat. */
function loadProgress(saved: LessonRecord['progress']): Progress {
  const { chat, ...rest } = saved as Partial<Progress> & { chat?: ChatMessage[] }
  const p = { ...fresh, ...rest }
  if (chat?.length && !p.chats.length) {
    p.chats = [{ id: 'c1', messages: chat, updated: new Date().toISOString() }]
    p.chatId = 'c1'
  }
  return p
}

type Step =
  | { kind: 'segment'; index: number }
  | { kind: 'problem'; index: number }
  | { kind: 'pitfalls' }
  | { kind: 'explain' }
  | { kind: 'done' }

function stepsOf(lesson: Lesson): Step[] {
  return [
    ...lesson.segments.map((_, index) => ({ kind: 'segment' as const, index })),
    ...lesson.problems.map((_, index) => ({ kind: 'problem' as const, index })),
    ...(lesson.pitfalls.length ? [{ kind: 'pitfalls' as const }] : []),
    { kind: 'explain' },
    { kind: 'done' },
  ]
}

const HINT_MS = 2500

export function Player({ record, onRecord }: { record: LessonRecord; onRecord: (r: LessonRecord) => void }) {
  const lesson = record.lesson!
  const steps = useMemo(() => stepsOf(lesson), [lesson])
  const glossary = useMemo(() => compileGlossary(lesson.glossary), [lesson])
  const [progress, setProgress] = useState<Progress>(() => loadProgress(record.progress))
  const [panel, setPanel] = useState<'tutor' | 'glossary' | 'settings' | 'edit' | null>(null)
  // What each segment's visual reports (widget controls, the step a scene is on), by segment id: Read mode shows
  // many visuals at once, and the tutor should see the one of the section being read.
  const widgetState = useRef<Record<string, Record<string, unknown>>>({})
  const draft = useRef('')
  const tutorInput = useRef<HTMLTextAreaElement>(null)
  const onWidgetState = useCallback((segmentId: string, s: Record<string, unknown>) => {
    widgetState.current[segmentId] = s
  }, [])
  // Where a segment puts its narration controls and status notices: inside the dock.
  const [mediaSlot, setMediaSlot] = useState<HTMLElement | null>(null)
  const [noticeSlot, setNoticeSlot] = useState<HTMLElement | null>(null)
  const dock: Dock = { media: mediaSlot, notices: noticeSlot }
  const { setElement: setDock, style: dockStyle, onPointerDown: dragDock } = useDraggable<HTMLDivElement>('minerva.dockOffset')

  const index = Math.min(progress.step, steps.length - 1)
  const step = steps[index]
  const reading = progress.mode === 'read'
  // In Read mode the tutor's segment is the section being read aloud or looked at.
  const [readSection, onReadSection] = useState('')
  const segment = reading
    ? (lesson.segments.find((s) => s.id === readSection) ?? null)
    : step.kind === 'segment'
      ? lesson.segments[step.index]
      : null
  const patch = (p: Partial<Progress>) => setProgress((prev) => ({ ...prev, ...p }))
  // The open chat's messages. Writing to a new chat ('') creates it.
  const chat = progress.chats.find((c) => c.id === progress.chatId)
  const setMessages = useCallback(
    (u: SetStateAction<ChatMessage[]>) =>
      setProgress((prev) => {
        const open = prev.chats.find((c) => c.id === prev.chatId)
        const messages = typeof u === 'function' ? u(open?.messages ?? []) : u
        const updated = { id: open?.id ?? Date.now().toString(36), messages, updated: new Date().toISOString() }
        const chats = open ? prev.chats.map((c) => (c === open ? updated : c)) : [...prev.chats, updated]
        return { ...prev, chats, chatId: updated.id }
      }),
    [],
  )
  const deleteChat = (id: string) =>
    setProgress((prev) => ({
      ...prev,
      chats: prev.chats.filter((c) => c.id !== id),
      chatId: prev.chatId === id ? '' : prev.chatId,
    }))

  // Save progress, debounced; flush on leaving. A failed save (server restarting, connection lost) is kept
  // and retried every few seconds until it goes through.
  const pending = useRef<Progress | null>(null)
  const [saveFailed, setSaveFailed] = useState(false)
  const save = useCallback(() => {
    const p = pending.current
    if (!p) return
    pending.current = null
    api.saveProgress(record.id, p).then(
      () => setSaveFailed(false),
      () => {
        pending.current ??= p // unless newer progress is already waiting
        setSaveFailed(true)
      },
    )
  }, [record.id])
  useEffect(() => {
    if (!saveFailed) return
    const t = setInterval(save, 5000)
    return () => clearInterval(t)
  }, [saveFailed, save])
  const loaded = useRef(progress)
  useEffect(() => {
    if (progress === loaded.current) return
    pending.current = progress
    const t = setTimeout(save, 600)
    return () => clearTimeout(t)
  }, [progress, save])
  useEffect(() => save, [save])

  const canContinue = (() => {
    if (step.kind === 'segment') {
      const s = lesson.segments[step.index]
      return (!s.predict || !!progress.predictions[s.id]) && (!s.check || !!progress.checks[s.id])
    }
    if (step.kind === 'problem') return !!progress.problems[step.index]
    if (step.kind === 'explain') return !!progress.explain
    return step.kind === 'pitfalls'
  })()
  const canAdvance = canContinue || index < progress.furthest

  // Why Continue does nothing yet, shown briefly when the learner tries.
  const [hint, setHint] = useState('')
  useEffect(() => {
    if (!hint) return
    const t = setTimeout(() => setHint(''), HINT_MS)
    return () => clearTimeout(t)
  }, [hint])
  const blocked =
    step.kind === 'segment'
      ? lesson.segments[step.index].predict && !progress.predictions[lesson.segments[step.index].id]
        ? 'Make a prediction first'
        : 'Answer the check to continue'
      : step.kind === 'explain'
        ? 'Explain it back, or skip'
        : 'Answer to continue'

  // Editing a segment. Progress follows the new lesson: steps after an inserted segment move along, and a
  // segment whose predict or check question changed loses its old answer.
  const [edit, setEdit] = useState<EditState | null>(null)
  const startEdit = (segmentId: string) => {
    if (!edit?.busy) setEdit({ segmentId, title: lesson.segments.find((s) => s.id === segmentId)!.title, busy: false, error: '' })
    setPanel('edit')
  }
  function submitEdit(instruction: string) {
    const { segmentId } = edit!
    setEdit({ ...edit!, busy: true, error: '' })
    api.editSegment(record.id, segmentId, instruction).then(
      (next) => {
        const at = lesson.segments.findIndex((s) => s.id === segmentId)
        const added = next.lesson!.segments.length - lesson.segments.length
        const [before, after] = [lesson.segments[at], next.lesson!.segments.find((s) => s.id === segmentId)!]
        const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
        const shift = (i: number) => (i > at ? i + added : i) // step i is segment i while in the segments
        setProgress((p) => {
          const predictions = { ...p.predictions }
          const checks = { ...p.checks }
          if (!same(before.predict, after.predict)) delete predictions[segmentId]
          if (!same(before.check, after.check)) delete checks[segmentId]
          return { ...p, step: shift(p.step), furthest: shift(p.furthest), predictions, checks }
        })
        onRecord(next)
        setEdit(null)
        setPanel((open) => (open === 'edit' ? null : open))
        setHint(added ? 'Section updated, and a new one added after it' : 'Section updated')
      },
      (e) => setEdit((cur) => cur && { ...cur, busy: false, error: errorMessage(e) }),
    )
  }

  // Finishing adds the lesson's cards to the review deck (idempotent on the backend).
  const [completion, setCompletion] = useState<{ busy: boolean; error: string }>({ busy: false, error: '' })
  function complete() {
    setCompletion({ busy: true, error: '' })
    api.complete(record.id).then(
      () => {
        setCompletion({ busy: false, error: '' })
        patch({ completed: true })
      },
      (e) => setCompletion({ busy: false, error: errorMessage(e) }),
    )
  }

  function go(i: number) {
    if (i < 0 || i >= steps.length || i > Math.max(progress.furthest, index + 1)) return
    if (steps[i].kind === 'done' && !progress.completed) complete()
    stop()
    draft.current = ''
    widgetState.current = {}
    setHint('')
    setProgress((prev) => ({ ...prev, step: i, furthest: Math.max(prev.furthest, i) }))
    window.scrollTo({ top: 0 })
  }
  function next() {
    unlock() // a tap: lets the next segment's narration play on iOS
    if (canAdvance) go(index + 1)
    else {
      setHint(blocked)
      document.getElementById('pending-question')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }

  // Text selected in the lesson, attached to the next tutor question.
  const mainRef = useRef<HTMLElement>(null)
  const [quote, setQuote] = useState('')
  const openTutor = () => {
    setPanel('tutor')
    requestAnimationFrame(() => tutorInput.current?.focus())
  }
  const closePanel = useCallback(() => setPanel(null), [])
  const setMode = (mode: Progress['mode']) => {
    stop()
    patch({ mode })
    window.scrollTo({ top: 0 })
  }
  const listening = useListening().phase !== 'off'
  useEffect(() => stopListening, []) // hands-free ends with the lesson
  const toggleHandsFree = () => toggleAsk(record.id)

  useHotkeys(
    reading
      ? { '/': openTutor }
      : {
          Enter: next,
          ArrowRight: next,
          ArrowLeft: () => go(index - 1),
          '/': openTutor,
          t: toggleHandsFree,
          T: toggleHandsFree,
        },
  )

  // What the tutor sees: the step, the live simulation state and the question being worked on (none in Read mode).
  const context = () => {
    let asked = tutorQuestion({ check: null, draft: '' })
    if (!reading && segment) {
      const predicting = segment.predict && !progress.predictions[segment.id]
      asked = tutorQuestion({
        predict: predicting ? segment.predict : null,
        check: segment.check,
        saved: progress.checks[segment.id],
        draft: draft.current,
      })
    } else if (!reading && step.kind === 'problem') {
      asked = tutorQuestion({
        check: lesson.problems[step.index],
        saved: progress.problems[step.index],
        draft: draft.current,
      })
    }
    return {
      segment_id: segment?.id ?? '',
      context: { widget_state: widgetState.current[segment?.id ?? ''] ?? {}, ...asked },
    }
  }

  const label = reading
    ? 'Reading'
    : step.kind === 'segment'
      ? `Learn · ${step.index + 1} of ${lesson.segments.length}`
      : step.kind === 'problem'
        ? `Practice · ${step.index + 1} of ${lesson.problems.length}`
        : { pitfalls: 'Pitfalls', explain: 'Explain it back', done: 'Complete' }[step.kind]
  const docked = reading || step.kind !== 'done'

  return (
    <GlossaryContext value={glossary}>
      <div className={`flex min-h-dvh flex-col transition-[padding] duration-300 ${panel ? 'lg:pr-[412px]' : ''}`}>
        <header className="sticky top-0 z-20 bg-bg/80 backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-1 px-2 sm:gap-2 lg:px-6">
            <Link
              href="/"
              aria-label="Home"
              title="Home"
              className="grid size-11 shrink-0 place-items-center rounded-full text-muted transition hover:bg-white/[0.07] hover:text-fg"
            >
              <Icon name="back" />
            </Link>
            <div className="min-w-0 flex-1 px-1">
              <div className="truncate text-sm font-medium">{lesson.title}</div>
              <div className="truncate text-xs text-muted">{label}</div>
            </div>
            <ListeningBadge />
            {saveFailed && (
              <Button
                variant="ghost"
                className="px-3 text-xs text-warn"
                onClick={save}
              >
                Not saved · Retry
              </Button>
            )}
            <div className="hidden sm:block">
              <Segmented
                value={progress.mode}
                options={[
                  { value: 'learn', label: 'Learn' },
                  { value: 'read', label: 'Read' },
                ]}
                onChange={setMode}
              />
            </div>
            <IconButton
              icon={reading ? 'layers' : 'book'}
              label={reading ? 'Guided lesson' : 'Read as a document'}
              className="text-muted sm:hidden"
              onClick={() => setMode(reading ? 'learn' : 'read')}
            />
            <IconButton
              icon="sliders"
              label="Settings"
              className="text-muted"
              onClick={() => setPanel(panel === 'settings' ? null : 'settings')}
            />
            <IconButton
              icon="search"
              label="Glossary"
              className="text-muted"
              onClick={() => setPanel(panel === 'glossary' ? null : 'glossary')}
            />
            <Button
              variant={panel === 'tutor' ? 'primary' : 'default'}
              onClick={() => (panel === 'tutor' ? setPanel(null) : openTutor())}
              aria-label="Tutor"
              title="Ask the tutor (/)"
              className="max-sm:w-11 max-sm:px-0 sm:px-4"
            >
              <Icon name="chat" />
              <span className="hidden sm:inline">Tutor</span>
            </Button>
          </div>
          {!reading && <Rail lesson={lesson} steps={steps} current={index} furthest={progress.furthest} onGo={go} />}
        </header>

        <main ref={mainRef} className={`mx-auto w-full max-w-[1600px] flex-1 px-4 pt-6 lg:px-8 lg:pt-10 ${docked ? 'pb-36' : 'pb-12'}`}>
          {reading ? (
            <ReadView
              lesson={lesson}
              lessonId={record.id}
              checks={progress.checks}
              onCheck={(id, a) => patch({ checks: { ...progress.checks, [id]: a } })}
              onWidgetState={onWidgetState}
              dock={dock}
              onSection={onReadSection}
              onEdit={startEdit}
              onPractice={() => {
                const first = steps.findIndex((s) => s.kind !== 'segment')
                setProgress((p) => ({ ...p, mode: 'learn', step: first, furthest: Math.max(p.furthest, first) }))
                window.scrollTo({ top: 0 })
              }}
            />
          ) : step.kind === 'segment' ? (
            <SegmentStep
              key={segment!.id}
              segment={segment!}
              lessonId={record.id}
              nextNarration={lesson.segments[step.index + 1]?.narration}
              prediction={progress.predictions[segment!.id]}
              check={progress.checks[segment!.id]}
              onPredict={(a) => {
                draft.current = '' // the prediction is in; a draft from now on answers the check question
                patch({ predictions: { ...progress.predictions, [segment!.id]: a } })
              }}
              onCheck={(a) => patch({ checks: { ...progress.checks, [segment!.id]: a } })}
              onDraft={(t) => {
                draft.current = t
              }}
              onWidgetState={onWidgetState}
              canContinue={canContinue}
              onContinue={next}
              dock={dock}
              onEdit={() => startEdit(segment!.id)}
            />
          ) : step.kind === 'problem' ? (
            <div key={step.index} className="mx-auto flex w-full max-w-2xl animate-enter flex-col gap-5 lg:pt-6">
              <div>
                <Eyebrow>
                  Problem {step.index + 1} of {lesson.problems.length}
                </Eyebrow>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight">Put it to work</h1>
              </div>
              <Panel className="sm:p-7">
                <QuestionCard
                  question={lesson.problems[step.index]}
                  attempt={progress.problems[step.index]}
                  lessonId={record.id}
                  onAttempt={(a) => patch({ problems: { ...progress.problems, [step.index]: a } })}
                  onDraft={(t) => {
                    draft.current = t
                  }}
                />
              </Panel>
            </div>
          ) : step.kind === 'pitfalls' ? (
            <Pitfalls pitfalls={lesson.pitfalls} />
          ) : step.kind === 'explain' ? (
            <ExplainStep
              lesson={lesson}
              lessonId={record.id}
              saved={progress.explain}
              onResult={(explain) => patch({ explain })}
              onDraft={(t) => {
                draft.current = t
              }}
              onFollowUp={(q) => {
                setMessages((m) => [...m, { role: 'assistant', content: q }])
                openTutor()
              }}
            />
          ) : (
            <DoneStep lesson={lesson} progress={progress} completion={completion} onComplete={complete} />
          )}
        </main>

        {docked && (
          <div
            className={`pointer-events-none fixed inset-x-0 bottom-0 z-20 flex flex-col items-center gap-2 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] transition-[padding] duration-300 ${panel ? 'lg:pr-[412px]' : ''}`}
          >
            <div
              ref={setDock}
              style={dockStyle}
              className="flex w-full max-w-md flex-col items-center gap-2 sm:w-auto sm:max-w-none"
            >
              <div ref={setNoticeSlot} className="flex flex-col items-center gap-2" />
              {hint && <Notice>{hint}</Notice>}
              <nav
                aria-label="Lesson controls"
                className="pointer-events-auto relative flex w-full items-center gap-1 rounded-full border border-white/[0.08] bg-raised/80 p-1.5 shadow-2xl shadow-black/60 backdrop-blur-xl sm:w-auto"
              >
                <div
                  onPointerDown={dragDock}
                  title="Drag to move"
                  className="-mr-1 grid h-11 w-6 shrink-0 cursor-grab touch-none place-items-center text-muted/60 hover:text-muted active:cursor-grabbing"
                >
                  <Icon name="grip" />
                </div>
                {!reading && (
                  <IconButton icon="back" label="Previous step" onClick={() => go(index - 1)} disabled={index === 0} className="text-muted" />
                )}
                <div ref={setMediaSlot} className="flex flex-1 items-center justify-center gap-1 empty:hidden sm:px-2" />
                {!reading && step.kind === 'explain' && !progress.explain && (
                  <Button variant="ghost" className="text-muted" onClick={() => go(index + 1)}>
                    Skip
                  </Button>
                )}
                {!reading && (
                  <Button
                    variant="primary"
                    onClick={next}
                    aria-disabled={!canAdvance}
                    aria-label="Continue"
                    className={`ml-auto pr-4 max-[400px]:w-11 max-[400px]:px-0 ${canAdvance ? '' : 'opacity-40'}`}
                  >
                    <span className="max-[400px]:hidden">Continue</span>
                    <Icon name="next" />
                  </Button>
                )}
              </nav>
            </div>
          </div>
        )}
      </div>

      <QuoteSelection
        within={mainRef}
        onQuote={(text) => {
          setQuote(text)
          openTutor()
        }}
      />
      <Sheet open={panel === 'tutor'} onClose={closePanel} compact={listening} title="Tutor">
        <Tutor
          lessonId={record.id}
          messages={chat?.messages ?? []}
          setMessages={setMessages}
          chats={progress.chats}
          chatId={chat?.id ?? ''}
          onOpenChat={(chatId) => patch({ chatId })}
          onDeleteChat={deleteChat}
          quote={quote}
          onQuote={setQuote}
          where={reading ? 'Reading' : segment ? segment.title : label}
          context={context}
          inputRef={tutorInput}
          onConversation={() => setPanel('tutor')}
        />
      </Sheet>
      <Sheet open={panel === 'edit'} onClose={closePanel} title="Edit section">
        {edit && <EditSection key={edit.segmentId} edit={edit} onSubmit={submitEdit} />}
      </Sheet>
      <Sheet open={panel === 'settings'} onClose={closePanel} title="Settings">
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">{panel === 'settings' && <SettingsPanel />}</div>
      </Sheet>
      <Sheet open={panel === 'glossary'} onClose={closePanel} title="Glossary">
        <GlossaryList terms={lesson.glossary} />
      </Sheet>
    </GlossaryContext>
  )
}

function Rail({
  lesson,
  steps,
  current,
  furthest,
  onGo,
}: {
  lesson: Lesson
  steps: Step[]
  current: number
  furthest: number
  onGo: (i: number) => void
}) {
  const title = (s: Step) =>
    s.kind === 'segment'
      ? lesson.segments[s.index].title
      : s.kind === 'problem'
        ? `Problem ${s.index + 1}`
        : { pitfalls: 'Pitfalls', explain: 'Explain it back', done: 'Done' }[s.kind]
  return (
    <nav aria-label="Lesson progress" className="mx-auto flex max-w-[1600px] gap-0.5 px-4 lg:px-8">
      {steps.map((s, i) => (
        <button
          key={i}
          onClick={() => onGo(i)}
          disabled={i > furthest}
          title={title(s)}
          aria-label={title(s)}
          aria-current={i === current ? 'step' : undefined}
          className="group flex h-3 flex-1 items-start pointer-coarse:h-6"
        >
          <span
            className={`h-0.5 w-full rounded-full transition-colors duration-300 ${
              i === current ? 'bg-accent' : i <= furthest ? 'bg-accent/30 group-hover:bg-accent/60' : 'bg-white/[0.07]'
            }`}
          />
        </button>
      ))}
    </nav>
  )
}

/** Each trap first; the learner thinks about why it fails before revealing. */
function Pitfalls({ pitfalls }: { pitfalls: Pitfall[] }) {
  const [shown, setShown] = useState<Set<number>>(new Set())
  return (
    <div className="mx-auto flex w-full max-w-2xl animate-enter flex-col gap-5 lg:pt-6">
      <div>
        <Eyebrow>Pitfalls</Eyebrow>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">What doesn’t work, and why</h1>
        <p className="mt-2 text-muted">Say why each one fails before you reveal it.</p>
      </div>
      {pitfalls.map((p, i) => (
        <Panel key={i} className="flex flex-col gap-4">
          <Markdown className="font-medium">{p.trap}</Markdown>
          {shown.has(i) ? (
            <Markdown className="animate-enter border-t border-white/[0.06] pt-4 text-[15px] text-fg/85">{p.why}</Markdown>
          ) : (
            <Button className="self-start" onClick={() => setShown(new Set(shown).add(i))}>
              Reveal why
            </Button>
          )}
        </Panel>
      ))}
    </div>
  )
}

function ExplainStep({
  lesson,
  lessonId,
  saved,
  onResult,
  onDraft,
  onFollowUp,
}: {
  lesson: Lesson
  lessonId: string
  saved: Progress['explain']
  onResult: (r: NonNullable<Progress['explain']>) => void
  onDraft: (text: string) => void
  onFollowUp: (question: string) => void
}) {
  const [text, setText] = useState(saved?.text ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const edit = (t: string) => {
    setText(t)
    onDraft(t)
  }

  async function submit() {
    if (!text.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      onResult({ text, result: await api.explain(lessonId, text) })
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const r = saved?.result
  const [scoreText, scoreBar] = !r
    ? []
    : r.score >= 80
      ? ['text-good', 'bg-good']
      : r.score >= 50
        ? ['text-warn', 'bg-warn']
        : ['text-bad', 'bg-bad']
  return (
    <div className="mx-auto flex w-full max-w-2xl animate-enter flex-col gap-5 lg:pt-6">
      <div>
        <Eyebrow>Explain it back</Eyebrow>
        <Markdown className="mt-1 text-2xl font-semibold tracking-tight">{lesson.explain_back.prompt}</Markdown>
        <p className="mt-2 text-muted">As if to a colleague: causes, effects and numbers.</p>
      </div>
      <div className="flex flex-col gap-3">
        <textarea
          value={text}
          onChange={(e) => edit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
          }}
          rows={7}
          placeholder="In my own words…"
          className={`${field} resize-y leading-relaxed`}
        />
        {error && <ErrorNote error={error} onRetry={submit} />}
        <div className="flex items-center gap-2">
          <Mic lessonId={lessonId} onText={(t) => edit(text ? `${text} ${t}` : t)} />
          <Button variant="primary" className="ml-auto" onClick={submit} disabled={!text.trim() || busy}>
            {busy && <Spinner />}
            {busy ? 'Grading' : r ? 'Grade again' : 'Grade'}
          </Button>
        </div>
      </div>

      {r && (
        <Panel className="flex animate-enter flex-col gap-5">
          <div className="flex items-end gap-4">
            <div className={`tabular text-5xl font-semibold tracking-tight ${scoreText}`}>{r.score}</div>
            <div className="flex-1 pb-2">
              <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]">
                <div className={`h-full rounded-full ${scoreBar} transition-all duration-700`} style={{ width: `${r.score}%` }} />
              </div>
            </div>
          </div>
          <RubricList items={r.covered} icon="check" tone="text-good" title="Covered" />
          <RubricList items={r.missing} icon="close" tone="text-bad" title="Missing" />
          <RubricList items={r.misconceptions} icon="bolt" tone="text-warn" title="Misconceptions" />
          {r.follow_up && (
            <div className="flex flex-col gap-3 rounded-2xl bg-accent/[0.07] p-4">
              <div className="text-sm font-medium text-accent">Follow-up</div>
              <Markdown className="text-[15px]">{r.follow_up}</Markdown>
              <Button className="self-start" onClick={() => onFollowUp(r.follow_up)}>
                <Icon name="chat" />
                Answer in the tutor
              </Button>
            </div>
          )}
        </Panel>
      )}
    </div>
  )
}

function RubricList({
  items,
  icon,
  tone,
  title,
}: {
  items: string[]
  icon: 'check' | 'close' | 'bolt'
  tone: string
  title: string
}) {
  if (!items.length) return null
  return (
    <div>
      <div className="mb-2 text-sm text-muted">{title}</div>
      <ul className="flex flex-col gap-2">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2.5 text-[15px]">
            <Icon name={icon} className={`mt-1 ${tone}`} />
            <Markdown className="min-w-0">{item}</Markdown>
          </li>
        ))}
      </ul>
    </div>
  )
}

function DoneStep({
  lesson,
  progress,
  completion,
  onComplete,
}: {
  lesson: Lesson
  progress: Progress
  completion: { busy: boolean; error: string }
  onComplete: () => void
}) {
  const [, navigate] = useLocation()
  const score = (attempts: Record<string, Attempt>, total: number) =>
    `${Object.values(attempts).filter((a) => a.correct).length}/${total}`

  return (
    <div className="mx-auto flex w-full max-w-xl animate-enter flex-col gap-8 py-6 lg:py-14">
      <div className="text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-full bg-good/12 text-2xl text-good">
          <Icon name="check" />
        </div>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight">Lesson complete</h1>
        <p className="mt-2 text-muted">{lesson.title}</p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Predictions" value={score(progress.predictions, lesson.segments.filter((s) => s.predict).length)} />
        <Stat label="Checks" value={score(progress.checks, lesson.segments.filter((s) => s.check).length)} />
        <Stat label="Problems" value={score(progress.problems, lesson.problems.length)} />
        <Stat label="Explain-back" value={progress.explain ? progress.explain.result.score : '—'} />
      </div>
      <Markdown className="text-[15px] text-fg/85">{lesson.summary}</Markdown>
      {completion.error ? (
        <ErrorNote error={`Couldn’t add the lesson’s review cards: ${completion.error}`} onRetry={onComplete} />
      ) : (
        !progress.completed &&
        !completion.busy && (
          <Button className="self-center" onClick={onComplete}>
            Add this lesson’s cards to review
          </Button>
        )
      )}
      <div className="flex flex-col items-center gap-3">
        <div className="flex justify-center gap-2">
          <Button variant="primary" onClick={() => navigate('/review')}>
            Review now
          </Button>
          <Button onClick={() => navigate('/')}>Home</Button>
        </div>
        <p className="text-center text-sm text-muted">Your misses and the key ideas are in your review deck.</p>
      </div>
    </div>
  )
}

function GlossaryList({ terms }: { terms: GlossaryTerm[] }) {
  const [query, setQuery] = useState('')
  const q = query.toLowerCase()
  const shown = terms.filter((t) => `${t.term} ${t.definition}`.toLowerCase().includes(q))
  return (
    <>
      <div className="px-4 pb-2">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" className={field} />
      </div>
      <dl className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        {shown.map((t) => (
          <div key={t.term} className="border-b border-white/[0.05] py-3.5 last:border-0">
            <dt className="font-medium">{t.term}</dt>
            <dd className="mt-1 text-sm leading-relaxed text-muted">{t.definition}</dd>
          </div>
        ))}
        {!shown.length && <p className="py-8 text-center text-sm text-muted">No matching terms.</p>}
      </dl>
    </>
  )
}
