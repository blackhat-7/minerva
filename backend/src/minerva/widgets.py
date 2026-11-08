"""Widget catalog (shared/widgets/*.json) and validation of generated lessons against it."""

import json
import logging

import jsonschema

from .config import REPO, Provider
from .lesson import Lesson, Segment

CATALOG_DIR = REPO / "shared" / "widgets"

log = logging.getLogger(__name__)


def load_catalog() -> dict[str, dict]:
    """name -> {name, description, props, example}. Read on every call so new widgets show up live."""
    catalog = {}
    for path in sorted(CATALOG_DIR.glob("*.json")):
        try:
            entry = json.loads(path.read_text())
            catalog[entry["name"]] = entry
        except (json.JSONDecodeError, KeyError) as e:
            log.warning("skipping bad widget catalog file %s: %s", path, e)
    return catalog


def check_lesson(lesson: Lesson, provider: Provider, catalog: dict[str, dict]) -> list[str]:
    """Problems in the lesson's visuals, as messages for the model. Normalizes as it goes:
    segment ids become s1..sN and widget props lose keys the schema doesn't define."""
    for i, seg in enumerate(lesson.segments):
        seg.id = f"s{i + 1}"
    return check_segments(lesson.segments, provider, catalog)


def check_segments(segments: list[Segment], provider: Provider, catalog: dict[str, dict]) -> list[str]:
    """Problems in the segments' visuals (see check_lesson); strips unknown widget props."""
    problems = []
    for i, seg in enumerate(segments):
        v = seg.visual
        where = f"segments[{i}].visual"
        if v.kind == "widget":
            entry = catalog.get(v.widget)
            if entry is None:
                problems.append(f"{where}: unknown widget {v.widget!r}; use one of {sorted(catalog)} or another kind")
                continue
            known = entry["props"].get("properties", {})
            v.props = {k: val for k, val in v.props.items() if k in known}
            for err in jsonschema.Draft202012Validator(entry["props"]).iter_errors(v.props):
                path = "".join(f"[{p!r}]" for p in err.absolute_path)
                problems.append(f"{where}.props{path}: {err.message}")
        elif v.kind == "html" and not provider.html:
            problems.append(f"{where}: kind 'html' is not allowed; use a widget, mermaid or math")
        elif v.kind in ("mermaid", "table", "math", "html") and not v.code.strip():
            problems.append(f"{where}: kind {v.kind!r} needs code")
    return problems
