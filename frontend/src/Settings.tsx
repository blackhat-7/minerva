// Settings: per job (lessons, tutor) which model runs it, which Claude model and how hard local models think;
// narration; and what the server is configured with (read-only, from config.toml). Provider choice and
// narration are kept on this device; the Claude model and thinking are saved on the server.
// A page at /settings, and a sheet inside a lesson (SettingsPanel).
import { useState, type ReactNode } from 'react'
import { Link } from 'wouter'
import {
  api,
  lessonProviderKey,
  tutorProviderKey,
  voiceKey,
  type Effort,
  type Role,
  type Settings as ServerSettings,
  type SpeechSettings,
} from './api'
import { setRate, useAudio } from './audio'
import { errorMessage, useAsync, usePersistentState } from './hooks'
import { Icon } from './icons'
import { ErrorNote, Panel, Segmented, Skeleton, Switch } from './ui'

const RATES = ['0.75', '1', '1.25', '1.5', '2'] as const
const EFFORTS: Effort[] = ['low', 'medium', 'high', 'max']
const ROLES: Role[] = ['lesson', 'tutor']

/** "claude-opus-5-5" -> "Opus 5.5" */
const claudeLabel = (id: string) => {
  const m = /^claude-([a-z]+)-(\d+)-(\d+)$/.exec(id)
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : id
}
const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1)

export default function Settings() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 px-4 py-3 pb-16 lg:py-8">
      <div className="flex items-center gap-2">
        <Link
          href="/"
          aria-label="Home"
          title="Home"
          className="-ml-2 grid size-11 place-items-center rounded-full text-muted transition hover:bg-white/[0.07] hover:text-fg"
        >
          <Icon name="back" />
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
      </div>
      <SettingsPanel />
    </div>
  )
}

export function SettingsPanel() {
  const settings = useAsync(api.settings)
  const s = settings.data
  return (
    <div className="flex flex-col gap-6">
      {settings.error && <ErrorNote error={settings.error} onRetry={settings.reload} />}
      {!s && !settings.error && <Skeleton className="h-96" />}
      {s && (
        <>
          <Models settings={s} onChange={settings.setData} />
          <Narration />
          <Voice tts={s.tts} stt={s.stt} />
          {s.learner && (
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-1 text-sm font-medium text-muted select-none hover:text-fg">
                About you
                <Icon name="chevron" className="transition-transform group-open:rotate-180" />
              </summary>
              <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap text-fg/80">{s.learner}</p>
            </details>
          )}
          <p className="text-xs leading-relaxed text-muted">
            Models, voice and the profile come from <code className="font-mono">{s.config_path}</code>; restart Minerva
            after editing it.
          </p>
        </>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-muted">{title}</h2>
      {children}
    </section>
  )
}

/** A compact select with a chevron. */
function Select({
  value,
  onChange,
  label,
  children,
}: {
  value: string
  onChange: (v: string) => void
  label: string
  children: ReactNode
}) {
  return (
    <label className="relative flex min-w-0 items-center">
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-9 w-full min-w-0 cursor-pointer truncate rounded-full bg-white/[0.06] py-1 pr-7 pl-3 text-sm transition hover:bg-white/[0.1] focus:outline-none [&>option]:bg-raised"
      >
        {children}
      </select>
      <Icon name="chevron" className="pointer-events-none absolute right-2 text-muted" />
    </label>
  )
}

function Models({ settings: s, onChange }: { settings: ServerSettings; onChange: (s: ServerSettings) => void }) {
  const [lessonProvider, setLessonProvider] = usePersistentState(lessonProviderKey(), '')
  const [tutorProvider, setTutorProvider] = usePersistentState(tutorProviderKey(), '')
  const provider = { lesson: [lessonProvider, setLessonProvider], tutor: [tutorProvider, setTutorProvider] } as const
  const [error, setError] = useState('')
  const names = s.providers.map((p) => p.name)
  const claude = s.providers.find((p) => p.kind === 'claude_code')
  const local = s.providers.find((p) => p.kind === 'openai')
  const configuredEffort = local?.extra_body.reasoning_effort as string | undefined

  // Saved on the server. Choosing what config.toml already says clears the override.
  const save = (call: Promise<void>, next: ServerSettings) => {
    setError('')
    call.then(
      () => onChange(next),
      (e) => setError(errorMessage(e)),
    )
  }
  const setClaude = (role: Role, model: string) => {
    const value = model === claude?.model ? '' : model
    save(api.setClaudeModel(role, value), { ...s, claude_models: { ...s.claude_models, [role]: value || undefined } })
  }
  const setEffort = (role: Role, effort: string) => {
    const value = (effort === configuredEffort ? '' : effort) as Effort | ''
    save(api.setThinking(role, value), { ...s, thinking: { ...s.thinking, [role]: value || undefined } })
  }

  const row = (label: string, cell: (role: Role) => ReactNode) => (
    <>
      <span className="text-sm text-muted">{label}</span>
      {ROLES.map((role) => (
        <div key={role} className="min-w-0">
          {cell(role)}
        </div>
      ))}
    </>
  )

  return (
    <Section title="Models">
      <Panel className="p-3 sm:p-4">
        <div className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-1.5 gap-y-2">
          <span />
          <span className="px-1 text-sm font-medium">Lessons</span>
          <span className="px-1 text-sm font-medium">Tutor</span>
          {row('Model', (role) => {
            const [value, set] = provider[role]
            return (
              <Select label={`${role} model`} value={names.includes(value) ? value : ''} onChange={set}>
                <option value="">Auto</option>
                {s.providers.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                    {p.available ? '' : ' (offline)'}
                  </option>
                ))}
              </Select>
            )
          })}
          {claude &&
            row('Claude', (role) => (
              <Select label={`${role} Claude model`} value={s.claude_models[role] ?? claude.model} onChange={(m) => setClaude(role, m)}>
                {[...new Set([claude.model, ...s.claude_model_options])].map((m) => (
                  <option key={m} value={m}>
                    {claudeLabel(m)}
                  </option>
                ))}
              </Select>
            ))}
          {local &&
            row('Thinking', (role) => (
              <Select label={`${role} local thinking`} value={s.thinking[role] ?? configuredEffort ?? ''} onChange={(e) => setEffort(role, e)}>
                {!configuredEffort && <option value="">Default</option>}
                {EFFORTS.map((e) => (
                  <option key={e} value={e}>
                    {capitalize(e)}
                  </option>
                ))}
              </Select>
            ))}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted">
          Auto tries {s.roles.lesson.join(' → ')} for lessons and {s.roles.tutor.join(' → ')} for the tutor. Thinking
          applies to local models. Model choice is per device; Claude model and thinking apply everywhere.
        </p>
      </Panel>
      {error && <ErrorNote error={error} />}
      <Panel className="flex flex-col gap-2 p-4">
        {s.providers.map((p) => (
          <div key={p.name} className="flex min-w-0 items-center gap-2 text-sm">
            <span className={`size-1.5 shrink-0 rounded-full ${p.available ? 'bg-good' : 'bg-bad'}`} title={p.available ? 'online' : 'offline'} />
            <span className="font-medium">{p.name}</span>
            <span className="min-w-0 flex-1 truncate text-muted" title={p.kind === 'claude_code' ? 'claude CLI' : p.base_url}>
              {p.kind === 'claude_code' ? 'Claude subscription (CLI)' : p.base_url}
            </span>
            {p.html && <span className="shrink-0 text-xs text-muted">simulations</span>}
          </div>
        ))}
      </Panel>
    </Section>
  )
}

function Narration() {
  const audio = useAudio()
  const [transcript, setTranscript] = usePersistentState('minerva.transcript', false)
  const [autoAdvance, setAutoAdvance] = usePersistentState('minerva.autoAdvance', false)
  const [, setAskedOnce] = usePersistentState('minerva.askedOnce', false)
  return (
    <Section title="Narration">
      <Panel className="flex flex-col p-2">
        <div className="px-3 pt-2 pb-1">
          <Segmented
            label="Speed ×"
            value={String(audio.rate) as (typeof RATES)[number]}
            options={RATES.map((r) => ({ value: r, label: r }))}
            onChange={(r) => setRate(Number(r))}
          />
        </div>
        <Switch on={transcript} onChange={setTranscript}>
          Transcript in Learn mode
        </Switch>
        <Switch on={autoAdvance} onChange={setAutoAdvance}>
          Continue when narration ends
        </Switch>
        <button
          onClick={() => setAskedOnce(false)}
          className="flex min-h-10 w-full items-center rounded-xl px-3 text-left text-sm text-muted transition hover:bg-white/[0.06] hover:text-fg"
        >
          Show the “Ask” tip again
        </button>
      </Panel>
    </Section>
  )
}

function Voice({ tts, stt }: { tts: SpeechSettings | null; stt: SpeechSettings | null }) {
  const row = (label: string, s: SpeechSettings | null, off: string) => (
    <div className="flex min-w-0 items-center gap-3 text-sm">
      <span className="w-24 shrink-0 text-muted">{label}</span>
      <span className="min-w-0 truncate font-mono text-xs" title={s ? `${s.model} · ${s.base_url}` : undefined}>
        {s ? `${s.model.split('/').pop()}${s.voice ? ` · ${s.voice}` : ''}` : off}
      </span>
    </div>
  )
  return (
    <Section title="Voice">
      <Panel className="flex flex-col gap-2 p-4">
        {row('Speech', tts, 'Browser voice')}
        {row('Recognition', stt, 'Off')}
      </Panel>
      {tts?.voices && Object.keys(tts.voices).length > 1 && <VoicePicker tts={tts} voices={tts.voices} />}
    </Section>
  )
}

/** The narration voice, per profile on this device. */
function VoicePicker({ tts, voices }: { tts: SpeechSettings; voices: Record<string, string> }) {
  const [voice, setVoice] = usePersistentState(voiceKey(), '')
  return (
    <Panel className="px-5 py-4">
      <Segmented
        label="Narrator"
        value={voice in voices ? voice : tts.voice}
        options={Object.entries(voices).map(([value, label]) => ({ value, label }))}
        onChange={(v) => setVoice(v === tts.voice ? '' : v)}
      />
    </Panel>
  )
}
