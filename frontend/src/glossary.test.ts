import { describe, expect, it } from 'vitest'
import { compileGlossary, splitTerms, type Piece } from './glossary'
import type { GlossaryTerm } from './lesson'

const g = compileGlossary([
  { term: 'KV cache', definition: 'stored keys and values' },
  { term: 'KV', definition: 'keys and values' },
  { term: 'TP', definition: 'tensor parallelism' },
  { term: 'roofline', definition: 'a performance bound' },
])!

const marked = (pieces: Piece[]) => pieces.flatMap((p) => (typeof p === 'string' ? [] : [`${p.text}=${p.term.term}`]))

describe('splitTerms', () => {
  it('prefers the longest term and keeps the text intact', () => {
    const pieces = splitTerms('The KV cache grows; KV is per token.', g, new Set())
    expect(marked(pieces)).toEqual(['KV cache=KV cache', 'KV=KV'])
    expect(pieces.map((p) => (typeof p === 'string' ? p : p.text)).join('')).toBe('The KV cache grows; KV is per token.')
  })

  it('matches whole words only, and acronyms case-sensitively', () => {
    expect(marked(splitTerms('output tp stop', g, new Set()))).toEqual([])
    expect(marked(splitTerms('With TP=8, …', g, new Set()))).toEqual(['TP=TP'])
  })

  it('is case-insensitive for words and allows plurals', () => {
    expect(marked(splitTerms('Rooflines and the Roofline', g, new Set()))).toEqual(['Rooflines=roofline'])
  })

  it('marks each term once per seen set', () => {
    const seen = new Set<GlossaryTerm>()
    expect(marked(splitTerms('TP and TP', g, seen))).toEqual(['TP=TP'])
    expect(marked(splitTerms('TP again', g, seen))).toEqual([])
  })

  it('returns null for an empty glossary', () => {
    expect(compileGlossary([])).toBeNull()
  })
})
