// Steps through a scene or code visual. While its narration is read aloud, the steps follow the sentence being
// read (scene.ts stepStarts); otherwise the learner steps by hand or presses Play. Shows the step's caption.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAudio } from './audio'
import type { Step } from './lesson'
import { stepAt, stepStarts } from './scene'
import { IconButton } from './ui'

const PLAY_MS = 3000 // per step when playing without narration
const SAME_SENTENCE_MS = 1500 // between steps that start at the same sentence
const MAX_DOTS = 10 // more steps show "3 / 12" instead of a dot each

// The step shown and the one it is advancing to, one at a time.
type Run = { step: number; goal: number; playing: boolean }

export function Walkthrough({
  steps,
  narration = '',
  onState,
  children,
}: {
  steps: Step[]
  narration?: string
  onState: (state: Record<string, unknown>) => void
  children: (step: number) => ReactNode
}) {
  const audio = useAudio()
  const starts = useMemo(() => stepStarts(narration, steps), [narration, steps])
  const reading = narration && audio.spoken?.text === narration && (audio.state !== 'idle' || audio.held)
  // The step the voice has reached (-1: not the first one yet), or null when the narration isn't being read.
  const narrated = reading ? stepAt(starts, audio.spoken!.index) : null
  const [run, setRun] = useState<Run>({ step: 0, goal: 0, playing: false })

  // The narration reached another step: go there through the steps that start at the same sentence before it.
  // A step picked by hand stays until then.
  const [followed, setFollowed] = useState<number | null>(null)
  if (narrated !== followed) {
    setFollowed(narrated)
    if (narrated !== null)
      setRun({ step: narrated < 0 ? -1 : starts.indexOf(starts[narrated]), goal: narrated, playing: false })
  }

  const { step, goal, playing } = run
  const voicePaused = narrated !== null && audio.state !== 'playing' // paused, or held for a question
  useEffect(() => {
    if (step >= goal || (!playing && voicePaused)) return
    const next = () => setRun((r) => ({ ...r, step: r.step + 1, playing: r.playing && r.step + 1 < r.goal }))
    const timer = setTimeout(next, playing ? PLAY_MS : SAME_SENTENCE_MS)
    return () => clearTimeout(timer)
  }, [step, goal, playing, voicePaused])

  const caption = steps[step]?.caption ?? ''
  useEffect(() => {
    if (steps.length) onState({ step: step + 1, steps: steps.length, caption })
  }, [onState, step, steps.length, caption])

  const go = (k: number) => setRun({ step: k, goal: k, playing: false })
  const last = steps.length - 1

  return (
    <div className="flex flex-col gap-3">
      {children(step)}
      {steps.some((s) => s.caption) && (
        // Every caption in one grid cell: the tallest sets the height, so the controls don't jump between steps.
        <div aria-live="polite" className="grid">
          {steps.map((s, i) => (
            <p
              key={i}
              className={`col-start-1 row-start-1 text-center text-[15px] leading-snug text-balance transition duration-200 ${i === step ? '' : 'invisible opacity-0'}`}
            >
              {s.caption}
            </p>
          ))}
        </div>
      )}
      {steps.length > 1 && (
        <div className="flex items-center justify-center gap-3">
          <IconButton
            icon={playing ? 'pause' : 'play'}
            label={playing ? 'Pause' : 'Play the steps'}
            onClick={() =>
              setRun(playing ? { step, goal: step, playing: false } : { step: step === last ? 0 : Math.max(step, 0), goal: last, playing: true })
            }
            className={narrated !== null ? 'invisible' : 'text-muted'}
          />
          <div className="flex items-center">
            <IconButton icon="back" label="Previous step" disabled={step <= 0} onClick={() => go(step - 1)} className="text-muted" />
            {steps.length > MAX_DOTS ? (
              <span className="tabular px-2 text-sm text-muted">
                {step + 1} / {steps.length}
              </span>
            ) : (
              steps.map((_, i) => (
                <button
                  key={i}
                  aria-label={`Step ${i + 1}`}
                  aria-current={i === step ? 'step' : undefined}
                  onClick={() => go(i)}
                  className="flex h-11 w-4 items-center justify-center"
                >
                  <span
                    className={`h-1.5 rounded-full transition-all duration-200 ${i === step ? 'w-4 bg-accent' : i < step ? 'w-1.5 bg-fg/50' : 'w-1.5 bg-fg/20'}`}
                  />
                </button>
              ))
            )}
            <IconButton icon="next" label="Next step" disabled={step === last} onClick={() => go(step + 1)} className="text-muted" />
          </div>
        </div>
      )}
    </div>
  )
}
