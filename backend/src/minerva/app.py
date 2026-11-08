"""HTTP API (docs/api.md) and the built frontend."""

import asyncio
import functools
import hashlib
import json
import logging
import os
import random
import uuid
from pathlib import Path
from typing import Literal

import openai
import uvicorn
from fastapi import FastAPI, Form, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from . import glossary, prompts
from .config import REPO, Config, Speech, config_path, data_dir, load_config
from .lesson import Diagnostic, Lesson, Question, SegmentEdit
from .llm import LLM, LLMError, Unavailable, add_step
from .search import web_search
from .store import Store
from .widgets import check_lesson, check_segments, load_catalog

DIST = REPO / "frontend" / "dist"

log = logging.getLogger("minerva")


class NewLesson(BaseModel):
    topic: str = Field(min_length=1)
    provider: str | None = None


class GenerateBody(BaseModel):
    answers: list[str]
    provider: str | None = None


class ProgressBody(BaseModel):
    progress: dict


class EditBody(BaseModel):
    instruction: str = Field(min_length=1)
    provider: str | None = None


class GradeBody(BaseModel):
    lesson_id: str
    question: Question
    answer: str
    provider: str | None = None


class ExplainBody(BaseModel):
    lesson_id: str
    explanation: str
    provider: str | None = None


class TutorContext(BaseModel):
    widget_state: dict = {}
    question: Question | None = None
    attempt: str = ""
    narration_heard: str = ""  # the narration played before the learner interrupted it


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class TutorBody(BaseModel):
    lesson_id: str
    segment_id: str = ""
    context: TutorContext = TutorContext()
    messages: list[ChatMessage] = Field(min_length=1)
    voice: bool = False
    provider: str | None = None


CLAUDE_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"]


class ClaudeModelBody(BaseModel):
    role: Literal["lesson", "tutor"]
    model: str  # one of CLAUDE_MODELS, or "" for the provider's model in config.toml


class ThinkingBody(BaseModel):
    role: Literal["lesson", "tutor"]
    effort: Literal["", "low", "medium", "high", "max"]  # "" = the provider's extra_body from config.toml


class TtsBody(BaseModel):
    text: str = Field(min_length=1)


class NewCard(BaseModel):
    lesson_id: str | None = None
    front: str = Field(min_length=1)
    back: str = Field(min_length=1)


class ReviewBody(BaseModel):
    rating: Literal[1, 2, 3, 4]


class DrillBody(BaseModel):
    topic: str | None = None
    provider: str | None = None


def speech_client(s: Speech) -> openai.AsyncOpenAI:
    key = os.environ.get(s.api_key_env, "") if s.api_key_env else "none"
    if not key:
        raise HTTPException(503, f"{s.api_key_env} is not set")
    return openai.AsyncOpenAI(base_url=s.base_url, api_key=key, timeout=openai.Timeout(120, connect=5), max_retries=0)


def create_app(config: Config | None = None, data: Path | None = None) -> FastAPI:
    config = config or load_config()
    data = data or data_dir()
    store = Store(data / "minerva.db")
    store.fail_interrupted()
    # Settings changed in the app (the settings page), kept apart from config.toml.
    prefs_path = data / "settings.json"
    prefs = json.loads(prefs_path.read_text()) if prefs_path.exists() else {}
    llm = LLM(config, data / "claude-cwd", thinking=prefs.get("thinking"), claude_models=prefs.get("claude_models"))

    def save_prefs() -> None:
        prefs.update(thinking=llm.thinking, claude_models=llm.claude_models)
        prefs_path.write_text(json.dumps(prefs, indent=1))
    about = config.learner.about
    tasks: set[asyncio.Task] = set()  # keeps background generations referenced until done
    activity: dict[str, list[dict]] = {}  # lesson id -> thinking and tool steps so far, while it generates

    app = FastAPI(title="Minerva")
    app.state.llm = llm
    app.state.store = store

    @app.exception_handler(LLMError)
    async def llm_error(_: Request, e: LLMError) -> JSONResponse:
        return JSONResponse({"detail": str(e)}, status_code=503 if isinstance(e, Unavailable) else 502)

    def check_provider(name: str | None) -> None:
        if name and name not in {p.name for p in config.providers}:
            raise HTTPException(400, f"unknown provider {name!r}")

    def lesson_or_404(lesson_id: str) -> dict:
        record = store.get_lesson(lesson_id)
        if record is None:
            raise HTTPException(404, "lesson not found")
        return record

    def ready_lesson(lesson_id: str) -> tuple[dict, Lesson]:
        record = lesson_or_404(lesson_id)
        if record["lesson"] is None:
            raise HTTPException(409, f"lesson is {record['status']}, not ready")
        return record, Lesson.model_validate(record["lesson"])

    # --- status ---

    @app.get("/api/status")
    async def status() -> dict:
        available = await asyncio.gather(*(llm.available(p) for p in config.providers))
        return {
            "providers": [
                {"name": p.name, "model": p.model, "available": ok, "html": p.html}
                for p, ok in zip(config.providers, available, strict=True)
            ],
            "roles": config.roles.model_dump(),
            "tts": config.tts is not None,
            "stt": config.stt is not None,
            "due": store.due_count(),
        }

    @app.get("/api/settings")
    async def settings() -> dict:
        """The server's configuration, for the settings page. No keys: only which env var holds one."""
        available = await asyncio.gather(*(llm.available(p) for p in config.providers))

        def speech(s: Speech | None) -> dict | None:
            return s and s.model_dump(include={"base_url", "model", "voice"})

        return {
            "providers": [
                {**p.model_dump(include={"name", "kind", "model", "base_url", "html", "extra_body"}), "available": ok}
                for p, ok in zip(config.providers, available, strict=True)
            ],
            "roles": config.roles.model_dump(),
            "tts": speech(config.tts),
            "stt": speech(config.stt),
            "thinking": llm.thinking,
            "claude_models": llm.claude_models,
            "claude_model_options": CLAUDE_MODELS,
            "learner": config.learner.about.strip(),
            "config_path": str(config_path()),
        }

    @app.put("/api/settings/thinking", status_code=204)
    async def set_thinking(body: ThinkingBody) -> None:
        if body.effort:
            llm.thinking[body.role] = body.effort
        else:
            llm.thinking.pop(body.role, None)
        save_prefs()

    @app.put("/api/settings/claude_model", status_code=204)
    async def set_claude_model(body: ClaudeModelBody) -> None:
        if body.model and body.model not in CLAUDE_MODELS:
            raise HTTPException(422, f"unknown Claude model {body.model!r}")
        if body.model:
            llm.claude_models[body.role] = body.model
        else:
            llm.claude_models.pop(body.role, None)
        save_prefs()

    # --- lessons ---

    @app.post("/api/lessons")
    async def create_lesson(body: NewLesson) -> dict:
        check_provider(body.provider)
        topic = body.topic.strip()
        if not topic:
            raise HTTPException(422, "topic is empty")
        diagnostic, used = await llm.complete_json(
            "lesson", prompts.DIAGNOSTIC_SYSTEM, prompts.diagnostic_user(topic, about), Diagnostic, provider=body.provider
        )
        return store.create_lesson(topic, used, diagnostic.model_dump())

    async def generate(lesson_id: str, topic: str, questions: list[Question], answers: list[str], provider: str | None):
        steps = activity[lesson_id] = []
        on_event = functools.partial(add_step, steps)
        try:
            profile = ""
            if answers:
                result, _ = await llm.complete_json(
                    "lesson", prompts.PROFILE_SYSTEM, prompts.profile_user(topic, questions, answers), prompts.Profile,
                    provider=provider, on_event=on_event,
                )
                profile = result.profile
                log.info("lesson %s learner profile: %s", lesson_id, profile)
            catalog = load_catalog()
            if config.search.enabled:
                on_event({"tool": {"name": "WebSearch", "detail": topic}})
            sources = await web_search(topic, config.search)
            lesson, used = await llm.complete_json(
                "lesson",
                lambda p: prompts.lesson_system(catalog, p.html),
                prompts.lesson_user(topic, profile, about, sources),
                Lesson,
                provider=provider,
                check=lambda lesson, p: check_lesson(lesson, p, catalog),
                on_event=on_event,
            )
            store.update_lesson(lesson_id, status="ready", error="", provider=used, lesson=lesson.model_dump())
        except Exception as e:
            log.exception("generating lesson %s failed", lesson_id)
            store.update_lesson(lesson_id, status="failed", error=str(e) or type(e).__name__)
        finally:
            del activity[lesson_id]

    @app.post("/api/lessons/{lesson_id}/generate", status_code=202)
    async def start_generation(lesson_id: str, body: GenerateBody) -> dict:
        check_provider(body.provider)
        record = lesson_or_404(lesson_id)
        if record["status"] == "generating":
            raise HTTPException(409, "already generating")
        questions = Diagnostic.model_validate(record["diagnostic"]).questions
        if body.answers and len(body.answers) != len(questions):
            raise HTTPException(422, f"expected {len(questions)} answers or none")
        store.update_lesson(lesson_id, status="generating", error="")
        task = asyncio.create_task(generate(lesson_id, record["topic"], questions, body.answers, body.provider))
        tasks.add(task)
        task.add_done_callback(tasks.discard)
        return store.get_lesson(lesson_id)

    @app.post("/api/lessons/{lesson_id}/segments/{segment_id}/edit")
    async def edit_segment(lesson_id: str, segment_id: str, body: EditBody) -> dict:
        """Rewrites one segment as the learner asks, optionally adding a new segment after it."""
        check_provider(body.provider)
        record, lesson = ready_lesson(lesson_id)
        segment = next((s for s in lesson.segments if s.id == segment_id), None)
        if segment is None:
            raise HTTPException(404, f"no segment {segment_id!r}")
        catalog = load_catalog()
        result, _ = await llm.complete_json(
            "lesson",
            lambda p: prompts.edit_system(catalog, p.html),
            prompts.edit_user(record["topic"], lesson, segment, body.instruction.strip(), about),
            SegmentEdit,
            provider=body.provider,
            check=lambda edit, p: check_segments(edit.segments, p, catalog),
        )
        # Re-read: the lesson may have changed while the model worked (another edit).
        _, lesson = ready_lesson(lesson_id)
        at = next((i for i, s in enumerate(lesson.segments) if s.id == segment_id), None)
        if at is None:
            raise HTTPException(409, f"segment {segment_id!r} was removed meanwhile")
        taken = {s.id for s in lesson.segments}
        new = result.segments
        new[0].id = segment_id
        for seg in new[1:]:
            seg.id = next(f"s{n}" for n in range(1, len(taken) + 3) if f"s{n}" not in taken)
            taken.add(seg.id)
        lesson.segments[at : at + 1] = new
        known = {g.term.lower() for g in lesson.glossary}
        lesson.glossary += [g for g in result.glossary if g.term.lower() not in known]
        store.update_lesson(lesson_id, lesson=lesson.model_dump())
        return store.get_lesson(lesson_id)

    @app.get("/api/lessons")
    async def list_lessons() -> list[dict]:
        return store.list_lessons()

    @app.get("/api/lessons/{lesson_id}")
    async def get_lesson(lesson_id: str) -> dict:
        record = lesson_or_404(lesson_id)
        return {**record, "activity": activity[lesson_id]} if lesson_id in activity else record

    @app.put("/api/lessons/{lesson_id}/progress", status_code=204)
    async def save_progress(lesson_id: str, body: ProgressBody) -> None:
        lesson_or_404(lesson_id)
        store.update_lesson(lesson_id, progress=body.progress)

    @app.delete("/api/lessons/{lesson_id}", status_code=204)
    async def delete_lesson(lesson_id: str) -> None:
        lesson_or_404(lesson_id)
        store.delete_lesson(lesson_id)

    @app.post("/api/lessons/{lesson_id}/complete", status_code=204)
    async def complete_lesson(lesson_id: str) -> None:
        record, lesson = ready_lesson(lesson_id)
        store.complete_lesson(lesson_id, [c.model_dump() for c in lesson.cards], record["topic"])

    # --- grading ---

    @app.post("/api/grade")
    async def grade(body: GradeBody) -> prompts.Grade:
        if body.question.kind != "free":
            raise HTTPException(400, "only free questions are graded here")
        check_provider(body.provider)
        record = lesson_or_404(body.lesson_id)
        result, _ = await llm.complete_json(
            "tutor", prompts.GRADE_SYSTEM, prompts.grade_user(record["topic"], body.question, body.answer), prompts.Grade,
            provider=body.provider,
        )
        return result

    @app.post("/api/explain")
    async def explain(body: ExplainBody) -> prompts.ExplainGrade:
        check_provider(body.provider)
        record, lesson = ready_lesson(body.lesson_id)
        eb = lesson.explain_back
        result, _ = await llm.complete_json(
            "tutor", prompts.EXPLAIN_SYSTEM,
            prompts.explain_user(record["topic"], eb.prompt, eb.rubric, body.explanation), prompts.ExplainGrade,
            provider=body.provider,
        )
        return result

    # --- tutor ---

    @app.post("/api/tutor")
    async def tutor(body: TutorBody) -> StreamingResponse:
        if body.messages[-1].role != "user":
            raise HTTPException(422, "the last message must be from the user")
        check_provider(body.provider)
        record, lesson = ready_lesson(body.lesson_id)
        ctx = body.context
        context = prompts.tutor_context(lesson, body.segment_id, ctx.widget_state, ctx.question, ctx.attempt, body.voice,
                                         ctx.narration_heard)
        messages = [m.model_dump() for m in body.messages]
        messages[-1]["content"] = f"{context}\n\n{messages[-1]['content']}"
        system = prompts.tutor_system(record["topic"], lesson, about)

        async def events():
            try:
                async for event in llm.stream_events("tutor", system, messages, provider=body.provider):
                    yield f"data: {json.dumps(event)}\n\n"
                yield 'data: {"done": true}\n\n'
            except Exception as e:
                log.exception("tutor stream failed")
                yield f"data: {json.dumps({'error': str(e) or type(e).__name__})}\n\n"

        return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})

    # --- voice ---

    @app.post("/api/stt")
    async def stt(audio: UploadFile, lesson_id: str = Form("")) -> dict:
        if config.stt is None:
            raise HTTPException(503, "speech-to-text is not configured")
        record = store.get_lesson(lesson_id) if lesson_id else None
        terms = [g["term"] for g in record["lesson"]["glossary"]] if record and record["lesson"] else []
        bias = {"prompt": prompts.stt_prompt(terms)} if terms else {}
        try:
            result = await speech_client(config.stt).audio.transcriptions.create(
                model=config.stt.model,
                file=(audio.filename or "audio.webm", await audio.read(), audio.content_type or "application/octet-stream"),
                **bias,
            )
        except openai.APIConnectionError as e:
            raise HTTPException(503, f"speech-to-text unreachable: {e}") from e
        except openai.APIStatusError as e:
            raise HTTPException(502, f"speech-to-text failed: {e.message}") from e
        return {"text": glossary.snap(result.text, terms)}

    @app.post("/api/tts")
    async def tts(body: TtsBody) -> FileResponse:
        if config.tts is None:
            raise HTTPException(503, "text-to-speech is not configured")
        s = config.tts
        key = hashlib.sha256(f"{s.base_url}\0{s.model}\0{s.voice}\0{body.text}".encode()).hexdigest()
        path = data / "tts" / f"{key}.mp3"
        if not path.exists():
            try:
                audio = await speech_client(s).audio.speech.create(
                    model=s.model, voice=s.voice, input=body.text, response_format="mp3"
                )
            except openai.APIConnectionError as e:
                raise HTTPException(503, f"text-to-speech unreachable: {e}") from e
            except openai.APIStatusError as e:
                raise HTTPException(502, f"text-to-speech failed: {e.message}") from e
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_name(f"{key}.{uuid.uuid4().hex}.tmp")
            tmp.write_bytes(audio.content)
            tmp.replace(path)
        return FileResponse(path, media_type="audio/mpeg")

    # --- review ---

    @app.get("/api/cards/due")
    async def due_cards(limit: int = 50) -> list[dict]:
        return store.due_cards(limit)

    @app.post("/api/cards")
    async def add_card(body: NewCard) -> dict:
        topic = lesson_or_404(body.lesson_id)["topic"] if body.lesson_id else ""
        return {"id": store.add_card(body.lesson_id, topic, body.front, body.back)}

    @app.post("/api/cards/{card_id}/review")
    async def review_card(card_id: str, body: ReviewBody) -> dict:
        due = store.review_card(card_id, body.rating)
        if due is None:
            raise HTTPException(404, "card not found")
        return {"due": due.isoformat()}

    # --- drill ---

    @app.post("/api/drill")
    async def drill(body: DrillBody) -> Question:
        check_provider(body.provider)
        topic, focus = body.topic, ""
        if not topic:
            ready = [r for r in store.list_lessons() if r["status"] == "ready"]
            if not ready:
                raise HTTPException(400, "no studied lessons yet; pass a topic")
            pick = store.get_lesson(random.choice(ready)["id"])
            topic = pick["topic"]
            focus = random.choice(pick["lesson"]["segments"])["title"]
        question, _ = await llm.complete_json(
            "tutor", prompts.DRILL_SYSTEM, prompts.drill_user(topic, focus, about), Question, provider=body.provider,
            check=lambda q, _: [] if q.kind == "numeric" else ["kind must be \"numeric\""],
        )
        return question

    # --- frontend ---

    @app.get("/{path:path}", include_in_schema=False)
    async def frontend(path: str) -> Response:
        if path == "api" or path.startswith("api/") or not DIST.is_dir():
            raise HTTPException(404)
        file = (DIST / path).resolve()
        if path and file.is_file() and file.is_relative_to(DIST.resolve()):
            return FileResponse(file)
        return FileResponse(DIST / "index.html")  # SPA route

    return app


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    uvicorn.run(create_app(), host="0.0.0.0", port=int(os.environ.get("MINERVA_PORT", "8765")))
