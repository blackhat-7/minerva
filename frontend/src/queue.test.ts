import { describe, expect, it, vi } from 'vitest'
import { createQueue, type Engine, type PlayState } from './queue'

/** A fake audio engine: loads resolve when told, clips "play" until finished or stopped. */
function fakeEngine() {
  const loads = new Map<string, { resolve: (clip: string) => void; reject: (e: Error) => void }>()
  let finishCurrent: (() => void) | undefined
  const log: string[] = []
  const engine: Engine<string> = {
    load: (text) =>
      new Promise((resolve, reject) => {
        log.push(`load ${text}`)
        loads.set(text, { resolve, reject })
      }),
    play: (clip) =>
      new Promise((resolve) => {
        log.push(`play ${clip}`)
        finishCurrent = resolve
      }),
    pause: () => log.push('pause'),
    resume: () => log.push('resume'),
    stop: () => {
      log.push('stop')
      finishCurrent?.()
    },
  }
  return {
    engine,
    log,
    loaded: (text: string) => loads.get(text)!.resolve(`clip:${text}`),
    failed: (text: string) => loads.get(text)!.reject(new Error('tts down')),
    finish: () => finishCurrent?.(),
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

function setup(lookahead = 1) {
  const f = fakeEngine()
  const states: PlayState[] = []
  const q = createQueue(f.engine, (s) => states.push(s), lookahead)
  return { ...f, q, states }
}

describe('createQueue', () => {
  it('plays pushed sentences in order, loading ahead, then calls done once', async () => {
    const { q, log, loaded, finish, states } = setup(1)
    const done = vi.fn()
    q.start(done)
    q.push('a')
    q.push('b')
    q.push('c')
    q.end()
    expect(log.filter((l) => l.startsWith('load'))).toEqual(['load a', 'load b']) // lookahead 1
    loaded('b') // out of order: still waits for a
    await tick()
    expect(log).not.toContain('play clip:b')
    loaded('a')
    await tick()
    expect(log.at(-1)).toBe('play clip:a')
    expect(log).not.toContain('load c')
    finish()
    await tick()
    expect(log.slice(-2)).toEqual(['load c', 'play clip:b']) // c loads while b plays
    finish()
    loaded('c')
    await tick()
    finish()
    await tick()
    expect(log.filter((l) => l.startsWith('play'))).toEqual(['play clip:a', 'play clip:b', 'play clip:c'])
    expect(done).toHaveBeenCalledOnce()
    expect(states.at(-1)).toBe('idle')
  })

  it('waits for more sentences while the stream is open', async () => {
    const { q, log, loaded, finish, states } = setup()
    const done = vi.fn()
    q.start(done)
    q.push('a')
    loaded('a')
    await tick()
    finish()
    await tick()
    expect(done).not.toHaveBeenCalled()
    expect(states.at(-1)).toBe('loading')
    q.push('b')
    loaded('b')
    await tick()
    expect(log.at(-1)).toBe('play clip:b')
    q.end()
    finish()
    await tick()
    expect(done).toHaveBeenCalledOnce()
  })

  it('skips a sentence whose audio failed to load', async () => {
    const { q, log, loaded, failed, finish } = setup()
    const done = vi.fn()
    q.start(done)
    q.push('a')
    q.push('b')
    q.end()
    failed('a')
    loaded('b')
    await tick()
    expect(log.filter((l) => l.startsWith('play'))).toEqual(['play clip:b'])
    finish()
    await tick()
    expect(done).toHaveBeenCalledOnce()
  })

  it('stop clears the queue, ends playback and never calls done (barge-in)', async () => {
    const { q, log, loaded, states } = setup()
    const done = vi.fn()
    q.start(done)
    q.push('a')
    q.push('b')
    loaded('a')
    await tick()
    q.stop()
    loaded('b')
    await tick()
    expect(log.filter((l) => l.startsWith('play'))).toEqual(['play clip:a'])
    expect(log).toContain('stop')
    expect(done).not.toHaveBeenCalled()
    expect(states.at(-1)).toBe('idle')
    // A new utterance after stop starts cleanly.
    q.start()
    q.push('c')
    loaded('c')
    await tick()
    expect(log.at(-1)).toBe('play clip:c')
  })

  it('pauses across sentence boundaries', async () => {
    const { q, log, loaded, finish, states } = setup()
    q.start()
    q.push('a')
    q.push('b')
    loaded('a')
    await tick()
    q.pause()
    expect(states.at(-1)).toBe('paused')
    finish() // the clip that was playing ends anyway
    loaded('b')
    await tick()
    expect(log.slice(-2)).toEqual(['play clip:b', 'pause']) // next clip starts paused
    q.resume()
    expect(log.at(-1)).toBe('resume')
    expect(states.at(-1)).toBe('playing')
  })
})

describe('position', () => {
  it('is the index of the sentence playing, so an interruption resumes from its start', async () => {
    const { q, loaded, finish } = setup()
    q.start()
    ;['a', 'b', 'c'].forEach(q.push)
    loaded('a')
    await tick()
    expect(q.position()).toBe(0)
    finish()
    loaded('b')
    await tick()
    expect(q.position()).toBe(1)
  })
})
