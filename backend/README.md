# Minerva backend

FastAPI app implementing `docs/api.md`.

```sh
cp ../config.example.toml ../config.toml   # then edit
uv run minerva                             # 0.0.0.0:8765 (MINERVA_PORT), data in ../data (MINERVA_DATA)
uv run pytest
```

- `config.py`: loads `config.toml` (`MINERVA_CONFIG` overrides the path).
- `llm.py`: `complete_json` and `stream_text` with role fallback; `openai` and `claude_code` providers.
  `claude_code` runs the official `claude` CLI headless with the user's own login, in an empty cwd,
  without the user's settings or CLAUDE.md.
- `prompts.py`: every prompt and the pedagogy rules.
- `widgets.py`: loads `shared/widgets/*.json` and validates widget visuals.
- `store.py`: SQLite (lessons, FSRS cards, review logs).
- `app.py`: routes, background lesson generation, voice proxies, the built frontend.
