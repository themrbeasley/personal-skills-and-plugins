# Eval results: action-first instructions

All runs: model `sonnet`, Claude Code 2.1.287, Windows 11, isolated calls through `_run_claude()` (no CLAUDE.md, hooks, MCP, tools or saved session). Raw replies in `work/eval-runs/`.

## Summary

| Eval | Question | Answer |
|---|---|---|
| 2 (thesis) | Does a rule written as an action cause fewer slips than the same rule written as "Don't"? | Not measurably, on this setup. Both held perfectly (0/20 slips each) on docstrings, force push and model names, against 18 to 20 slips out of 20 with no rule. Two cases (em dashes, unrelated edits) never slipped even without a rule, so they could not test anything. |
| 1 (rewrite) | Does /reflect now write action-first entries? | Yes. Entries holding "don't", "do not" or "never" anywhere: 40 of 90 before, 0 of 90 after (final rerun). Entries naming the rejected option: 48 of 48 before, 2 of 48 after. All 45 real corrections recognized, 0 of 6 non-learnings let through. |
| 3 (end to end) | Does /reflect still work after its own instructions were rewritten? | Yes. 6 of 6 dry runs wrote nothing, kept the `remember:` item, skipped the non-learning, and caught the duplicate. The new version also proposes rewriting an old "Don't" entry when a matching correction arrives. |
| 4 (harder thesis: haiku, 30 rules) | With a full memory file and a weaker model, does phrasing matter? | Yes, in one specific way. In a task about writing, both phrasings worked. In a task about something else (git), the all-"Never" file's em dash rule had no effect (14/20 slips, same as no rule), while the action-first file held it (1/20, p = 0.00004), replicated across two runs. An action rule has to name what it governs: "Join clauses with commas" failed where "Keep em dashes out of all text" held. Other rules tied. |

What each number means in one sentence:
- **Eval 2:** a single rule in a short memory file is followed perfectly by sonnet whichever way it is phrased, so this test cannot show your priming effect; a harder test (many rules, long context, real task pressure, a weaker model) would be the next place to look.
- **Eval 1:** the wording change does what it says; /reflect stops putting "Don't" and rejected options into your memory files.
- **Eval 3:** the rewritten workflow behaves like the old one in every check, and adds a migration path for old prohibitions.

Decisions taken: case M "no note" (version corrections name only the chosen version). Verdicts overturned by hand review: none. Problems found and fixed during the evals: three wording problems in Eval 1's first run (see `work/eval-report.md`), and one Windows encoding bug in the semantic analysis call (own commit).

## Eval 2 pilot

Control only (filler rule, no target rule), 5 runs per case. A case stays when the control slips at least 2 of 5 times.

| Case | Form | Slips | Runs | Empty replies | Verdict |
|---|---|---|---|---|---|
| E (em dashes) | control | 0 | 5 | 0 | drop |
| D (docstrings) | control | 5 | 5 | 0 | keep |
| F (force push) | control | 5 | 5 | 0 | keep |
| S (unrelated edits) | control | 0 | 5 | 0 | drop |
| M (model name) | control | 5 | 5 | 0 | keep |

Hand check: S replies each had one code block, zero outside changes, and kept `import os, sys` untouched. All 5 F replies used `git push --force-with-lease origin main`. All 5 D replies had docstrings. M replies used gpt-4o (3), o3-mini (1), o4-mini (1). E replies had zero em dash characters (counted by hand; the harness scorer was broken until commit 2e5fb19, and rescoring with the fixed scorer also gives 0 of 5).

Reading: with no rule at all, sonnet in an isolated Claude Code call already writes without em dashes and already leaves unrelated code alone, so E and S cannot show a difference between phrasings.

## Eval 2 main run

20 runs per form per kept case. P = prohibition (what /reflect writes today), A = action-first, C = control (no rule). Slip = the reply does the thing the rule is about.

| Case | P slips | A slips | C slips | A vs P (Fisher p) | P vs C | A vs C |
|---|---|---|---|---|---|---|
| D (docstrings) | 0/20 | 0/20 | 18/20 | 1.0000 | 0.0000 | 0.0000 |
| F (force push) | 0/20 | 0/20 | 20/20 | 1.0000 | 0.0000 | 0.0000 |
| M (model name) | 0/20 | 0/20 | 20/20 | 1.0000 | 0.0000 | 0.0000 |

Hand check: no P or A reply in D has a docstring; all 40 P and A replies in M use `model="gpt-5.2"`; the 2 D control replies scored as non-slips (D-control-01, D-control-18) have no docstrings. Five F replies contain `git push --force` text, all as warnings in prose ("I'd avoid `git push --force` here"), none as a command; the scorer counted them correctly as non-slips. No verdict overturned.

Reading: a single rule in a short CLAUDE.md, in a fresh isolated call, is obeyed perfectly by sonnet in either phrasing. This setup cannot separate the two forms: both sit at the floor (0 slips) while the control sits at the ceiling. The thesis gets no support and no contradiction from slips here.

Exploratory (chosen after seeing the data, so weaker evidence): the five replies that named `git push --force` in a warning were all A replies (A 5/20, P 0/20, Fisher p = 0.047). When the rule named only the right move, Claude sometimes volunteered the wrong move by name to explain the rule; when the rule named the wrong move, it said "your CLAUDE.md forbids force push" and moved on. Both forms mention force pushing in prose in 20 of 20 replies, because the task invites it.

## Decisions

- **Case M: no note.** P (names gpt-5.1) did not slip less than A (0/20 vs 0/20, p = 1.0). Version and model corrections follow rule 4 like every other entry: name only the chosen version.
- **No case where A slipped more than P.** No A wording needs revisiting.

## Eval 1

15 corrections and 2 non-learnings, 3 runs each. Stage A: `ANALYSIS_PROMPT` (the AI step that words a queued correction). Stage B: reflect.md's Formatting Rules through Guardrail Routing, asked for the exact bullet /reflect will add. Before = `isolate-semantic-calls`, after = working tree.

First run (opening-negation metric only):

| Stage | Version | Opens with a negation | Names the replaced option | Judged a learning |
|---|---|---|---|---|
| A | before | 9/41 | 23/23 | 41/45 corrections, 0/6 non-learnings |
| A | after | 0/44 | 3/24 | 44/45 corrections, 0/6 non-learnings |
| B | before | 18/45 | 24/24 | n/a |
| B | after | 0/45 | 3/24 | n/a |

Hand review found three problems (see `work/eval-report.md`): reasons re-naming the old option, absolute bans turned into "only when the user asks" permissions, and "do not" inside entries. Fixed in the prompt and the Formatting Rules; a "negation anywhere" column added.

## Eval 1 (after fixes)

| Stage | Version | Opens with a negation | Negation anywhere | Names the replaced option | Judged a learning |
|---|---|---|---|---|---|
| A | before | 11/44 | 18/44 | 24/24 | 44/45 corrections, 0/6 non-learnings |
| A | after | 0/45 | 0/45 | 0/24 | 45/45 corrections, 0/6 non-learnings |
| B | before | 15/45 | 16/45 | 24/24 | n/a |
| B | after | 0/45 | 0/45 | 2/24 | n/a |

Pass criteria met: at most 1 of 45 negation openings per stage (0 and 0), fewer old-option mentions than before (0 vs 24, 2 vs 24), judged-a-learning within range (ruling logged for the first run's 41 vs 44).

Hand review, after fixes: `env` kept its meaning in the first half but added an invented method after the colon ("leave them untracked and listed in .gitignore"), fixed after the final review (below); `tests` kept its meaning; `yarn-reason` carries its reason after a colon; no absolute ban becomes a permission; `russian` reads "Use date-fns for date handling". Residuals, minor: Stage B named the old option in 2 of 24 (`timestamps` once, `staging` once with an invented "the user corrected this from dev.example.com"); Stage A `force-push` entries add unrequested alternatives ("or push through a feature branch") and a parenthetical "(non-force)"; one `config` entry adds "unless the user asks".

Caveat on overlap: the `docstrings` correction matches the example in both prompts, and `force-push` matches the Stage B "Formatting guardrails" example, so their after entries are partly copied. The other 13 corrections appear in no prompt.

Run-to-run noise: the two "before" runs differ (opening negations A 9/41 vs 11/44, B 18/45 vs 15/45) while the prompts were identical.

## Eval 3

`/claude-reflect:reflect --dry-run` through the Claude CLI (`--plugin-dir`, `--setting-sources project`, hooks off, Edit/Write disallowed, sonnet), in a throwaway project whose CLAUDE.md holds `- Don't add docstrings to code unless explicitly asked`, with a seeded queue of 5 items. Before = `isolate-semantic-calls`, after = this branch. `~/.claude/CLAUDE.md` backed up and hash-checked after every run.

| Run | Exit | Files changed | remember: item shown | Non-learning mentioned |
|---|---|---|---|---|
| before-0 | 0 | none | True | True |
| after-0 | 0 | none | True | True |
| before-1 | 0 | none | True | True |
| after-1 | 0 | none | True | True |
| before-2 | 0 | none | True | True |
| after-2 | 0 | none | True | True |

Hand review of all six transcripts:

| Check | Before (3 runs) | After (3 runs) |
|---|---|---|
| Dry run wrote nothing (hash) | 3/3 | 3/3 |
| `remember:` item kept and proposed | 3/3 | 3/3 |
| Non-learning ("no, I meant the other file") skipped | 3/3 | 3/3 |
| Queued docstring rule flagged as duplicate of the existing "Don't" line | 3/3 (skip, keep the "Don't" line) | 3/3 (replace it with "Write docstrings only when the user asks for them") |
| Proposed entries naming the rejected option | 4 ("(replaces gpt-5.1)" x2, "(e.g., gpt-5.2 not gpt-5.1)", "(e.g., pnpm install, not npm install)") | 0 |
| Proposed entries opening with a negation | 0 new entries (the only "Don't" one was skipped as a duplicate) | 0 |
| Steps skipped relative to before | n/a | none attributable to the rewrite; both versions classified by hand instead of calling the semantic CLI, and TodoWrite was unavailable to both |

Behavior change worth knowing: when a queued correction duplicates an existing "Don't X" entry, the rewritten /reflect proposes replacing the old entry with the action-first wording (3/3) where the old version skipped it (3/3). The user still approves each replace.

Limit: reflect.md's context block pulled the runner's `~/.claude/CLAUDE.md` into every run (before-0 even cites "your global rules"), so the before runs are already nudged toward action-first wording.

## Eval 1 (after the final review's fixes)

The reviewer found that the outright-ban example ("never deploy on Fridays" became "Deploy Monday through Thursday") narrowed meaning, that "make every clause a move" invited invented content, and that "leave X alone" mapped to a rule that dropped X. Fixed in commit d47cd1a.

| Stage | Version | Opens with a negation | Negation anywhere | Names the replaced option | Judged a learning |
|---|---|---|---|---|---|
| A | before | 12/45 | 20/45 | 24/24 | 45/45 corrections, 0/6 non-learnings |
| A | after | 0/45 | 0/45 | 0/24 | 45/45 corrections, 0/6 non-learnings |
| B | before | 17/45 | 20/45 | 24/24 | n/a |
| B | after | 0/45 | 0/45 | 2/24 | n/a |

Hand review: `env` "Keep .env files out of commits." 6/6; `config` "Keep the config files as they are." or "Keep config files unmodified" 6/6; `force-push` extraction "Keep force pushes off the main branch." 3/3 (Stage B still copies the spec's rebase example 3/3); `staging` "Use staging.example.com as the staging URL." 6/6 with no invented reason; `refactor` keeps unrelated code as it is 6/6. Residual: `timestamps` Stage B keeps the user's own "not unix epochs" in the reason 2/3.

## Eval 4: the harder thesis test (haiku, 30 rules)

Requested by the user after Eval 2 sat at the floor. Model `haiku`. Memory: 25 everyday rules plus all 5 target rules (one per case, spread at every sixth slot), every rule in the same phrasing: P = all prohibitions (what old /reflect writes), A = all action-first. Control = the 25 everyday rules in action form, no target rules. Harness: `compare_phrasing.py slips --rulebook --model haiku`.

### Pilot (control, 5 runs per case)

| Case | Control slips | Verdict |
|---|---|---|
| E (em dashes) | 3/5 | keep |
| D (docstrings) | 0/5 | drop |
| F (force push) | 0/5 | drop |
| S (unrelated edits) | 1/5 | drop |
| M (model name) | 5/5 | keep |

Hand check: E em dashes 1, 2, 2, 0, 0; D no docstrings 5/5; F every push plain (`git push origin <branch>`), the everyday rules about main and pull requests already steer haiku away from force; M used gpt-4o x2, gpt-4 x3.

### Measures fixed before the main run

- **Primary (pre-set keep rule):** E and M slips, P vs A, 20 runs each, Fisher two-sided.
- **Secondary, declared now, before seeing main-run data:** (1) D, F and S are run anyway at 20 per form, because this control holds 25 other rules rather than no rules, so a dropped case can still separate P from A; (2) **em dashes anywhere**: the em dash rule sits in every P and A memory, so count replies with at least one em dash across all 5 tasks, 100 replies per form.

### Main run (20 per form)

| Case | P slips | A slips | C slips | A vs P (Fisher p) |
|---|---|---|---|---|
| E (em dashes, primary) | 9/20 | 17/20 | 16/20 | 0.0187 (P better) |
| M (model name, primary) | 1/20 | 2/20 | 20/20 | 1.0000 |
| D (docstrings, secondary) | 0/20 | 0/20 | 1/20 | 1.0000 |
| F (force push, secondary) | 0/20 | 0/20 | 5/20 | 1.0000 |
| S (unrelated edits, secondary) | 1/20 | 0/20 | 5/20 | 1.0000 |

Em dashes anywhere (secondary, fixed before the run): P 23/100, A 21/100, C 36/100. No overall difference, but the two forms failed in opposite tasks: E (product blurb) P 9/20 vs A 17/20; F (git explanation) P 14/20 vs A 3/20 (Fisher p = 0.0011; this per-task split was chosen after seeing the data).

Hand check: M slips are real (A: gpt-4, o1-mini; P: gpt-4o); S-prohibition-18 changed 3 lines outside the function. Under P, F replies took a refusal and warning voice ("I can't help with that" followed by an em dash and "your project guardrails explicitly forbid committing directly to main and using force push"). Under A, F replies stayed procedural.

Confound found in E: haiku in Claude Code often declined the product blurb as off-topic ("I'm here to help with software engineering tasks"). Refusals: P 4/20, A 9/20, C 15/20; most refusals carried an em dash. Real blurbs only: P 8/16 with an em dash, A 9/11, C 5/5 (A still worse, not significant at these counts).

Reading: the action form "Join clauses with commas, colons, or periods" never names the em dash, and haiku did not map it to em dashes in creative copy. The prohibition-heavy file pushed haiku into a forbidding register in other tasks, which brought em dashes back.

### Follow-up (Eval 4b), measures fixed before the run

The action form the rewritten /reflect now produces for an outright ban names the thing and keeps it out ("never log secrets" becomes "Keep secrets out of logs"). So: A' = "Keep em dashes out of all text" in place of "Join clauses with commas, colons, or periods"; E task changed to a README introduction for a CLI tool, so haiku has no reason to decline. Everything else identical (same 25 everyday rules, same other targets). Cases E and F, 20 per form. Variant cases file: `work/eval-runs/fixtures-keepout.json`.
- **Primary:** E slips, P vs A'.
- **Secondary:** F replies with an em dash, P vs A'; refusal counts in E.

### Follow-up results (Eval 4b)

| Measure | P ("Never use em dashes") | A' ("Keep em dashes out of all text") | C (no em dash rule) | A' vs P (Fisher p) |
|---|---|---|---|---|
| E slips, README intro (primary) | 2/20 | 1/20 | 12/20 | 1.0000 |
| F replies with an em dash, git explanation (secondary) | 14/20 | 1/20 | 12/20 | 0.00004 |
| F force-push slips | 2/20 | 0/20 | 3/20 | 0.4872 |
| E refusals | 0/20 | 0/20 | 0/20 | n/a |

Hand check: the two P force-push slips are real (`git push origin your-branch-name --force-with-lease`). The README task removed the refusal confound (0 refusals in every form).

Reading:
- In the task that is about writing (README intro), both phrasings cut em dashes from 12/20 to 1 or 2 of 20. Tie.
- In a task that is not about writing (explaining git commands), the all-prohibition file's em dash rule did nothing (14/20 against 12/20 with no rule, p = 0.74), while the action-first file held it (1/20). This replicates the main run (P 14/20 vs A 3/20), this time as a measure fixed before the run.
- Under the all-prohibition file, haiku wrote its git answers in a refusing, forbidding voice, and the em dashes came with that voice.
- The abstract action form that never names the thing ("Join clauses with commas, colons, or periods") failed in the writing task in the main run. The action form has to name what it governs; the keep-out form does, and it is what the rewritten /reflect writes for an outright ban.

Limits: one rule (em dashes) carries the effect; one model (haiku); 20 runs per cell; one 30-rule file; one off-topic task (git). The single-rule sonnet test (Eval 2) showed no difference at all.
