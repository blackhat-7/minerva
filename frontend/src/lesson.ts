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

/** Scene palette names; the frontend picks the shades. */
export type Color = 'blue' | 'pink' | 'green' | 'yellow' | 'purple' | 'cyan' | 'gray'

/** A thing on a scene's stage: an icon (or a plain dot, icon "") with a short label, in one grid cell
 * (shared/scene.json has the grid size and the icon names). */
export type Actor = {
  id: string
  label: string
  icon: string
  color: Color
  col: number
  row: number
  value: string // short text under the label, e.g. "16 GB"
  count: number // drawn as this many copies
  level: number | null // 0-1 meter: how full
}

/** Something that travels along a path of actors while its step runs. color "" = the first actor's. */
export type Flow = { path: string[]; label: string; speed: 'slow' | 'medium' | 'fast'; color: Color | '' }

/** An actor's new value, count or level, from its step on. */
export type Change = { id: string; value: string | null; count: number | null; level: number | null }

/** One beat of a scene or code walkthrough. It starts when the narration reaches the sentence its `at` words
 * come from ("" = right after the previous step); in Read mode the learner steps by hand. */
export type Step = {
  at: string
  caption: string
  lines: string // code: lines to highlight, e.g. "3-5" or "2,7-9"
  show: string[]
  hide: string[]
  link: string[][] // arrows that appear and stay, each a path of actor ids
  flow: Flow[] // only while the step runs
  highlight: string[] // only while the step runs
  change: Change[]
}

export type Visual = {
  kind: 'widget' | 'scene' | 'code' | 'mermaid' | 'table' | 'math' | 'html' | 'none'
  widget: string
  props: Record<string, unknown>
  code: string
  language?: string // code; missing in lessons made before scene and code visuals
  actors?: Actor[] // scene
  steps?: Step[] // scene and code
  caption: string
}

export type Segment = {
  id: string
  title: string
  one_line: string
  predict: Question | null
  text?: string // the segment written for reading (markdown); missing or "" in older lessons: show the narration
  narration: string
  key_points: string[]
  visual: Visual
  task: string
  check: Question | null
}

/** One everyday picture for the whole lesson; the narration, scenes and tutor reuse it. */
export type Analogy = { picture: string; parts: { familiar: string; real: string }[]; limits: string }

export type ExplainBack = { prompt: string; rubric: string[] }

export type Pitfall = { trap: string; why: string }

export type Card = { front: string; back: string }

export type Diagnostic = { questions: Question[] }

export type Lesson = {
  title: string
  summary: string
  analogy?: Analogy | null // missing or null in older lessons
  glossary: GlossaryTerm[]
  segments: Segment[]
  problems: Question[]
  pitfalls: Pitfall[]
  explain_back: ExplainBack
  cards: Card[]
}
