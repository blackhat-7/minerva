// Pure helpers for voice: split streaming text into speakable sentences, turn markdown into what the voice
// reads, and encode microphone audio as WAV.
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { dollarMath } from './dollarMath'

const BOUNDARY = /[.!?…]+["'”’)\]]*(?=\s)|\n+/g
const ABBREVIATIONS = new Set(['etc', 'vs', 'approx', 'cf', 'dr', 'mr', 'mrs', 'ms', 'prof', 'fig', 'eq', 'al', 'resp'])
const MAX_CHARS = 240 // a run-on sentence is cut at a comma so audio isn't held back
const FIRST_MAX_WORDS = 20 // the first chunk is cut at a clause so the first audio starts sooner

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length

/** Index just after the first clause break (comma, semicolon, colon, dash) that has 6+ words before it. */
function clauseBreak(text: string): number {
  for (const m of text.matchAll(/[,;:—–](?=\s)/g)) if (wordCount(text.slice(0, m.index)) >= 6) return m.index + 1
  return -1
}

/** A period that doesn't end a sentence: "e.g.", "U.S.", "etc.", or a list marker like "1.". */
function isAbbreviation(before: string): boolean {
  const word = /(\S+)$/.exec(before)?.[1] ?? ''
  return (
    /^([a-z]\.)+[a-z]$/i.test(word) || // e.g, i.e, U.S
    /^[A-Z]$/.test(word) || // an initial
    ABBREVIATIONS.has(word.toLowerCase()) ||
    /^\d+$/.test(before.trim()) // "1." starting a list item
  )
}

/** Splits text arriving in chunks into whole sentences. `push` returns the sentences completed so far;
 * `flush` returns whatever remains once the text is complete. */
export function sentenceSplitter() {
  let buffer = ''
  let started = false // a chunk has been emitted

  function take(final: boolean): string[] {
    const out: string[] = []
    let start = 0
    for (const m of buffer.matchAll(BOUNDARY)) {
      if (m[0][0] === '.' && isAbbreviation(buffer.slice(start, m.index))) continue
      const end = m.index + m[0].length
      const sentence = buffer.slice(start, end).trim()
      if (sentence) out.push(sentence)
      start = end
    }
    buffer = buffer.slice(start)
    if (!final && buffer.length > MAX_CHARS) {
      const cut = Math.max(buffer.lastIndexOf(', '), buffer.lastIndexOf('; '), buffer.lastIndexOf(': '))
      if (cut > 0) {
        out.push(buffer.slice(0, cut + 1).trim())
        buffer = buffer.slice(cut + 2)
      }
    }
    if (final) {
      if (buffer.trim()) out.push(buffer.trim())
      buffer = ''
    }
    // A long first chunk (finished, or still arriving) is cut at its first clause break.
    const first = started ? '' : (out[0] ?? buffer)
    const cut = wordCount(first) > FIRST_MAX_WORDS ? clauseBreak(first) : -1
    if (cut > 0) {
      if (out.length) out.splice(0, 1, first.slice(0, cut).trim(), first.slice(cut).trim())
      else {
        out.push(buffer.slice(0, cut).trim())
        buffer = buffer.slice(cut)
      }
    }
    started ||= out.length > 0
    return out
  }

  return {
    push: (text: string) => {
      buffer += text
      return take(false)
    },
    flush: () => take(true),
  }
}

/** All sentences of a complete text. */
export const sentences = (text: string) => {
  const s = sentenceSplitter()
  return [...s.push(text), ...s.flush()]
}

type MdNode = { type: string; value?: string; children?: MdNode[] }
const BLOCKS = new Set(['paragraph', 'heading', 'listItem', 'blockquote', 'math', 'tableCell'])

/** What the voice reads for markdown: the text as the page shows it, one block per line, math in words
 * (see `texToWords`) and code blocks left out. ReadAlong finds these sentences on the page. */
export function spokenText(markdown: string): string {
  const parts: string[] = []
  const walk = (n: MdNode) => {
    if (n.type === 'code' || n.type === 'html') return
    if (n.type === 'inlineMath' || n.type === 'math') parts.push(texToWords(n.value ?? ''))
    else if (n.type === 'text' || n.type === 'inlineCode') parts.push(n.value ?? '')
    else if (n.type === 'break') parts.push('\n')
    n.children?.forEach(walk)
    if (BLOCKS.has(n.type)) parts.push('\n')
  }
  walk(unified().use(remarkParse).use(remarkGfm).use(remarkMath).parse(dollarMath(markdown)) as MdNode)
  return parts.join('').replace(/\n\s*/g, '\n').trim()
}

const TEX_WORDS: Record<string, string> = {
  times: 'times', cdot: 'times', approx: 'is about', sim: 'about', propto: 'proportional to',
  le: 'at most', leq: 'at most', ge: 'at least', geq: 'at least', ll: 'much less than', gg: 'much more than',
  neq: 'is not', pm: 'plus or minus', to: 'to', rightarrow: 'to', infty: 'infinity', sum: 'the sum of',
  ldots: '…', cdots: '…', left: '', right: '', quad: '', qquad: '',
}

/** TeX as words for the voice: "\frac{A}{N^{\alpha}}" -> "A over N to the alpha". Commands it doesn't know
 * are read by name (\alpha -> alpha). */
export function texToWords(tex: string): string {
  let s = tex.trim()
  for (let before = ''; before !== s; ) {
    before = s // innermost braces first, so nested ones resolve on later passes
    s = s
      .replace(/\\(?:text|mathrm|mathbf|mathit|operatorname)\{([^{}]*)\}/g, '$1')
      .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, ' $1 over $2 ')
      .replace(/\\sqrt\{([^{}]*)\}/g, ' the square root of $1 ')
      .replace(/\^\{([^{}]*)\}/g, ' to the $1 ')
      .replace(/_\{([^{}]*)\}/g, ' $1 ')
  }
  return s
    .replace(/\^(\w)/g, ' to the $1 ')
    .replace(/_(\w)/g, ' $1 ')
    .replace(/\\[,;:! ]|~/g, ' ')
    .replace(/\\([a-zA-Z]+)/g, (_, name: string) => ` ${TEX_WORDS[name] ?? name} `)
    .replace(/=/g, ' equals ')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/ ([,.;:)])/g, '$1')
    .trim()
}

/** 16-bit PCM mono WAV from samples in [-1, 1]. */
export function encodeWav(samples: Float32Array, sampleRate = 16000): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const ascii = (offset: number, s: string) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)))
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  ascii(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  samples.forEach((x, i) => {
    const s = Math.max(-1, Math.min(1, x))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  })
  return buffer
}

const RESUME = new RegExp(
  '^(?:(?:ok|okay|alright|all right|got it|thanks|thank you|great|cool|sure|right|yes|yeah|fine|makes sense)\\s+)*' +
    "(?:(?:let's|lets|please|you can)\\s+)?" +
    '(?:continue|go on|carry on|keep going|resume|next|proceed|move on|go ahead)' +
    '(?:\\s+(?:please|then|now))?$',
)

/** True for a short "carry on" like "continue", "okay, go on", "got it, continue": the learner wants
 * the narration back, not a tutor reply. */
export function isResumePhrase(text: string): boolean {
  const t = text
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[^\p{L}\p{N}'\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return t.split(' ').length <= 5 && RESUME.test(t)
}

/** Narration paused for a conversation: its sentences and the one that was playing. */
export type Held = { sentences: string[]; index: number }

/** Where narration stands when interrupted. `base` is the sentence it last started from; `position` the
 * queue's index within that run. */
export const hold = (sentences: string[], base: number, position: number): Held => ({
  sentences,
  index: Math.min(base + position, sentences.length - 1),
})

/** What the learner has heard: everything up to and including the interrupted sentence. */
export const heard = (h: Held) => h.sentences.slice(0, h.index + 1).join(' ')
