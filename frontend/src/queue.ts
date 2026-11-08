// Plays sentences in order through an engine, loading a few ahead so playback is gapless.
// Sentences can be pushed while playing (a streaming reply); `end` says no more will come.

export type PlayState = 'idle' | 'loading' | 'playing' | 'paused'

/** Turns text into a playable clip and plays clips one at a time. `play` resolves when the clip
 * finishes or `stop` is called. */
export type Engine<Clip> = {
  load: (text: string) => Promise<Clip>
  play: (clip: Clip) => Promise<void>
  pause: () => void
  resume: () => void
  stop: () => void
}

/** `onSentence` gets the index of each sentence as it starts playing. */
export function createQueue<Clip>(
  engine: Engine<Clip>,
  onState: (s: PlayState) => void,
  lookahead = 1,
  onSentence?: (index: number) => void,
) {
  let items: { text: string; clip?: Promise<Clip> }[] = []
  let at = 0
  let open = false // more sentences may still be pushed
  let running = false
  let paused = false
  let run = 0 // bumped by stop() so a superseded loop exits
  let onDone: (() => void) | undefined

  const load = (i: number) => {
    const item = items[i]
    if (item && !item.clip) {
      item.clip = engine.load(item.text)
      item.clip.catch(() => {}) // a failed sentence is skipped when its turn comes
    }
  }

  function finish() {
    onState('idle')
    const done = onDone
    onDone = undefined
    done?.()
  }

  async function loop(mine: number) {
    running = true
    while (mine === run && at < items.length) {
      for (let i = at; i <= at + lookahead; i++) load(i) // 'loading' was set by start(); no flicker between sentences
      const clip = await items[at].clip!.catch(() => null)
      if (mine !== run) return
      if (clip !== null) {
        if (!paused) onState('playing')
        onSentence?.(at)
        const played = engine.play(clip)
        if (paused) engine.pause()
        await played
        if (mine !== run) return
      }
      at++
    }
    running = false
    if (!open) finish()
    else if (!paused) onState('loading') // waiting for the next sentence of a streaming reply
  }

  const queue = {
    /** Starts a new utterance, replacing anything playing. `done` runs if it plays to the end. */
    start(done?: () => void) {
      queue.stop()
      open = true
      onDone = done
      onState('loading')
    },
    push(text: string) {
      items.push({ text })
      if (items.length - 1 <= at + lookahead) load(items.length - 1)
      if (!running) loop(run)
    },
    end() {
      open = false
      if (!running) finish()
    },
    /** Index of the sentence playing (or about to) within this utterance. */
    position: () => at,
    pause() {
      paused = true
      engine.pause()
      onState('paused')
    },
    resume() {
      paused = false
      engine.resume()
      onState(running ? 'playing' : 'loading')
    },
    stop() {
      run++
      items = []
      at = 0
      open = running = paused = false
      onDone = undefined
      engine.stop()
      onState('idle')
    },
  }
  return queue
}
