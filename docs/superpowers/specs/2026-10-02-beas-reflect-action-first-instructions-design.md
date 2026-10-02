# Action-first instructions for claude-reflect: design spec

- **Date:** 2026-10-02
- **Status:** approved 2026-10-02, then adjusted the same day for local-only work
- **Where it lives:** your personal fork of claude-reflect, worked and finished locally. Upstream (BayramAnnakov/claude-reflect) is out of the picture.
- **Scope decision (approved 2026-10-02):** everything in one change: what /reflect writes for users, and the instructions the plugin gives Claude.

## Goal

Make claude-reflect write every instruction as the action to take: the correct move first, then the reason that makes it correct. This covers the memories /reflect writes into users' files and the instructions the plugin itself gives Claude.

## The problem this change solves

1. **/reflect plants prohibitions in users' memory files by design.** `commands/reflect.md:1525` tells Claude to "Use imperative negative form: 'Don't X'", and the guardrail card's example entry is `- Don't add docstrings to code unless explicitly asked`. Everyone who runs /reflect accumulates "Don't..." lines in CLAUDE.md and `.claude/rules/guardrails.md`.
2. **A prohibition names one wrong move and no right one,** and it keeps the unwanted pattern in the model's context, where it can be matched instead of avoided.
3. **The positive rules carry wrong answers along too.** The formatting rule's example is `(e.g., gpt-5.2 not gpt-5.1)` (`reflect.md:1453`).
4. **The skill's own prose leans on the same form:** "DO NOT PROCEED", "NEVER filter out", "Do NOT try to validate".
5. **Outside evidence points the same way, with a limit.** Superpowers measured in June 2026 that prohibitions backfire when the model is composing output it has its own ideas about (worse than having no rule), while a simple one-off "don't" held 5 of 5 times. This work measures the claude-reflect case directly instead of leaning on a general claim.

## The rule applied to every file in scope

Write each instruction as the action to take.

1. **Lead with the move:** an imperative verb naming what to do.
2. **Follow with the mechanism when one is known:** the reason the move is correct, joined with a colon.
3. **Replace a ban with the move that takes its place.** When the user named the replacement ("use pnpm"), use it. When the user named only the unwanted move, state the condition for the move ("Write docstrings only when the user asks for them") or the boundary of the work ("Change only the files the request names").
4. **Keep the unwanted move out of the instruction.** The mechanism explains why the right move works, not what the wrong one does. Version and model corrections are the one open question; Eval 2 case M settles it (see Measurement).
5. **Carry the user's reason when they gave one; write the action alone when they did not.** Reasons are never invented.

| Before (today) | After |
|---|---|
| `- Don't add docstrings to code unless explicitly asked` | `- Write docstrings only when the user asks for them` |
| `- Never use force push` | `- Push with plain git push; when the remote rejects it, rebase onto the remote first` |
| `- Use gpt-5.2 for reasoning tasks (e.g., gpt-5.2 not gpt-5.1)` | `- Use gpt-5.2 for reasoning tasks` (pending case M) |
| `Check .env for service URLs - don't assume localhost` | `Read service URLs from .env: each environment sets its own host` |
| `**DO NOT PROCEED** to the next section until you have initialized the task list with TodoWrite.` | `**Create the TodoWrite task list first:** every later step checks itself off against it.` |
| `**NEVER filter out remember: items**` | `**Keep every remember: item:** the user asked for it by name.` |
| `Do NOT combine these into a single compound command with $(...)` | `Run each command on its own and paste its result into the next one: Claude Code's bash executor mangles subshell syntax.` |
| Option text `"Don't store this learning"` | `"Discard this learning"` |

## What changes

### Layer 1: what /reflect writes for users

- `commands/reflect.md`
  - Formatting Rules (lines 1448-1453): add the rule above; replace the `X not Y` example.
  - Guardrail Routing (1494-1527): new presentation card entry and "Formatting guardrails" list built on the rule.
  - Section header descriptions (1461-1462) and Target Selection descriptions (70-72).
  - Every place that tells Claude how to word a learning (634-637, 916) and every example entry that shows the output (dedupe, organize, consolidation, skill-file examples, such as "Never use force push" at 422).
- `scripts/lib/semantic_detector.py`
  - `ANALYSIS_PROMPT`: the `extracted_learning` guideline gets the rule. The input descriptions ("don't use Z") stay, because they describe what users type.
  - `ERROR_TO_GUIDELINE_PROMPT`: the `refined_guideline` guideline gets the rule.
  - `CONTRADICTION_PROMPT`: its own rules rewritten action-first.
- `scripts/lib/reflect_utils.py`: the guideline templates in `PROJECT_SPECIFIC_ERROR_PATTERNS`.
- `commands/reflect-skills.md`: the Guardrails section of the generated skill template, and the guidance that turns corrections into guardrails.
- `README.md` and `SKILL.md`: output examples, so the docs match what /reflect now writes. README's own explanatory prose stays as written.

### Layer 2: instructions the plugin gives Claude

- `commands/reflect.md`, `commands/reflect-skills.md`, `commands/view-queue.md`, `commands/skip-reflect.md`, `SKILL.md`: every prohibition-form instruction rewritten with the rule, including option descriptions shown to the user in AskUserQuestion menus.
- Contrast examples come out where the good example stands alone (the "NOT: I found 3 messages containing 'linkedin'" block in `reflect-skills.md`).

### Found during planning

- **Step 2a of `reflect.md` finds the current session file with `ls ~/.claude/projects/ | grep -i "$(basename $(pwd))"`.** The same file warns twice that a folder found by grep is the wrong folder and that `$(...)` gets mangled. Step 2a switches to the newest main session file from `project_paths.py`, as Step 0.5a already does. Included because Layer 2 rewrites the surrounding prose anyway.

## Unchanged by design

| Kept as is | Reason |
|---|---|
| Detection patterns and their names (`dont-unless-asked`, the Default English patterns list, `GUARDRAIL_PATTERNS`) | They match what users type, and users will keep typing "don't". |
| Quoted user messages in examples ("Original: don't add docstrings unless I explicitly ask") | They show input, not instructions. |
| Heading and file names (`## Guardrails`, `## Common Errors to Avoid`, `guardrails.md`), queue item types, routing code | Existing users' files already use these names, and `reflect_utils.py` routes on "guardrail" in the file name. Renaming would split a user's entries across old and new headings. The descriptions of these headings do change. |
| Python logic and code comments | Developers read them; Claude reads the prompts and command files at runtime. |
| Workflow behavior | Every step keeps doing what it does today: a dry run writes nothing, remember: items always survive, tool rejections are always shown. Only wording changes. Eval 3 checks this. |

## Measurement

### Harness

- **`scripts/compare_phrasing.py`**, standard library only, named after the existing `scripts/compare_detection.py`, so you can rerun it whenever the wording changes. It needs no API key.
- **Isolation:** every call goes through `_run_claude()` in `semantic_detector.py`, built on the `isolate-semantic-calls` branch: no CLAUDE.md files, hooks, MCP servers, tools or saved sessions. Reason: a plain `claude -p` loads the runner's own CLAUDE.md. Verified 2026-10-02: a plain call quoted your global CLAUDE.md back word for word, which would have tilted every result toward your rule.
- **Cases** live in `tests/fixtures/phrasing_cases.json`.
- **Output:** a results table on stdout, raw outputs saved to a folder passed on the command line, and the tables copied into `work/eval-results.md`.
- **Statistics:** raw counts per cell, plus a two-sided Fisher exact test (a few lines with `math.comb`). A difference counts only at p < 0.05.

### Eval 1: does /reflect now write action-first entries?

Tests the pipeline: the exact prompt text shipped before and after.

- **Inputs:** 15 corrections: guardrails ("don't X unless I ask"), replacements ("use X not Y"), stale versions, scope ("leave X alone"), explicit `remember:` items, and one non-English correction.
- **Stage A:** `ANALYSIS_PROMPT` before and after; score `extracted_learning`.
- **Stage B:** reflect.md's formatting and guardrail sections before and after, as the system prompt, asking for the exact bullet /reflect would add; score the bullet.
- **Scores:** entries that open with a negation (don't, do not, never, avoid, stop, no), and entries that mention the unwanted option.
- **Runs:** 3 per correction per version per stage (180 calls), model `sonnet`, which is claude-reflect's default for semantic analysis.
- **Pass:** the new version opens with a negation in at most 1 of 45 entries per stage, and mentions the unwanted option less often than the old version.

### Eval 2: does an action-first memory cause fewer slips than a prohibition?

Tests the thesis: the same rule in three forms, a task that tempts the slip.

- **Forms:** P is the prohibition, taken from what /reflect writes today. A is the action-first form. C is no rule (the control).
- **Setup:** the system prompt is a short CLAUDE.md-style memory block holding the rule; the user prompt is the task.

| Case | P (today) | A (action-first) | Task | Slip |
|---|---|---|---|---|
| E | Never use em dashes | Join clauses with commas, colons, or periods | 150-word product blurb | each em dash character (U+2014) |
| D | Don't add docstrings to code unless explicitly asked | Write docstrings only when the user asks for them | two small Python functions | each function with a docstring |
| F | Never use force push | Push with plain git push; when the remote rejects it, rebase onto the remote first | "push rejected, remote has commits, get my commit up fast" | any force flag |
| S | Don't refactor unrelated code | Change only the lines the request names | fix one bug in a 40-line file with messy code nearby, return the whole file | lines changed outside the buggy function |
| M | Use gpt-5.2 for reasoning tasks (e.g., gpt-5.2 not gpt-5.1) | Use gpt-5.2 for reasoning tasks | Python call to the OpenAI API for a reasoning task | any model name other than gpt-5.2 |

- **Pilot:** 5 control runs per case. Keep a case only when the control slips at least 2 of 5 times, since a case nobody fails can't show a difference. Dropped cases go in the report with their pilot numbers.
- **Main run:** 20 runs per form per kept case (up to 300 calls), model `sonnet`.
- **Decisions fixed in advance:**
  - Case M decides rule 4. If P slips significantly less than A, version and model corrections keep a short "(replaces gpt-5.1)" note; every other entry follows rule 4.
  - If A loses to P on any other case, the results say so plainly and that case's wording gets revisited before the branch is finished.

### Eval 3: does /reflect still work end to end?

- **pytest:** `python -m pytest tests/ -v` passes. `tests/test_semantic_detector.py` checks keywords inside `ANALYSIS_PROMPT`; the rewrite keeps them.
- **Dry run, before and after:** `/reflect --dry-run` through the Claude CLI with `--plugin-dir` pointed first at a copy of the base branch `isolate-semantic-calls` and then at the rewritten branch (comparing against `main` would mix in the two semantic-analysis fixes), in a throwaway project with a seeded queue of 5 items (a `remember:` item, a guardrail, a replacement, a stale version, and one non-learning). 3 runs each.
- **Checks:** every file unchanged after the dry run (hash before and after), every `remember:` item shown, the non-learning filtered, and the count of proposed entries that open with a negation.
- **Limit:** reflect.md's context block pulls in the runner's real `~/.claude/CLAUDE.md`, which holds your own action-first rule, so both versions see it. The dry-run negation counts are informational; Eval 1 is the clean phrasing measurement.
- **Safety:** these runs get Read, Glob, Grep and Bash only (Edit and Write disallowed). `~/.claude/CLAUDE.md` is backed up and hash-checked after each run and restored from the backup if it changed. The seeded project's session folder gets its `.reflect-initialized` marker up front, so the first-run question never fires in a non-interactive run.

### Time and cost

About 45 to 60 minutes of wall-clock time with 4 calls in parallel, roughly 500 short calls plus 6 full dry runs. It runs on your Claude subscription's usage.

## Branch and finish

- **Branch:** `action-first-instructions`, started from `isolate-semantic-calls`. Reason: the harness reuses that branch's isolated `_run_claude()`, and both branches rewrite `semantic_detector.py`, so stacking them avoids a merge conflict later.
- **Commits, one per layer,** so any layer can be reverted on its own: (1) harness and fixtures, (2) layer 1 rules, prompts and templates, (3) layer 2 prose, (4) README, SKILL.md and CHANGELOG. Commit messages follow the rule too.
- **CHANGELOG:** an Unreleased entry.
- **Finishing gate:** you see the complete diff and the eval results, then choose how to finish. Merging into your local `main` brings in both branches.

## Working files

- This spec, the plan and a status tracker live in `work/`, which the local git exclude file keeps out of every commit.
- Raw eval outputs go to `work/eval-runs/`. Problems found during an eval run go to `work/eval-report.md` and get fixed after the run.

## Risks

| Risk | Response |
|---|---|
| Rewritten workflow prose changes behavior | Eval 3 and pytest. |
| The thesis loses on some case | Decisions fixed in advance; results reported as measured. |
| Model output varies run to run | 20 runs per cell, Fisher p reported, raw outputs kept. |
