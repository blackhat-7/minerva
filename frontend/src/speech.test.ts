import { describe, expect, it } from 'vitest'
import { encodeWav, heard, hold, isResumePhrase, sentences, sentenceSplitter } from './speech'

describe('sentenceSplitter', () => {
  it('emits sentences as soon as they are complete', () => {
    const s = sentenceSplitter()
    expect(s.push('Decode is memory')).toEqual([])
    expect(s.push('-bound. Each tok')).toEqual(['Decode is memory-bound.'])
    expect(s.push('en reads all weights! Why')).toEqual(['Each token reads all weights!'])
    expect(s.push('?')).toEqual([]) // could still be "?!" or "?)": wait for whitespace
    expect(s.flush()).toEqual(['Why?'])
  })

  it('keeps decimals, abbreviations, initials and list markers inside sentences', () => {
    expect(sentences('An H100 moves 3.35 TB/s, e.g. for decode. Then i.e. the ridge is ~295. Done.')).toEqual([
      'An H100 moves 3.35 TB/s, e.g. for decode.',
      'Then i.e. the ridge is ~295.',
      'Done.',
    ])
    expect(sentences('Ask J. Dean etc. about it. Fine.')).toEqual(['Ask J. Dean etc. about it.', 'Fine.'])
    expect(sentences('1. Read weights. 2. Multiply.')).toEqual(['1. Read weights.', '2. Multiply.'])
  })

  it('ends a sentence after a model name with a period', () => {
    expect(sentences('Use an H100. It has HBM3.')).toEqual(['Use an H100.', 'It has HBM3.'])
  })

  it('splits on newlines and keeps closing quotes', () => {
    expect(sentences('He said "stop." Then left\nNew line')).toEqual(['He said "stop."', 'Then left', 'New line'])
  })

  it('cuts a long first sentence at a clause so audio starts sooner, but not later ones', () => {
    const long = 'Decode at batch one reads every weight from memory for each token, so the GPU waits on bandwidth instead of doing math.'
    expect(sentences(`${long} ${long}`)).toEqual([
      'Decode at batch one reads every weight from memory for each token,',
      'so the GPU waits on bandwidth instead of doing math.',
      long,
    ])
    // While streaming, before the sentence has even ended.
    const s = sentenceSplitter()
    const start = 'Decode at batch one reads every weight from memory for each token, so the GPU waits on bandwidth instead of doing'
    expect(s.push(start)).toEqual(['Decode at batch one reads every weight from memory for each token,'])
    expect(s.push(' math. ')).toEqual(['so the GPU waits on bandwidth instead of doing math.'])
  })

  it('cuts a long run-on sentence at a comma', () => {
    const s = sentenceSplitter()
    const out = s.push(`${'word '.repeat(40)}and more, ${'tail '.repeat(10)}`)
    expect(out).toHaveLength(1)
    expect(out[0].endsWith('and more,')).toBe(true)
    expect(s.flush()[0].startsWith('tail')).toBe(true)
  })
})

describe('encodeWav', () => {
  it('writes a 16 kHz mono 16-bit PCM header and clamped samples', () => {
    const buf = encodeWav(new Float32Array([0, 1, -1, 2]), 16000)
    const v = new DataView(buf)
    const text = (o: number, n: number) => String.fromCharCode(...new Uint8Array(buf, o, n))
    expect(buf.byteLength).toBe(44 + 8)
    expect(text(0, 4)).toBe('RIFF')
    expect(v.getUint32(4, true)).toBe(36 + 8)
    expect(text(8, 8)).toBe('WAVEfmt ')
    expect(v.getUint16(20, true)).toBe(1)
    expect(v.getUint16(22, true)).toBe(1)
    expect(v.getUint32(24, true)).toBe(16000)
    expect(v.getUint32(28, true)).toBe(32000)
    expect(v.getUint16(34, true)).toBe(16)
    expect(text(36, 4)).toBe('data')
    expect(v.getUint32(40, true)).toBe(8)
    expect([0, 1, 2, 3].map((i) => v.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32768, 32767])
  })
})

describe('isResumePhrase', () => {
  it.each(['continue', 'Continue.', 'go on', 'Carry on!', 'keep going', 'resume', 'Okay, continue', 'next', "let's continue", 'Let’s continue.', 'got it, continue', 'OK go on please', 'alright, keep going', 'makes sense, move on'])(
    'accepts %j',
    (t) => expect(isResumePhrase(t)).toBe(true),
  )
  it.each(['', 'why does it continue to grow', 'continue explaining the KV cache', 'what comes next', 'okay', 'got it', 'go on about batching please now'])(
    'rejects %j',
    (t) => expect(isResumePhrase(t)).toBe(false),
  )
})

describe('hold / heard', () => {
  const s = ['One.', 'Two.', 'Three.', 'Four.']
  it('remembers the interrupted sentence, including after an earlier resume', () => {
    expect(hold(s, 0, 1)).toEqual({ sentences: s, index: 1 })
    expect(hold(s, 2, 1)).toEqual({ sentences: s, index: 3 }) // resumed at Three, interrupted in Four
    expect(hold(s, 2, 9).index).toBe(3) // clamped
  })
  it('reports what was heard, up to and including the interrupted sentence', () => {
    expect(heard({ sentences: s, index: 1 })).toBe('One. Two.')
    expect(heard({ sentences: s, index: 0 })).toBe('One.')
  })
})
