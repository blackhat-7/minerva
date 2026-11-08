import json
import sqlite3
import threading
import time
from datetime import datetime

import pytest

from conftest import choice, lesson_json, wait_for

from fastapi.testclient import TestClient

from minerva.app import create_app
from minerva.config import Config, Speech
from minerva.llm import LLMError
from minerva.store import Store


def diagnostic_json() -> str:
    free = {"kind": "free", "prompt": "Why?", "reference": "Bytes dominate.", "explanation": "e"}
    return json.dumps({"questions": [choice(), free]})


def new_lesson(client, fake) -> dict:
    fake.replies.append(diagnostic_json())
    r = client.post("/api/lessons", json={"topic": "Rooflines"})
    assert r.status_code == 200, r.text
    return r.json()


def ready_lesson(client, fake) -> str:
    record = new_lesson(client, fake)
    fake.replies.append(lesson_json())
    client.post(f"/api/lessons/{record['id']}/generate", json={"answers": []})
    assert wait_for(client, record["id"])["status"] == "ready"
    return record["id"]


def test_lesson_flow(client, fake):
    record = new_lesson(client, fake)
    assert record["status"] == "diagnostic"
    assert len(record["diagnostic"]["questions"]) == 2
    assert "RX 7900 XTX" in fake.calls[0]["messages"][0]["content"]  # learner context reaches the prompt

    fake.replies += ['```json\n{"profile": "Knows HBM; shaky on ridge points."}\n```', lesson_json()]
    r = client.post(f"/api/lessons/{record['id']}/generate", json={"answers": ["memory", ""]})
    assert r.status_code == 202 and r.json()["status"] == "generating"

    done = wait_for(client, record["id"])
    assert done["status"] == "ready", done["error"]
    assert done["provider"] == "a"
    assert [s["id"] for s in done["lesson"]["segments"]] == ["s1", "s2"]
    profile_prompt, lesson_prompt = fake.calls[1]["messages"][0]["content"], fake.calls[2]["messages"][0]["content"]
    assert "(left empty: does not know)" in profile_prompt
    assert "shaky on ridge points" in lesson_prompt
    assert "<sources>\nSearch results for Rooflines.\n</sources>" in lesson_prompt
    assert "roofline" in fake.calls[2]["system"]  # widget catalog in the lesson prompt
    assert client.get("/api/lessons").json()[0]["title"] == "Rooflines"


def test_generate_needs_one_answer_per_question(client, fake):
    record = new_lesson(client, fake)
    r = client.post(f"/api/lessons/{record['id']}/generate", json={"answers": ["only one"]})
    assert r.status_code == 422


def test_widget_props_are_validated_and_retried(client, fake):
    record = new_lesson(client, fake)
    fake.replies += [lesson_json({"gpu": "TPU", "batch": 4, "junk": 1}), lesson_json({"gpu": "H100", "batch": 4, "junk": 1})]
    client.post(f"/api/lessons/{record['id']}/generate", json={"answers": []})

    done = wait_for(client, record["id"])
    assert done["status"] == "ready", done["error"]
    assert done["lesson"]["segments"][1]["visual"]["props"] == {"gpu": "H100", "batch": 4}  # unknown key stripped
    feedback = fake.calls[-1]["messages"][-1]["content"]
    assert "segments[1].visual.props['gpu']" in feedback and "'TPU' is not one of" in feedback
    assert "junk" not in feedback


def test_generation_fails_after_one_retry(client, fake):
    record = new_lesson(client, fake)
    fake.replies += ["no json here", '{"title": "missing fields"}']
    client.post(f"/api/lessons/{record['id']}/generate", json={"answers": []})

    done = wait_for(client, record["id"])
    assert done["status"] == "failed"
    assert "invalid output twice" in done["error"]


def test_cards_review_round_trip(client, fake):
    lesson_id = ready_lesson(client, fake)
    assert client.post(f"/api/lessons/{lesson_id}/complete").status_code == 204
    assert client.post(f"/api/lessons/{lesson_id}/complete").status_code == 204  # second call adds nothing
    client.post("/api/cards", json={"front": "Missed question", "back": "Answer"})

    due = client.get("/api/cards/due").json()
    assert len(due) == 3
    assert {c["topic"] for c in due} == {"Rooflines", ""}

    r = client.post(f"/api/cards/{due[0]['id']}/review", json={"rating": 3})
    assert datetime.fromisoformat(r.json()["due"]) > datetime.now().astimezone()
    assert len(client.get("/api/cards/due").json()) == 2
    assert client.post(f"/api/cards/{due[0]['id']}/review", json={"rating": 5}).status_code == 422
    assert client.get("/api/status").json()["due"] == 2


def test_due_cards_interleave_topics(client):
    store = client.app.state.store
    for topic in ["A", "A", "A", "B", "B"]:
        store.add_card("me", None, topic, "front", "back")
    assert [c["topic"] for c in store.due_cards("me", 10)] == ["A", "B", "A", "B", "A"]
    assert len(store.due_cards("me", 2)) == 2


def test_grade_free_answer(client, fake):
    lesson_id = ready_lesson(client, fake)
    fake.replies.append('{"correct": false, "feedback": "You missed why bytes dominate."}')
    free = {"kind": "free", "prompt": "Why?", "reference": "Weights are read once per step.", "explanation": "e"}
    r = client.post("/api/grade", json={"lesson_id": lesson_id, "question": free, "answer": "it is slow"})
    assert r.json() == {"correct": False, "feedback": "You missed why bytes dominate."}
    assert "Weights are read once per step." in fake.calls[-1]["messages"][0]["content"]

    r = client.post("/api/grade", json={"lesson_id": lesson_id, "question": choice(), "answer": "x"})
    assert r.status_code == 400


def test_generation_shows_its_steps_while_running(client, fake):
    record = new_lesson(client, fake)
    fake.gate = threading.Event()
    fake.events = [{"thinking": "Start with "}, {"thinking": "bytes."}, {"tool": {"name": "WebFetch", "detail": "u"}},
                   {"writing": True}, {"output": '{"title": "Roofl'}, {"output": 'ines", "segments": [{"title": "Ov'}]
    fake.replies.append(lesson_json())
    client.post(f"/api/lessons/{record['id']}/generate", json={"answers": []})
    for _ in range(200):
        live = client.get(f"/api/lessons/{record['id']}").json()
        if live.get("draft", {}).get("segments"):
            break
        time.sleep(0.01)
    assert live["activity"] == [
        {"kind": "tool", "name": "WebSearch", "detail": "Rooflines"},
        {"kind": "thinking", "text": "Start with bytes."},
        {"kind": "tool", "name": "WebFetch", "detail": "u"},
        {"kind": "tool", "name": "Write", "detail": "Lesson"},
    ]
    assert live["draft"] == {"title": "Rooflines", "segments": [{"title": "Ov", "one_line": ""}], "parts": []}
    fake.gate.set()
    done = wait_for(client, record["id"])
    assert done["status"] == "ready" and "activity" not in done and "draft" not in done


def sse(text: str) -> list[dict]:
    return [json.loads(line.removeprefix("data: ")) for line in text.splitlines() if line.startswith("data: ")]


def test_tutor_streams_sse(client, fake):
    lesson_id = ready_lesson(client, fake)
    fake.chunks = [{"thinking": "hmm"}, {"tool": {"name": "WebSearch", "detail": "H100"}}, "Think about ", "bytes."]
    body = {
        "lesson_id": lesson_id,
        "segment_id": "s2",
        "context": {"widget_state": {"batch": 8}, "question": choice(), "attempt": "",
                    "narration_heard": "Decode reads every weight once."},
        "messages": [{"role": "user", "content": "is it compute bound?"}],
        "voice": True,
    }
    r = client.post("/api/tutor", json=body)
    assert r.headers["content-type"].startswith("text/event-stream")
    assert sse(r.text) == [{"thinking": "hmm"}, {"tool": {"name": "WebSearch", "detail": "H100"}},
                           {"delta": "Think about "}, {"delta": "bytes."}, {"done": True}]

    call = fake.calls[-1]
    assert "HBM: High-bandwidth memory." in call["system"]
    last = call["messages"][-1]["content"]
    assert '{"batch": 8}' in last and "haven't answered it yet" in last and "spoken aloud" in last
    assert "heard only this much of it: 'Decode reads every weight once.'" in last
    assert last.endswith("is it compute bound?")


def test_tutor_reports_errors_in_stream(client, fake):
    lesson_id = ready_lesson(client, fake)
    fake.chunks = ["Partial", LLMError("boom")]
    r = client.post("/api/tutor", json={"lesson_id": lesson_id, "messages": [{"role": "user", "content": "hi"}]})
    assert sse(r.text) == [{"delta": "Partial"}, {"error": "boom"}]


def test_drill_needs_a_topic_or_a_studied_lesson(client, fake):
    assert client.post("/api/drill", json={}).status_code == 400
    fake.replies.append(json.dumps({"kind": "numeric", "prompt": "Estimate", "value": 3, "unit": "ms",
                                    "explanation": "e", "hints": ["a", "b", "c"]}))
    r = client.post("/api/drill", json={"topic": "NCCL all-reduce"})
    assert r.json()["kind"] == "numeric"


def test_voice_unconfigured_is_503(client):
    assert client.post("/api/tts", json={"text": "hi"}).status_code == 503
    assert client.post("/api/stt", files={"audio": ("a.webm", b"x", "audio/webm")}).status_code == 503


def test_settings_show_config_without_secrets(client):
    s = client.get("/api/settings").json()
    assert [p["name"] for p in s["providers"]] == ["a", "b"]
    assert s["providers"][0]["base_url"] == "http://127.0.0.1:9/v1" and "api_key_env" not in s["providers"][0]
    assert s["roles"] == {"lesson": ["a", "b"], "tutor": ["a"]}
    assert s["learner"] == "Runs an RX 7900 XTX." and s["tts"] is None


def test_tutor_uses_the_chosen_provider(client, fake):
    lesson_id = ready_lesson(client, fake)
    fake.chunks = ["ok"]
    body = {"lesson_id": lesson_id, "messages": [{"role": "user", "content": "hi"}], "provider": "b"}
    client.post("/api/tutor", json=body)
    assert fake.calls[-1]["provider"] == "b"
    assert client.post("/api/tutor", json={**body, "provider": "nope"}).status_code == 400


def test_thinking_setting_applies_per_role_and_persists(client, fake, config, tmp_path):
    lesson_id = ready_lesson(client, fake)
    assert client.put("/api/settings/thinking", json={"role": "tutor", "effort": "medium"}).status_code == 204
    fake.chunks = ["ok"]
    client.post("/api/tutor", json={"lesson_id": lesson_id, "messages": [{"role": "user", "content": "hi"}]})
    assert fake.calls[-1]["effort"] == "medium"
    assert client.get("/api/settings").json()["thinking"] == {"tutor": "medium"}

    with TestClient(create_app(config, tmp_path / "data")) as again:  # survives a restart
        assert again.get("/api/settings").json()["thinking"] == {"tutor": "medium"}
    client.put("/api/settings/thinking", json={"role": "tutor", "effort": ""})
    assert client.get("/api/settings").json()["thinking"] == {}
    assert client.put("/api/settings/thinking", json={"role": "tutor", "effort": "huge"}).status_code == 422


def test_edit_segment_revises_and_inserts(client, fake):
    lesson_id = ready_lesson(client, fake)
    seg = {"title": "", "one_line": "", "text": "Words.", "narration": "Words.", "key_points": ["k"], "task": "", "predict": None,
           "check": None, "id": "ignored"}
    revised = {**seg, "title": "Overview, revised", "visual": {"kind": "mermaid", "code": "flowchart LR\nA-->B"}}
    bad = {**seg, "title": "Inside a layer", "visual": {"kind": "widget", "widget": "nope"}}
    good = {**bad, "visual": {"kind": "table", "code": "| a |\n|---|\n| 1 |"}}
    glossary = [{"term": "hbm", "definition": "dup"}, {"term": "FFN", "definition": "Feed-forward network."}]
    fake.replies += [json.dumps({"segments": [revised, bad]}), json.dumps({"segments": [revised, good], "glossary": glossary})]

    r = client.post(f"/api/lessons/{lesson_id}/segments/s1/edit", json={"instruction": "Add a layer diagram"})
    assert r.status_code == 200, r.text
    lesson = r.json()["lesson"]
    assert [(s["id"], s["title"]) for s in lesson["segments"]] == [
        ("s1", "Overview, revised"), ("s3", "Inside a layer"), ("s2", "Decode")]
    assert [g["term"] for g in lesson["glossary"]] == ["HBM", "roofline", "FFN"]
    assert "unknown widget 'nope'" in fake.calls[-1]["messages"][-1]["content"]  # validated and retried
    assert "Add a layer diagram" in fake.calls[-2]["messages"][0]["content"]
    assert "The next segment (s2, Decode)" in fake.calls[-2]["messages"][0]["content"]

    r = client.post(f"/api/lessons/{lesson_id}/segments/zz/edit", json={"instruction": "x"})
    assert r.status_code == 404


def test_claude_model_setting(client):
    assert client.put("/api/settings/claude_model", json={"role": "lesson", "model": "claude-opus-5-5"}).status_code == 204
    s = client.get("/api/settings").json()
    assert s["claude_models"] == {"lesson": "claude-opus-5-5"} and "claude-haiku-5-5" in s["claude_model_options"]
    assert client.put("/api/settings/claude_model", json={"role": "lesson", "model": "gpt-9"}).status_code == 422
    client.put("/api/settings/claude_model", json={"role": "lesson", "model": ""})
    assert client.get("/api/settings").json()["claude_models"] == {}


def test_tts_voice_must_be_offered(config, fake, tmp_path):
    tts = {"base_url": "http://127.0.0.1:9/v1", "model": "kokoro", "voice": "af_heart",
           "voices": {"af_heart": "Heart", "am_michael": "Michael"}}
    voiced = config.model_copy(update={"tts": Speech.model_validate(tts)})
    with TestClient(create_app(voiced, tmp_path / "data")) as c:
        assert c.get("/api/settings").json()["tts"]["voices"] == tts["voices"]
        assert c.post("/api/tts", json={"text": "hi", "voice": "bf_emma"}).status_code == 422
        assert c.post("/api/tts", json={"text": "hi", "voice": "am_michael"}).status_code == 503  # offered; server down
    with pytest.raises(ValueError, match="must include the default voice"):
        Config.model_validate({**config.model_dump(), "tts": {**tts, "voice": "bf_emma"}})


def test_segment_text_and_analogy_are_required(client, fake):
    record = new_lesson(client, fake)
    bare = json.loads(lesson_json())
    bare["analogy"] = None
    bare["segments"][0]["text"] = " "
    fake.replies += [json.dumps(bare), lesson_json()]
    client.post(f"/api/lessons/{record['id']}/generate", json={"answers": []})
    assert wait_for(client, record["id"])["status"] == "ready"
    retry = fake.calls[-1]["messages"][-1]["content"]
    assert "segments[0].text: write the segment for reading" in retry and "analogy" in retry


def test_broken_visual_is_reported_with_its_segment(client, fake):
    record = new_lesson(client, fake)
    bad = json.loads(lesson_json())
    bad["segments"][0]["visual"] = {"kind": "scene", "actors": []}
    fake.replies += [json.dumps(bad), lesson_json()]
    client.post(f"/api/lessons/{record['id']}/generate", json={"answers": []})
    wait_for(client, record["id"])
    assert "segments[0].visual: a scene needs actors" in fake.calls[-1]["messages"][-1]["content"]


def test_learner_profile_is_saved_and_reaches_the_tutor_and_edits(client, fake):
    record = new_lesson(client, fake)
    fake.replies += ['{"profile": "Knows HBM; shaky on ridge points."}', lesson_json()]
    client.post(f"/api/lessons/{record['id']}/generate", json={"answers": ["memory", ""]})
    assert wait_for(client, record["id"])["learner"] == "Knows HBM; shaky on ridge points."

    fake.chunks = ["ok"]
    client.post("/api/tutor", json={"lesson_id": record["id"], "messages": [{"role": "user", "content": "hi"}]})
    assert "shaky on ridge points" in fake.calls[-1]["system"]
    seg = json.loads(lesson_json())["segments"][0]
    fake.replies.append(json.dumps({"segments": [seg]}))
    client.post(f"/api/lessons/{record['id']}/segments/s1/edit", json={"instruction": "shorter"})
    assert "shaky on ridge points" in fake.calls[-1]["messages"][0]["content"]


def test_old_database_gains_the_learner_column(tmp_path):
    path = tmp_path / "old.db"
    db = sqlite3.connect(path)
    db.execute("CREATE TABLE lessons (id TEXT PRIMARY KEY, profile TEXT NOT NULL, topic TEXT NOT NULL,"
               " created_at TEXT NOT NULL, provider TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,"
               " error TEXT NOT NULL DEFAULT '', diagnostic TEXT, lesson TEXT, progress TEXT NOT NULL DEFAULT '{}',"
               " cards_added INTEGER NOT NULL DEFAULT 0)")
    db.execute("INSERT INTO lessons (id, profile, topic, created_at, status) VALUES ('l1', 'me', 't', 'now', 'ready')")
    db.commit()
    db.close()
    assert Store(path, owner="me").get_lesson("me", "l1")["learner"] == ""


def test_tutor_accepts_whether_the_answer_was_right(client, fake):
    lesson_id = ready_lesson(client, fake)
    fake.chunks = ["ok"]
    body = {"lesson_id": lesson_id, "messages": [{"role": "user", "content": "why?"}], "segment_id": "s2"}
    for correct, told in ((None, "haven't submitted"), (False, "which is wrong")):
        context = {"question": choice(), "attempt": "compute", "correct": correct}
        assert client.post("/api/tutor", json={**body, "context": context}).status_code == 200
        assert told in fake.calls[-1]["messages"][-1]["content"]
    assert client.post("/api/tutor", json={**body, "context": {"correct": "maybe"}}).status_code == 422


def test_claude_effort_setting(client, config, tmp_path):
    assert client.get("/api/settings").json()["claude_effort"] == {"lesson": "high"}  # the default
    assert client.put("/api/settings/claude_effort", json={"role": "tutor", "effort": "xhigh"}).status_code == 204
    s = client.get("/api/settings").json()
    assert s["claude_effort"] == {"lesson": "high", "tutor": "xhigh"} and "max" in s["claude_effort_options"]
    client.put("/api/settings/claude_effort", json={"role": "lesson", "effort": ""})
    with TestClient(create_app(config, tmp_path / "data")) as again:  # survives a restart, even with none for lesson
        assert again.get("/api/settings").json()["claude_effort"] == {"tutor": "xhigh"}
    assert client.put("/api/settings/claude_effort", json={"role": "tutor", "effort": "huge"}).status_code == 422
