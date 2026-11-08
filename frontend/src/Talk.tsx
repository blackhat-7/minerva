// The hands-free conversation panel: an orb that shows listening / hearing / thinking / speaking.
import { useAudio } from './audio'
import { Icon } from './icons'
import { sendRecording, stopListening, useListening } from './listen'
import { Button } from './ui'

const LABELS = {
  off: 'Hands-free is off',
  error: 'Hands-free is off',
  starting: 'Starting the microphone…',
  listening: 'Listening',
  hearing: 'Hearing you…',
  recording: 'Recording · tap Done',
  transcribing: 'Got it…',
  thinking: 'Thinking…',
  speaking: 'Speaking · talk to interrupt',
}

type View = keyof typeof LABELS

/** What the conversation is doing now, combining the microphone with playback and the tutor stream. */
function useTalkView(busy: boolean): View {
  const { phase } = useListening()
  const audio = useAudio()
  if (phase !== 'listening') return phase
  if (audio.state === 'playing') return 'speaking'
  return busy || audio.state === 'loading' ? 'thinking' : 'listening'
}

/** The orb for a state. While listening it scales with the live microphone level. */
function Orb({ view, className = '' }: { view: View; className?: string }) {
  return (
    <span className={`relative grid shrink-0 place-items-center ${className}`}>
      {view === 'speaking' && <span className="absolute inset-0 animate-ping rounded-full bg-accent/20" />}
      {(view === 'thinking' || view === 'transcribing' || view === 'starting') && (
        <span className="absolute -inset-1 animate-spin rounded-full border-2 border-accent/60 border-t-transparent [animation-duration:1.4s]" />
      )}
      <span
        className={`size-full rounded-full bg-[radial-gradient(circle_at_35%_30%,var(--color-chart-6),var(--color-accent)_45%,var(--color-chart-5))] shadow-[0_0_24px_-6px_var(--color-accent)] transition-[transform,opacity,filter] duration-100 ease-out motion-reduce:transform-none ${
          view === 'error' || view === 'off' ? 'opacity-30 grayscale' : view === 'listening' ? 'opacity-80' : ''
        }`}
        style={{
          transform:
            view === 'hearing' || view === 'listening' ? 'scale(calc(1 + var(--voice-level, 0) * 0.35))' : undefined,
        }}
      />
    </span>
  )
}

/** The conversation bar at the bottom of the tutor drawer. */
export function Talk({ busy }: { busy: boolean }) {
  const { error } = useListening()
  const view = useTalkView(busy)
  return (
    <div className="m-3 mt-1 flex items-center gap-3 rounded-[26px] bg-white/[0.04] p-1.5 pl-3" aria-live="polite">
      <Orb view={view} className="size-8" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{LABELS[view]}</div>
        {error && <p className="text-xs text-bad">{error}</p>}
      </div>
      {view === 'recording' && (
        <Button variant="primary" onClick={sendRecording} className="shrink-0 px-4">
          <Icon name="check" />
          Done
        </Button>
      )}
      <Button onClick={stopListening} className="shrink-0 px-4">
        End
      </Button>
    </div>
  )
}

/** Small indicator for the player header; tapping it turns hands-free off. */
export function ListeningBadge() {
  const { phase, error } = useListening()
  const view = useTalkView(false)
  if (phase === 'off') return null
  return (
    <button
      onClick={phase === 'recording' ? sendRecording : stopListening}
      title={error || (phase === 'recording' ? 'Recording. Tap when done (T)' : 'Hands-free is on. Tap to turn off (T)')}
      aria-label="Turn off hands-free"
      className="flex min-h-11 items-center gap-2 rounded-full px-3 text-xs text-muted transition hover:bg-white/[0.07] hover:text-fg"
    >
      <Orb view={view} className="size-3.5" />
      <span className="hidden md:inline">{phase === 'error' ? 'Mic off' : LABELS[view]}</span>
    </button>
  )
}
