# Agent instructions — DSHA

DSHA is an Android app (`dev.aum.dsha`) plus its backend `dsh`, a DeepSeek agent harness that runs in Termux.
Several agents (Claude Code, Codex) may work here. GitHub is the shared record: `origin` = github.com/aum-unreal/dsha (**private**), branch `main`.

## Layout
- `server/` — dsh (Node 24, no npm deps). `dsh.mjs` CLI; `lib/deepseek.mjs` API client + prices; `lib/agent.mjs` loop, permission gate, event log; `lib/tools.mjs`; `lib/server.mjs` HTTP/SSE API; `lib/store.mjs` ~/.dsh state. `~/.local/bin/dsh` execs `server/dsh.mjs` directly, so server edits go live on `dsh restart`.
- `src/dev/aum/dsha/Sse.java` — SSE batching, plain Java so `tests/SseCheck.java` runs it on the JVM.
- `src/dev/aum/dsha/MainActivity.java` — main native class: WebView on `https://dsha.local/`, a `Native` bridge doing HTTP + SSE to dsh, Termux RUN_COMMAND pairing, notifications, share intent.
- Fonts: `assets/fonts/*.ttf` are fontTools Latin subsets of Nightwire's pinned OFL files (Inter, JetBrains Mono); notices appended to `assets/vendor/LICENSES.txt`. JetBrains Mono is for code, commands and paths only.
- Design: taste-skill app sheet "true-black-flat" (`.taste-skill/direction.json`). Check with `node ~/.claude/skills/design-taste-frontend/scripts/lint.mjs --app assets/` (keep 0 FAIL). No gradients, glows, uppercase labels or emoji; colour only on data and status.
- Layout modes (`relayout()` in app.js): phone, `wide` (≥680px or two side-by-side viewport segments; split at the hinge from `native.posture`), `tabletop` (hinge half-open and landscape). `tests/ui.cjs` checks all three; `?posture=wide|tabletop` forces one in a browser.
- `assets/` — the web UI (`app.js`, `app.css`, `index.html`), vendored markdown-it / DOMPurify / highlight.js in `assets/vendor/` (copied from Nightwire's pinned node_modules; notices in `LICENSES.txt`).

## Rules
- DeepSeek thinking mode: when `tools` are sent, every assistant message's `reasoning_content` must be passed back. Never strip it from stored messages. Non-API data goes in `session.meta`, never on messages.
- Tests: `tests/run.sh` (node --test for the server, the SseCheck JVM test, then `tests/ui.cjs`, a Playwright run against a real dsh with a mock model, which writes `tests/ui-*.png`). Look at the screenshots after UI changes.
- Never commit API keys, the dsh token, or `~/.dsh`. The key lives only in `~/.config/deepseek/key`.

## After every APK version is built
Bump `versionCode`/`versionName` in `AndroidManifest.xml` (and `VERSION` in `server/lib/server.mjs` when the backend changes), add a README "Changes" line, run `tests/run.sh` and `./build.sh`, copy the APK to `~/storage/shared/Download/DSHA-<ver>.apk`, then `git pull --rebase`, commit and `git push origin main`. Never force-push. Add a TOOLCHAIN.md changelog line.
