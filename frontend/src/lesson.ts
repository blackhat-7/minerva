// Lesson format. Mirrors backend/src/minerva/lesson.py. Change both together.

export type GlossaryTerm = { term: string; definition: string }

export type Question = {
  kind: 'choice' | 'numeric' | 'free'
  prompt: string
  options: string[]
  correct: number | null
  value: number | null
  unit: string
  tolerance: number
  reference: string
  explanation: string
  hints: string[]
}

export type Visual = {
  kind: 'widget' | 'mermaid' | 'table' | 'math' | 'html' | 'none'
  widget: string
  props: Record<string, unknown>
  code: string
  caption: string
}

export type Segment = {
  id: string
  title: string
  one_line: string
  predict: Question | null
  narration: string
  key_points: string[]
  visual: Visual
  task: string
  check: Question | null
}

export type ExplainBack = { prompt: string; rubric: string[] }

export type Pitfall = { trap: string; why: string }

export type Card = { front: string; back: string }

export type Diagnostic = { questions: Question[] }

export type Lesson = {
  title: string
  summary: string
  glossary: GlossaryTerm[]
  segments: Segment[]
  problems: Question[]
  pitfalls: Pitfall[]
  explain_back: ExplainBack
  cards: Card[]
}
