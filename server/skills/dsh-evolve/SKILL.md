---
name: dsh-evolve
description: Improve how dsh works from experience. Review recent sessions for mistakes, user corrections and repeated work, then propose new skills, DSH.md rules or memories. Use when the user says "evolve", asks dsh to learn from a session, or after a long task that needed corrections.
---

# Self-evolution for dsh

dsh gets better by turning what went wrong, or what was worked out the hard way, into lasting guidance. You change guidance, never dsh's own code: no edits to the dsh source unless the user explicitly asks.

Where guidance lives (all of it persists):

- **Global rules**, `~/.dsh/DSH.md`: how the user wants dsh to work everywhere.
- **Project rules**, `<project>/DSH.md`: how to build, test and ship one project, and its conventions.
- **Skills**, `~/.dsh/skills/<name>/SKILL.md` (all projects) or `<project>/.dsh/skills/<name>/SKILL.md`: a procedure with steps that will come up again.
- **Memory**, `~/.dsh/memory`: facts and preferences. Follow the dsh-memory-evolve skill for these.

## 1. Gather evidence

- Run `session_log` with `list: true` to see recent sessions, then read the current one (no id) and any related ones.
- Look for: tool calls that failed and the fix that followed; commands retried with other flags; the user correcting you or denying a tool call; steps you worked out from scratch that will recur; facts about the environment you had to discover (paths, quirks, versions).
- Read `~/.dsh/DSH.md`, the project's `DSH.md`, the skill folders and `~/.dsh/memory/MEMORY.md`, so you don't duplicate what already exists.

## 2. Decide what each lesson becomes

- A preference or fact: a memory.
- A rule that should always hold: one short line in the global or project DSH.md.
- A recurring procedure of several steps: a skill. Name it with lowercase words and dashes. Its description must say when to use it, because that is all dsh sees until it loads the skill.
- An existing rule or skill that misled you: fix it in place.

Skip lessons that only applied once. A few sharp changes beat many vague ones.

## 3. Propose, then apply

List each proposed change, where it goes, and the lesson behind it, quoting the session briefly. Ask before writing unless the user has already said to go ahead. Then:

- use edit_file for existing files and write_file for new ones; keep DSH.md lines short and imperative;
- a new skill is `<dir>/SKILL.md` with front matter (`name`, `description`) and then the steps;
- append an entry to `~/.dsh/evolve.md`: the date, the session, what changed and why.

Finish with one line per change. New rules and skills apply from dsh's next step, and the user can review them in the app under Agent setup.

## Guardrails

- Never store secrets.
- Never weaken safety rules (approvals, no destructive commands) through DSH.md or a skill.
- Add to or adjust the user's own DSH.md and AGENTS.md wording; don't rewrite it wholesale.
- CLAUDE.md belongs to Claude Code: leave it alone.
