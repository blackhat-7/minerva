// Read mode: the whole lesson as one long-form document, visuals inline and interactive.
// Questions stay available, collapsed under "Test yourself". Sections can be read aloud, one after another,
// with the sentence being read highlighted.
import { useEffect, useState } from 'react'
import { narrate, stopNarration, useAudio } from './audio'
import { Icon } from './icons'
import type { Lesson, Question } from './lesson'
import { Markdown } from './Markdown'
import { MenuItem, Narration, type Dock } from './Narration'
import { QuestionCard, type Attempt } from './Question'
import { ReadAlong } from './ReadAlong'
import { Visual } from './Visual'
import { Button, Panel } from './ui'

export function ReadView({
  lesson,
  lessonId,
  checks,
  onCheck,
  onWidgetState,
  onPractice,
  dock,
  onSection,
  onEdit,
}: {
  lesson: Lesson
  lessonId: string
  checks: Record<string, Attempt>
  onCheck: (segmentId: string, a: Attempt) => void
  onWidgetState: (segmentId: string, state: Record<string, unknown>) => void
  onPractice: () => void
  dock: Dock
  onSection: (segmentId: string) => void // the section being read or looked at, for the tutor
  onEdit: (segmentId: string) => void
}) {
  const toc = [
    { id: 'start', title: 'Overview' },
    ...lesson.segments.map((s) => ({ id: `s-${s.id}`, title: s.title })),
    ...(lesson.pitfalls.length ? [{ id: 'pitfalls', title: 'Pitfalls' }] : []),
    ...(lesson.glossary.length ? [{ id: 'glossary', title: 'Glossary' }] : []),
  ]
  const active = useActiveSection(toc.map((t) => t.id))

  // Reading aloud: a section, then the ones after it.
  const audio = useAudio()
  const live = audio.state !== 'idle' || audio.held !== null
  const reading = live ? lesson.segments.findIndex((s) => s.narration === audio.spoken?.text) : -1
  const readFrom = (i: number, sentence = 0): void =>
    narrate(lesson.segments[i].narration, () => i + 1 < lesson.segments.length && readFrom(i + 1), sentence)
  const looking = Math.max(0, lesson.segments.findIndex((s) => `s-${s.id}` === active))
  useEffect(() => stopNarration, [])
  const section = lesson.segments[reading >= 0 ? reading : looking]?.id ?? ''
  useEffect(() => onSection(section), [section, onSection])

  return (
    <div className="mx-auto grid max-w-6xl animate-enter grid-cols-[minmax(0,1fr)] gap-10 xl:grid-cols-[220px_minmax(0,1fr)]">
      <Narration
        dock={dock}
        lessonId={lessonId}
        play={() => readFrom(looking)}
        menu={
          <MenuItem icon="replay" onClick={() => readFrom(0)}>
            Read from the top
          </MenuItem>
        }
      />
      <nav aria-label="Contents" className="hidden xl:block">
        <ol className="sticky top-24 flex flex-col gap-0.5 border-l border-white/[0.07] text-sm">
          {toc.map((t) => (
            <li key={t.id}>
              <a
                href={`#${t.id}`}
                className={`-ml-px block border-l py-1.5 pl-3 transition-colors ${active === t.id ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg'}`}
              >
                {t.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <article className="flex max-w-3xl min-w-0 flex-col gap-14 pb-16">
        <section id="start" className="scroll-mt-24">
          <h1 className="text-4xl font-semibold tracking-tight text-balance">{lesson.title}</h1>
          <Markdown className="mt-4 text-[17px] leading-relaxed text-fg/90">{lesson.summary}</Markdown>
          {lesson.analogy && (
            <Panel className="mt-6 flex flex-col gap-3 p-4 sm:p-5">
              <h2 className="text-sm font-medium text-accent">The picture</h2>
              <Markdown className="text-[15px] leading-relaxed">{lesson.analogy.picture}</Markdown>
              <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
                {lesson.analogy.parts.map((p, i) => (
                  <div key={i} className="contents">
                    <dt className="text-muted">{p.familiar}</dt>
                    <dd>→ {p.real}</dd>
                  </div>
                ))}
              </dl>
              {lesson.analogy.limits && <p className="text-sm text-muted">Where it breaks: {lesson.analogy.limits}</p>}
            </Panel>
          )}
        </section>

        {lesson.segments.map((s, i) => (
          <section key={s.id} id={`s-${s.id}`} className="flex scroll-mt-24 flex-col gap-4">
            <div className="flex min-h-9 items-center justify-between gap-3">
              <div className="tabular flex-1 text-sm text-accent">{String(i + 1).padStart(2, '0')}</div>
              <Button variant="ghost" onClick={() => onEdit(s.id)} title="Change this section" className="min-h-9 px-3 text-muted hover:text-fg">
                <Icon name="pencil" />
                Edit
              </Button>
              {reading === i ? (
                <span className="flex items-center gap-2 px-3 text-sm text-accent">
                  <Icon name="wave" className={audio.state === 'playing' ? 'animate-pulse' : ''} />
                  Reading
                </span>
              ) : (
                <Button variant="ghost" onClick={() => readFrom(i)} className="min-h-9 px-3 text-muted hover:text-fg">
                  <Icon name="play" />
                  Listen
                </Button>
              )}
            </div>
            <h2 className="-mt-3 text-2xl font-semibold tracking-tight">{s.title}</h2>
            {s.one_line && <Markdown className="text-lg text-fg/70">{s.one_line}</Markdown>}
            {s.text?.trim() ? (
              <Markdown className="text-[16px] leading-relaxed text-fg/90">{s.text}</Markdown>
            ) : (
              <ReadAlong
                text={s.narration}
                onPlayFrom={(sentence) => readFrom(i, sentence)}
                className="text-[16px] leading-relaxed text-fg/90"
              />
            )}
            {s.visual.kind !== 'none' && (
              <Panel className="overflow-x-auto p-3 sm:p-6">
                <Visual visual={s.visual} narration={s.narration} onState={(state) => onWidgetState(s.id, state)} />
              </Panel>
            )}
            {s.task && (
              <div className="flex gap-3 rounded-2xl bg-accent/[0.07] p-4">
                <Icon name="target" className="mt-0.5 text-accent" />
                <Markdown className="min-w-0 text-[15px]">{s.task}</Markdown>
              </div>
            )}
            {s.key_points.length > 0 && (
              <ul className="flex flex-col gap-3">
                {s.key_points.map((p, j) => (
                  <li key={j} className="flex gap-3 text-[15px] leading-relaxed">
                    <span className="mt-[0.7em] h-px w-3 shrink-0 bg-accent" />
                    <Markdown className="min-w-0">{p}</Markdown>
                  </li>
                ))}
              </ul>
            )}
            {(s.predict || s.check) && (
              <details className="group rounded-2xl border border-white/[0.06]">
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 text-sm text-muted select-none hover:text-fg">
                  <Icon name="bulb" className="text-warn" />
                  Test yourself
                  <Icon name="next" className="ml-auto transition-transform group-open:rotate-90" />
                </summary>
                <div className="flex flex-col gap-6 border-t border-white/[0.06] p-4">
                  {s.predict && <SelfTest question={s.predict} lessonId={lessonId} />}
                  {s.check && (
                    <QuestionCard
                      question={s.check}
                      attempt={checks[s.id]}
                      lessonId={lessonId}
                      onAttempt={(a) => onCheck(s.id, a)}
                    />
                  )}
                </div>
              </details>
            )}
          </section>
        ))}

        {lesson.pitfalls.length > 0 && (
          <section id="pitfalls" className="flex scroll-mt-24 flex-col gap-4">
            <h2 className="text-2xl font-semibold tracking-tight">What doesn’t work, and why</h2>
            {lesson.pitfalls.map((p, i) => (
              <div key={i} className="flex gap-3 border-l-2 border-bad/60 pl-4">
                <div className="min-w-0">
                  <Markdown className="font-medium">{p.trap}</Markdown>
                  <Markdown className="mt-1 text-[15px] text-fg/85">{p.why}</Markdown>
                </div>
              </div>
            ))}
          </section>
        )}

        {lesson.glossary.length > 0 && (
          <section id="glossary" className="scroll-mt-24">
            <h2 className="text-2xl font-semibold tracking-tight">Glossary</h2>
            <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-[minmax(8rem,auto)_1fr]">
              {lesson.glossary.map((t) => (
                <div key={t.term} className="contents">
                  <dt className="font-medium">{t.term}</dt>
                  <dd className="text-[15px] text-muted max-sm:-mt-2">{t.definition}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        <Panel className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center">
          <div className="flex-1">
            <div className="font-medium">Ready to use it?</div>
            <div className="text-sm text-muted">Problems and explain-back are where it sticks.</div>
          </div>
          <Button variant="primary" onClick={onPractice}>
            Practice
            <Icon name="next" />
          </Button>
        </Panel>
      </article>
    </div>
  )
}

/** A predict question asked after reading isn't a prediction any more, so it's a local self-test. */
function SelfTest({ question, lessonId }: { question: Question; lessonId: string }) {
  const [attempt, setAttempt] = useState<Attempt>()
  return <QuestionCard question={question} attempt={attempt} lessonId={lessonId} onAttempt={setAttempt} />
}

/** The id of the section nearest the top of the viewport. */
function useActiveSection(ids: string[]) {
  const [active, setActive] = useState(ids[0])
  const key = ids.join(' ')
  useEffect(() => {
    const visible = new Set<string>()
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => (e.isIntersecting ? visible.add(e.target.id) : visible.delete(e.target.id)))
        const first = key.split(' ').find((id) => visible.has(id))
        if (first) setActive(first)
      },
      { rootMargin: '-80px 0px -60% 0px' },
    )
    key.split(' ').forEach((id) => {
      const el = document.getElementById(id)
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [key])
  return active
}
