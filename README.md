# Minerva

A personal app for learning complex technical topics deeply. You give it a topic. It checks what you already know, then builds a lesson: you predict before each reveal, hear narration over interactive simulations, ask a tutor, solve estimation problems, explain the idea back, and review with spaced repetition. Read mode shows the same lesson as one structured document.

While learning you can interrupt the narration and ask out loud, rewind or jump to any sentence, keep several tutor chats per lesson (rewind one to any question, quote selected text, replay a reply aloud), and ask for a section to be rewritten or extended (say, with an interactive animation).

Works with your Claude subscription (through the official `claude` CLI) and any OpenAI-compatible local model server. Runs on one machine (PC or Pi); use it from any browser on your tailnet.

## Run

```sh
cp config.example.toml config.toml        # edit providers, roles, [learner]
cd frontend && npm install && npm run build && cd ..
cd backend && uv run minerva              # serves the app and API on 0.0.0.0:8765
```

Open `http://<host>:8765`. For Claude, install Claude Code on the same machine and log in once with `claude`.

To start it at login instead: `cp deploy/minerva.service ~/.config/systemd/user/ && systemctl --user enable --now minerva` (edit `WorkingDirectory` if the repo lives elsewhere).

### HTTPS (needed for the mic on iPhone and iPad)

`tailscale serve` can give you HTTPS directly. If your tailnet can't issue certificates (e.g. headscale), use a domain you own: a DNS-only Cloudflare record (say `minerva.example.com`) pointing at the machine's tailnet IP, so only tailnet devices reach it, and Caddy gets a Let's Encrypt cert through a Cloudflare DNS challenge:

```sh
# Caddy built with the Cloudflare DNS plugin
curl -sSL -o ~/.local/bin/caddy "https://caddyserver.com/api/download?os=linux&arch=amd64&p=github.com%2Fcaddy-dns%2Fcloudflare" && chmod +x ~/.local/bin/caddy
# ~/.config/minerva/cloudflare.env, mode 600, holds CF_API_TOKEN=... (an "Edit zone DNS" token for your zone)
# and MINERVA_HOST=minerva.example.com
cp deploy/caddy.service ~/.config/systemd/user/caddy-minerva.service
systemctl --user enable --now caddy-minerva
```

Open `https://minerva.example.com:8443`. On iOS, use Safari → Share → Add to Home Screen.

### Voice

[speaches](https://github.com/speaches-ai/speaches) serves both directions on CPU, so the GPU stays free for the LLM: Kokoro for speech (~1.2 s per sentence) and Parakeet for recognition (~0.3 s per question). Misheard jargon is snapped to the lesson's glossary. Set up as a systemd user service:

```sh
git clone --depth 1 --branch v0.9.0-rc.3 https://github.com/speaches-ai/speaches ~/.local/share/voice/speaches
cd ~/.local/share/voice/speaches
sed -i 's/^required-version = .*/required-version = ">=0.8.14"/' pyproject.toml   # it pins an old uv
uv sync --no-dev
cp <minerva>/deploy/speaches.env ~/.local/share/voice/
cp <minerva>/deploy/speaches.service ~/.config/systemd/user/
systemctl --user enable --now speaches    # first start downloads the models
```

`config.example.toml` already points `[tts]` and `[stt]` at it. Any other OpenAI-compatible speech server works too; without them the app uses the browser's voice and hides the mic.

### Settings

The Settings page (also a sheet inside a lesson) picks, per job (lessons, tutor), which model runs it, which Claude model, and how hard local models think. The Claude model and thinking are saved on the server in `data/settings.json` and override `config.toml`; the other choices stay on the device. Everything else (providers, voice, learner profile) comes from `config.toml` and needs a restart.

## Develop

```sh
cd backend && uv run pytest
cd frontend && npx tsc -b && npx vitest run && npx oxlint src
cd frontend && npx vite                   # dev server, proxies /api to :8765; widget gallery at /gallery
```

- `docs/api.md`: the HTTP contract.
- `backend/src/minerva/lesson.py` and `frontend/src/lesson.ts`: the lesson format, mirrored; change both together.
- Widgets: a component in `frontend/src/widgets/` plus a catalog entry in `shared/widgets/<name>.json` (the schema the lesson generator sees). Pure math lives in `<name>.math.ts` with tests.
- The PWA service worker caches the build: after deploying a new build, a page needs one reload to pick it up.
