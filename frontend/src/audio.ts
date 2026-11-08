// One shared player for narration and spoken tutor replies, plus push-to-talk recording.
// Text is spoken sentence by sentence through a queue, so audio starts after the first sentence.
// Server TTS when /api/status says so; the browser's speechSynthesis otherwise, or for a sentence whose TTS failed.
import { useSyncExternalStore } from 'react'
import { api, chosenVoice } from './api'
import { createQueue, type Engine, type PlayState } from './queue'
import { heard, hold, sentences, type Held } from './speech'

export type { PlayState }

// 44-byte silent WAV. Playing it inside a tap unlocks the element for later programmatic play on iOS.
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='

const el = new Audio()
el.preservesPitch = true // speed changes shouldn't chipmunk the voice
const urls = new Map<string, Promise<string>>() // voice + sentence -> blob URL of its server TTS
const listeners = new Set<() => void>()
let snapshot = {
  state: 'idle' as PlayState,
  rate: Number(localStorage.getItem('minerva.rate')) || 1,
  volume: Number(localStorage.getItem('minerva.volume') ?? 1),
  held: null as Held | null, // narration paused for a conversation, to resume from its sentence
  spoken: null as Spoken | null, // the narration sentence playing (or held), for highlighting
}
el.volume = snapshot.volume
/** Which narration text is being read, and the index of its sentence (see `sentences`). */
export type Spoken = { text: string; index: number }
let unlocked = false
let session = 0 // bumped by every new utterance and stop(), so a stale stream can't push into a new one

function update(patch: Partial<typeof snapshot>) {
  snapshot = { ...snapshot, ...patch }
  listeners.forEach((l) => l())
}

type Clip = { url: string } | { text: string }
let current: Clip | undefined
let finishCurrent: (() => void) | undefined

function finishClip() {
  const finish = finishCurrent
  finishCurrent = undefined
  finish?.()
}
el.onended = finishClip

function serverAudio(text: string): Promise<string> {
  const key = `${chosenVoice()}\0${text}`
  let url = urls.get(key)
  if (!url) {
    url = api.tts(text).then((blob) => URL.createObjectURL(blob))
    urls.set(key, url)
    url.catch(() => urls.delete(key))
  }
  return url
}

const engine: Engine<Clip> = {
  load: async (text) => {
    const tts = await api.cachedStatus().then((s) => s.tts, () => false)
    const url = tts ? await serverAudio(text).catch(() => null) : null
    return url ? { url } : { text }
  },
  play: (clip) =>
    new Promise((resolve) => {
      current = clip
      if ('url' in clip) {
        finishCurrent = resolve
        el.src = clip.url
        el.playbackRate = snapshot.rate
        // Blocked autoplay (no tap yet): show as paused; the play button's tap resumes it. Not for the
        // AbortError of a clip replaced by the next one (a seek), which must not pause its successor.
        el.play().catch((e) => e instanceof DOMException && e.name === 'NotAllowedError' && current === clip && queue.pause())
      } else {
        const u = new SpeechSynthesisUtterance(clip.text)
        u.voice = bestVoice()
        u.lang = u.voice?.lang ?? 'en-US'
        u.rate = snapshot.rate
        u.volume = snapshot.volume
        u.onend = u.onerror = () => resolve()
        speechSynthesis.speak(u)
      }
    }),
  pause: () => (current && 'url' in current ? el.pause() : speechSynthesis.pause()),
  resume: () => (current && 'url' in current ? el.play().catch(() => {}) : speechSynthesis.resume()),
  stop: () => {
    el.pause()
    speechSynthesis.cancel() // ends the current utterance, resolving its play()
    finishClip()
  },
}

const queue = createQueue(
  engine,
  (state) => update({ state }),
  1,
  (at) => narration?.session === session && update({ spoken: { text: narration.text, index: narration.base + at } }),
)

/** Call from a tap/click handler before any audio is needed (iOS requires a user gesture). */
export function unlock() {
  if (unlocked) return
  unlocked = true
  el.src = SILENT
  el.play().catch(() => {})
  speechSynthesis.speak(new SpeechSynthesisUtterance(''))
}

export const isUnlocked = () => unlocked

let context: AudioContext | undefined
/** The app's one AudioContext (the microphone's voice detection runs in it). Call first from a tap so
 * iOS lets it run. */
export function audioContext() {
  context ??= new AudioContext()
  context.resume().catch(() => {}) // stays suspended without a gesture; the next tap resumes it
  return context
}

/** Starts speaking text that arrives in pieces (a streaming reply): push sentences, then end().
 * Replaces anything playing. `onEnd` runs only if it plays to the end. Narration it interrupted stays held;
 * narration that had already finished stops counting as being read (its last sentence isn't `spoken` any more). */
export function speakStream(onEnd?: () => void) {
  if (!snapshot.held) update({ spoken: null })
  return utterance(onEnd)
}

function utterance(onEnd?: () => void) {
  const mine = ++session
  queue.start(onEnd)
  return {
    push: (sentence: string) => mine === session && queue.push(sentence),
    end: () => mine === session && queue.end(),
  }
}

// The narration playing now: its text and sentences, the one this run started from, and what to do at the end.
type Narration = { text: string; sentences: string[]; base: number; session: number; onEnd?: () => void }
let narration: Narration | null = null
let heldNarration: Narration | null = null

function narrateFrom(text: string, all: string[], base: number, onEnd?: () => void) {
  const stream = utterance(onEnd)
  narration = { text, sentences: all, base, session, onEnd }
  update({ held: null })
  all.slice(base).forEach(stream.push)
  stream.end()
}

/** Narrates a text sentence by sentence, from sentence `from`. `onEnd` runs if it plays to the end. */
export const narrate = (text: string, onEnd?: () => void, from = 0) => narrateFrom(text, sentences(text), from, onEnd)

/** Jumps the current (or held) narration to sentence `index`, keeping what it does at the end. */
export function seek(index: number) {
  const n = snapshot.held ? heldNarration : narration
  if (n) narrateFrom(n.text, n.sentences, Math.max(0, Math.min(index, n.sentences.length - 1)), n.onEnd)
}

/** The learner started talking. Narration pauses and remembers its sentence; a tutor reply just stops. */
export function interrupt() {
  const n = narration
  const narrating = n && n.session === session && snapshot.state !== 'idle'
  const position = queue.position()
  stop()
  if (narrating) {
    heldNarration = n
    const held = hold(n.sentences, n.base, position)
    update({ held, spoken: { text: n.text, index: held.index } })
  }
}

/** Continues held narration from the start of the sentence it was interrupted in. */
export function resumeNarration() {
  const h = snapshot.held
  if (h && heldNarration) narrateFrom(heldNarration.text, h.sentences, h.index, heldNarration.onEnd)
}

/** Steps narration back: restarts the sentence playing, or goes to the previous one if it only just began.
 * After the end it replays the last sentence. */
export function rewind() {
  const h = snapshot.held
  if (h && heldNarration)
    return narrateFrom(heldNarration.text, h.sentences, Math.max(0, h.index - 1), heldNarration.onEnd)
  const n = narration
  if (!n || n.session !== session) return
  const index = Math.min(n.base + queue.position(), n.sentences.length - 1)
  const justStarted = !current || !('url' in current) || el.currentTime < REWIND_RESTART_S
  narrateFrom(n.text, n.sentences, Math.max(0, index - (justStarted ? 1 : 0)), n.onEnd)
}
const REWIND_RESTART_S = 2

/** Stops narration and forgets any held position (leaving the segment). */
export function stopNarration() {
  stop()
  update({ held: null, spoken: null })
}

/** The narration heard before the interruption, for the tutor; null when nothing is held. */
export const narrationHeard = () => (snapshot.held ? heard(snapshot.held) : null)

/** Fetch the first sentence's audio ahead of time so the next narration starts instantly. */
export function prefetch(text: string) {
  const [first] = sentences(text)
  if (first) engine.load(first).catch(() => {}) // best-effort; playback falls back on its own
}

export function pause() {
  if (snapshot.state !== 'idle') queue.pause()
}

export function resume() {
  if (snapshot.state === 'paused') queue.resume()
}

/** Stops whatever is playing. A held narration position is kept. */
export function stop() {
  session++
  narration = null
  queue.stop()
}

export function setRate(rate: number) {
  localStorage.setItem('minerva.rate', String(rate))
  el.playbackRate = rate // speechSynthesis picks the rate up on the next sentence
  update({ rate })
}

/** Sets the volume (0 to 1) of narration and spoken replies. Phones may ignore it (iOS uses the hardware buttons). */
export function setVolume(volume: number) {
  localStorage.setItem('minerva.volume', String(volume))
  el.volume = volume // speechSynthesis picks the volume up on the next sentence
  update({ volume })
}

export function useAudio() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => snapshot,
  )
}

function bestVoice(): SpeechSynthesisVoice | null {
  const english = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'))
  const score = (v: SpeechSynthesisVoice) =>
    (/natural|neural|premium|enhanced|siri/i.test(v.name) ? 4 : 0) +
    (/samantha|ava|google us english|aria|jenny/i.test(v.name) ? 2 : 0) +
    (v.lang === 'en-US' ? 1 : 0)
  return english.sort((a, b) => score(b) - score(a))[0] ?? null
}

/** Microphone constraints for speech: the browser cancels our own playback and steadies the level. */
const MIC: MediaTrackConstraints = {
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
}

/** Push-to-talk: starts recording. Returns a function that stops and resolves the recording. */
export async function record(): Promise<() => Promise<Blob>> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: MIC })
  // iOS Safari records only audio/mp4; Chrome and Firefox prefer webm/ogg opus.
  const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'].find((t) =>
    MediaRecorder.isTypeSupported(t),
  )
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => chunks.push(e.data)
  recorder.start()
  return () =>
    new Promise((resolve) => {
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        resolve(new Blob(chunks, { type: recorder.mimeType }))
      }
      recorder.stop()
    })
}
