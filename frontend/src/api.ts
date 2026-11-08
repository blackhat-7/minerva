// Typed client for the backend HTTP API (docs/api.md).
import type { Diagnostic, Lesson, Question } from './lesson'
import { profileId } from './profile'

export type Provider = { name: string; model: string; available: boolean; html: boolean }

export type Status = {
  providers: Provider[]
  roles: Record<string, string[]>
  tts: boolean
  stt: boolean
  due: number
}

export type SettingsProvider = {
  name: string
  kind: 'openai' | 'claude_code'
  model: string
  base_url: string
  html: boolean
  extra_body: Record<string, unknown>
  available: boolean
}
export type SpeechSettings = { base_url: string; model: string; voice: string; voices?: Record<string, string> }
/** The server's configuration (config.toml), read-only. */
export type Settings = {
  providers: SettingsProvider[]
  roles: { lesson: string[]; tutor: string[] }
  tts: SpeechSettings | null
  stt: SpeechSettings | null
  thinking: Partial<Record<Role, Effort>> // set in the app; missing = from config.toml
  claude_models: Partial<Record<Role, string>> // set in the app; missing = the provider's model in config.toml
  claude_model_options: string[]
  learner: string
  config_path: string
}

export type Role = 'lesson' | 'tutor'
export type Effort = 'low' | 'medium' | 'high' | 'max'

/** localStorage keys (JSON, as usePersistentState writes them) for the models the profile chose on this device;
 * '' = the server's role order. */
export const lessonProviderKey = () => `minerva.${profileId()}.provider`
export const tutorProviderKey = () => `minerva.${profileId()}.tutorProvider`
const chosen = (key: string): string | undefined => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '""') || undefined
  } catch {
    return undefined
  }
}
const tutorProvider = () => chosen(tutorProviderKey())
/** localStorage key for the narration voice the profile chose on this device; '' = the server's default. */
export const voiceKey = () => `minerva.${profileId()}.voice`
export const chosenVoice = () => chosen(voiceKey()) ?? ''

export type LessonRecord = {
  id: string
  topic: string
  created_at: string
  provider: string
  status: 'diagnostic' | 'generating' | 'ready' | 'failed'
  error: string
  diagnostic: Diagnostic | null
  lesson: Lesson | null
  activity?: Step[] // while generating: what the model has done so far
  progress: Record<string, unknown>
}

export type LessonSummary = Pick<LessonRecord, 'id' | 'topic' | 'status' | 'created_at'> & { title: string }

export type DueCard = { id: string; front: string; back: string; topic: string; lesson_id: string | null }

export type Grade = { correct: boolean; feedback: string }

export type ExplainResult = {
  score: number
  covered: string[]
  missing: string[]
  misconceptions: string[]
  follow_up: string
}

/** What a model did on the way to its answer: thinking, and tool calls such as web searches. */
export type Step = { kind: 'thinking'; text: string } | { kind: 'tool'; name: string; detail: string }

/** One tutor stream event: reply text, thinking text ('' when only its start is known), or a tool call. */
export type TutorEvent = { delta?: string; thinking?: string; tool?: { name: string; detail: string } }

/** Folds a thinking or tool event into the steps; thinking in a row is one step.
 *  Same as add_step in backend llm.py, which does this for lesson generation. */
export function addStep(steps: Step[], event: TutorEvent): Step[] {
  if (event.tool) return [...steps, { kind: 'tool', ...event.tool }]
  if (event.thinking === undefined) return steps
  const last = steps.at(-1)
  if (last?.kind === 'thinking') return [...steps.slice(0, -1), { kind: 'thinking', text: last.text + event.thinking }]
  return [...steps, { kind: 'thinking', text: event.thinking }]
}

/** `at`: the lesson step a question was asked in, for the saved history (not sent to the model).
 * `quote`: lesson text the learner selected to ask about; sent to the model as a blockquote. */
export type ChatMessage = { role: 'user' | 'assistant'; content: string; at?: string; quote?: string; steps?: Step[] }

export type TutorRequest = {
  lesson_id: string
  segment_id: string
  context: {
    widget_state: Record<string, unknown>
    question: Question | null
    attempt: string
    narration_heard?: string
  }
  messages: ChatMessage[]
  voice: boolean
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: headers() }
  if (body instanceof FormData) init.body = body
  else if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = headers(true)
  }
  const res = await fetch(`/api${path}`, init).catch(() => {
    throw new Error("Can't reach the Minerva server.")
  })
  if (!res.ok) throw new Error(await errorText(res))
  return (res.status === 204 ? undefined : res.json()) as Promise<T>
}

function headers(json = false): Record<string, string> {
  return { 'X-Profile': profileId(), ...(json && { 'Content-Type': 'application/json' }) }
}

async function errorText(res: Response): Promise<string> {
  const text = await res.text().catch(() => '')
  try {
    const detail = JSON.parse(text).detail
    if (detail) return typeof detail === 'string' ? detail : JSON.stringify(detail)
  } catch {
    // not JSON; fall through
  }
  return text.slice(0, 200) || `${res.status} ${res.statusText}`
}

let statusOnce: Promise<Status> | undefined

export const api = {
  status: () => (statusOnce = request<Status>('GET', '/status')),
  /** The last fetched status, for capability flags (tts, stt) that do not change while the app runs. */
  cachedStatus: () => statusOnce ?? api.status(),
  settings: () => request<Settings>('GET', '/settings'),
  /** How hard local models think for a role, on every device; '' = from config.toml. */
  setThinking: (role: Role, effort: Effort | '') => request<void>('PUT', '/settings/thinking', { role, effort }),
  /** Which Claude model a role uses, on every device; '' = the one in config.toml. */
  setClaudeModel: (role: Role, model: string) => request<void>('PUT', '/settings/claude_model', { role, model }),

  lessons: () => request<LessonSummary[]>('GET', '/lessons'),
  lesson: (id: string) => request<LessonRecord>('GET', `/lessons/${id}`),
  createLesson: (topic: string, provider?: string) => request<LessonRecord>('POST', '/lessons', { topic, provider }),
  generate: (id: string, answers: string[], provider?: string) =>
    request<LessonRecord>('POST', `/lessons/${id}/generate`, { answers, provider }),
  saveProgress: (id: string, progress: unknown) => request<void>('PUT', `/lessons/${id}/progress`, { progress }),
  deleteLesson: (id: string) => request<void>('DELETE', `/lessons/${id}`),
  /** Rewrites a segment as asked (it may add one after it). Takes a minute or two. */
  editSegment: (id: string, segmentId: string, instruction: string) =>
    request<LessonRecord>('POST', `/lessons/${id}/segments/${segmentId}/edit`, {
      instruction,
      provider: chosen(lessonProviderKey()),
    }),
  complete: (id: string) => request<void>('POST', `/lessons/${id}/complete`),

  grade: (lesson_id: string, question: Question, answer: string) =>
    request<Grade>('POST', '/grade', { lesson_id, question, answer, provider: tutorProvider() }),
  explain: (lesson_id: string, explanation: string) =>
    request<ExplainResult>('POST', '/explain', { lesson_id, explanation, provider: tutorProvider() }),

  due: () => request<DueCard[]>('GET', '/cards/due?limit=50'),
  addCard: (front: string, back: string, lesson_id?: string) =>
    request<{ id: string }>('POST', '/cards', { lesson_id, front, back }),
  review: (id: string, rating: 1 | 2 | 3 | 4) => request<{ due: string }>('POST', `/cards/${id}/review`, { rating }),

  drill: (topic?: string) => request<Question>('POST', '/drill', { topic: topic || undefined, provider: tutorProvider() }),

  stt: (audio: Blob, lesson_id?: string) => {
    const form = new FormData()
    form.append('audio', audio, `speech.${audio.type.includes('mp4') ? 'mp4' : audio.type.includes('ogg') ? 'ogg' : 'webm'}`)
    if (lesson_id) form.append('lesson_id', lesson_id)
    return request<{ text: string }>('POST', '/stt', form)
  },
  tts: async (text: string) => {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: headers(true),
      body: JSON.stringify({ text, voice: chosenVoice() || undefined }),
    })
    if (!res.ok) throw new Error(await errorText(res))
    return res.blob()
  },

  /** Streams the tutor's reply, calling `onEvent` per event. Resolves when done; rejects on error. */
  tutor: async (body: TutorRequest, onEvent: (event: TutorEvent) => void, signal?: AbortSignal) => {
    const res = await fetch('/api/tutor', {
      method: 'POST',
      headers: headers(true),
      body: JSON.stringify({ ...body, provider: tutorProvider() }),
      signal,
    })
    if (!res.ok || !res.body) throw new Error(await errorText(res))
    const parser = sseParser()
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
    for (;;) {
      const { value, done } = await reader.read()
      if (done) throw new Error('The tutor stream ended early.')
      for (const data of parser(value)) {
        const event = JSON.parse(data) as TutorEvent & { done?: boolean; error?: string }
        if (event.error) throw new Error(event.error)
        if (event.done) return reader.cancel()
        onEvent(event)
      }
    }
  },
}

/** Incremental Server-Sent Events parser: feed it text chunks, get back each complete event's data. */
export function sseParser() {
  let buffer = ''
  return (chunk: string): string[] => {
    buffer += chunk
    // Hold back a trailing \r: it may be the first half of a \r\n split across chunks.
    const cut = buffer.endsWith('\r') ? buffer.length - 1 : buffer.length
    const events = buffer.slice(0, cut).replace(/\r\n?/g, '\n').split('\n\n')
    buffer = events.pop()! + buffer.slice(cut)
    return events.flatMap((event) => {
      const data = event
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(line.startsWith('data: ') ? 6 : 5))
      return data.length ? [data.join('\n')] : []
    })
  }
}
