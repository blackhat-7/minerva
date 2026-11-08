"""Scene and code visuals: the stage spec (shared/scene.json) the lesson model picks from, and the
normalization of what it wrote, so one odd value is fixed in place instead of failing a whole lesson."""

import difflib
import json
import re

from .config import REPO
from .lesson import COLORS, SPEEDS, Step, Visual

SPEC = json.loads((REPO / "shared" / "scene.json").read_text())
COLS: int = SPEC["cols"]
ROWS: int = SPEC["rows"]
ICONS: list[str] = SPEC["icons"]
LANGUAGES: list[str] = SPEC["languages"]

LANGUAGE_ALIASES = {
    "sh": "bash", "shell": "bash", "console": "bash", "zsh": "bash", "terminal": "bash", "py": "python",
    "js": "javascript", "jsx": "javascript", "node": "javascript", "ts": "typescript", "tsx": "typescript",
    "yml": "yaml", "c++": "cpp", "cs": "csharp", "c#": "csharp", "kt": "kotlin", "golang": "go",
    "docker": "dockerfile", "text": "plaintext", "txt": "plaintext", "": "plaintext",
}
PUNCTUATION = re.compile(r"[^\w\s]")
LINES = re.compile(r"(\d+)\s*(?:[-–—]\s*(\d+))?")


def normalize(visual: Visual, narration: str) -> list[str]:
    """Fixes a scene or code visual in place and returns the problems that are not worth fixing silently
    (the model rewrites the lesson for those). Other kinds lose the scene and code fields.

    A step's `at` is a few words from the narration; the frontend starts the step when the voice reaches the
    sentence containing them. Both strings are normalized the same way before matching (scene.ts `normalize`
    does the same): lowercase, every character that isn't a letter, digit, underscore or space turned into a
    space, runs of whitespace to one space. So a comma the model dropped doesn't lose the step. `at` is replaced
    by its normalized form, or by "" when it is not found in the narration at or after the previous step's
    match. Steps left with nothing to show are dropped before matching."""
    if visual.kind != "scene":
        visual.actors = []
    if visual.kind != "code":
        visual.language = ""
    if visual.kind not in ("scene", "code"):
        visual.steps = []
        return []
    problems = _scene(visual) if visual.kind == "scene" else _code(visual)
    keep = _has_scene_content if visual.kind == "scene" else (lambda s: s.caption.strip() or s.lines)
    visual.steps = [s for s in visual.steps if keep(s)]
    _align(visual, _words(narration))
    return problems


def _words(text: str) -> str:
    return " ".join(PUNCTUATION.sub(" ", text.lower()).split())


def _align(visual: Visual, narration: str) -> None:
    pos = 0
    for step in visual.steps:
        step.at = _words(step.at)
        found = narration.find(step.at, pos) if step.at else -1
        if found < 0:
            step.at = ""
        else:
            pos = found


def _has_scene_content(step: Step) -> bool:
    return bool(step.caption.strip() or step.show or step.hide or step.link or step.flow or step.highlight
                or step.change)


def _count(n: int | None) -> int | None:
    return None if n is None else max(1, min(12, n))


def _level(x: float | None) -> float | None:
    return None if x is None else max(0.0, min(1.0, x))


def _scene(v: Visual) -> list[str]:
    problems = []
    if not v.actors:
        problems.append("a scene needs actors")
    if len(v.actors) > COLS * ROWS:
        problems.append(f"a scene holds at most {COLS * ROWS} actors ({COLS} columns x {ROWS} rows)")
    ids = [a.id for a in v.actors]
    if dupes := sorted({i for i in ids if ids.count(i) > 1}):
        problems.append(f"duplicate actor ids: {dupes}")
    if any(not a.label.strip() for a in v.actors):
        problems.append("every actor needs a label")

    free = {(r, c) for r in range(ROWS) for c in range(COLS)}
    for a in v.actors:
        want = (max(0, min(ROWS - 1, a.row)), max(0, min(COLS - 1, a.col)))
        if free:
            a.row, a.col = min(free, key=lambda cell: (abs(cell[0] - want[0]) + abs(cell[1] - want[1]), *cell))
            free.remove((a.row, a.col))
        a.icon = _icon(a.icon)
        a.color = a.color if a.color in COLORS else "blue"
        a.count, a.level = _count(a.count), _level(a.level)

    known = set(ids)

    def only_known(path: list[str]) -> list[str]:
        return [i for i in path if i in known]

    for s in v.steps:
        s.lines = ""
        s.show, s.hide, s.highlight = only_known(s.show), only_known(s.hide), only_known(s.highlight)
        s.link = [p for p in map(only_known, s.link) if len(p) > 1]
        for f in s.flow:
            f.path = only_known(f.path)
            f.speed = f.speed if f.speed in SPEEDS else "medium"
            f.color = f.color if f.color in COLORS else ""
        s.flow = [f for f in s.flow if len(f.path) > 1]
        s.change = [c for c in s.change if c.id in known]
        for c in s.change:
            c.count, c.level = _count(c.count), _level(c.level)
    return problems


def _icon(name: str) -> str:
    name = name.strip().lower()
    if name in ICONS:
        return name
    return next(iter(difflib.get_close_matches(name, ICONS, n=1, cutoff=0.8)), "")


def _code(v: Visual) -> list[str]:
    language = v.language.strip().lower()
    language = LANGUAGE_ALIASES.get(language, language)
    v.language = language if language in LANGUAGES else "plaintext"
    total = len(v.code.splitlines())
    for s in v.steps:
        s.lines = _lines(s.lines, total)
        s.show, s.hide, s.link, s.flow, s.highlight, s.change = [], [], [], [], [], []
    return [] if v.code.strip() else ["a code visual needs code"]


def _lines(spec: str, total: int) -> str:
    """The parts of a spec like "2,7-9" that lie within 1..total, written "a" or "a-b". A range may have spaces,
    an en or em dash, or its ends swapped (as the frontend's lineRanges accepts)."""
    kept = []
    for token in spec.split(","):
        m = LINES.fullmatch(token.strip())
        if not m:
            continue
        first, last = sorted((int(m[1]), int(m[2] or m[1])))
        if first < 1 or first > total:
            continue
        last = min(last, total)
        kept.append(f"{first}-{last}" if last > first else str(first))
    return ",".join(kept)
