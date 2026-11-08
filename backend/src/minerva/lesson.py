"""Lesson format: the contract between the generator, the API and the frontend.

Mirrored by frontend/src/lesson.ts. Change both together.
Fields stay flat (no unions) so small local models can fill them reliably.
"""

from typing import Literal

from pydantic import BaseModel, Field, model_validator


class GlossaryTerm(BaseModel):
    term: str  # as written in the lesson, e.g. "GDN" or "PagedAttention"
    definition: str  # plain words; abbreviations spelled out


class Question(BaseModel):
    """A question the learner answers. Choice and numeric are graded in the browser, free by the LLM."""

    kind: Literal["choice", "numeric", "free"]
    prompt: str  # markdown, $math$ allowed
    options: list[str] = []  # choice
    correct: int | None = None  # choice: index into options
    value: float | None = None  # numeric: reference answer
    unit: str = ""  # numeric
    tolerance: float = 2.0  # numeric: accepted if within this factor of value
    reference: str = ""  # free: model answer used for grading
    explanation: str  # shown after answering
    hints: list[str] = []  # graduated, most subtle first

    @model_validator(mode="after")
    def _check_kind(self) -> "Question":
        if self.kind == "choice":
            if len(self.options) < 2 or self.correct is None or not 0 <= self.correct < len(self.options):
                raise ValueError("choice needs >= 2 options and a valid correct index")
        elif self.kind == "numeric":
            if self.value is None or self.value == 0 or self.tolerance < 1:
                raise ValueError("numeric needs a non-zero value and tolerance >= 1")
        elif not self.reference:
            raise ValueError("free needs a reference answer")
        return self


class Visual(BaseModel):
    kind: Literal["widget", "mermaid", "table", "math", "html", "none"]
    widget: str = ""  # widget: name from shared/widgets
    props: dict = {}  # widget: validated against the widget's props schema
    code: str = ""  # mermaid source, a markdown table, LaTeX, or a self-contained HTML document
    caption: str = ""


class Segment(BaseModel):
    """One 1-3 minute step: predict, watch and listen, act on the visual, check.
    The first segment is the big-picture overview of the whole lesson."""

    id: str
    title: str
    one_line: str  # the takeaway in one plain sentence
    predict: Question | None = None  # committed before the explanation is revealed
    narration: str  # spoken in the player, read in Read mode: problem -> mechanism -> why it works -> result
    key_points: list[str]  # short on-screen labels
    visual: Visual
    task: str = ""  # what to do with the visual, e.g. "find the batch size where decode becomes compute-bound"
    check: Question | None = None


class ExplainBack(BaseModel):
    prompt: str
    rubric: list[str]  # cause-and-effect links a good explanation must contain


class Pitfall(BaseModel):
    trap: str  # a common wrong belief or approach
    why: str  # why it fails, with the mechanism


class Card(BaseModel):
    front: str
    back: str


class SegmentEdit(BaseModel):
    """A learner-requested change to one segment: its replacement, optionally followed by one new segment."""

    segments: list[Segment] = Field(min_length=1, max_length=2)
    glossary: list[GlossaryTerm] = []  # terms the new text uses that the lesson's glossary lacks


class Diagnostic(BaseModel):
    questions: list[Question] = Field(min_length=1, max_length=5)


class Lesson(BaseModel):
    title: str
    summary: str  # "start here": the headline idea with concrete numbers, and what the lesson covers
    glossary: list[GlossaryTerm]
    segments: list[Segment] = Field(min_length=1)
    problems: list[Question]
    pitfalls: list[Pitfall]
    explain_back: ExplainBack
    cards: list[Card]
