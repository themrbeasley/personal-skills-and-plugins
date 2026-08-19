# forge-prompt Question Definition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give forge-prompt's Questions block a positive definition — a Question resolves an ambiguity, never an absence — so the skill stops opening every session by asking where the image will be used and at what size.

**Architecture:** Four prose edits across three markdown files. No executable code. The 08-18 style-gate spec fixed the Suggestions block by replacing a prohibition list with a positive definition of what a Suggestion *is*; this applies the identical treatment to Questions, which still carried a priority list and no definition. Because there is no test framework for skill prose, each task's test cycle is a `grep` gate: run it first to observe the failing state, make the edit, run it again to observe the passing state, commit.

**Tech Stack:** Markdown. Verification by `grep` and `sed`. No build, no package manager, no test runner involved.

## Global Constraints

Copied from `docs/superpowers/specs/2026-08-18-forge-prompt-question-definition-design.md`. Every task's requirements implicitly include this section.

- **No new "Things to never do" entry.** Not "never ask about destination," not "never ask about size," not "never ask about aspect ratio." A rule spelled "never propose X" ships an example of X into the context where it matters. The definition is the fence.
- **`## The loop` must expose exactly four `###` headings** — `Revised Prompt`, `Suggestions`, `Questions`, `Loop rules`. A fifth is a regression. The count is 4 before this plan and must be 4 after.
- **The plugin version is not bumped.** `.claude-plugin/marketplace.json` and `professor-orb/.claude-plugin/plugin.json` both read `1.15.0` and must stay matched. Releasing is the DM's call.
- **The SHARED-PRINCIPLES preamble at `SKILL.md:6` must survive.** Every command, agent, and skill in this plugin opens by reading it.
- **No executable code is touched.** The eight Node suites are unaffected and must pass unchanged.
- Do not introduce a `type` frontmatter field anywhere in this skill. The write-time validator hook skips a typeless file and blocks a type it does not recognize.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `professor-orb/skills/forge-prompt/SKILL.md` | The skill itself. Carries the three output blocks and the mode openers. | Modify: frontmatter description, Step 0 Forge opener, the Suggestions cross-reference sentence, the whole `### Questions` section, the "Never stall" parenthetical |
| `professor-orb/skills/forge-prompt/references/flux2-prompting.md` | Model-specific prompt craft, refreshed against the BFL guide when results drift. | Modify: header scope line. Delete: `## Aspect ratios and resolution`, `## Parameters` |
| `professor-orb/CONTEXT.md` | The plugin's glossary — the vocabulary used in `CLAUDE.md` and user-facing prose. | Modify: the forge-prompt entry gains a one-sentence Question definition |

Tasks 1 and 2 both edit `SKILL.md` and are split because a reviewer can accept the definition while rejecting the opener's wording. Task 4 runs last so the glossary describes the state that actually shipped.

---

## Task 1: Define what a Question is

This is the substantive change. Everything else follows from it.

**Files:**
- Modify: `professor-orb/skills/forge-prompt/SKILL.md:3` (frontmatter description)
- Modify: `professor-orb/skills/forge-prompt/SKILL.md:107` (Suggestions cross-reference)
- Modify: `professor-orb/skills/forge-prompt/SKILL.md:119-123` (the `### Questions` section)
- Test: none. This repo has no test suite for skill prose; the gate is the grep block in each step.

**Interfaces:**
- Consumes: nothing. This is the first task.
- Produces: the exact sentence `A Question resolves an ambiguity, never an absence.` Task 4 restates it in the glossary and must match its meaning. The phrase `Zero to three per round.` replaces the old floor of one, and Task 2's loop-rule edit depends on that floor being gone.

### Note on scope: one edit beyond the spec

The spec says the Suggestions block is untouched. Implementing against the file shows it cannot be, and the reason is worth reading before you make the edit.

`SKILL.md:107` currently ends: *"If you cannot act on it without more information, it is a Question."* That is the reciprocal pointer from Suggestions to Questions, and under the new definition it is false. A missing detail is exactly the case where you lack information, and the new rule routes it to Suggestions to be invented and offered. Left alone, the skill would carry two rules that sort the same case in opposite directions.

The 08-18 spec names this failure mode directly: *"two rules that appear to contradict each other invite a later session to bridge them off-plan."* That is what produced its own defect 1. So the clause is corrected here rather than left for a later session to reconcile. The pointer stays; only its criterion changes.

- [ ] **Step 1: Run the gate and confirm it fails**

```bash
cd professor-orb/skills/forge-prompt
grep -c 'A Question resolves an ambiguity, never an absence' SKILL.md
grep -ci 'at what size' SKILL.md
grep -c 'Zero to three' SKILL.md
grep -ci 'One to three' SKILL.md
grep -c 'asked only to settle an ambiguity' SKILL.md
grep -c 'If you cannot act on it without more information' SKILL.md
```

Expected before the edit, in order: `0`, `1`, `0`, `1`, `0`, `1`. Every one of these flips. If any already reads its target value, stop — the file is not in the state this plan was written against.

- [ ] **Step 2: Edit the frontmatter description**

In the `description:` string on line 3, replace this exact substring:

```
and at most three questions, asked only when they block progress.
```

with:

```
and at most three questions, asked only to settle an ambiguity in what the DM has already said.
```

Leave the rest of the description untouched. It is one long single-line YAML string; do not reflow it, and do not add line breaks.

- [ ] **Step 3: Correct the Suggestions cross-reference**

On line 107, replace this exact sentence:

```
If you cannot act on it without more information, it is a Question.
```

with:

```
If it turns on which of two readings the DM meant, it is a Question.
```

Change nothing else in that paragraph. The three sentences before it — the add/edit/delete definition, "Name the change, name what the image gains," and "If it does not change the prompt's text, it is not a Suggestion" — are the 08-18 fix and stay exactly as they are.

- [ ] **Step 4: Replace the Questions section**

Replace this entire block, from the heading through the final line:

```markdown
### Questions

One to three, and only what blocks progress. If the loop can advance without the answer, it is a Suggestion. Prioritize: where the image will be used and at what size, whether the DM has a reference or an earlier attempt that came close, and what the image is actually for.

**A Question asks; it does not assert.** Offering choices is fine ("clean-shaven, or bearded?"). Stating an unconfirmed detail as settled while appearing to ask about something else is not.
```

with:

```markdown
### Questions

**A Question resolves an ambiguity, never an absence.** Something the DM has already said reads two ways, the two readings produce different images, and no source settles which one they meant. That is the entire class. A detail nobody has mentioned is not ambiguous, it is missing, and missing detail is a Suggestion adopted by silence.

The ambiguity sits in one of the four parts a FLUX.2 prompt is built from: **subject**, **action**, **style**, **context**. "You said the tower fell: is this mid-collapse, or the ruin years after?" is an action fork, and the two prompts share almost no words. "Is he bearded?" is not a fork. Nobody said anything about his face, so it is an add.

Zero to three per round. Zero is the normal state once the readings are settled, and a round with no Questions is a finished round rather than a lazy one. Keep the heading and write "None blocking" under it.

**A Question asks; it does not assert.** Naming both readings is the point. Stating an unconfirmed detail as settled while appearing to ask about something else is not.
```

The `### Questions` heading itself must survive — it is one of the four the Global Constraints pin.

- [ ] **Step 5: Run the gate and confirm it passes**

```bash
cd professor-orb/skills/forge-prompt
grep -c 'A Question resolves an ambiguity, never an absence' SKILL.md
grep -ci 'at what size' SKILL.md
grep -c 'Zero to three' SKILL.md
grep -ci 'One to three' SKILL.md
grep -c 'asked only to settle an ambiguity' SKILL.md
grep -c 'If you cannot act on it without more information' SKILL.md
```

Expected, in order: `1`, `0`, `1`, `0`, `1`, `0`.

- [ ] **Step 6: Confirm the loop still has exactly four headings**

```bash
sed -n '/^## The loop/,/^## The test runs/p' professor-orb/skills/forge-prompt/SKILL.md | grep '^### '
```

Expected exactly four lines: `### Revised Prompt`, `### Suggestions`, `### Questions`, `### Loop rules`.

- [ ] **Step 7: Commit**

```bash
git add professor-orb/skills/forge-prompt/SKILL.md
git commit -m "fix(forge-prompt): define a Question as an ambiguity, not an absence" -m "The block carried a priority list and no definition of what a Question is, so on a round with nothing blocking the skill was required to ask and told to ask about destination and size. Drops the floor from one to zero and corrects the Suggestions cross-reference, which routed missing detail to Questions and contradicted the new rule." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Remove destination from the opener and the loop rule

**Files:**
- Modify: `professor-orb/skills/forge-prompt/SKILL.md:30-31` (Step 0, Forge mode)
- Modify: `professor-orb/skills/forge-prompt/SKILL.md:127` (Loop rules, "Never stall")
- Test: none. The gate is the grep block below.

**Interfaces:**
- Consumes: Task 1's definition. The opener's fork is a reading question and only makes sense under it.
- Produces: the sentence `Is this a portrait of them, or a scene they are in?`, which is the first thing a DM sees in Forge mode. Nothing later depends on it.

- [ ] **Step 1: Run the gate and confirm it fails**

```bash
cd professor-orb/skills/forge-prompt
grep -ci 'where will it end up\|where the image goes' SKILL.md
grep -c 'Is this a portrait of them, or a scene they are in' SKILL.md
```

Expected before the edit: `2`, `0`.

- [ ] **Step 2: Replace the Forge opener**

Replace these two lines:

```markdown
**Forge.** A subject, and no image yet.
Open with: "What is the image for, and where will it end up?"
```

with:

```markdown
**Forge.** A subject, and no image yet.
Open with the one fork the DM's message leaves open: "Is this a portrait of them, or a scene they are in?" It sets subject, action, and context at once, and the two readings share almost no prompt text. When the message already answers it, skip it and resolve the style.
```

The Edit and Diagnose openers directly below are unchanged.

- [ ] **Step 3: Trim the "Never stall" parenthetical**

On line 127, replace this exact substring:

```
On a vague or incomplete answer about the request itself (where the image goes, what it is for, which of two readings you meant), make a reasonable inference,
```

with:

```
On a vague or incomplete answer about which of two readings you meant, make a reasonable inference,
```

The rest of that bullet is unchanged, including everything from **This license stops at the subject's appearance.** onward. Do not touch the three bullets below it.

- [ ] **Step 4: Run the gate and confirm it passes**

```bash
cd professor-orb/skills/forge-prompt
grep -ci 'where will it end up\|where the image goes' SKILL.md
grep -c 'Is this a portrait of them, or a scene they are in' SKILL.md
```

Expected: `0`, `1`.

- [ ] **Step 5: Run the spec's full regression check on SKILL.md**

```bash
cd professor-orb/skills/forge-prompt
grep -ci 'where will it end up\|at what size\|where the image goes' SKILL.md
```

Expected: `0`. This is the check that matters — any count above zero means a destination or size prompt survived somewhere in the file. It reads `2` before this task and `0` after, because Task 1 already removed the "at what size" occurrence.

- [ ] **Step 6: Commit**

```bash
git add professor-orb/skills/forge-prompt/SKILL.md
git commit -m "fix(forge-prompt): open Forge on a reading fork, not a destination" -m "Aspect ratio is a ComfyUI node setting, not prompt text, so nothing the DM answered here reached the deliverable. Replaced with the one fork that sets subject, action, and context at once, skipped when the message already answers it." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Cut generator settings from the reference

**Files:**
- Modify: `professor-orb/skills/forge-prompt/references/flux2-prompting.md:5` (header note)
- Delete: `professor-orb/skills/forge-prompt/references/flux2-prompting.md:57-75` (`## Aspect ratios and resolution` and `## Parameters`)
- Test: none. The gate is the grep block below.

**Interfaces:**
- Consumes: nothing. Independent of Tasks 1 and 2.
- Produces: the sentence `This file covers prompt text.`, which is the positive scope statement a future refresh against the BFL guide reads to know what belongs.

This is where the behavior regrew from. The skill reads this file every round, and neither table describes anything the skill can act on: they are not prompt text, so they cannot be a Suggestion, and they are not a reading fork, so they cannot be a Question.

- [ ] **Step 1: Run the gate and confirm it fails**

```bash
cd professor-orb/skills/forge-prompt
grep -ci 'aspect ratio\|Guidance (flex)' references/flux2-prompting.md
grep -c '^## ' references/flux2-prompting.md
grep -c 'This file covers prompt text' references/flux2-prompting.md
```

Expected before the edit: `2`, `12`, `0`.

- [ ] **Step 2: Add the scope sentence to the header note**

On line 5, append to the end of the existing paragraph, after "Check it against the live guide when results stop matching what it describes.":

```
This file covers prompt text. Generator settings live in ComfyUI and are the DM's, not this skill's.
```

It joins the same paragraph as a trailing sentence. Do not make it a new paragraph and do not add a heading for it.

- [ ] **Step 3: Delete both sections**

Delete this entire span, from the `## Aspect ratios and resolution` heading through the blank line before `## Prompt upsampling`:

```markdown
## Aspect ratios and resolution

| Ratio | Typical use |
|---|---|
| 1:1 | Social, product shots |
| 16:9 | Landscapes, cinematic |
| 9:16 | Mobile, portraits |
| 4:3 | Magazine, presentation |
| 21:9 | Panorama |

Limits: 4MP maximum total, 64x64 minimum, dimensions in multiples of 16.

## Parameters

| Parameter | Range or use |
|---|---|
| Seed | Reproducibility |
| Guidance (flex) | 1.5 to 10, prompt adherence |
| Steps (flex) | Up to 50, quality against speed |

```

`## Multi-language` above and `## Prompt upsampling` below stay, separated by a single blank line. `## Prompt upsampling` is not cut — it describes what happens to prompt text.

- [ ] **Step 4: Run the gate and confirm it passes**

```bash
cd professor-orb/skills/forge-prompt
grep -ci 'aspect ratio\|Guidance (flex)' references/flux2-prompting.md
grep -c '^## ' references/flux2-prompting.md
grep -c 'This file covers prompt text' references/flux2-prompting.md
```

Expected: `0`, `10`, `1`.

- [ ] **Step 5: Confirm the four-part frame survived**

Task 1's Questions block cites it by name, so cutting the wrong section would leave a dangling reference.

```bash
grep -n 'four-part frame' professor-orb/skills/forge-prompt/references/flux2-prompting.md
```

Expected: one hit, `## Prompt anatomy`'s line, naming Subject, Action, Style, and Context.

- [ ] **Step 6: Commit**

```bash
git add professor-orb/skills/forge-prompt/references/flux2-prompting.md
git commit -m "docs(forge-prompt): scope the FLUX.2 reference to prompt text" -m "Aspect ratios, resolution limits, seed, guidance, and steps are ComfyUI node settings. Nothing in the skill can act on them, and leaving them in the file it reads every round is where the destination question regrew from. Accepts that the reference is now a curated subset of the BFL guide rather than a mirror." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Record the definition in the glossary

**Files:**
- Modify: `professor-orb/CONTEXT.md:95-97` (the forge-prompt entry)
- Test: none. The gate is the grep block below.

**Interfaces:**
- Consumes: Task 1's definition. The wording here must not drift from it.
- Produces: nothing downstream.

`CONTEXT.md` is the plugin's glossary and is read before writing user-facing prose. Its forge-prompt entry defines a Suggestion in full and says nothing about a Question, which is the gap this closes. It is hard-wrapped at roughly 80 columns; the replacement below preserves that.

- [ ] **Step 1: Run the gate and confirm it fails**

```bash
grep -c 'A Question resolves an ambiguity in what the DM already' professor-orb/CONTEXT.md
```

Expected before the edit: `0`.

- [ ] **Step 2: Insert the definition**

Replace these three lines:

```
in the DM's own words. The Revised Prompt carries confirmed material only, from
the KB article, prior prompts for that same subject, the resolved style, and
the DM; invention is offered as a Suggestion instead, so a thin
```

with these four:

```
in the DM's own words. A Question resolves an ambiguity in what the DM already said,
never an absence, and an absence is a Suggestion. The Revised Prompt carries confirmed
material only, from the KB article, prior prompts for that same subject, the resolved
style, and the DM; invention is offered as a Suggestion instead, so a thin
```

This is a re-wrap of the same paragraph with one sentence added. The line before ("decides it, with a decline dropping it...") and the line after ("first prompt is correct output...") are untouched.

- [ ] **Step 3: Run the gate and confirm it passes**

```bash
grep -c 'A Question resolves an ambiguity in what the DM already' professor-orb/CONTEXT.md
```

Expected: `1`.

- [ ] **Step 4: Run the spec's complete verification block**

All of it, from a clean working tree at the repo root:

```bash
cd professor-orb/skills/forge-prompt && grep -c 'A Question resolves an ambiguity, never an absence' SKILL.md; grep -ci 'where will it end up\|at what size\|where the image goes' SKILL.md; grep -c 'Zero to three' SKILL.md; grep -ci 'One to three' SKILL.md
```

Expected, in order: `1`, `0`, `1`, `0`.

```bash
grep -ci 'aspect ratio\|Guidance (flex)' professor-orb/skills/forge-prompt/references/flux2-prompting.md
```

Expected: `0`.

```bash
sed -n '/^## The loop/,/^## The test runs/p' professor-orb/skills/forge-prompt/SKILL.md | grep '^### '
```

Expected: `Revised Prompt`, `Suggestions`, `Questions`, and `Loop rules`.

- [ ] **Step 5: Confirm no version drift**

```bash
grep -h '"version"' .claude-plugin/marketplace.json professor-orb/.claude-plugin/plugin.json
```

Expected: both read `1.15.0`. A bump is out of scope for this plan.

- [ ] **Step 6: Confirm the Node suites still pass**

No executable code was touched, so this is a regression check rather than a test of the change.

```bash
for f in $(find professor-orb -name "*.test.mjs" | sort); do node "$f" || break; done
```

Expected: all eight suites exit zero.

- [ ] **Step 7: Commit**

```bash
git add professor-orb/CONTEXT.md
git commit -m "docs(professor-orb): define a Question in the forge-prompt glossary entry" -m "The entry defined a Suggestion in full and said nothing about a Question, which is the half that just changed." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Coverage against the spec

| Spec requirement | Task |
|---|---|
| Frontmatter description reworded | 1, Step 2 |
| `### Questions` replaced in full | 1, Step 4 |
| Floor drops from one to zero | 1, Step 4 |
| Counter-example replaces the example | 1, Step 4 (the "Is he bearded?" line) |
| Suggestions cross-reference no longer contradicts | 1, Step 3 — *beyond the spec, see the note in Task 1* |
| Step 0 Forge opener replaced | 2, Step 2 |
| "Never stall" parenthetical trimmed | 2, Step 3 |
| Two reference tables cut | 3, Step 3 |
| Reference gains a positive scope line | 3, Step 2 |
| `CONTEXT.md` gains the Question definition | 4, Step 2 |
| No new never-do entry | Global Constraints; nothing in any task adds one |
| No version bump | 4, Step 5 |
