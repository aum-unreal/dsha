# DSHA

A phone UI for **dsh**, a DeepSeek-powered coding/ops agent that runs on your own phone in Termux, with your files and shell.

```
DSHA (Android, WebView UI) ──HTTP+SSE, bearer token──▶ dsh (Node, Termux, 127.0.0.1:8787) ──▶ api.deepseek.com
                                                         └─ tools: bash, read/write/edit file, list, grep, glob, web_fetch, todo, + MCP servers from ~/.dsh/mcp.json
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
- Foldable-aware: unfolded, chat sits left of the hinge with an Inspector on the right (live tool output, tasks, session stats with files touched, sessions); half-folded in landscape (Flex mode), chat stays above the hinge and a control deck below has big approve/deny buttons, live output and quick actions; folded, the cover screen gets a denser single column. In the unfolded layout a top-bar button gives the chat the whole screen and hands it back. Uses the hinge-angle sensor plus the screen centre, or the Viewport Segments API when the WebView provides it.
- OLED design: true-black surfaces, hairlines and a blue-violet-cyan accent; Fraunces, DM Sans, JetBrains Mono and Space Mono bundled (Latin subsets, OFL).
- Notifications when a run finishes or needs approval while the app is in the background.

## Build & test
`./build.sh` writes `dsha.apk` (no-Gradle recipe, debug keystore). `tests/run.sh` runs the backend tests and the browser UI test.

## Security
dsh listens on 127.0.0.1 only and needs the token from `~/.dsh/config.json`. To expose it on another machine, set `host` in that file and put it behind HTTPS (the app permits cleartext only to localhost). In Auto mode the model can run any command as your Termux user.

## Changes
- 0.5.1 (8): MCP tool servers in dsh 0.3.0. `~/.dsh/mcp.json` lists servers (`command`/`args` for stdio, `url` for streamable HTTP, optional `start` hook and default `risk`); their tools join the built-ins, go through the same Ask/Edits/Auto gate, are re-listed every step (toolset gating), and each server's instructions are added to the system prompt. `dsh mcp [reload]` and `GET /api/mcp` show state. Ships configured for the Godot Editor MCP service (`godot-mcp start`, shared with Claude Code over `http://127.0.0.1:9090/mcp`). App: history cards summarise unknown tools' arguments.
- 0.1.0 (1): first version. dsh backend (agent loop, 9 tools, permission modes, SSE event log, sessions, compaction, terminal client) and the DSHA app (chat, approvals, sessions, settings, Termux pairing, notifications).
- 0.1.1 (2): fix the app sticking on "Working…" after a reply. The native SSE reader held the last batch of events (final text, usage, run_end) until another event arrived; it now flushes whenever the stream goes idle (`Sse.java`, JVM check `tests/SseCheck.java`). The UI also re-checks with dsh every 10 s while a run looks active.
- 0.4.0 (6): Light mode (Settings > Appearance: System, Dark or Light; the native side recolours the system bars). Generation speed in tok/s: dsh 0.2.0 measures each model call from first streamed token to end; shown in the meter, the Session tab (last and average) and live in the run strip while streaming (estimated). Composer keeps clear of the gesture bar; task-list summaries in plain text.
- 0.3.1 (5): Fix unfolded layout where the whole page scrolled, moving both panes together and pushing the top bar and Inspector tabs off screen. The grid row is now pinned to the viewport; `tests/ui.cjs` checks with a long chat and a long Inspector.
- 0.3.0 (4): Design revamp with taste-skill (style true-black-flat). Flat true-black surfaces, Inter plus JetBrains Mono for code only, white pill primaries, one cobalt hue on data. New run strip under the title: one segment per step of the current run, sized by time and coloured by state; tap one to jump to it. Plain-language tool status, row-style starters and recent sessions on the empty screen, KPI Session tab, the Flex-mode approval shown only in the deck.
- 0.2.0 (3): UI overhaul. OLED true-black theme, bundled stylised fonts, and foldable layouts: hinge-split dual pane with Inspector, tabletop Flex-mode deck and a compact cover screen. Native hinge-angle bridge (`TYPE_HINGE_ANGLE`).
- 0.5.0 (7): Fullscreen chat on foldables. In the unfolded layout a button in the top bar hides the Inspector and the hinge so the chat spans both panes; the choice is remembered across folding, and tapping a tool brings the Inspector back.
