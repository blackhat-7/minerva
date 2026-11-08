// Narration controls (rewind, play/pause, Ask, speed) and voice status notices, rendered into the lesson dock
// through portals. Used by a Learn segment and by Read mode.
import { useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { api } from './api'
import { pause, resume, resumeNarration, rewind, seek, setRate, useAudio } from './audio'
import { useAsync, useHotkeys, usePersistentState } from './hooks'
import { Icon } from './icons'
import { toggleAsk, useListening } from './listen'
import { sentences } from './speech'
import { Button, IconButton, Notice, Popover, Segmented, Spinner } from './ui'

/** Elements in the lesson dock that narration controls render into. */
export type Dock = { media: HTMLElement | null; notices: HTMLElement | null }

const RATES = ['0.75', '1', '1.25', '1.5', '2'] as const
const MIC_LABELS = {
  off: 'Ask',
  starting: 'Starting',
  listening: 'Listening',
  hearing: 'Hearing you',
  recording: 'Tap when done',
  transcribing: 'Got it',
  error: 'Mic off',
}

/** `play` starts narration when nothing is playing; `menu` adds items to the settings menu. */
export function Narration({
  dock,
  lessonId,
  play,
  menu,
}: {
  dock: Dock
  lessonId: string
  play: () => void
  menu?: ReactNode
}) {
  const audio = useAudio()
  const mic = useListening()
  const listening = mic.phase !== 'off' && mic.phase !== 'error'
  const voice = useAsync(api.cachedStatus).data?.stt ?? false
  const [askedOnce, setAskedOnce] = usePersistentState('minerva.askedOnce', false)
  const ask = () => {
    setAskedOnce(true)
    toggleAsk(lessonId)
  }

  // Narration held for a conversation resumes from its sentence; otherwise play/pause as usual.
  const held = audio.held !== null
  const playing = audio.state === 'playing' && !held
  const toggle = () =>
    held ? resumeNarration() : audio.state === 'playing' ? pause() : audio.state === 'paused' ? resume() : play()
  useHotkeys({ ' ': toggle, j: rewind, J: rewind })
  const micProblem = mic.error || (mic.silent && mic.phase === 'listening')

  // Seek bar over the narration's sentences, along the dock's top edge. It jumps on release, not while
  // dragging, so each step of a drag doesn't start fetching audio.
  const total = audio.spoken ? sentences(audio.spoken.text).length : 0
  const [drag, setDrag] = useState<number | null>(null)
  const position = drag ?? audio.spoken?.index ?? 0
  const commit = () => {
    if (drag !== null) seek(drag)
    setDrag(null)
  }

  const controls = (
    <>
      {total > 1 && (
        <input
          type="range"
          aria-label="Narration position"
          title={`Sentence ${position + 1} of ${total}`}
          min={0}
          max={total - 1}
          value={position}
          onChange={(e) => setDrag(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
          style={{ '--played': `${(position / (total - 1)) * 100}%` } as CSSProperties}
          className="scrubber absolute inset-x-7 -top-2 h-4 cursor-pointer rounded-full"
        />
      )}
      <IconButton icon="rewind" label="Back one sentence (J)" onClick={rewind} className="text-muted" />
      <Button
        variant="default"
        onClick={toggle}
        aria-label={playing ? 'Pause narration' : held ? 'Resume narration' : 'Play narration'}
        title={playing ? 'Pause (Space)' : 'Play (Space)'}
        className="w-11 px-0"
      >
        {audio.state === 'loading' && !held ? <Spinner /> : <Icon name={playing ? 'pause' : 'play'} />}
      </Button>
      {voice && (
        <Button
          variant="ghost"
          onClick={ask}
          aria-pressed={listening}
          title={listening ? 'Just talk to interrupt. Tap to stop (T)' : 'Pause and ask out loud (T)'}
          className={`min-w-11 gap-2 px-4 max-[400px]:px-3 ${listening ? 'bg-accent/15 text-accent hover:bg-accent/20' : ''}`}
        >
          {/* the icon pulses with the mic level, so you can see it hears you */}
          <span
            className="grid transition-transform duration-75 motion-reduce:transform-none"
            style={
              mic.phase === 'listening' || mic.phase === 'hearing'
                ? { transform: 'scale(calc(1 + var(--voice-level, 0) * 0.6))' }
                : undefined
            }
          >
            <Icon name="mic" />
          </span>
          <span className={`truncate ${mic.phase === 'off' ? 'max-[400px]:hidden' : ''}`}>{MIC_LABELS[mic.phase]}</span>
        </Button>
      )}
      <Popover icon="more" label="Narration settings">
        <div className="px-2 pt-2 pb-1">
          <Segmented
            label="Speed ×"
            value={String(audio.rate) as (typeof RATES)[number]}
            options={RATES.map((r) => ({ value: r, label: r }))}
            onChange={(r) => setRate(Number(r))}
          />
        </div>
        {menu}
      </Popover>
    </>
  )

  const notices = micProblem ? (
    <Notice tone="text-bad">{mic.error || 'No sound from your microphone. Check the input device.'}</Notice>
  ) : held ? (
    <Notice>
      Paused for your question <span className="text-muted">· say “continue” or press play</span>
    </Notice>
  ) : (
    voice &&
    !askedOnce && (
      <Notice>
        <Icon name="mic" className="text-accent" />
        <span>
          Questions? Tap <span className="font-medium">Ask</span> and just talk.
        </span>
        <button onClick={() => setAskedOnce(true)} className="-mr-2 ml-1 rounded-full px-2 text-muted hover:text-fg">
          Got it
        </button>
      </Notice>
    )
  )

  return (
    <>
      {dock.media && createPortal(controls, dock.media)}
      {dock.notices && createPortal(notices, dock.notices)}
    </>
  )
}

/** A settings-menu row with an icon. */
export function MenuItem({ icon, onClick, children }: { icon: 'replay'; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-sm transition hover:bg-white/[0.06]"
    >
      <Icon name={icon} className="text-muted" />
      {children}
    </button>
  )
}
