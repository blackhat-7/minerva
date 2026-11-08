import asyncio
import json
import threading
import time

import pytest
from fastapi.testclient import TestClient

from minerva import app, widgets
from minerva.app import create_app
from minerva.config import Config
from minerva.llm import LLM

ROOFLINE = {
    "name": "roofline",
    "description": "Roofline chart.",
    "props": {
        "type": "object",
        "properties": {"gpu": {"type": "string", "enum": ["H100", "A100"]}, "batch": {"type": "integer", "minimum": 1}},
    },
    "example": {"gpu": "H100", "batch": 1},
}


def choice(**kw) -> dict:
    return {"kind": "choice", "prompt": "Which?", "options": ["memory", "compute"], "correct": 0,
            "explanation": "Because.", **kw}


def lesson_json(props: dict | None = None) -> str:
    segment = {"title": "", "one_line": "", "text": "Words.", "narration": "Words.", "key_points": ["k"], "task": "", "predict": None,
               "check": None}
    return json.dumps({
        "title": "Rooflines",
        "summary": "Decode is memory-bound.",
        "analogy": {"picture": "A kitchen.", "parts": [{"familiar": "cook", "real": "GPU"}], "limits": "No queues."},
        "glossary": [{"term": "HBM", "definition": "High-bandwidth memory."},
                     {"term": "roofline", "definition": "A chart."}],
        "segments": [
            {**segment, "id": "x", "title": "Overview", "visual": {"kind": "mermaid", "code": "flowchart LR\nA-->B"}},
            {**segment, "id": "x", "title": "Decode", "predict": choice(), "task": "Raise batch.",
             "visual": {"kind": "widget", "widget": "roofline", "props": props or {"gpu": "H100", "batch": 1}}},
        ],
        "problems": [{"kind": "numeric", "prompt": "Estimate", "value": 20, "unit": "ms", "tolerance": 2,
                      "explanation": "140 GB / 4.8 TB/s.", "hints": ["a", "b", "c"]}],
        "pitfalls": [{"trap": "More GPUs always help", "why": "Communication."}],
        "explain_back": {"prompt": "Explain decode.", "rubric": ["weights streamed once per step"]},
        "cards": [{"front": "Why memory-bound?", "back": "Intensity ~1."},
                  {"front": "Ridge of H100?", "back": "~295 FLOP/B."}],
    })


class FakeLLM:
    """Replaces the provider calls: replies are popped in order; calls are recorded."""

    def __init__(self):
        self.replies: list = []  # str, or an Exception to raise
        self.chunks: list = []  # stream events (a str is a text delta), or an Exception to raise mid-stream
        self.events: list[dict] = []  # thinking and tool events sent on every JSON call
        self.gate: threading.Event | None = None  # JSON calls wait for it to be set
        self.calls: list[dict] = []

    async def json(self, p, system, messages, schema, effort, on_event):
        self.calls.append({"provider": p.name, "system": system, "messages": [dict(m) for m in messages],
                           "effort": effort})
        for event in self.events:
            on_event(event)
        while self.gate and not self.gate.is_set():
            await asyncio.sleep(0.01)
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply

    async def stream(self, p, system, messages, effort):
        self.calls.append({"provider": p.name, "system": system, "messages": messages, "effort": effort})
        for chunk in self.chunks:
            if isinstance(chunk, Exception):
                raise chunk
            yield {"delta": chunk} if isinstance(chunk, str) else chunk


@pytest.fixture
def config() -> Config:
    return Config.model_validate({
        "providers": [
            {"name": "a", "kind": "openai", "base_url": "http://127.0.0.1:9/v1", "model": "m"},
            {"name": "b", "kind": "openai", "base_url": "http://127.0.0.1:9/v1", "model": "m"},
        ],
        "roles": {"lesson": ["a", "b"], "tutor": ["a"]},
        "profiles": {"me": {"name": "Me", "about": "Runs an RX 7900 XTX."}},
    })


@pytest.fixture
def fake(monkeypatch) -> FakeLLM:
    f = FakeLLM()
    monkeypatch.setattr(LLM, "_openai_json", f.json)
    monkeypatch.setattr(LLM, "_stream", f.stream)

    async def search(query, cfg):
        return f"Search results for {query}."
    monkeypatch.setattr(app, "web_search", search)
    return f


@pytest.fixture
def client(config, fake, tmp_path, monkeypatch):
    catalog = tmp_path / "widgets"
    catalog.mkdir()
    (catalog / "roofline.json").write_text(json.dumps(ROOFLINE))
    monkeypatch.setattr(widgets, "CATALOG_DIR", catalog)
    with TestClient(create_app(config, tmp_path / "data")) as c:
        yield c


def wait_for(client: TestClient, lesson_id: str) -> dict:
    for _ in range(200):
        record = client.get(f"/api/lessons/{lesson_id}").json()
        if record["status"] != "generating":
            return record
        time.sleep(0.01)
    raise AssertionError("generation did not finish")
