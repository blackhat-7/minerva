import asyncio
import json
import os
import sys

import pytest
from conftest import ROOFLINE, lesson_json

from minerva import prompts
from minerva.config import load_config
from minerva.lesson import Lesson
from minerva.llm import LLM, LLMError, Unavailable, parse_json
from minerva.widgets import check_lesson


def test_parse_json_is_lenient():
    assert parse_json('Sure!\n```json\n{"profile": "x"}\n```\nDone.', prompts.Profile).profile == "x"
    with pytest.raises(ValueError, match="no JSON object"):
        parse_json("nothing", prompts.Profile)


def test_role_falls_through_only_when_unavailable(config, fake, tmp_path):
    llm = LLM(config, tmp_path)
    fake.replies += [Unavailable("connection refused"), '{"profile": "from b"}']
    result, used = asyncio.run(llm.complete_json("lesson", "sys", "user", prompts.Profile))
    assert (result.profile, used) == ("from b", "b")

    fake.replies += [LLMError("HTTP 400"), '{"profile": "never"}']
    with pytest.raises(LLMError, match="HTTP 400"):
        asyncio.run(llm.complete_json("lesson", "sys", "user", prompts.Profile))

    fake.replies.append('{"profile": "explicit"}')
    _, used = asyncio.run(llm.complete_json("lesson", "sys", "user", prompts.Profile, provider="b"))
    assert used == "b"


def test_stream_falls_through_before_first_chunk(config, fake, tmp_path, monkeypatch):
    async def stream(self, p, system, messages, effort):
        if p.name == "a":
            raise Unavailable("down")
        yield "hi"

    monkeypatch.setattr(LLM, "_stream", stream)
    config.roles.tutor = ["a", "b"]

    async def collect():
        return [c async for c in LLM(config, tmp_path).stream_text("tutor", "sys", [{"role": "user", "content": "q"}])]

    assert asyncio.run(collect()) == ["hi"]


def test_check_lesson_rejects_unknown_widgets_and_disallowed_html(config):
    lesson = Lesson.model_validate_json(lesson_json())
    lesson.segments[1].visual.widget = "nope"
    lesson.segments[0].visual.kind = "html"
    problems = check_lesson(lesson, config.provider("a"), {"roofline": ROOFLINE})
    assert any("unknown widget 'nope'" in p for p in problems)
    assert any("'html' is not allowed" in p for p in problems)


def test_load_config(tmp_path, monkeypatch):
    path = tmp_path / "config.toml"
    path.write_text("""
[[providers]]
name = "local"
kind = "openai"
base_url = "http://127.0.0.1:6868/v1"
model = "local"
extra_body = { chat_template_kwargs = { enable_thinking = false } }

[[providers]]
name = "claude"
kind = "claude_code"
model = "claude-sonnet-5-5"
html = true

[roles]
lesson = ["claude", "local"]
tutor = ["local"]
""")
    monkeypatch.setenv("MINERVA_CONFIG", str(path))
    config = load_config()
    assert config.provider("local").extra_body == {"chat_template_kwargs": {"enable_thinking": False}}
    assert config.provider("claude").html and config.tts is None and config.learner.about == ""

    path.write_text(path.read_text().replace('tutor = ["local"]', 'tutor = ["ghost"]'))
    with pytest.raises(ValueError, match="unknown providers"):
        load_config()


# --- claude_code adapter, against a fake `claude` executable ---

FAKE_CLAUDE = """#!{python}
import json, os, sys
args = sys.argv[1:]
if args[:2] == ["auth", "status"]:
    print(json.dumps({{"loggedIn": True, "email": "never-read"}}))
    sys.exit(0)
with open(os.environ["FAKE_CLAUDE_LOG"], "a") as f:
    f.write(json.dumps({{"args": args, "stdin": sys.stdin.read(), "cwd": os.getcwd(),
                        "no_memory": os.environ.get("CLAUDE_CODE_DISABLE_CLAUDE_MDS")}}) + "\\n")
fail = os.environ.get("FAKE_CLAUDE_FAIL") == "1"
if args[args.index("--output-format") + 1] == "json":
    print(json.dumps({{"type": "result", "is_error": fail, "result": "rate limited" if fail else "",
                       "structured_output": None if fail else {{"profile": "structured"}}}}))
else:
    for text in ["Hel", "lo"]:
        print(json.dumps({{"type": "stream_event", "event": {{"type": "content_block_delta", "index": 0,
                           "delta": {{"type": "text_delta", "text": text}}}}}}))
    print(json.dumps({{"type": "result", "subtype": "success", "is_error": fail, "result": "Hello"}}))
"""


@pytest.fixture
def claude_config(config):
    return config.model_validate({
        "providers": [{"name": "claude", "kind": "claude_code", "model": "claude-haiku-5-5"}],
        "roles": {"lesson": ["claude"], "tutor": ["claude"]},
    })


@pytest.fixture
def fake_claude(tmp_path, monkeypatch):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    exe = bin_dir / "claude"
    exe.write_text(FAKE_CLAUDE.format(python=sys.executable))
    exe.chmod(0o755)
    log = tmp_path / "calls.jsonl"
    monkeypatch.setenv("PATH", f"{bin_dir}{os.pathsep}{os.environ['PATH']}")
    monkeypatch.setenv("FAKE_CLAUDE_LOG", str(log))
    return lambda: [json.loads(line) for line in log.read_text().splitlines()]


def test_claude_json(claude_config, fake_claude, tmp_path):
    llm = LLM(claude_config, tmp_path / "cwd")
    result, used = asyncio.run(llm.complete_json("lesson", "be brief", "a long prompt", prompts.Profile))
    assert (result.profile, used) == ("structured", "claude")

    [call] = fake_claude()
    args = call["args"]
    assert call["stdin"] == "a long prompt" and call["cwd"] == str(tmp_path / "cwd") and call["no_memory"] == "1"
    assert args[args.index("--system-prompt") + 1] == "be brief"
    assert args[args.index("--model") + 1] == "claude-haiku-5-5"
    assert args[args.index("--tools") + 1] == ""
    assert args[args.index("--setting-sources") + 1] == "project"
    assert json.loads(args[args.index("--json-schema") + 1]) == prompts.Profile.model_json_schema()
    assert "--no-session-persistence" in args and "--strict-mcp-config" in args and "--bare" not in args


def test_claude_stream_and_transcript(claude_config, fake_claude, tmp_path):
    llm = LLM(claude_config, tmp_path / "cwd")
    messages = [{"role": "user", "content": "q1"}, {"role": "assistant", "content": "a1"}, {"role": "user", "content": "q2"}]

    async def collect():
        return [c async for c in llm.stream_text("tutor", "sys", messages)]

    assert asyncio.run(collect()) == ["Hel", "lo"]
    stdin = fake_claude()[0]["stdin"]
    assert "[assistant]\na1" in stdin and stdin.endswith("[user]\nq2")


def test_claude_errors(claude_config, fake_claude, tmp_path, monkeypatch):
    llm = LLM(claude_config, tmp_path / "cwd")
    assert asyncio.run(llm.available(claude_config.provider("claude"))) is True

    monkeypatch.setenv("FAKE_CLAUDE_FAIL", "1")
    with pytest.raises(LLMError, match="rate limited"):
        asyncio.run(llm.complete_json("lesson", "s", "u", prompts.Profile))

    monkeypatch.setenv("PATH", str(tmp_path / "empty"))
    with pytest.raises(Unavailable, match="not found"):
        asyncio.run(llm.complete_json("lesson", "s", "u", prompts.Profile))


def test_stt_prompt_puts_likely_misheard_terms_first():
    terms = ["roofline", "arithmetic intensity", "HBM", "PagedAttention", "H100"]
    assert prompts.stt_prompt(terms) == "HBM, PagedAttention, H100, roofline, arithmetic intensity"
    assert prompts.stt_prompt(terms, max_chars=20) == "HBM, PagedAttention"


def test_thinking_effort_replaces_the_configured_one(config):
    p = config.providers[0].model_copy(update={"extra_body": {"reasoning_effort": "low", "top_k": 20}})
    assert LLM._extra_body(p, "max") == {"reasoning_effort": "max", "top_k": 20}
    assert LLM._extra_body(p, None) == {"reasoning_effort": "low", "top_k": 20}
    assert LLM._extra_body(config.providers[0], None) is None


def test_claude_model_chosen_per_role(claude_config, tmp_path):
    llm = LLM(claude_config, tmp_path, claude_models={"lesson": "claude-opus-5-5"})
    [p] = llm.providers("lesson")
    assert p.model == "claude-opus-5-5"
    assert llm.providers("tutor")[0].model == claude_config.providers[0].model
