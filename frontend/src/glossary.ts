// Glossary term highlighting: one regex per lesson, applied to rendered markdown as a rehype plugin.
import { createContext } from 'react'
import type { GlossaryTerm } from './lesson'

export type Glossary = { regex: RegExp; byKey: Map<string, GlossaryTerm> }

// All-caps terms (FSDP, TP, KV) match case-sensitively so "tp" in prose is not "TP".
const isAcronym = (term: string) => term === term.toUpperCase() && /\p{Lu}/u.test(term)

export function compileGlossary(terms: GlossaryTerm[]): Glossary | null {
  const usable = terms.filter((t) => t.term.trim())
  if (!usable.length) return null
  const alternatives = usable
    .map((t) => t.term.trim())
    .sort((a, b) => b.length - a.length) // longest first: "KV cache" before "KV"
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'))
  return {
    regex: new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alternatives.join('|')})(?:e?s)?(?![\\p{L}\\p{N}_])`, 'giu'),
    byKey: new Map(usable.map((t) => [t.term.trim().replace(/\s+/g, ' ').toLowerCase(), t])),
  }
}

export type Piece = string | { text: string; term: GlossaryTerm }

/** Splits text into plain strings and term matches. Each term is marked once per `seen` set. */
export function splitTerms(text: string, glossary: Glossary, seen: Set<GlossaryTerm>): Piece[] {
  const pieces: Piece[] = []
  let last = 0
  for (const m of text.matchAll(glossary.regex)) {
    const term = lookup(m[0], glossary)
    if (!term || seen.has(term)) continue
    seen.add(term)
    if (m.index > last) pieces.push(text.slice(last, m.index))
    pieces.push({ text: m[0], term })
    last = m.index + m[0].length
  }
  if (last < text.length) pieces.push(text.slice(last))
  return pieces
}

function lookup(match: string, glossary: Glossary): GlossaryTerm | undefined {
  const key = match.replace(/\s+/g, ' ')
  for (const candidate of [key, key.replace(/s$/, ''), key.replace(/es$/, '')]) {
    const term = glossary.byKey.get(candidate.toLowerCase())
    if (term) return isAcronym(term.term) && !candidate.startsWith(term.term) ? undefined : term
  }
}

// Minimal hast shapes, enough to walk text nodes.
type HastText = { type: 'text'; value: string }
type HastElement = { type: 'element'; tagName: string; properties: Record<string, unknown>; children: HastNode[] }
type HastNode = HastText | HastElement | { type: string; children?: HastNode[] }

const SKIP = new Set(['code', 'pre', 'a', 'button'])

/** Rehype plugin: wraps the first occurrence of each glossary term in
 * <dfn data-term data-definition>. Run before KaTeX. */
export function rehypeGlossary(glossary: Glossary) {
  return () => (tree: HastNode) => {
    const seen = new Set<GlossaryTerm>()
    const walk = (node: HastNode) => {
      if (!('children' in node) || !node.children) return
      if (node.type === 'element' && SKIP.has((node as HastElement).tagName)) return
      node.children = node.children.flatMap((child): HastNode[] => {
        if (child.type !== 'text') {
          walk(child)
          return [child]
        }
        return splitTerms((child as HastText).value, glossary, seen).map((p) =>
          typeof p === 'string'
            ? { type: 'text', value: p }
            : {
                type: 'element',
                tagName: 'dfn',
                properties: { dataTerm: p.term.term, dataDefinition: p.term.definition },
                children: [{ type: 'text', value: p.text }],
              },
        )
      })
    }
    walk(tree)
  }
}

/** The current lesson's glossary; Markdown inside it highlights terms. */
export const GlossaryContext = createContext<Glossary | null>(null)
