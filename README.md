# DSHA

A phone UI for **dsh**, a DeepSeek-powered coding/ops agent that runs on your own phone in Termux, with your files and shell.

```
DSHA (Android, WebView UI) ──HTTP+SSE, bearer token──▶ dsh (Node, Termux, 127.0.0.1:8787) ──▶ api.deepseek.com
                                                         └─ tools: bash, read/write/edit file, list, grep, glob, web_fetch, todo
```

## Use
1. In Termux: `dsh key` (or put the key in `~/.config/deepseek/key`), then `dsh start`.
2. Open DSHA → **Pair with Termux**. The app runs `dsh start && dsh token` through Termux's RUN_COMMAND (needs `allow-external-apps = true` in `~/.termux/termux.properties`, and Android asks once for the permission). You can also paste the URL and `dsh token` output in Settings.
3. Chat. Tool calls show as cards; in **Ask** mode, shell, edits and web fetches wait for Allow / Always / Deny. **Edits** auto-allows file edits. **Auto** allows everything.

The terminal client shares sessions with the app: `dsh` (new session in the cwd), `dsh -c` (continue), `dsh ls`, `dsh status|start|stop|restart`, `dsh token`.

### Features
- Streams thinking (collapsible, timed), text and live tool output. Runs continue in the backend if the phone sleeps or the app closes; reopening replays the run from the event log.
- Models: `deepseek-flash` / `deepseek-v4-pro`, thinking off/low/high/max, per session. Token, cache and cost meter.
- Sessions drawer, folder picker, `/compact` (auto near 700k tokens), edit and resend a message, share transcript, share text into DSHA.
- Project instructions: `DSH.md`, `AGENTS.md` or `CLAUDE.md` in the working directory are added to the system prompt.
- Notifications when a run finishes or needs approval while the app is in the background.

## Build & test
`./build.sh` writes `dsha.apk` (no-Gradle recipe, debug keystore). `tests/run.sh` runs the backend tests and the browser UI test.

## Security
dsh listens on 127.0.0.1 only and needs the token from `~/.dsh/config.json`. To expose it on another machine, set `host` in that file and put it behind HTTPS (the app permits cleartext only to localhost). In Auto mode the model can run any command as your Termux user.

## Changes
- 0.1.0 (1): first version. dsh backend (agent loop, 9 tools, permission modes, SSE event log, sessions, compaction, terminal client) and the DSHA app (chat, approvals, sessions, settings, Termux pairing, notifications).
- 0.1.1 (2): fix the app sticking on "Working…" after a reply. The native SSE reader held the last batch of events (final text, usage, run_end) until another event arrived; it now flushes whenever the stream goes idle (`Sse.java`, JVM check `tests/SseCheck.java`). The UI also re-checks with dsh every 10 s while a run looks active.
