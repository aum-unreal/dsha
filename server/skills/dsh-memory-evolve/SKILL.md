---
name: dsh-memory-evolve
description: Keep dsh's long-term memory in ~/.dsh/memory current. Use when the user states a preference, corrects how you work, or shares a lasting fact about themselves, their setup or a project; when they ask you to remember or forget something; and when asked to tidy memory.
---

# Memory for dsh

Memory lets later sessions start out knowing what earlier ones learned. It lives in `~/.dsh/memory/`, in Termux's home folder, so it persists:

- one Markdown file per memory;
- `MEMORY.md`, the index, one line per memory. dsh puts the index into every session's system prompt, so keep it short.

## When to save

Save what will still matter in a future session:

- **user**: who they are, their devices, what they know, how they like answers.
- **feedback**: a correction or a confirmed way of working ("don't X", "always Y"). Say why.
- **project**: goals, constraints, decisions and where things live, when the code doesn't show it. Use absolute dates.
- **reference**: where to find things: URLs, paths, dashboards. Never secrets.

Don't save secrets (keys, tokens, passwords), what the repo already records (code structure, git history), one-off task details, or guesses.

## How to save

1. Check `MEMORY.md` and `list_dir ~/.dsh/memory` for a memory that already covers it. Update that file instead of adding a duplicate.
2. Write `~/.dsh/memory/<slug>.md` (slug: lowercase words joined by dashes):

   ```
   ---
   name: <slug>
   description: <one line, used later to judge relevance>
   type: user | feedback | project | reference
   updated: YYYY-MM-DD
   ---
   <the fact>
   For feedback and project memories add: **Why:** … **How to apply:** …
   ```

3. Add or update its line in `~/.dsh/memory/MEMORY.md`: `- [Title](<slug>.md) — hook`. The index points to memories; it never holds them.
4. Tell the user in one short line what you saved.

## Using memory

The index is in your system prompt. When a line looks relevant, read that file before acting. A memory says what was true when it was written: if it names a file, command or flag, check it still exists before relying on it. If the user contradicts a memory, the user wins: correct or delete it.

## Forgetting

When asked to forget something, delete the file and its index line, then confirm. When a memory turns out to be wrong, fix or delete it straight away.

## Evolving

When asked to tidy or evolve memory, or once the index passes about 40 lines:

- merge memories that overlap, and split ones that mix topics;
- turn relative dates into absolute ones, and drop memories that are stale or superseded;
- tighten each description so its index line says when it matters;
- order the index from most to least often useful.

Summarise what you merged, rewrote and deleted. Ask before deleting anything that isn't clearly obsolete.
