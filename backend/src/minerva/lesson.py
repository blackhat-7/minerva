"""Lesson format: the contract between the generator, the API and the frontend.

Mirrored by frontend/src/lesson.ts. Change both together.
Fields stay flat (no unions) so small local models can fill them reliably.
"""

import json
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


def _require(*fields: str):
    """Marks fields required in the JSON schema the model sees, while lessons stored before they existed
    (and so lack them) still load with the field's default."""

    def extra(schema: dict) -> None:
        schema["required"] = [*schema.get("required", []), *fields]

    return extra


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


COLORS = ("blue", "pink", "green", "yellow", "purple", "cyan", "gray")  # scene palette; the frontend picks the shades
SPEEDS = ("slow", "medium", "fast")


class Actor(BaseModel):
    """A thing on a scene's stage: an icon (or a plain dot) with a short label, in one cell of the grid.
    Loose types (str, not Literal) so one odd value is fixed by scene.normalize instead of failing the lesson."""

    id: str
    label: str  # 1-3 words
    icon: str = ""  # a name from shared/scene.json icons; "" = a plain dot
    color: str = Field("blue", json_schema_extra={"enum": list(COLORS)})
    col: int = 0  # 0 .. cols-1, left to right
    row: int = 0  # 0 .. rows-1, top to bottom
    value: str = ""  # a short number or word under the label, e.g. "16 GB"
    count: int = 1  # drawn as this many copies (a batch, a queue)
    level: float | None = None  # 0-1: how full, drawn as a meter


class Flow(BaseModel):
    """Something that travels along a path of actors while its step runs."""

    path: list[str]  # actor ids, at least 2
    label: str = ""  # what travels, shown moving with it
    speed: str = Field("medium", json_schema_extra={"enum": list(SPEEDS)})
    color: str = ""  # "" = the color of the path's first actor


class Change(BaseModel):
    """An actor's new value, count or level, from its step on."""

    id: str
    value: str | None = None
    count: int | None = None
    level: float | None = None


class Step(BaseModel):
    """One beat of a scene or a code walkthrough. It starts when the narration reaches the sentence its
    `at` words come from (the frontend maps them to TTS sentences); in Read mode the learner steps by hand."""

    at: str = ""  # a few words copied exactly from the narration sentence where this step starts
    caption: str = ""  # one short line on screen while the step runs
    lines: str = ""  # code: lines to highlight, e.g. "3-5" or "2,7-9"
    show: list[str] = []  # scene: actors that appear (actors no step shows are there from the start)
    hide: list[str] = []  # scene: actors that disappear
    link: list[list[str]] = []  # scene: arrows that appear and stay, each a path of actor ids
    flow: list[Flow] = []  # scene: things travelling during this step
    highlight: list[str] = []  # scene: actors pointed at during this step
    change: list[Change] = []  # scene: new values from this step on


class Visual(BaseModel):
    kind: Literal["widget", "scene", "code", "mermaid", "table", "math", "html", "none"]
    widget: str = ""  # widget: name from shared/widgets
    props: dict = {}  # widget: validated against the widget's props schema
    code: str = ""  # mermaid source, a markdown table, LaTeX, a self-contained HTML document, or code (kind code)
    language: str = ""  # code: one of shared/scene.json languages
    actors: list[Actor] = []  # scene
    steps: list[Step] = []  # scene and code: what changes as the narration goes
    caption: str = ""


class Segment(BaseModel):
    """One 1-3 minute step: predict, watch and listen, act on the visual, check.
    The first segment is the big-picture overview of the whole lesson (or, when the learner lacks a prerequisite,
    a short "what you need first" segment before it)."""

    model_config = ConfigDict(json_schema_extra=_require("text"))

    id: str
    title: str
    one_line: str  # the takeaway in one plain sentence
    predict: Question | None = None  # committed before the explanation is revealed
    text: str = ""  # the segment written for reading (markdown), shown in Read mode; "" in older lessons
    narration: str  # spoken in Learn mode: the same content written for the ear, in the segment's pattern
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


class AnalogyPart(BaseModel):
    familiar: str  # the everyday thing
    real: str  # what it stands for in the topic


class Analogy(BaseModel):
    """One everyday picture for the whole lesson: the narration, scenes and the tutor all reuse it."""

    picture: str  # the scene in 1-3 plain sentences
    parts: list[AnalogyPart]
    limits: str  # where the picture stops matching


class Lesson(BaseModel):
    model_config = ConfigDict(json_schema_extra=_require("analogy"))

    title: str
    summary: str  # "start here": the headline idea with concrete numbers, and what the lesson covers
    analogy: Analogy | None = None  # None in older lessons
    glossary: list[GlossaryTerm]
    segments: list[Segment] = Field(min_length=1)
    problems: list[Question]
    pitfalls: list[Pitfall]
    explain_back: ExplainBack
    cards: list[Card]


_FIELD = re.compile(r'"(title|one_line)"\s*:\s*"((?:[^"\\]|\\.)*)')  # complete or still being written
_PARTS = ("problems", "pitfalls", "explain_back", "cards")


def _unescape(s: str) -> str:
    for whole in (s, s[:-1]):  # the stream may have stopped halfway through an escape
        try:
            return json.loads(f'"{whole}"')
        except ValueError:
            pass
    return s


def draft(text: str) -> dict:
    """What a lesson being written (its JSON so far) already has: the title, each segment's title and one-line
    takeaway, and which later parts have started. Shown while the lesson is built."""
    at = text.find('"segments"')
    title, segments = "", []
    for m in _FIELD.finditer(text):
        value = _unescape(m[2])
        if at < 0 or m.start() < at:
            if m[1] == "title":
                title = value
        elif m[1] == "title":
            segments.append({"title": value, "one_line": ""})
        elif segments:
            segments[-1]["one_line"] = value
    parts = [p for p in _PARTS if at >= 0 and f'"{p}"' in text[at:]]
    return {"title": title, "segments": segments, "parts": parts}
