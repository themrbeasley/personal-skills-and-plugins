# Research-Backed Questions, Self-Contained Questions, and Prep's Two Tenses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the three issues in the DM's 2026-09-19 report: a skill looks up the project's files before asking the DM a question, every question states what it asks about, and prep writes anything it takes from the last report as what happened, then what could follow.

**Architecture:** Prose edits across seven markdown files, plus the spec's Status line and the two version manifests. No executable code. There is no test framework for skill prose, so each task's test cycle is a `grep` gate: run it first to see the failing state, make the edits, run it again to see the passing state, commit. Task 1 adds Principle 14 and wires it into debrief; Task 2 adds Principle 15 and wires it into debrief, chronicler, timeline, and setup; Task 3 gives prep its two-part form; Task 4 marks the spec implemented, releases 1.18.0, and runs the full verification.

**Tech Stack:** Markdown and JSON. Verification by `grep`, `awk`, and one `node -e` JSON read. The eight Node test suites (plain `node <file>.test.mjs`, no framework) run once at the end to confirm nothing executable moved.

**Spec:** `docs/superpowers/specs/2026-09-19-professor-orb-research-backed-questions-and-prep-tense-design.md`. Its "What ships" section holds the approved wording, and this plan copies that wording into exact edits. Read the spec's "Design decisions and why" before any task: it says why each rule is stated the way it is, and a reworded rule can quietly undo the reason.

## Global Constraints

Copied from the spec, or from the repo's `CLAUDE.md` where noted. Every task's requirements implicitly include this section.

- **No em dashes in any file this plan touches.** SHARED-PRINCIPLES Principle 6. Every touched file has zero today and must have zero after. Use commas, colons, parentheses, or restructure the sentence.
- **No specimen of a failure goes into any file.** The question that pointed back at earlier text, and the prep options that restated past events as plans, are described in the spec and quoted nowhere. Each rule is stated in its positive form, with an example of the correct output only. That is the design, not an omission.
- **No consumer specifics in plugin files.** No campaign, character, or organization name from any consumer project appears in skill or glossary text. Examples use the plugin's existing generic cast (Vela Thorne, the Sunken Temple, the Cinder Pact, the Compact). (`professor-orb/CONTEXT.md`: no consumer's specifics are baked in.)
- **Principles 14 and 15 append after Principle 13.** No existing principle is renumbered, so every existing citation of a principle number stays correct.
- **The SHARED-PRINCIPLES preamble** (`> **Before you begin:** read ...SHARED-PRINCIPLES.md...`) survives in every skill touched. (repo `CLAUDE.md`)
- **Match each file's wrapping.** `professor-orb/CONTEXT.md` is hard-wrapped. The `interrogation` entry's three body lines (80 to 82 columns today) become four (76 to 80 columns), and no line outside the entry changes. Every other touched markdown file keeps each paragraph and each bullet on one line.
- **Working-tree files use CRLF** (`core.autocrlf=true`). Make every edit with the Edit tool, which matches across line endings. Do not use `sed -i`.
- **Line numbers below are from the files before this plan.** Earlier tasks shift later ones, so find each target by its quoted text, not its number. Every quoted target was confirmed to occur exactly once in its file.
- **Version 1.17.0 becomes 1.18.0** in both `.claude-plugin/marketplace.json` and `professor-orb/.claude-plugin/plugin.json`, and the two must match. (repo `CLAUDE.md`)
- **No executable code is touched.** All eight Node suites pass unchanged.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `professor-orb/skills/SHARED-PRINCIPLES.md` | Rules every component reads first | Task 1: Principle 14. Task 2: Principle 15 |
| `professor-orb/skills/debrief/SKILL.md` | Session debrief and its interrogation rounds | Task 1: What to probe, Round discipline, Phase 4. Task 2: Round discipline |
| `professor-orb/CONTEXT.md` | The glossary | Task 1: the `interrogation` entry |
| `professor-orb/skills/chronicler/SKILL.md` | Lore-update proposals | Task 2: Step 1c's approval question |
| `professor-orb/skills/timeline/SKILL.md` | Chronology and temporal triage | Task 2: Step 3a's triage question |
| `professor-orb/skills/setup/SKILL.md` | Conventions and the onboarding migration | Task 2: Step 7's mapping confirmation |
| `professor-orb/skills/prep/SKILL.md` | Session briefs | Task 3: Step 1b question 4, Section 3's Building the list |
| `docs/superpowers/specs/2026-09-19-professor-orb-research-backed-questions-and-prep-tense-design.md` | This work's spec | Task 4: Status becomes Implemented |
| `.claude-plugin/marketplace.json`, `professor-orb/.claude-plugin/plugin.json` | Release version | Task 4: 1.18.0 |

Tasks 1 and 2 both edit SHARED-PRINCIPLES and debrief's Round discipline line. They are split because a reviewer could accept one principle and reject the other: looking up the files before asking and stating a question's subject are independent decisions. Task 2's Round discipline edit anchors on text Task 1 writes, so the two cannot run out of order. Task 4 runs last because its Status line and version describe the finished work.

---

## Task 1: Look it up before you ask

**Files:**
- Modify: `professor-orb/skills/SHARED-PRINCIPLES.md` (append after Principle 13, the file's last section)
- Modify: `professor-orb/skills/debrief/SKILL.md:51` (What to probe)
- Modify: `professor-orb/skills/debrief/SKILL.md:61` (Round discipline)
- Modify: `professor-orb/skills/debrief/SKILL.md:110` (Phase 4, the lore-agent-unavailable paragraph)
- Modify: `professor-orb/CONTEXT.md:68-70` (the `interrogation` entry)
- Test: the grep gate in Steps 1 and 6. No test suite covers skill prose.

**Interfaces:**
- Consumes: nothing. This is the first task.
- Produces: the heading `## 14. Look it up before you ask` as the last section of SHARED-PRINCIPLES (Task 2 appends after it), and debrief's Round discipline sentence ending `intake, a prior round, or the files. Do not ask filler.` (Task 2's edit anchors on it).

- [ ] **Step 1: Run the gate and confirm it fails**

```bash
cd professor-orb
grep -c '^## 14\. Look it up before you ask$' skills/SHARED-PRINCIPLES.md
grep -cF 'only ask about gaps' skills/debrief/SKILL.md
grep -c 'Principle 14' skills/debrief/SKILL.md
grep -cF 'intake, a prior round, or the files' skills/debrief/SKILL.md
grep -cF "Phase 2's lookups served its questions" skills/debrief/SKILL.md
grep -cF 'preceded by a lookup in the project' CONTEXT.md
cd ..
```

Expected before the edit, in order: `0`, `1`, `0`, `0`, `0`, `0`. If any already reads its Step 6 value, stop: the file is not in the state this plan was written against.

- [ ] **Step 2: Append Principle 14 to SHARED-PRINCIPLES**

The file ends with Principle 13's last paragraph. Replace that paragraph:

```markdown
Excluded content is bounded work, not blocked work. Note the article as excluded, say what you could not check because of it, and carry on with everything else.
```

with the same paragraph followed by the new principle:

```markdown
Excluded content is bounded work, not blocked work. Note the article as excluded, say what you could not check because of it, and carry on with everything else.

## 14. Look it up before you ask

Before each AskUserQuestion call, read what the project's files say about each thing a question in that call turns on: its KB article or staged article, the campaign's earlier session reports, and any other file the project keeps on it, such as a character sheet or a prep brief. The lookup covers those files, for the questions at hand. Content exclusions and Principle 13 bound it like any other read.

Each question then takes one of three forms:

- **The files answer it.** The question drops out, and its answer goes in the call's text with its source, where the DM can correct a stale file in the same reply: "From the files: Vela Thorne is the harbormaster's sister ([[Vela Thorne]])." If no question is left to ask, say it in chat instead.
- **The files and the DM disagree.** Ask about the disagreement, quoting both sides. The DM's answer settles it (Principle 1).
- **The files say nothing.** Ask the question.
```

The file keeps its single trailing line ending after the last bullet.

- [ ] **Step 3: Rewrite debrief's What to probe and Round discipline**

In Phase 2, replace:

```markdown
**What to probe.** Compare what you already know from intake against this checklist, and only ask about gaps:
```

with:

```markdown
**What to probe.** Before every round, look up each entity the round will touch, per SHARED-PRINCIPLES Principle 14: its article, the campaign's earlier reports, and any character sheet. Compare what intake and the files tell you against this checklist, and ask about what neither answers:
```

The numbered checklist that follows it stays as it is. Then, in the paragraph beginning `**Round discipline.**`, replace:

```markdown
Do not ask about anything already answered in intake or a prior round. Do not ask filler.
```

with:

```markdown
Do not ask about anything already answered in intake, a prior round, or the files. Do not ask filler.
```

- [ ] **Step 4: Separate Phase 2's lookups from the lore agent's work**

In Phase 4, in the paragraph that begins "If the `lore` agent is unavailable or the DM declines the handoff", replace:

```markdown
Do not attempt the deep KB cross-referencing yourself; that is the `lore` agent's job.
```

with:

```markdown
Do not attempt the deep KB cross-referencing yourself; that is the `lore` agent's job. Phase 2's lookups served its questions and end with them.
```

That sentence ends the paragraph; nothing follows it on the line.

- [ ] **Step 5: Rewrap the glossary's `interrogation` entry**

In `professor-orb/CONTEXT.md`, replace these three lines:

```
The debrief skill's namesake phase: free-form probing follow-up questions, asked
via the AskUserQuestion tool (mandatory mechanism, not optional), continuing until
the DM explicitly ends it. The skill never decides on its own that it has enough.
```

with these four:

```
The debrief skill's namesake phase: free-form probing follow-up questions, asked
via the AskUserQuestion tool (mandatory mechanism, not optional), each round
preceded by a lookup in the project's files (Principle 14), continuing until the
DM explicitly ends it. The skill never decides on its own that it has enough.
```

The `**interrogation**:` line above and the `_Avoid_: "phase two", "the interview"` line below stay exactly as they are.

- [ ] **Step 6: Run the gate and confirm it passes**

```bash
cd professor-orb
grep -c '^## 14\. Look it up before you ask$' skills/SHARED-PRINCIPLES.md
grep -cF 'only ask about gaps' skills/debrief/SKILL.md
grep -c 'Principle 14' skills/debrief/SKILL.md
grep -cF 'intake, a prior round, or the files' skills/debrief/SKILL.md
grep -cF "Phase 2's lookups served its questions" skills/debrief/SKILL.md
grep -cF 'preceded by a lookup in the project' CONTEXT.md
tail -n 1 skills/SHARED-PRINCIPLES.md | cut -c1-30
sed -n '/^\*\*interrogation\*\*:/,/^_Avoid_/p' CONTEXT.md | tr -d '\r' | awk '{ print length }'
grep -c '—' skills/SHARED-PRINCIPLES.md skills/debrief/SKILL.md CONTEXT.md
cd ..
```

Expected, in order: `1`, `0`, `1`, `1`, `1`, `1`; `- **The files say nothing.** A`; the entry's line widths `18`, `80`, `76`, `80`, `77`, `37`; `0` em dashes for each file.

- [ ] **Step 7: Commit**

```bash
git add -- professor-orb/skills/SHARED-PRINCIPLES.md professor-orb/skills/debrief/SKILL.md professor-orb/CONTEXT.md
git commit -F - <<'EOF'
fix(professor-orb): look up the files before asking the DM

Principle 14: before each AskUserQuestion call, read what the project's
files say about each thing its questions turn on. A question the files
answer drops out and its answer is stated with its source; a conflict
between the files and the DM becomes the question. debrief runs the
lookup before every interrogation round.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 2: A question states what it asks about

**Files:**
- Modify: `professor-orb/skills/SHARED-PRINCIPLES.md` (append after Principle 14)
- Modify: `professor-orb/skills/debrief/SKILL.md:61` (Round discipline)
- Modify: `professor-orb/skills/chronicler/SKILL.md:158` (Step 1c, Ask for approval)
- Modify: `professor-orb/skills/timeline/SKILL.md:65` (Step 3a)
- Modify: `professor-orb/skills/setup/SKILL.md:91` (Step 7)
- Test: the grep gate in Steps 1 and 5.

**Interfaces:**
- Consumes: from Task 1, the section `## 14. Look it up before you ask` ending in the bullet `- **The files say nothing.** Ask the question.`, and debrief's sentence `Do not ask about anything already answered in intake, a prior round, or the files. Do not ask filler.`
- Produces: the heading `## 15. A question states what it asks about`, cited as `(Principle 15)` by the four skill edits in this task.

- [ ] **Step 1: Run the gate and confirm it fails**

```bash
cd professor-orb/skills
grep -c '^## 15\. A question states what it asks about$' SHARED-PRINCIPLES.md
grep -c 'Principle 15' debrief/SKILL.md chronicler/SKILL.md timeline/SKILL.md setup/SKILL.md
grep -cF 'Use AskUserQuestion to offer the DM a choice:' chronicler/SKILL.md
grep -cF 'Use AskUserQuestion with these four routes:' timeline/SKILL.md
grep -cF 'via AskUserQuestion before anything moves.' setup/SKILL.md
grep -cF 'or the files. Do not ask filler.' debrief/SKILL.md
cd ../..
```

Expected before the edit, in order: `0`; `0` for each of the four files; `1`; `1`; `1`; `1`. The last value is Task 1's output: a `0` there means Task 1 has not run, so stop and run it first.

- [ ] **Step 2: Append Principle 15 to SHARED-PRINCIPLES**

Replace Principle 14's last bullet:

```markdown
- **The files say nothing.** Ask the question.
```

with the same bullet followed by the new principle:

```markdown
- **The files say nothing.** Ask the question.

## 15. A question states what it asks about

Each AskUserQuestion question carries, in its own text or its options, the content of the thing it asks about: enough to answer with nothing else on screen. Earlier messages are not always in view when a question appears; the Claude desktop app sometimes folds them into a one-line summary. Explanations, drafts, and files can still come first, and the question restates what the decision turns on:

- A proposal is written out: "Morale roll: 5 dice. 3 for the militia's numbers, 2 for the fortified gate, 1 for the paladin's speech, minus 1 for the fallen captain. Use it as written?"
- Something long is summarized by what the decision turns on: "Approve the lore update: 3 new articles (Sunken Temple, Vela Thorne, Cinder Pact), 5 edits, 2 items that need your call?"
```

The file keeps its single trailing line ending after the last bullet. The morale roll's arithmetic is part of the example: 3 + 2 + 1 - 1 = 5. Keep it consistent if the example is ever reworded.

- [ ] **Step 3: Have debrief write a proposal into its question**

In debrief's paragraph beginning `**Round discipline.**`, replace:

```markdown
or the files. Do not ask filler.
```

with:

```markdown
or the files. Do not ask filler. Anything a question proposes, such as a dice pool, is written out in the question itself (Principle 15).
```

- [ ] **Step 4: Have chronicler, timeline, and setup state the subject in the question**

In `chronicler/SKILL.md`, Step 1c, in the paragraph beginning `**Ask for approval as a structured decision.**`, replace:

```markdown
Use AskUserQuestion to offer the DM a choice:
```

with:

```markdown
Use AskUserQuestion, with the summary stated in the question itself (Principle 15), to offer the DM a choice:
```

In `timeline/SKILL.md`, replace:

```markdown
**Step 3a: Ask which way to take it.** Use AskUserQuestion with these four routes:
```

with:

```markdown
**Step 3a: Ask which way to take it.** Use AskUserQuestion with these four routes, stating in the question the two claims that conflict, a line each, with the file each comes from (Principle 15):
```

The numbered list of four routes that follows stays as it is.

In `setup/SKILL.md`, Step 7, replace:

```markdown
confirm the source-to-destination mapping with the DM via AskUserQuestion before anything moves.
```

with:

```markdown
confirm the source-to-destination mapping with the DM via AskUserQuestion before anything moves, stating each prong's move in the question itself (Principle 15).
```

- [ ] **Step 5: Run the gate and confirm it passes**

```bash
cd professor-orb/skills
grep -c '^## 15\. A question states what it asks about$' SHARED-PRINCIPLES.md
grep -c 'Principle 15' debrief/SKILL.md chronicler/SKILL.md timeline/SKILL.md setup/SKILL.md
grep -cF 'Use AskUserQuestion to offer the DM a choice:' chronicler/SKILL.md
grep -cF 'Use AskUserQuestion with these four routes:' timeline/SKILL.md
grep -cF 'via AskUserQuestion before anything moves.' setup/SKILL.md
grep -c '^## 1[45]\. ' SHARED-PRINCIPLES.md
tail -n 1 SHARED-PRINCIPLES.md | cut -c1-38
grep -c '—' SHARED-PRINCIPLES.md debrief/SKILL.md chronicler/SKILL.md timeline/SKILL.md setup/SKILL.md
cd ../..
```

Expected, in order: `1`; `1` for each of the four files; `0`; `0`; `0`; `2`; `- Something long is summarized by what`; `0` em dashes for each file.

- [ ] **Step 6: Commit**

```bash
git add -- professor-orb/skills/SHARED-PRINCIPLES.md professor-orb/skills/debrief/SKILL.md professor-orb/skills/chronicler/SKILL.md professor-orb/skills/timeline/SKILL.md professor-orb/skills/setup/SKILL.md
git commit -F - <<'EOF'
fix(professor-orb): state a question's subject inside the question

Principle 15: an AskUserQuestion question carries the content of what
it asks about, enough to answer with nothing else on screen, because
earlier messages are not always in view when it appears. debrief's
rounds, chronicler's approval, timeline's triage, and setup's mapping
confirmation each state their subject in the question.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 3: prep writes a report thread as last session, then next

**Files:**
- Modify: `professor-orb/skills/prep/SKILL.md:55` (Step 1b, question 4)
- Modify: `professor-orb/skills/prep/SKILL.md:85` (Section 3, Building the list)
- Test: the grep gate in Steps 1 and 4.

**Interfaces:**
- Consumes: nothing from Tasks 1 and 2. prep inherits both principles through SHARED-PRINCIPLES and needs no edit for them.
- Produces: the two-part form's labels `**Last session:**` and `**Next:**`, which the spec's manual check 4 looks for in prep's output.

- [ ] **Step 1: Run the gate and confirm it fails**

```bash
cd professor-orb/skills/prep
grep -cF '**Last session:**' SKILL.md
grep -cF 'two-part form' SKILL.md
grep -c '^- \*\*Write anything drawn from the report in two parts\.\*\*' SKILL.md
cd ../../..
```

Expected before the edit, in order: `0`, `0`, `0`.

- [ ] **Step 2: Point question 4's options at the form**

In Step 1b, question 4, replace:

```markdown
If they're not sure yet, that's fine; you'll draft candidates from the report in Phase 2.
```

with:

```markdown
If they're not sure yet, that's fine; you'll draft candidates from the report in Phase 2. An option you draw from the report is written in the two-part form under Section 3's "Building the list."
```

- [ ] **Step 3: Add the two-part form to Building the list**

In Section 3, replace:

```markdown
- If supplementing, clearly mark which north stars came from the DM and which you are proposing from the report, so the DM can cut or keep during review.
```

with the same bullet followed by the new one:

```markdown
- If supplementing, clearly mark which north stars came from the DM and which you are proposing from the report, so the DM can cut or keep during review.
- **Write anything drawn from the report in two parts.** **Last session:** what happened, in past tense. **Next:** the scene that follows from it, which is the north star. For example: **Last session:** Vela Thorne fled the harbor with the ledger. **Next:** the Compact's agents come asking who helped her.
```

The bullet after it (`For each north star, write a brief description`) stays as it is.

- [ ] **Step 4: Run the gate and confirm it passes**

```bash
cd professor-orb/skills/prep
grep -cF '**Last session:**' SKILL.md
grep -cF 'two-part form' SKILL.md
grep -c '^- \*\*Write anything drawn from the report in two parts\.\*\*' SKILL.md
grep -c '—' SKILL.md
cd ../../..
```

Expected, in order: `1`, `1`, `1`, `0`. The first counts lines, and both `**Last session:**` labels sit on the one new bullet.

- [ ] **Step 5: Commit**

```bash
git add -- professor-orb/skills/prep/SKILL.md
git commit -F - <<'EOF'
fix(prep): write a report thread as last session, then next

An option or north star prep draws from the last report is written in
two labeled parts: what happened, in past tense, then the scene that
follows from it. The Next part names the follow-up, so an event that
already happened cannot stand in the brief as a plan.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 4: Mark the spec implemented, release 1.18.0, and verify

**Files:**
- Modify: `docs/superpowers/specs/2026-09-19-professor-orb-research-backed-questions-and-prep-tense-design.md:4`
- Modify: `.claude-plugin/marketplace.json:11`, `professor-orb/.claude-plugin/plugin.json:4`
- Test: the grep gate in Steps 1 and 4, the spec's full verification in Step 5, and the eight Node suites in Step 6.

**Interfaces:**
- Consumes: the finished state of Tasks 1 to 3.
- Produces: nothing downstream.

- [ ] **Step 1: Run the gate and confirm it fails**

```bash
grep -cF '**Status:** Approved, not yet implemented' docs/superpowers/specs/2026-09-19-professor-orb-research-backed-questions-and-prep-tense-design.md
node -e "const r=f=>JSON.parse(require('fs').readFileSync(f,'utf8')); console.log(r('professor-orb/.claude-plugin/plugin.json').version, r('.claude-plugin/marketplace.json').plugins.find(p=>p.name==='professor-orb').version)"
```

Expected before: `1`; `1.17.0 1.17.0`.

- [ ] **Step 2: Mark the spec implemented**

In the spec, replace:

```markdown
**Status:** Approved, not yet implemented
```

with:

```markdown
**Status:** Implemented in 1.18.0
```

- [ ] **Step 3: Bump the version**

In `professor-orb/.claude-plugin/plugin.json`, replace `"version": "1.17.0",` with `"version": "1.18.0",`. In `.claude-plugin/marketplace.json`, make the same replacement inside the professor-orb entry. Neither file has another `1.17.0` in it.

- [ ] **Step 4: Run the gate and confirm it passes**

```bash
grep -cF '**Status:** Implemented in 1.18.0' docs/superpowers/specs/2026-09-19-professor-orb-research-backed-questions-and-prep-tense-design.md
node -e "const r=f=>JSON.parse(require('fs').readFileSync(f,'utf8')); console.log(r('professor-orb/.claude-plugin/plugin.json').version, r('.claude-plugin/marketplace.json').plugins.find(p=>p.name==='professor-orb').version)"
```

Expected: `1`; `1.18.0 1.18.0`. The `node` read also proves both manifests still parse.

- [ ] **Step 5: Run the spec's full verification**

```bash
cd professor-orb/skills
grep -c '^## 14\. Look it up before you ask$' SHARED-PRINCIPLES.md
grep -c '^## 15\. A question states what it asks about$' SHARED-PRINCIPLES.md
grep -c 'only ask about gaps' debrief/SKILL.md
grep -c 'Principle 14' debrief/SKILL.md
grep -c 'Principle 15' debrief/SKILL.md chronicler/SKILL.md timeline/SKILL.md setup/SKILL.md
grep -c '\*\*Last session:\*\*' prep/SKILL.md
cd ../..
grep -c '—' professor-orb/skills/SHARED-PRINCIPLES.md professor-orb/skills/debrief/SKILL.md professor-orb/skills/prep/SKILL.md professor-orb/skills/chronicler/SKILL.md professor-orb/skills/timeline/SKILL.md professor-orb/skills/setup/SKILL.md professor-orb/CONTEXT.md
grep -c 'All 19 carry the preamble' CLAUDE.md
grep -rl 'SHARED-PRINCIPLES.md' professor-orb/skills/*/SKILL.md professor-orb/agents/*.md professor-orb/commands/*.md | wc -l
grep -rn 'Principle 13' professor-orb --include=*.md | grep -v 'skills/SHARED-PRINCIPLES.md' | wc -l
```

Expected, in order: `1`, `1`, `0`, `1`, `1` for each of the four files, `1`; `0` em dashes for each file; `1`; `19`; `3`. The preamble pair confirms the repo `CLAUDE.md` count still matches, since no component was added or removed. The last line confirms the three existing citations of Principle 13 (`rule-fixer`, `/sweep`, prep) still stand, since nothing was renumbered.

- [ ] **Step 6: Run all eight Node suites**

```bash
for f in $(find professor-orb -name "*.test.mjs" | sort); do node "$f" || { echo "FAIL: $f"; break; }; done
```

Expected: every suite exits 0 and no `FAIL:` line prints (about a minute). No executable code changed, so a failure here means something outside this plan moved: stop and report it rather than fixing it.

- [ ] **Step 7: Commit the spec record**

```bash
git add -- docs/superpowers/specs/2026-09-19-professor-orb-research-backed-questions-and-prep-tense-design.md
git commit -F - <<'EOF'
docs(professor-orb): mark the 09-19 design implemented

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 8: Commit the release**

```bash
git add -- .claude-plugin/marketplace.json professor-orb/.claude-plugin/plugin.json
git commit -F - <<'EOF'
chore(professor-orb): 1.18.0

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

## After Task 4

This repo lands work as a local merge commit on `main`, not a pull request. Merge the branch locally once every task is committed and Step 6 passed.

The spec's manual verification (five checks in a consumer project) runs after the consumer picks up 1.18.0. It is the DM's to run, because it needs live debrief, prep, and chronicler sessions in their own project.
