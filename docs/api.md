# HTTP API

All JSON. The lesson types are in `backend/src/minerva/lesson.py` (mirrored in `frontend/src/lesson.ts`). Beyond the basics, a lesson has an `analogy`, each segment has `text` (written for reading) beside `narration`, and a visual may be `kind: "scene"` (actors on a grid, with timed steps) or `kind: "code"` (with a `language` and highlighted `lines` per step); see `lesson.py`. Scene and code visuals are normalized by `scene.py` before they are stored.
The backend serves the built frontend (`frontend/dist`) at `/`; in dev, Vite proxies `/api` to `127.0.0.1:8765`.

## Profiles

`GET /api/profiles` → `[{id, name}]`, from `[profiles.<id>]` in `config.toml`. The only endpoint without a profile.

Every other endpoint acts for one profile, named by the `X-Profile: <id>` header. With exactly one profile the header may be omitted. An unknown id, or no header with several profiles, gives `400`. A lesson or card of another profile gives `404`. An explicit `provider` the profile may not use gives `403`. There are no passwords: expose the app only on a private network, or behind an auth proxy.

Behind an auth proxy (Caddy + Authelia forward auth) the `Remote-User` header carries the logged-in username. When it is set, a request may only use profiles whose `login` equals it: `GET /api/profiles` lists just those, a missing `X-Profile` picks the only one, another profile gives `403`, and a login with no profile gives `403` everywhere. Without the header nothing changes. The header only narrows access, but the proxy must strip any client-sent `Remote-User`.

## Status

`GET /api/status`

```json
{
  "providers": [{"name": "local", "model": "…", "available": true, "html": false}],
  "roles": {"lesson": ["claude", "local"], "tutor": ["local", "claude"]},
  "tts": true,
  "stt": true,
  "due": 12
}
```

`GET /api/settings` → the server's configuration for the settings page, read-only and without keys:
`{providers: [{name, kind, model, base_url, html, extra_body, available}], roles, tts: {base_url, model, voice, voices} | null,
stt: … | null, thinking, claude_models, claude_model_options, claude_effort, claude_effort_options, learner, config_path}`.

- `PUT /api/settings/thinking {role: "lesson"|"tutor", effort: ""|"low"|"medium"|"high"|"max"}` → `204`. How hard OpenAI-compatible (local) providers think for that job; replaces `reasoning_effort` from `extra_body`. `""` falls back to `config.toml`.
- `PUT /api/settings/claude_model {role, model}` → `204`. The Claude model for that job, one of `claude_model_options`; `""` falls back to `config.toml`.
- `PUT /api/settings/claude_effort {role, effort: ""|"low"|"medium"|"high"|"xhigh"|"max"}` → `204`. The `--effort` level the Claude CLI uses for that job, one of `claude_effort_options`; `""` leaves the CLI's own default. Without a saved value the lesson job starts at `high`.

All three are saved in `data/settings.json` and apply on every device.

`/api/status` and `/api/settings` are per profile: they list only the profile's providers and the role lists filtered to them. In settings, `learner` is the profile's `about`. Thinking, Claude-model and Claude-effort settings are global.

`available` is a quick reachability check. With `tts: false` the frontend speaks with the browser's `speechSynthesis`; with `stt: false` it hides the mic.

## Lessons

`LessonRecord`:

```json
{
  "id": "…", "topic": "…", "created_at": "ISO-8601", "provider": "claude",
  "status": "diagnostic | generating | ready | failed",
  "error": "",
  "learner": "what the diagnostic showed the learner knows; \"\" if there was none",
  "diagnostic": {"questions": [Question]} | null,
  "lesson": Lesson | null,
  "progress": {}
}
```

`progress` is opaque to the backend. The frontend owns its shape and saves it so a lesson resumes on any device.

- `POST /api/lessons {topic, provider?}` → `LessonRecord` with `status: "diagnostic"` and 2–4 diagnostic questions.
- `POST /api/lessons/{id}/generate {answers: [string], provider?}` → `202` + `LessonRecord` with `status: "generating"`. One answer per diagnostic question, `""` for "don't know"; `[]` skips the diagnostic. Generation runs in the background; poll `GET /api/lessons/{id}` until `ready` or `failed`. While it runs, the record also has `activity` (the model's thinking and tool calls: `[{kind: "thinking", text} | {kind: "tool", name, detail}]`, where a `Write` tool marks the output starting) and `draft`, the lesson so far: `{title, segments: [{title, one_line}], parts}`, `parts` listing which of `problems`, `pitfalls`, `explain_back`, `cards` have started.
- `POST /api/lessons/{id}/segments/{segment_id}/edit {instruction, provider?}` → `LessonRecord`. Rewrites that segment as the learner asks, under the same rules and validation as generation, matching the segments around it. The model may add one new segment after it (a fresh id); new glossary terms are merged. Synchronous: a minute or two.
- `GET /api/lessons` → `[{id, topic, title, status, created_at}]`, newest first.
- `GET /api/lessons/{id}` → `LessonRecord`.
- `PUT /api/lessons/{id}/progress {progress}` → `204`.
- `DELETE /api/lessons/{id}` → `204`.

`provider` names a provider the profile may use (else `403`); omitted, the role's list is tried in order.

## Grading

- `POST /api/grade {lesson_id, question: Question, answer, provider?}` → `{correct: bool, feedback: string}`. For `free` questions; `choice` and `numeric` are graded in the browser (numeric: correct when `max(a/v, v/a) <= tolerance` and signs match).
- `POST /api/explain {lesson_id, explanation, provider?}` → `{score: 0-100, covered: [string], missing: [string], misconceptions: [string], follow_up: string}`, graded against the lesson's `explain_back.rubric`.

## Tutor

`POST /api/tutor`

```json
{
  "lesson_id": "…",
  "segment_id": "s2",
  "context": {"widget_state": {}, "question": Question, "attempt": "learner's answer so far",
              "narration_heard": "narration played before the learner interrupted it",
              "correct": null},
  "messages": [{"role": "user", "content": "…"}],
  "voice": false,
  "provider": null
}
```

`context.correct` is `null` until the learner submits the question, then `false` if the answer was wrong (the frontend leaves out questions answered right).

Streams `text/event-stream`: `data: {"delta": "…"}` events, then `data: {"done": true}` (or `data: {"error": "…"}`). With `voice: true` replies are short and written to be spoken (no markdown, no LaTeX).

## Voice

- `POST /api/stt` multipart `audio` (any browser recording format) + optional `lesson_id` → `{text}`. The lesson glossary biases recognition.
- `POST /api/tts {text, voice?}` → `audio/mpeg`. Cached on disk. `voice` is one of `tts.voices` from `/api/settings` (the frontend keeps the choice per profile on each device); omitted, the default `tts.voice`. `422` for a voice not offered, `503` when TTS is not configured.

## Review (FSRS)

- `GET /api/cards/due?limit=50` → `[{id, front, back, topic, lesson_id}]`, mixed across topics.
- `POST /api/cards {lesson_id?, front, back}` → `{id}`. The frontend adds a card for every missed question.
- `POST /api/cards/{id}/review {rating: 1|2|3|4}` → `{due: ISO-8601}` (Again, Hard, Good, Easy).
- `POST /api/lessons/{id}/complete` → `204`. Adds the lesson's `cards` (once; repeat calls do nothing). The frontend calls it when the learner finishes the lesson.

## Drill

`POST /api/drill {topic?, provider?}` → `Question` (numeric, back-of-envelope estimation). Without `topic`, picks from studied lessons.
