import { describe, expect, it } from 'vitest'
import type { Question } from './lesson'
import { tutorQuestion } from './tutorQuestion'

const q = (prompt: string): Question => ({
  kind: 'free',
  prompt,
  options: [],
  correct: null,
  value: null,
  unit: '',
  tolerance: 0,
  reference: '',
  explanation: '',
  hints: [],
})
const predict = q('predict')
const check = q('check')

describe('tutorQuestion', () => {
  it('asks about a predict question not yet predicted, with the draft', () => {
    expect(tutorQuestion({ predict, check, draft: 'maybe 3' })).toEqual({ question: predict, attempt: 'maybe 3', correct: null })
  })

  it('has no question when there is none', () => {
    expect(tutorQuestion({ check: null, draft: 'x' })).toEqual({ question: null, attempt: '', correct: null })
  })

  it('drops a check answered right', () => {
    const saved = { answer: '3.6x', correct: true, feedback: '' }
    expect(tutorQuestion({ check, saved, draft: 'x' })).toEqual({ question: null, attempt: '', correct: null })
  })

  it('keeps a check answered wrong, with the saved answer', () => {
    const saved = { answer: '2x', correct: false, feedback: '' }
    expect(tutorQuestion({ check, saved, draft: 'x' })).toEqual({ question: check, attempt: '2x', correct: false })
  })

  it('keeps "don\'t know" as wrong', () => {
    const saved = { answer: '', correct: false, feedback: '' }
    expect(tutorQuestion({ check, saved, draft: '' })).toEqual({ question: check, attempt: '', correct: false })
  })

  it('uses the draft for a check not answered yet', () => {
    expect(tutorQuestion({ check, draft: 'half' })).toEqual({ question: check, attempt: 'half', correct: null })
  })
})
