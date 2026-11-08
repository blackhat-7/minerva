import type { Question } from './lesson'
import type { Attempt } from './Question'

export type TutorQuestion = { question: Question | null; attempt: string; correct: boolean | null }

/** The question the tutor is told the learner is on. A question answered right is done with, so it is left out;
 * one answered wrong is kept with its answer; an unanswered one comes with whatever is typed so far. */
export function tutorQuestion({
  predict,
  check,
  saved,
  draft,
}: {
  predict?: Question | null // a predict question not yet predicted
  check: Question | null
  saved?: Attempt // the answer to `check`
  draft: string
}): TutorQuestion {
  if (predict) return { question: predict, attempt: draft, correct: null }
  if (!check || saved?.correct === true) return { question: null, attempt: '', correct: null }
  if (saved) return { question: check, attempt: saved.answer, correct: false }
  return { question: check, attempt: draft, correct: null }
}
