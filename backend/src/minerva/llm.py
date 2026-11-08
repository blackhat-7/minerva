"""LLM calls with role fallback: `complete_json` for structured output, `stream_text` for chat.

A role is an ordered list of providers. The next provider is tried only when one is
Unavailable (unreachable, timed out, not installed or missing its key); any other error is final.

Provider kinds:
- openai: any OpenAI-compatible server, through the openai SDK.
- claude_code: the user's Claude subscription through the official `claude` CLI in headless
  mode (`claude -p`). We never read or pass credentials; the CLI uses its own login.
"""

import asyncio
import contextlib
import json
import logging
import os
import shutil
import time
from collections.abc import AsyncIterator, Callable
from pathlib import Path

import openai
from pydantic import BaseModel

from .config import Config, Provider

REQUEST_TIMEOUT = 900  # seconds; local models can take minutes for a full lesson
PROBE_TIMEOUT = 1.5
PROBE_TTL = 30

log = logging.getLogger(__name__)

Messages = list[dict[str, str]]  # [{"role": "user" | "assistant", "content": "..."}]


class LLMError(Exception):
    """A provider failed: an error status, a CLI failure, or invalid output after the retry."""


class Unavailable(LLMError):
    """The provider could not be reached. The only error that falls through to the next provider."""


def parse_json[T: BaseModel](text: str, model: type[T], check: Callable[[T], list[str]] | None = None) -> T:
    """Lenient parse: take the outermost {...} (drops ``` fences and chatter), then validate.
    Raises ValueError (pydantic's ValidationError is one) with a message fit to show the model."""
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start:
        raise ValueError("the reply contains no JSON object")
    try:
        data = json.loads(text[start : end + 1])
    except json.JSONDecodeError as e:
        raise ValueError(f"invalid JSON: {e}") from e
    obj = model.model_validate(data)
    problems = check(obj) if check else []
    if problems:
        raise ValueError("\n".join(problems))
    return obj


def transcript(messages: Messages) -> str:
    """Render a conversation as one prompt, for the CLI which takes a single prompt per call."""
    if len(messages) == 1:
        return messages[0]["content"]
    earlier = "\n\n".join(f"[{m['role']}]\n{m['content']}" for m in messages[:-1])
    return f"The conversation so far:\n\n{earlier}\n\n[user]\n{messages[-1]['content']}"


class LLM:
    def __init__(
        self,
        config: Config,
        workdir: Path,
        thinking: dict[str, str] | None = None,
        claude_models: dict[str, str] | None = None,
    ):
        self.config = config
        # role -> reasoning_effort for OpenAI-compatible providers, chosen on the settings page. It replaces any
        # reasoning_effort in the provider's extra_body; Claude keeps its default.
        self.thinking = thinking or {}
        self.claude_models = claude_models or {}  # role -> model for claude_code providers, from the settings page
        self.workdir = workdir  # empty cwd for the claude CLI, so no project files leak into its context
        self._clients: dict[str, openai.AsyncOpenAI] = {}
        self._probes: dict[str, tuple[float, bool]] = {}

    def providers(self, role: str, name: str | None = None) -> list[Provider]:
        """An explicit provider name skips the role list. Raises KeyError for unknown names.
        Claude providers come with the model chosen for the role on the settings page, if any."""
        names = [name] if name else getattr(self.config.roles, role)
        chosen = self.claude_models.get(role)
        return [
            p.model_copy(update={"model": chosen}) if chosen and p.kind == "claude_code" else p
            for p in (self.config.provider(n) for n in names)
        ]

    async def complete_json[T: BaseModel](
        self,
        role: str,
        system: str | Callable[[Provider], str],
        user: str,
        model: type[T],
        *,
        provider: str | None = None,
        check: Callable[[T, Provider], list[str]] | None = None,
    ) -> tuple[T, str]:
        """Returns the validated object and the name of the provider that produced it.
        `system` may depend on the provider (e.g. whether it may write HTML); `check` returns problems
        beyond the pydantic model, which feed the single retry like validation errors do."""
        failures = []
        for p in self.providers(role, provider):
            try:
                text_system = system(p) if callable(system) else system
                return await self._json_with_retry(p, text_system, user, model, check, self.thinking.get(role)), p.name
            except Unavailable as e:
                failures.append(f"{p.name}: {e}")
        raise Unavailable("; ".join(failures))

    async def stream_text(
        self, role: str, system: str, messages: Messages, *, provider: str | None = None
    ) -> AsyncIterator[str]:
        """Yields text deltas. Falls through to the next provider only before the first delta."""
        failures = []
        for p in self.providers(role, provider):
            async with contextlib.aclosing(self._stream(p, system, messages, self.thinking.get(role))) as chunks:
                try:
                    first = await anext(chunks)
                except Unavailable as e:
                    failures.append(f"{p.name}: {e}")
                    continue
                except StopAsyncIteration:
                    return
                yield first
                async for chunk in chunks:
                    yield chunk
                return
        raise Unavailable("; ".join(failures))

    async def available(self, p: Provider) -> bool:
        """Quick reachability check, cached for PROBE_TTL seconds."""
        checked = self._probes.get(p.name)
        if checked and time.monotonic() - checked[0] < PROBE_TTL:
            return checked[1]
        ok = await (self._probe_openai(p) if p.kind == "openai" else self._probe_claude())
        self._probes[p.name] = (time.monotonic(), ok)
        return ok

    # --- one provider ---

    async def _json_with_retry[T: BaseModel](
        self,
        p: Provider,
        system: str,
        user: str,
        model: type[T],
        check: Callable[[T, Provider], list[str]] | None,
        effort: str | None,
    ) -> T:
        schema = model.model_json_schema()
        messages = [{"role": "user", "content": user}]
        for attempt in range(2):
            text = await (self._openai_json(p, system, messages, schema, effort) if p.kind == "openai" else
                          self._claude_json(p, system, transcript(messages), schema))
            try:
                return parse_json(text, model, check and (lambda obj: check(obj, p)))
            except ValueError as e:
                if attempt:
                    raise LLMError(f"{p.name} returned invalid output twice. Last problems:\n{e}") from e
                log.warning("%s returned invalid %s, retrying: %s", p.name, model.__name__, e)
                messages += [
                    {"role": "assistant", "content": text},
                    {"role": "user", "content": f"That output failed validation:\n{e}\n\n"
                     "Fix these problems and return the complete corrected JSON object only."},
                ]
        raise AssertionError("unreachable")

    def _openai(self, p: Provider) -> openai.AsyncOpenAI:
        if p.name not in self._clients:
            key = os.environ.get(p.api_key_env, "") if p.api_key_env else "none"
            if not key:
                raise Unavailable(f"{p.api_key_env} is not set")
            self._clients[p.name] = openai.AsyncOpenAI(
                base_url=p.base_url, api_key=key, timeout=openai.Timeout(REQUEST_TIMEOUT, connect=5), max_retries=0
            )
        return self._clients[p.name]

    @staticmethod
    def _extra_body(p: Provider, effort: str | None) -> dict | None:
        return ({**p.extra_body, "reasoning_effort": effort} if effort else p.extra_body) or None

    async def _openai_json(self, p: Provider, system: str, messages: Messages, schema: dict, effort: str | None) -> str:
        extra = {"response_format": {"type": "json_schema", "json_schema": {"name": "output", "schema": schema}}}
        try:
            resp = await self._openai(p).chat.completions.create(
                model=p.model,
                messages=[{"role": "system", "content": system}, *messages],
                extra_body=self._extra_body(p, effort),
                **(extra if p.structured else {}),
            )
        except openai.APIConnectionError as e:  # includes timeouts
            raise Unavailable(str(e)) from e
        except openai.APIStatusError as e:
            raise LLMError(f"{p.name}: {e.message}") from e
        msg = resp.choices[0].message
        # Thinking models on llama.cpp-style servers may put everything in reasoning_content.
        return msg.content or (msg.model_extra or {}).get("reasoning_content") or ""

    async def _claude_json(self, p: Provider, system: str, prompt: str, schema: dict) -> str:
        proc = await self._claude(p, system, ["--output-format", "json", "--json-schema", json.dumps(schema)])
        try:
            out, err = await asyncio.wait_for(proc.communicate(prompt.encode()), REQUEST_TIMEOUT)
        except TimeoutError:
            proc.kill()
            await proc.wait()
            raise Unavailable("claude CLI timed out") from None
        if not out.strip():
            raise LLMError(f"claude CLI exited {proc.returncode}: {err.decode(errors='replace')[-500:]}")
        result = json.loads(out)
        if result.get("is_error"):
            raise LLMError(f"claude CLI: {result.get('result') or result.get('subtype')}")
        structured = result.get("structured_output")
        return json.dumps(structured) if structured is not None else result.get("result", "")

    async def _stream(self, p: Provider, system: str, messages: Messages, effort: str | None) -> AsyncIterator[str]:
        if p.kind == "openai":
            try:
                stream = await self._openai(p).chat.completions.create(
                    model=p.model,
                    messages=[{"role": "system", "content": system}, *messages],
                    stream=True,
                    extra_body=self._extra_body(p, effort),
                )
            except openai.APIConnectionError as e:
                raise Unavailable(str(e)) from e
            except openai.APIStatusError as e:
                raise LLMError(f"{p.name}: {e.message}") from e
            async for chunk in stream:
                if chunk.choices and chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content
            return

        proc = await self._claude(
            p, system, ["--output-format", "stream-json", "--include-partial-messages", "--verbose"], stderr=False
        )
        result = None
        try:
            proc.stdin.write(transcript(messages).encode())
            await proc.stdin.drain()
            proc.stdin.close()
            async for line in proc.stdout:
                event = json.loads(line)
                if event["type"] == "stream_event":
                    e = event["event"]
                    if e["type"] == "content_block_delta" and e["delta"]["type"] == "text_delta":
                        yield e["delta"]["text"]
                elif event["type"] == "result":
                    result = event
            await proc.wait()
        finally:
            if proc.returncode is None:
                proc.kill()
                await proc.wait()
        if result is None or result.get("is_error"):
            detail = result and (result.get("result") or result.get("subtype"))
            raise LLMError(f"claude CLI failed: {detail or f'exit {proc.returncode}'}")

    async def _claude(self, p: Provider, system: str, args: list[str], stderr: bool = True):
        exe = shutil.which("claude")
        if not exe:
            raise Unavailable("claude CLI not found on PATH")
        self.workdir.mkdir(parents=True, exist_ok=True)
        return await asyncio.create_subprocess_exec(
            exe, "-p", "--model", p.model,
            "--setting-sources", "project",  # with the empty cwd: none of the user's settings, hooks or plugins
            "--system-prompt", system,
            "--tools", "", "--strict-mcp-config", "--no-session-persistence",
            *args,
            cwd=self.workdir,
            # --setting-sources alone still loads ~/.claude/CLAUDE.md; keep the user's memory out of lessons.
            env={**os.environ, "CLAUDE_CODE_DISABLE_CLAUDE_MDS": "1", "CLAUDE_CODE_DISABLE_AUTO_MEMORY": "1"},
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE if stderr else asyncio.subprocess.DEVNULL,
            limit=1 << 24,  # stream-json lines carry whole messages
        )

    async def _probe_openai(self, p: Provider) -> bool:
        try:
            await self._openai(p).with_options(timeout=PROBE_TIMEOUT, max_retries=0).models.list()
        except (Unavailable, openai.APIConnectionError, openai.AuthenticationError, openai.PermissionDeniedError):
            return False
        except openai.APIStatusError:  # reachable; some servers just don't implement /models
            return True
        return True

    async def _probe_claude(self) -> bool:
        exe = shutil.which("claude")
        if not exe:
            return False
        proc = await asyncio.create_subprocess_exec(
            exe, "auth", "status", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL
        )
        try:
            out, _ = await asyncio.wait_for(proc.communicate(), PROBE_TIMEOUT)
        except TimeoutError:
            proc.kill()
            await proc.wait()
            return False
        try:
            return proc.returncode == 0 and json.loads(out).get("loggedIn") is True
        except json.JSONDecodeError:
            return False
