// Hands-free listening: one Silero VAD microphone for the whole page. It hears when the learner starts and
// stops talking, transcribes each utterance, and hands it to whoever registered handlers (the tutor).
import type { MicVAD } from '@ricky0123/vad-web'
import { useSyncExternalStore } from 'react'
import { api } from './api'
import { audioContext, interrupt, MIC, record, unlock } from './audio'
import { errorMessage } from './hooks'
import { encodeWav } from './speech'

export type ListenPhase = 'off' | 'starting' | 'listening' | 'hearing' | 'recording' | 'transcribing' | 'error'

type Handlers = {
  onSpeech: () => void // speech confirmed (~0.4 s in): time to interrupt
  onUtterance: (text: string) => void
}

// `silent`: the mic has delivered nothing but digital silence for a while (wrong or muted input device).
let snapshot = { phase: 'off' as ListenPhase, error: '', silent: false }
const SILENT_RMS = 1e-4 // far below any real room noise
const SILENT_AFTER_MS = 6000
let lastSound = 0
let silenceCheck: ReturnType<typeof setInterval> | undefined
// A timer, not the frame callback: a dead input may deliver no frames at all.
function checkSilence() {
  const silent = performance.now() - lastSound > SILENT_AFTER_MS
  if (silent !== snapshot.silent) update({ silent })
}
const listeners = new Set<() => void>()
let vad: MicVAD | null = null
let handlers: Handlers | null = null
let lessonId = ''
let run = 0 // bumped by stopListening so a VAD still loading is discarded

function update(patch: Partial<typeof snapshot>) {
  snapshot = { ...snapshot, ...patch }
  listeners.forEach((l) => l())
}

export function setVoiceHandlers(h: Handlers | null) {
  handlers = h
}

function micError(e: unknown): string {
  const name = e instanceof DOMException ? e.name : ''
  if (name === 'NotAllowedError') return 'Microphone blocked. Allow it for this site in your browser settings, then try again.'
  if (name === 'NotFoundError') return 'No microphone found.'
  return `Hands-free mode couldn’t start (${errorMessage(e)}). Use the mic button to talk instead.`
}

// Release the microphone while the app is in the background.
const onVisibility = () => (document.hidden ? vad?.pause() : vad?.start())

/** Pause narration (it resumes from the same sentence on "continue") and listen for a question.
 * Listening stays on, so later speech interrupts too. Call from a tap. */
export function ask(lesson: string) {
  interrupt()
  lessonId = lesson
  if (detectorBroken) {
    unlock()
    void startRecording()
  } else void startListening(lesson)
}

// Some browsers (seen: a misconfigured Zen on macOS) hand the page mic audio but never run the detector's
// audio-processing node. Then Ask falls back to plain recording and the learner taps when done.
let framesSeen = 0
let detectorBroken = false
let finishRecording: (() => Promise<Blob>) | null = null

/** Plain recording, no detector: the learner taps when done (see sendRecording). */
async function startRecording() {
  teardown()
  const mine = run
  try {
    const finish = await record()
    if (mine !== run) return void finish()
    finishRecording = finish
    update({ phase: 'recording', error: '' })
  } catch (e) {
    update({ phase: 'error', error: micError(e) })
  }
}

/** Sends a question recorded in fallback mode. */
export async function sendRecording() {
  const finish = finishRecording
  finishRecording = null
  if (!finish) return
  update({ phase: 'transcribing' })
  try {
    const { text } = await api.stt(await finish(), lessonId)
    if (text.trim()) handlers?.onUtterance(text.trim())
    update({ phase: 'off' })
  } catch (e) {
    update({ phase: 'off', error: `Couldn’t transcribe that: ${errorMessage(e)}` })
  }
}

/** The Ask button: start asking, finish a recorded question, or stop listening. */
export function toggleAsk(lesson: string) {
  if (snapshot.phase === 'recording') return void sendRecording()
  if (snapshot.phase !== 'off' && snapshot.phase !== 'error') return stopListening()
  ask(lesson)
}

// Firefox stops feeding the detector's audio worklet once the mic goes digitally silent (noise
// suppression does that between words), so it never hears a turn end and sticks on "Hearing you".
// An inaudible constant summed into the worklet's input keeps it fed; a dead mic still reads as
// silent (1e-6 << SILENT_RMS). vad-web exposes no handle on its worklet node, hence the cast.
type VadInternals = { getAudioInstances(): { audioContext: AudioContext; vadNode: AudioNode } }
let dither: ConstantSourceNode | null = null

function keepFed(v: MicVAD) {
  const { audioContext: context, vadNode } = (v as unknown as VadInternals).getAudioInstances()
  dither = context.createConstantSource()
  dither.offset.value = 1e-6
  dither.connect(vadNode)
  dither.start()
}

/** Starts listening. Call from a tap: it also unlocks audio playback and the AudioContext on iOS. */
export async function startListening(lesson: string) {
  lessonId = lesson
  if (vad || snapshot.phase === 'starting') return
  if (!isSecureContext) return update({ phase: 'error', error: 'Voice needs HTTPS. Open Minerva at its https:// address.' })
  unlock()
  const context = audioContext()
  const mine = ++run
  lastSound = performance.now()
  clearInterval(silenceCheck)
  silenceCheck = setInterval(checkSilence, 1000)
  update({ phase: 'starting', error: '', silent: false })
  try {
    const { MicVAD } = await import('@ricky0123/vad-web')
    const v = await MicVAD.new({
      model: 'v5',
      baseAssetPath: '/vad/',
      onnxWASMBasePath: '/vad/',
      audioContext: context,
      // vad-web's default pause stops the mic and resume asks for it again, so the browser prompts each
      // time the learner switches apps. Keep the stream while hidden; ask again only if the system ended it.
      pauseStream: async () => {},
      resumeStream: async (stream) =>
        stream.getAudioTracks().some((t) => t.readyState === 'live')
          ? stream
          : navigator.mediaDevices.getUserMedia({ audio: MIC }),
      redemptionMs: 900, // silence that ends a turn (default 1400): snappier, still allows a short pause
      ortConfig: (ort) => {
        ort.env.logLevel = 'error'
        ort.env.wasm.numThreads = 1 // multi-threaded wasm needs cross-origin isolation we don't have
      },
      onFrameProcessed: (_, frame) => {
        const rms = Math.sqrt(frame.reduce((sum, x) => sum + x * x, 0) / frame.length)
        framesSeen++
        if (rms > SILENT_RMS) lastSound = performance.now()
        document.documentElement.style.setProperty('--voice-level', String(Math.min(1, rms * 10)))
      },
      onSpeechStart: () => update({ phase: 'hearing' }),
      // Interrupt only once speech is confirmed, so a cough or echo doesn't cut the narration or tutor off.
      onSpeechRealStart: () => handlers?.onSpeech(),
      onVADMisfire: () => update({ phase: 'listening' }),
      onSpeechEnd: async (samples) => {
        update({ phase: 'transcribing', error: '' })
        try {
          const { text } = await api.stt(new Blob([encodeWav(samples)], { type: 'audio/wav' }), lessonId)
          if (text.trim()) handlers?.onUtterance(text.trim())
        } catch (e) {
          update({ error: `Couldn’t transcribe that: ${errorMessage(e)}` })
        }
        if (vad) update({ phase: 'listening' })
      },
    })
    if (mine !== run) return v.destroy()
    keepFed(v)
    vad = v
    document.addEventListener('visibilitychange', onVisibility)
    update({ phase: 'listening' })
    // No frames at all after 2 s: the detector can't run here (see detectorBroken). Remembered for the page.
    framesSeen = 0
    setTimeout(() => {
      if (vad !== v || framesSeen > 0) return
      detectorBroken = true
      void startRecording()
    }, 2000)
  } catch (e) {
    if (mine === run) update({ phase: 'error', error: micError(e) })
  }
}

function teardown() {
  clearInterval(silenceCheck)
  dither?.stop()
  dither = null
  vad?.destroy()
  vad = null
  void finishRecording?.() // discard
  finishRecording = null
  document.removeEventListener('visibilitychange', onVisibility)
}

export function stopListening() {
  run++
  teardown()
  update({ phase: 'off', error: '', silent: false })
}

export function useListening() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => snapshot,
  )
}
