# Article Boundaries and the Lore Item Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `chronicler` writing campaign material and premature articles into the player-facing knowledge base, and give the lore item flow the carriers that `prep` and `chronicler` both already reference but that were never built.

**Architecture:** Almost all of this is prose edits to skill, agent, and command markdown files, which are the plugin's actual instruction surface. One file is executable code (`hooks/pipeline-next.mjs`) and it has a test that pins its output string exactly. Chronicler gains three new sections and a run-mode decision; `debrief` and `prep` each gain one section; the session-reports lane gains a fourth file kind and every enumeration of that lane must learn about it.

**Tech Stack:** Markdown skill files, Node.js built-ins (no framework, no dependencies), `node <file>.test.mjs` for tests.

**Spec:** `docs/superpowers/specs/2026-08-20-professor-orb-article-boundaries-and-lore-flow-design.md`

## Global Constraints

- **No em dashes anywhere in any file this plan touches.** SHARED-PRINCIPLES Principle 6. Use commas, colons, parentheses, or restructure.
- **Vocabulary is fixed and every task must use these exact terms:**
  - **session-driven run**: a chronicler run where the DM named a session report or prep file, or where `debrief` or `prep` just ran.
  - **standalone run**: a chronicler run where the DM invoked chronicler on its own subject and no report or prep file is in scope.
  - **the campaign's `articles/` folder**: `<sessionReportsRoot>/<campaign>/articles/`, the staging area. Never called a "staging root" and never recorded in `conventions.json`.
  - **Lore Candidates**: the new section in the session report, written by `debrief`.
  - **Lore Resolution**: the new section in the session brief, written by `prep`.
  - **Lore Resolution tiers**, verbatim: `Needed for next session`, `Wanted this cycle`, `Backlog`.
  - **work-tracking state** versus **narrative content**: the distinction that licenses chronicler to edit reports and briefs at all.
  - **DM Eyes-Only block**: a `%%`-fenced passage. Never "comment", never "hidden block".
- **Do not add a `stagingRoot` field to `conventions.json`,** do not touch `references/base-rules.json`, and do not bump `schemaVersion`. Staging is a fixed subdirectory, following the precedent of `content/` and `prompts/`.
- **The full suite must stay green after every task.** Run:
  ```bash
  for f in $(find professor-orb -name "*.test.mjs" | sort); do node "$f" || break; done
  ```
- **Every task commits.** Conventional-commit prefix, scope `professor-orb` or the component name, and this trailer on every commit:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  ```
- **Line numbers in this plan are pre-edit.** Each task shifts the ones below it in the same file. Always locate by the quoted anchor text, never by the number alone.

---

## File Structure

| File | Responsibility after this change |
|---|---|
| `professor-orb/skills/chronicler/SKILL.md` | Gains run-mode determination, three new sections (what an article is, where it goes, DM Eyes-Only blocks), publish handling, and write-back. The bulk of the change. |
| `professor-orb/skills/debrief/SKILL.md` | Report gains an unconditional Lore Candidates section; Phase 4 merges the lore agent's output into it. |
| `professor-orb/skills/prep/SKILL.md` | Brief gains Section 5, Lore Resolution, with carry-forward from the previous brief. |
| `professor-orb/agents/lore.md` | Output format gains a Lore Candidates bucket; three stale claims about who persists the proposal corrected. |
| `professor-orb/hooks/pipeline-next.mjs` + `.test.mjs` | Chronicler's next-step clause names both lanes. |
| `professor-orb/commands/log.md` | Lane enumeration and surprise guard learn about `articles/`. |
| `professor-orb/agents/kb-validator.md` | Staged articles exempt from index-ownership and parity checks. |
| `professor-orb/commands/migrate.md` | Promotion out of staging named as a scope. |
| `professor-orb/skills/forge-prompt/SKILL.md` | Grounding also resolves staged articles. |
| `professor-orb/skills/orb/SKILL.md`, `README.md`, `CONTEXT.md` | Documentation parity. |
| `.claude-plugin/marketplace.json`, `professor-orb/.claude-plugin/plugin.json` | Version 1.16.0. |

---

### Task 1: Chronicler decides its run mode

This is the blocker. Without it there is no reachable standalone run, every new article stages, and chronicler stops writing to `kbRoot` entirely.

**Files:**
- Modify: `professor-orb/skills/chronicler/SKILL.md:37` (Step 1a item 1)
- Modify: `professor-orb/skills/chronicler/SKILL.md:199` (Inputs line)

**Interfaces:**
- Produces: the terms **session-driven run** and **standalone run**, which Tasks 2, 5, 6, 7 and 11 all reference.

- [ ] **Step 1: Replace Step 1a item 1**

Find this line:

```
1. **Identify the target report.** If the user named one, use it. If not, find the most recent report from `debrief`. If there are multiple campaigns, ask.
```

Replace with:

```
1. **Decide the run mode, then identify inputs.** This decision governs where new articles go (see "Where an article goes"), so make it first and state it in the proposal header.

   - **Session-driven run.** The DM named a session report or a prep file, or `debrief` or `prep` just ran in this conversation. Use the named report; if the DM named a campaign but no specific report, use that campaign's most recent one. If there are multiple campaigns and the DM named none, ask.
   - **Standalone run.** The DM invoked this skill on its own subject: "write up the Vela article," "tidy the faction pages," "the Cinder Pact needs an entry." No report and no prep file are in scope.

   **Do not go hunting for the most recent report on a standalone run.** Auto-discovering a report is what makes a run session-driven, so discovering one turns a standalone request into a session-driven pass and sends its articles to staging. If the DM's request names a subject rather than a session, the run is standalone and the rest of Step 1a's report reading does not apply.
```

- [ ] **Step 2: Replace the Inputs line at 199**

Find this line:

```
- **Inputs:** Report from `debrief` (required). Prep file from `prep` (optional, raises priority of P0 lore items). Proposal from the `lore` agent, produced during `debrief`'s Phase 4 (optional, provides pre-validated contradiction and temporal analysis).
```

Replace with:

```
- **Inputs:** On a session-driven run, the report from `debrief` (required for that mode) and the prep file from `prep` when one exists (its Lore Resolution section names which lore items are priorities). On a standalone run, the DM's named subject and the KB itself; no report is required or sought. Either way, the `lore` agent's in-conversation proposal is an optional supplement when the same conversation produced one.
```

- [ ] **Step 3: Verify both edits landed and the old text is gone**

```bash
grep -n "Decide the run mode" professor-orb/skills/chronicler/SKILL.md
grep -c "find the most recent report from \`debrief\`" professor-orb/skills/chronicler/SKILL.md
grep -c "P0" professor-orb/skills/chronicler/SKILL.md
```

Expected: line number for the first; `0` for the second; `1` for the third (line 201 still mentions it and is handled in Task 7).

- [ ] **Step 4: Run the full suite**

```bash
for f in $(find professor-orb -name "*.test.mjs" | sort); do node "$f" || break; done
```

Expected: all eight suites pass.

- [ ] **Step 5: Commit**

```bash
git add professor-orb/skills/chronicler/SKILL.md
git commit -m "fix(chronicler): decide the run mode before reading inputs

Step 1a made a report mandatory and auto-discovered one when the DM named
none, so a standalone run was unreachable. Every run was session-driven,
which under the new placement rule would stage every new article and stop
chronicler writing to kbRoot at all.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Chronicler learns where an article goes

**Files:**
- Modify: `professor-orb/skills/chronicler/SKILL.md`, insert a new section after the "First: learn the user's system" section and before `## Two phases: propose, then execute` (line 29 pre-edit)

**Interfaces:**
- Consumes: **session-driven run** / **standalone run** from Task 1.
- Produces: the term **the campaign's `articles/` folder**, used by Tasks 5, 7, 9, 11, 12, 13.

- [ ] **Step 1: Insert the new section**

Immediately before the line `## Two phases: propose, then execute`, insert:

```markdown
## Where an article goes

Two destinations are normal, and the run mode from Step 1a decides which is the default for **new** articles.

- **A session-driven run stages new articles.** Write them to `<sessionReportsRoot>/<campaign>/articles/`, creating that folder if it does not exist. Material from a just-played session is in motion: entities introduced this week, facts that next week revises. Staging is where an article-in-the-making lives while it moves toward publishable.
- **A standalone run may write new articles to `kbRoot`.** The DM asked for lore work on its own terms, not for a session's consequences to be propagated.

**Edits go where the article already lives, and never relocate it.** If the target sits in `kbRoot`, edit it there. If it sits in the campaign's `articles/` folder, edit it there. An edit never moves its target between the two, on either run mode.

**Promotion is a separate operation the DM asks for by name.** Moving a staged article into `kbRoot` is never a side effect of a lore pass, never bundled into an edit, and never something you offer to do "while you are in there" (Principle 8). `/migrate` performs promotions; point the DM at it when they ask.

**What a staged article is outside of.** State these plainly if the DM asks why a staged article was not checked:

- The write-time validator skips every `scope: "kb"` rule for a file outside `kbRoot`, so index parity, single ownership, and the split and absorb thresholds do not apply to a staged article. You own its placement decisions yourself until promotion.
- `validation-sweep` enumerates each setting's `kbRoot` only, so `/sweep` does not scan staged articles.
- A staged article therefore carries no owning index, and that is correct rather than a defect.

Frontmatter rules, filename rules, and the content rules in "What an article is" apply in full at both destinations. Staging is about readiness, never about relaxing the standard.
```

- [ ] **Step 2: Verify the section is in place and reads correctly in context**

```bash
grep -n "^## Where an article goes" professor-orb/skills/chronicler/SKILL.md
sed -n "$(grep -n '^## Where an article goes' professor-orb/skills/chronicler/SKILL.md | cut -d: -f1),+3p" professor-orb/skills/chronicler/SKILL.md
grep -c "—" professor-orb/skills/chronicler/SKILL.md
```

Expected: a line number, the opening lines of the section, and `0` em dashes.

- [ ] **Step 3: Run the full suite**

```bash
for f in $(find professor-orb -name "*.test.mjs" | sort); do node "$f" || break; done
```

Expected: all eight suites pass.

- [ ] **Step 4: Commit**

```bash
git add professor-orb/skills/chronicler/SKILL.md
git commit -m "feat(chronicler): route new articles by run mode

A session-driven run stages new articles in the campaign's articles/
folder; a standalone run may write them to kbRoot. Edits never relocate
their target and promotion is a separate DM-requested operation.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Chronicler learns what an article is

**Files:**
- Modify: `professor-orb/skills/chronicler/SKILL.md`, insert a new section immediately before the `## Where an article goes` section added in Task 2

**Interfaces:**
- Produces: the four excluded categories (**the party**, **the session**, **the players**, **the plan**) and the sentence-subject test, referenced by Tasks 4, 5 and 7.

- [ ] **Step 1: Insert the new section**

Immediately before `## Where an article goes`, insert:

```markdown
## What an article is

An article records the world. It does not record the campaign's progress through the world.

Write what is true about the subject: what it is, what it does, where it sits, who it is connected to, what has happened to it. A fact stays in scope even when the party has not learned it yet. "Vela Thorne killed Duke Aldric" is a fact about Vela, and it belongs in her article whether or not anyone at the table has worked it out. How plainly you frame such a fact is a judgment call that can change over the course of an adventure; whether the fact belongs is not.

Four kinds of sentence are about the campaign rather than the world. None of them belongs in an article, at either destination, in any article type:

- **The party.** What the PCs did, saw, said, or suspected. "The party met her at the Rusty Anchor and found her evasive." An article about a person does not narrate someone else's visit.
- **The session.** Anything indexed to a session number or a real-world date of play. "In Session 12..." Session-scoped narrative belongs to the report, which already has it.
- **The players.** What the table knows or does not know. "The party does not yet know her true identity."
- **The plan.** Anything not yet run: a planned reveal, an intended scene, a prepared contingency. "She will flee the city if confronted." Sourced from a prep brief, it describes an event that has not happened.

**The test is the sentence's subject, not your judgment about sensitivity.** If a sentence is about the party, a session, the players, or a plan, it is campaign material. Rewrite it as a world fact or leave it out. All four already live in the session report and the prep brief, where they are correct; a second copy inside an article drifts out of sync with the first.

**One carve-out: temporal declarations.** A time-travel interpretation the DM declared through the `timeline` skill (loop, branch, rewrite, or unresolved) is canon about a world phenomenon, not campaign status, and is in scope. A declaration article belongs in `kbRoot` regardless of run mode, because `timeline` reads only `kbRoot`.
```

- [ ] **Step 2: Verify**

```bash
grep -n "^## What an article is" professor-orb/skills/chronicler/SKILL.md
grep -n "The test is the sentence's subject" professor-orb/skills/chronicler/SKILL.md
grep -c "—" professor-orb/skills/chronicler/SKILL.md
```

Expected: two line numbers, and `0` em dashes.

- [ ] **Step 3: Run the full suite**

```bash
for f in $(find professor-orb -name "*.test.mjs" | sort); do node "$f" || break; done
```

Expected: all eight suites pass.

- [ ] **Step 4: Commit**

```bash
git add professor-orb/skills/chronicler/SKILL.md
git commit -m "feat(chronicler): an article records the world, not the campaign

Sentences about the party, the session, the players, or the plan are
campaign material and stay out of articles at every write location. The
test is the sentence's subject, which is observable, rather than a
judgment about sensitivity, which is not.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Chronicler learns DM Eyes-Only blocks

**Files:**
- Modify: `professor-orb/skills/chronicler/SKILL.md`, insert a new section immediately after the `## Where an article goes` section

**Interfaces:**
- Consumes: the four excluded categories from Task 3.

- [ ] **Step 1: Insert the new section**

Immediately after the `## Where an article goes` section and before `## Two phases: propose, then execute`, insert:

```markdown
## DM Eyes-Only blocks

A passage fenced in `%%` is hidden from rendered views, including a published site. The DM may ask for one.

**Only when the DM asks.** Never wrap a passage on your own initiative, and never unwrap one. Removing a fence exposes content to players, so the rule binds harder on removal than on creation: an existing block is not yours to open even when the material inside it now looks public.

**The default for an unrevealed in-world fact is plain prose, not a block.** "What an article is" already puts the fact in the article, and on a session-driven run the article is staged anyway, so location is carrying the secrecy. A block is what the DM reaches for when they want one passage hidden inside an article that is already published.

**Preserve every block you encounter.** An edit made for any other reason must not reflow, relocate, split, or dissolve a block, and must not quote its contents into another article's visible prose or into an index entry.

**Never put campaign material inside a block.** `%%` governs who sees a fact, not whether the fact belongs. The four categories in "What an article is" stay out whether hidden or not.

**Placement, when the DM asks for one:** immediately after the prose it relates to, not in a trailing section, so that an eventual unwrap is a clean edit rather than a rewrite.

**When a report shows the party has learned something an existing block covers,** note it under "Deferred / Flagged" in the proposal and let the DM decide. Do not unwrap it, and do not treat the reveal as an approved edit.
```

- [ ] **Step 2: Verify**

```bash
grep -n "^## DM Eyes-Only blocks" professor-orb/skills/chronicler/SKILL.md
grep -n "Only when the DM asks" professor-orb/skills/chronicler/SKILL.md
grep -c "—" professor-orb/skills/chronicler/SKILL.md
```

Expected: two line numbers, and `0` em dashes.

- [ ] **Step 3: Run the full suite**

```bash
for f in $(find professor-orb -name "*.test.mjs" | sort); do node "$f" || break; done
```

Expected: all eight suites pass.

- [ ] **Step 4: Commit**

```bash
git add professor-orb/skills/chronicler/SKILL.md
git commit -m "feat(chronicler): DM Eyes-Only blocks are opt-in only

Chronicler never creates or removes a %% block unasked, preserves any it
encounters, and never puts campaign material inside one. A reveal is
flagged for the DM rather than applied.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Chronicler's inputs and proposal template

**Files:**
- Modify: `professor-orb/skills/chronicler/SKILL.md:38` (Step 1a item 2)
- Modify: `professor-orb/skills/chronicler/SKILL.md:39` (Step 1a item 3)
- Modify: `professor-orb/skills/chronicler/SKILL.md:40` (Step 1a item 4, the line-70 pointer)
- Modify: `professor-orb/skills/chronicler/SKILL.md:48` (Step 1b item 1)
- Modify: `professor-orb/skills/chronicler/SKILL.md:57-87` (the proposal template)

**Interfaces:**
- Consumes: **session-driven run**, **the campaign's `articles/` folder**.
- Produces: the proposal header field `**Run mode:**` and the table columns `Destination` and `Publish`, which Task 6 and Task 7 write into.

- [ ] **Step 1: Replace Step 1a item 2**

Find:

```
2. **Read the report end-to-end.** The lore candidates section is your backbone, but also read the narrative, new canon, discovered canon, and open threads sections.
```

Replace with:

```
2. **Read the report end-to-end, and know what each section is for.** The **Lore Candidates** section is your backbone: it is the durable record of the `lore` agent's findings plus what `debrief` itself flagged. **New canon** and **discovered canon** are article material. The **narrative recap** and **open threads** sections are context: read them to understand what happened and what is now true, then leave them where they are. Open threads in particular is defined by `debrief` as what has changed in the world that the party does not yet know about, which makes it both a rich source of world facts and a guaranteed source of campaign material. Take the facts, leave the framing (see "What an article is").
```

- [ ] **Step 2: Replace Step 1a item 3**

Find:

```
3. **Read the matching prep file from `prep` if it exists.** If it has a lore resolution section, treat P0 items as priority for this pass.
```

Replace with:

```
3. **Read the matching prep file from `prep` if it exists, for priorities only.** A prep brief is DM planning material. Its five sections are Work Review, Last Session Recap, North Stars, Handouts, and **Lore Resolution**. Only Lore Resolution concerns you: it names the outstanding lore items and their tier, and items under `Needed for next session` are this pass's priority. Nothing else in the brief is article content. North Stars in particular are scenes the DM has not run yet, which makes anything sourced from them a plan, excluded by "What an article is". If the brief has no Lore Resolution section, or it is empty, that is the normal case; move on.
```

- [ ] **Step 3: Replace the parenthetical in Step 1a item 4**

Find this fragment inside item 4:

```
(If this is a fresh session without a prior lore run, the proposal will not be available in the chat history; mark the lore proposal as "not available" in your proposal template at line 70. You may optionally suggest the DM re-run a lore analysis if they want that analysis incorporated.)
```

Replace with:

```
(The agent's findings are not lost when the conversation is: `debrief` writes them into the report's Lore Candidates section in its Phase 4, which is why that section is your backbone. A same-conversation lore run is a supplement to it, not the only source. If none ran in this conversation, mark the **Lore agent proposal** header field of the proposal as "not available in conversation; read from the report's Lore Candidates section" and carry on.)
```

- [ ] **Step 4: Replace Step 1b item 1**

Find:

```
1. **New articles to create.** For each: proposed filename, target folder, target owning index, article type, estimated length (stub, short, medium, or full), and a two-sentence summary.
```

Replace with:

```
1. **New articles to create.** For each: proposed filename, destination (the campaign's `articles/` folder on a session-driven run, a `kbRoot` folder on a standalone run), the proposed `publish` value, article type, estimated length (stub, short, medium, or full), and a two-sentence summary. Target owning index applies only to a `kbRoot` destination; a staged article has none, and that is correct.
```

- [ ] **Step 5: Update the proposal template**

In the fenced template block, find the header lines:

```
**Source report:** [link]
**Source prep:** [link or "None"]
**Lore agent proposal:** [incorporated / not available]
```

Replace with:

```
**Run mode:** [session-driven / standalone]
**Source report:** [link, or "None (standalone run)"]
**Source prep:** [link or "None"]
**Lore agent proposal:** [incorporated / not available in conversation, read from the report]
```

Then find the new-articles table:

```
## 1. New Articles (count)
| Filename | Folder | Owning Index | Type | Length | Summary |
|----------|--------|--------------|------|--------|---------|
```

Replace with:

```
## 1. New Articles (count)
| Filename | Destination | Publish | Owning Index | Type | Length | Summary |
|----------|-------------|---------|--------------|------|--------|---------|
```

Then find the Deferred / Flagged heading and insert a new numbered section immediately before it:

```
## Deferred / Flagged
```

Replace with:

```
## 6. Lore Items to Mark Resolved (count)
| Item | Carrier(s) | How it was resolved |
|------|-----------|---------------------|

## Deferred / Flagged
```

- [ ] **Step 6: Verify every template change and that no hardcoded line pointer survives**

```bash
grep -n "Run mode:" professor-orb/skills/chronicler/SKILL.md
grep -n "| Filename | Destination | Publish |" professor-orb/skills/chronicler/SKILL.md
grep -n "Lore Items to Mark Resolved" professor-orb/skills/chronicler/SKILL.md
grep -nE "template at line [0-9]+|at line [0-9]+" professor-orb/skills/chronicler/SKILL.md
grep -c "lore resolution section" professor-orb/skills/chronicler/SKILL.md
```

Expected: line numbers for the first three; **no output** for the fourth (no hardcoded line pointers remain); `0` for the fifth.

- [ ] **Step 7: Run the full suite**

```bash
for f in $(find professor-orb -name "*.test.mjs" | sort); do node "$f" || break; done
```

Expected: all eight suites pass.

- [ ] **Step 8: Commit**

```bash
git add professor-orb/skills/chronicler/SKILL.md
git commit -m "fix(chronicler): point the inputs at sections that exist

The lore candidates and lore resolution sections chronicler named were
never built by debrief or prep, so with both missing the only surviving
instruction was to read whole files, which is how session narrative,
open threads, and unrun North Stars reached articles.

Proposal template gains Run mode, Destination and Publish, and a section
for lore items to mark resolved. Replaces a hardcoded line-70 pointer
that was already off by six.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Chronicler sets publish explicitly

**Files:**
- Modify: `professor-orb/skills/chronicler/SKILL.md:120-131` (Step 2c)

**Interfaces:**
- Consumes: the `Publish` column from Task 5.

- [ ] **Step 1: Add the publish bullet to Step 2c**

In Step 2c's bullet list, immediately after the `- **Frontmatter is mandatory**...` bullet, insert:

```
- **Set `publish` explicitly on every article you create, as the first frontmatter field.** The base rule set enforces its presence at `warn`, not `block`, so a missing field is written successfully and falls back to the site's default, which is how an unmarked secret article reaches a player-facing wiki. Write the value the DM approved in the proposal: `false` for a staged article, the approved value for a `kbRoot` article. `frontmatterFieldOrder` requires `publish` before `type` and `tags`, so put it first.
- **On an edit to an existing article that has no `publish` field, leave the field alone.** Do not insert one. Setting a disclosure flag on an article you did not create is the DM's call, and guessing it would either hide finished lore or leak secret lore, which is the same reason `/migrate` refuses to default it in bulk. List the article under "Deferred / Flagged" and note that `/sweep` reports articles missing `publish`.
```

- [ ] **Step 2: Amend the validator retry line**

Find:

```
If a write trips a block-level violation from the validator hook, fix the write and retry rather than working around it.
```

Replace with:

```
If a write trips a block-level violation from the validator hook, fix the write and retry rather than working around it. Warn-level violations are advisory in general, with one exception: on an article you are **creating**, a warning that `publish` is missing is treated as blocking. Fix it and retry before moving on. The exception does not extend to edits, per the rule above.
```

- [ ] **Step 3: Verify**

```bash
grep -n "as the first frontmatter field" professor-orb/skills/chronicler/SKILL.md
grep -n "leave the field alone" professor-orb/skills/chronicler/SKILL.md
grep -n "is treated as blocking" professor-orb/skills/chronicler/SKILL.md
```

Expected: three line numbers.

- [ ] **Step 4: Run the full suite**

```bash
for f in $(find professor-orb -name "*.test.mjs" | sort); do node "$f" || break; done
```

Expected: all eight suites pass.

- [ ] **Step 5: Commit**

```bash
git add professor-orb/skills/chronicler/SKILL.md
git commit -m "fix(chronicler): set publish explicitly on every article it creates

frontmatterPublishPresence ships at warn, and chronicler committed only to
fixing block-level violations, so an article written with no publish field
succeeded and fell back to the site default. Binds chronicler to the warning
for creates only; an edit to a legacy article leaves the field alone and is
flagged for /sweep.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Chronicler writes back and stops claiming it never does

**Files:**
- Modify: `professor-orb/skills/chronicler/SKILL.md:3` (frontmatter description)
- Modify: `professor-orb/skills/chronicler/SKILL.md:111-118` (Step 2b execution order)
- Modify: `professor-orb/skills/chronicler/SKILL.md:141-150` (report-back template)
- Modify: `professor-orb/skills/chronicler/SKILL.md:191` (never-do rule)
- Modify: `professor-orb/skills/chronicler/SKILL.md:200` (Outputs line)
- Modify: `professor-orb/skills/chronicler/SKILL.md:201` (Downstream line)
- Modify: `professor-orb/skills/chronicler/SKILL.md:203` (handoff line)

**Interfaces:**
- Consumes: the `Lore Items to Mark Resolved` table from Task 5.
- Produces: the term **work-tracking state**, referenced by Tasks 9 and 11.

- [ ] **Step 1: Add the write-back step to Step 2b**

In Step 2b's numbered list, after item 6 (`**Apply artifact cleanup**...`), add:

```
7. **Mark resolved lore items last**, once every article they refer to exists. For each row of the proposal's "Lore Items to Mark Resolved" table, tick the item's checkbox and append a one-line note of how it was resolved, in every carrier that holds it: the session report's Lore Candidates section and the prep brief's Lore Resolution section, both, wherever each exists. Use this shape:

   ```
   - [x] Sunken Temple has no article. North Star 2 puts the party at its entrance.
         **Resolved 2026-08-20 by chronicler:** created `Sunken-Temple.md` (staged).
   ```

   If a carrier does not exist (no prep brief was written, or the report has been archived), mark the ones that do and say plainly in the report-back which carrier was missing. A missing carrier is never a reason to fail the run. Mark an item resolved even where you satisfied it incidentally rather than by working from the list: the point of the record is that nobody is later unsure whether the work was done.
```

- [ ] **Step 2: Narrow the never-do rule at 191**

Find:

```
- **Never edit session reports or prep files.** Those are historical records belonging to `debrief` and `prep`.
```

Replace with:

```
- **Never edit narrative content in session reports or prep files.** Those are historical records belonging to `debrief` and `prep`. You may update **work-tracking state** in them, and only that: ticking a lore item's checkbox in the report's Lore Candidates section or the brief's Lore Resolution section and appending the one-line resolution note. A checkbox in a work list is not history. The recap is. Do not touch a narrative recap, an open thread, a North Star, a Work Review entry, or anything else in either file.
```

- [ ] **Step 3: Replace the Outputs line at 200**

Find:

```
- **Outputs:** The proposal file in `.professor-orb/proposals/`, new and edited KB articles, index updates, log entries. No changes to session reports or prep files.
```

Replace with:

```
- **Outputs:** The proposal file in `.professor-orb/proposals/`; new articles (in the campaign's `articles/` folder on a session-driven run, in `kbRoot` on a standalone run); edited articles and index updates where those articles live; log entries; and work-tracking updates marking lore items resolved in the source report and prep brief. Never narrative changes to a report or a brief.
```

- [ ] **Step 4: Replace the Downstream line at 201**

Find:

```
- **Downstream of `debrief`:** This is the designated follow-up for the Lore Candidates section and the `lore` agent's proposal.
```

Replace with:

```
- **Downstream of `debrief`:** This is the designated follow-up for the report's Lore Candidates section, which `debrief` writes and which survives the conversation that produced it.
- **Downstream of `prep`:** The brief's Lore Resolution section names which lore items are priorities for this pass, and its `Needed for next session` tier is what to clear first.
```

- [ ] **Step 5: Replace the commit handoff at 203**

Find:

```
- **Handoff to `/scribe`:** `/scribe` can commit the KB changes.
```

Replace with:

```
- **Handoff to `/scribe` and `/log`:** `/scribe` commits changes in `kbRoot`. `/log` commits the campaign lane, which includes staged articles in the `articles/` folder and the write-backs to the report and brief. A session-driven run usually produces work for both.
```

- [ ] **Step 6: Amend the frontmatter description at line 3**

In the `description:` string, find the phrase:

```
and the only pipeline component that writes to the knowledge base.
```

Replace with:

```
and the only pipeline component that writes KB articles.
```

And find:

```
then executes exactly what the approved file says.
```

Replace with:

```
then executes exactly what the approved file says. New articles from a session-driven run are staged in the campaign's articles folder rather than written straight to the knowledge base.
```

- [ ] **Step 7: Add the write-back line to the report-back template**

In the `## Lore Update Complete` fenced block, after the `**Artifacts cleaned:**` line, add:

```
**Lore items marked resolved (N):** [list, naming any carrier that was missing]
```

- [ ] **Step 8: Verify no contradictory claim survives**

```bash
grep -n "No changes to session reports or prep files" professor-orb/skills/chronicler/SKILL.md
grep -n "Never edit session reports or prep files" professor-orb/skills/chronicler/SKILL.md
grep -n "work-tracking state" professor-orb/skills/chronicler/SKILL.md
grep -n "Handoff to \`/scribe\` and \`/log\`" professor-orb/skills/chronicler/SKILL.md
grep -c "—" professor-orb/skills/chronicler/SKILL.md
```

Expected: **no output** for the first two; line numbers for the next two; `0` em dashes.

- [ ] **Step 9: Run the full suite**

```bash
for f in $(find professor-orb -name "*.test.mjs" | sort); do node "$f" || break; done
```

Expected: all eight suites pass.

- [ ] **Step 10: Commit**

```bash
git add professor-orb/skills/chronicler/SKILL.md
git commit -m "feat(chronicler): mark resolved lore items in their carriers

Chronicler ticks each resolved item in the report's Lore Candidates section
and the brief's Lore Resolution section, both where they exist, so a later
run is not left guessing whether the work was done.

Narrows the never-edit rule to narrative content and corrects the three
other places that claimed chronicler never touches those files or writes
only to the KB.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Debrief writes a Lore Candidates section

**Files:**
- Modify: `professor-orb/skills/debrief/SKILL.md:69` (report structure)
- Modify: `professor-orb/skills/debrief/SKILL.md:83-95` (Phase 4)
- Modify: `professor-orb/skills/debrief/SKILL.md:91` (the phantom persistence promise)
- Modify: `professor-orb/skills/debrief/SKILL.md:93` (the agent-declined branch)
- Modify: `professor-orb/skills/debrief/SKILL.md:135` (connections line)

**Interfaces:**
- Produces: the report's **Lore Candidates** section, consumed by Task 5 (chronicler) and Task 10 (prep).

- [ ] **Step 1: Make the section unconditional**

The list at line 69 is the *third* fallback, used only when the project has neither a template nor existing reports. Adding the section there alone would never take effect in a real consumer. Find:

```
**Draft the report.** If the project has a report template, use it. If it has existing reports, match their structure. If neither exists, build one covering: metadata, narrative recap, PCs present, NPCs and factions, locations, inventory, lore revelations (new canon and discovered canon), and open threads. The open threads section describes the state of the world, not a list of tasks for the DM. Fill every section; for sections with nothing to report, write a stub rather than omitting it, downstream skills need predictable structure.
```

Replace with:

```
**Draft the report.** If the project has a report template, use it. If it has existing reports, match their structure. If neither exists, build one covering: metadata, narrative recap, PCs present, NPCs and factions, locations, inventory, lore revelations (new canon and discovered canon), and open threads. The open threads section describes the state of the world, not a list of tasks for the DM. Fill every section; for sections with nothing to report, write a stub rather than omitting it, downstream skills need predictable structure.

**Every report carries a Lore Candidates section, whichever structure source won.** This is the one section to append when a template or the existing reports do not already have one, because it is the durable carrier the `chronicler` skill reads as its backbone; without it chronicler falls back to reading the whole report and pulls campaign material into articles. Seed it in this phase from what you already tracked: entities touched this session that have no KB article, new canon that needs capturing, and anything the DM flagged during interrogation. Write each as an unchecked item so it can be ticked later:

```
## Lore Candidates

- [ ] Sunken Temple has no article. Referenced twice this session.
- [ ] New canon: the Cinder Pact sigil predates the Compact.
```
```

- [ ] **Step 2: Add the Phase 4 merge, with an explicit mapping**

The `lore` agent's Output format (`agents/lore.md:146`) has no Lore Candidates bucket, so the mapping must be stated. Find:

```
Wait for the `lore` agent to return its findings. Present a summary to the DM (not a raw dump) and point them at the full proposal above in this conversation (the chronicler skill re-derives and persists it when it runs), and tell them the `chronicler` skill is what actually canonizes any of it into the KB.
```

Replace with:

```
Wait for the `lore` agent to return its findings, then **merge them into the report's Lore Candidates section**. This is the second and last write to the report, and it is what makes the agent's analysis durable rather than dying with this conversation. Map its output sections as follows:

- **Entities Without Articles** and the new-article bucket of its **Update Proposal** become Lore Candidates items.
- The edit and index buckets of its **Update Proposal** become Lore Candidates items too, worded as the change rather than as a new article.
- **Contradictions** and **Temporal Inconsistencies** do **not** become Lore Candidates. They are chronicler's "Deferred / Flagged" material and the `historian` agent's business. Note under the section that the agent raised N of each and leave them in the conversation for chronicler to pick up.
- **Non-obvious Connections** are neither; mention them to the DM and do not write them into the report.

Present the merged section to the DM for approval (Principle 2), then update the report file. Tell them the `chronicler` skill is what canonizes any of it into the KB.
```

- [ ] **Step 3: Handle the declined branch**

Find:

```
If the `lore` agent is unavailable or the DM declines the handoff, note that the report was written without a lore cross-reference and move on. Do not attempt the deep KB cross-referencing yourself; that is the `lore` agent's job.
```

Replace with:

```
If the `lore` agent is unavailable or the DM declines the handoff, the Lore Candidates section you seeded in Phase 3 stands as written and final: do not make it conditional on the agent, and skip the second write entirely. Note inside the section that no lore cross-reference ran, so a later reader knows the list is debrief's own and not the agent's. Do not attempt the deep KB cross-referencing yourself; that is the `lore` agent's job.
```

- [ ] **Step 4: Fix the connections line at 135**

Find:

```
- **Handoff to `chronicler`:** The `lore` agent's proposal is the input the `chronicler` skill uses to propose and execute KB updates.
```

Replace with:

```
- **Handoff to `chronicler`:** The report's Lore Candidates section is chronicler's input, and it survives this conversation. The `lore` agent's in-conversation proposal supplements it when the same conversation produced one.
```

- [ ] **Step 5: Verify**

```bash
grep -n "Every report carries a Lore Candidates section" professor-orb/skills/debrief/SKILL.md
grep -n "Entities Without Articles" professor-orb/skills/debrief/SKILL.md
grep -c "the chronicler skill re-derives and persists it" professor-orb/skills/debrief/SKILL.md
grep -c "—" professor-orb/skills/debrief/SKILL.md
```

Expected: line numbers for the first two; `0` for the third; `0` em dashes.

- [ ] **Step 6: Run the full suite**

```bash
for f in $(find professor-orb -name "*.test.mjs" | sort); do node "$f" || break; done
```

Expected: all eight suites pass.

- [ ] **Step 7: Commit**

```bash
git add professor-orb/skills/debrief/SKILL.md
git commit -m "feat(debrief): persist lore candidates into the report

debrief told the DM that chronicler re-derives and persists the lore
agent's proposal; chronicler has no such behavior, so the analysis died
with the conversation. Phase 4 now merges the agent's findings into an
unconditional Lore Candidates section, with an explicit mapping from the
agent's six output buckets.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: The lore agent stops claiming chronicler persists its work

**Files:**
- Modify: `professor-orb/agents/lore.md:5-6`, `:30`, `:183` (stale claims)
- Modify: `professor-orb/agents/lore.md:146-175` (Output format)

**Interfaces:**
- Consumes: the mapping defined in Task 8.

- [ ] **Step 1: Read the three stale claims and the output format**

```bash
sed -n '5,6p;30p;183p' professor-orb/agents/lore.md
sed -n '146,178p' professor-orb/agents/lore.md
```

- [ ] **Step 2: Correct the frontmatter description (lines 5-6)**

Find:

```
  structured lore update proposal. Read-only, never edits files; the chronicler
  skill later presents its proposal to the DM.
```

Replace with:

```
  structured lore update proposal. Read-only, never edits files; debrief writes
  these findings into the report's Lore Candidates section, and the chronicler
  skill later proposes canonizing them to the DM.
```

- [ ] **Step 3: Correct the sole-carrier claim at line 30**

Find:

```
your own proposal is written only by `chronicler`, and only after the DM approves it.
```

Replace with:

```
`debrief` persists your findings into the session report's Lore Candidates section in its Phase 4, so they survive the conversation that produced them, and `chronicler` is what canonizes any of it into the KB after the DM approves.
```

- [ ] **Step 4: Correct the never-edit rule at line 183**

Find:

```
- **Never edit files.** You are read-only. Return the proposal above as your final message; nothing from this proposal gets written until the DM approves it and the `chronicler` skill executes it.
```

Replace with:

```
- **Never edit files.** You are read-only. Return the proposal above as your final message. `debrief` writes your Lore Candidates into the report after the DM approves the merged section, and nothing else from this proposal reaches the KB until the DM approves it and the `chronicler` skill executes it.
```

- [ ] **Step 5: Add a Lore Candidates bucket to the Output format**

In the fenced Output format block, immediately after the `### Entities Without Articles` block, add:

```
### Lore Candidates
[The items from Update Proposal and Entities Without Articles above, restated as
one unchecked checkbox each, ready for debrief to paste into the report's Lore
Candidates section. Contradictions and Temporal Inconsistencies do NOT appear here.]
```

- [ ] **Step 6: Verify**

```bash
grep -n "Lore Candidates" professor-orb/agents/lore.md
grep -c "written only by \`chronicler\`" professor-orb/agents/lore.md
grep -c "—" professor-orb/agents/lore.md
```

Expected: line numbers including one in the Output format; `0` for the second; `0` em dashes.

- [ ] **Step 7: Run the full suite**

```bash
for f in $(find professor-orb -name "*.test.mjs" | sort); do node "$f" || break; done
```

Expected: all eight suites pass.

- [ ] **Step 8: Commit**

```bash
git add professor-orb/agents/lore.md
git commit -m "fix(lore): emit lore candidates and correct the persistence claim

The agent's output format had no Lore Candidates bucket, so debrief had
nothing shaped to merge. Three lines also claimed chronicler is the sole
carrier of the proposal, which debrief's Phase 4 write replaces.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Prep writes a Lore Resolution section

**Files:**
- Modify: `professor-orb/skills/prep/SKILL.md:3` (description)
- Modify: `professor-orb/skills/prep/SKILL.md:10` (the not-a-checklist claim)
- Modify: `professor-orb/skills/prep/SKILL.md:41` (previous-brief read scope)
- Modify: `professor-orb/skills/prep/SKILL.md:63` ("four sections")
- Modify: `professor-orb/skills/prep/SKILL.md:90-95` (insert Section 5 after Handouts)
- Modify: `professor-orb/skills/prep/SKILL.md:144`, `:145`, `:147` (connections)

**Interfaces:**
- Consumes: the report's **Lore Candidates** section from Task 8.
- Produces: the brief's **Lore Resolution** section and its three tiers, consumed by Task 5 and Task 7.

- [ ] **Step 1: Read the two claims that need narrowing**

```bash
sed -n '10p;41p;63p' professor-orb/skills/prep/SKILL.md
```

- [ ] **Step 2: Change "four sections" to five**

Find:

```
Build the brief with four sections in this order:
```

Replace with:

```
Build the brief with five sections in this order:
```

- [ ] **Step 3: Narrow the not-a-checklist claim at line 10**

Section 5 contradicts this sentence head-on, so narrow it rather than deleting it. Find:

```
It is not a to-do list, not a checklist, and not a work-planning tool.
```

Replace with:

```
It is not a to-do list for the DM's prep work, and not a work-planning tool. The one list it does carry is Section 5, the campaign's outstanding lore items, because the brief is the only durable place those exist.
```

- [ ] **Step 4: Widen the previous-brief read at line 41**

Find:

```
- The **previous prep file** for that campaign (to see the shape the DM prefers).
```

Replace with:

```
- The **previous prep file** for that campaign, for two things: the shape the DM prefers, and its Lore Resolution section, whose unresolved items carry forward into this brief (Section 5).
```

- [ ] **Step 5: Insert Section 5 after Handouts**

Immediately after the Section 4 Handouts prose and before `### Phase 3: Review and save`, insert:

```markdown
#### Section 5: Lore Resolution

The campaign's outstanding lore work, and the only durable record of it. `chronicler` reads this section to know what to do first, and ticks items off here as it resolves them.

**Sources, in this order:**

1. The session report's **Lore Candidates** section, for anything still unchecked.
2. Any north star that depends on a lore decision the DM has not made. You are already told to note these; this is where they go.
3. Anything the Work Review surfaced that the DM has not addressed. You are already told to mention these; this is where they go.
4. Unresolved items carried forward from the previous brief's Lore Resolution section.

**Tiers.** Group items under exactly these three headings, in this order:

- **Needed for next session.** A planned north star depends on it. You can work this out yourself, because you just wrote the north stars.
- **Wanted this cycle.**
- **Backlog.**

Propose the tiers, then let the DM adjust them during the Phase 3 review exactly as they adjust north stars. If the DM promotes an item, it stays promoted (Principle 1).

**Carry-forward discipline.** An item the previous brief marked resolved does not come back, ever (Principle 3). When you carry an item across, note where it came from so `chronicler` can find every copy later:

```
## Lore Resolution

**Needed for next session**
- [ ] Sunken Temple has no article. North Star 2 puts the party at its entrance.
- [ ] Vela Thorne's article contradicts the Cinder Pact reveal. (from 2026-08-13-REPORT)

**Wanted this cycle**
- [ ] Harbormaster Quill mentioned twice, still unarticled.

**Backlog**
- [ ] Ashfall Compact membership list is incomplete.
```

Do not resolve any of these yourself. Naming them is the whole job (see "Never write lore content" below).
```

- [ ] **Step 6: Fix the three connections lines**

Find and replace, in order:

```
- **Inputs:** The latest session report from `debrief` (required). Previous prep file (optional, for format reference).
```

becomes:

```
- **Inputs:** The latest session report from `debrief` (required), including its Lore Candidates section. Previous prep file (read whenever one exists: its Lore Resolution section carries unresolved items forward, and it is also a format reference).
```

```
- **Outputs:** A session brief that `content` reads as secondary input for handout and setpiece context.
```

becomes:

```
- **Outputs:** A session brief that `content` reads as secondary input for handout and setpiece context, and whose Lore Resolution section `chronicler` reads for priorities and writes back into as it resolves items.
```

```
- **Handoff to `chronicler`:** If the Work Review reveals lore items the DM has not yet addressed, mention that `chronicler` can handle them. Do not resolve lore here.
```

becomes:

```
- **Handoff to `chronicler`:** Lore items the Work Review reveals are written into Section 5, not mentioned in passing, so they survive this conversation. Do not resolve lore here.
```

- [ ] **Step 7: Update the frontmatter description at line 3**

In the `description:` string, find `a work review, last session recap, planned scenes (north stars), and a handout list` and replace with:

```
a work review, last session recap, planned scenes (north stars), a handout list, and the campaign's outstanding lore items
```

- [ ] **Step 8: Verify all four "four sections" sites and the new section**

```bash
grep -n "five sections in this order" professor-orb/skills/prep/SKILL.md
grep -n "^#### Section 5: Lore Resolution" professor-orb/skills/prep/SKILL.md
grep -nE "Needed for next session|Wanted this cycle|Backlog" professor-orb/skills/prep/SKILL.md
grep -c "four sections" professor-orb/skills/prep/SKILL.md
grep -c "—" professor-orb/skills/prep/SKILL.md
```

Expected: line numbers for the first three; `0` for `four sections`; `0` em dashes.

- [ ] **Step 9: Run the full suite**

```bash
for f in $(find professor-orb -name "*.test.mjs" | sort); do node "$f" || break; done
```

Expected: all eight suites pass.

- [ ] **Step 10: Commit**

```bash
git add professor-orb/skills/prep/SKILL.md
git commit -m "feat(prep): add the Lore Resolution section

prep's own description promised it feeds unresolved lore items to
chronicler, and two rules told it to note and mention them, but the brief
had nowhere to write them down, so they were said aloud and evaporated.
Section 5 is that carrier, with three tiers and carry-forward from the
previous brief.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: The pipeline-next hook names both lanes

The only executable change in this plan, and the only one with a real test cycle.

**Files:**
- Modify: `professor-orb/hooks/pipeline-next.test.mjs:119-124`
- Modify: `professor-orb/hooks/pipeline-next.mjs:59`

**Interfaces:**
- Consumes: the two-lane handoff wording from Task 7.

- [ ] **Step 1: Update the test first, so it fails**

In `professor-orb/hooks/pipeline-next.test.mjs`, find:

```javascript
  checkContains("chronicler + git mode: /scribe clause appended", r.out, "/scribe", true);
  check(
    "chronicler + git mode: clause wording is exact",
    r.out,
    "Next: the kb-validator agent can audit the changes, and /timeline can record events in the campaign chronology. /scribe can commit the KB changes.\n"
  );
```

Replace with:

```javascript
  checkContains("chronicler + git mode: /scribe clause appended", r.out, "/scribe", true);
  checkContains("chronicler + git mode: /log clause appended", r.out, "/log", true);
  check(
    "chronicler + git mode: clause wording is exact",
    r.out,
    "Next: the kb-validator agent can audit the changes, and /timeline can record events in the campaign chronology. /scribe can commit the KB changes, and /log the campaign's staged articles.\n"
  );
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node professor-orb/hooks/pipeline-next.test.mjs
```

Expected: FAIL on "chronicler + git mode: clause wording is exact", showing the old string.

- [ ] **Step 3: Update the hook**

In `professor-orb/hooks/pipeline-next.mjs`, find:

```javascript
  chronicler: " /scribe can commit the KB changes.",
```

Replace with:

```javascript
  // Chronicler writes in two lanes now: kbRoot articles that /scribe commits,
  // and staged articles in the campaign's articles/ folder that /log commits.
  // The hook reads only pipeline-state.json and versioning.json, so it cannot
  // know the run's mode; naming both unconditionally is the only correct shape.
  chronicler: " /scribe can commit the KB changes, and /log the campaign's staged articles.",
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node professor-orb/hooks/pipeline-next.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Run the full suite**

```bash
for f in $(find professor-orb -name "*.test.mjs" | sort); do node "$f" || break; done
```

Expected: all eight suites pass.

- [ ] **Step 6: Commit**

```bash
git add professor-orb/hooks/pipeline-next.mjs professor-orb/hooks/pipeline-next.test.mjs
git commit -m "fix(pipeline-next): name both lanes after a chronicler run

The Stop hook named /scribe only. A session-driven chronicler run writes
staged articles into the campaign lane, which /scribe does not commit, so
the DM was sent to the one command that would not pick them up.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: The session-reports lane learns about staged articles

**Files:**
- Modify: `professor-orb/commands/log.md:2`, `:43`, `:59`, `:128`, `:133`

**Interfaces:**
- Consumes: **the campaign's `articles/` folder**, **work-tracking state**.

- [ ] **Step 1: Read all five sites**

```bash
sed -n '2p;43p;59p;128p;133p' professor-orb/commands/log.md
```

- [ ] **Step 2: Add `articles/` to the lane enumerations at 2, 43 and 133**

At line 43, find `the \`content/\` subdirectory holding recaps, handouts, and setpieces, and the \`prompts/\` subdirectory holding what \`forge-prompt\` saved` and extend it to:

```
the `content/` subdirectory holding recaps, handouts, and setpieces, the `prompts/` subdirectory holding what `forge-prompt` saved, and the `articles/` subdirectory holding new KB articles `chronicler` staged during a session-driven run
```

At line 133, append to the "Fed by" list:

```
, and the `chronicler` skill, which stages new KB articles into the campaign's `articles/` subdirectory on a session-driven run and marks resolved lore items in the report and brief
```

At line 2, inside the `description:` string, find:

```
Fed by the debrief skill's session reports and Session Prep briefs, the content skill's recaps and handouts, and the forge-prompt skill's saved prompts, all of which live inside the same campaign folder.
```

Replace with:

```
Fed by the debrief skill's session reports and Session Prep briefs, the content skill's recaps and handouts, the forge-prompt skill's saved prompts, and the new KB articles the chronicler skill stages in the campaign's articles subdirectory, all of which live inside the same campaign folder.
```

Also find, in the same string:

```
Use whenever the DM wants to commit a session report, prep brief, recap, handout, or prompt that debrief, content, or forge-prompt just wrote.
```

Replace with:

```
Use whenever the DM wants to commit a session report, prep brief, recap, handout, prompt, or staged article that debrief, content, forge-prompt, or chronicler just wrote.
```

- [ ] **Step 3: Exempt staged articles from the surprise guard at 59**

Find:

```
`.obsidian/` is exempt: it is expected inside the project and never trips the guard.
```

Replace with:

```
`.obsidian/` is exempt: it is expected inside the project and never trips the guard. So is the campaign's `articles/` subdirectory: the KB-typed articles `chronicler` stages there (`type: Person`, `Location`, `Organization` and the rest) look like a schema mismatch for this lane and are not one. They are expected there until the DM promotes them.
```

- [ ] **Step 4: Bring the cross-prong edge case at 128 into parity with `scribe.md`**

`scribe.md:127` carries a `/migrate` exception sentence that its twin at `log.md:128` is missing. Find, at `log.md:128`:

```
- **A file moved between this lane and another prong.** Each command sees only its own lane, so the move lands in two separate commits, one from each command. Acceptable: the alternative is reaching outside the lane.
```

Replace with:

```
- **A file moved between this lane and another prong.** Each command sees only its own lane, so the move lands in two separate commits, one from each command. Acceptable: the alternative is reaching outside the lane. `/migrate` is the exception: it restructures across prongs by design and lands a cross-prong move in one commit of its own (see `commands/migrate.md`). Promotion of a staged article out of the `articles/` subdirectory into `kbRoot` is the common instance of it, and neither `/log` nor `/scribe` should try to split a promotion across two commits.
```

- [ ] **Step 5: Verify**

```bash
grep -c "articles/" professor-orb/commands/log.md
grep -n "are expected there until the DM promotes them" professor-orb/commands/log.md
grep -c "—" professor-orb/commands/log.md
```

Expected: at least `4`; a line number; `0` em dashes.

- [ ] **Step 6: Run the full suite**

```bash
for f in $(find professor-orb -name "*.test.mjs" | sort); do node "$f" || break; done
```

Expected: all eight suites pass. `commands/lane-staging.test.mjs` is the one to watch.

- [ ] **Step 7: Commit**

```bash
git add professor-orb/commands/log.md
git commit -m "feat(log): the campaign lane holds staged articles

Adds the articles/ subdirectory to every enumeration of the lane, exempts
it from the surprise guard (a type: Person article in this lane looks like
a schema mismatch and is not one), and names promotion as the common
cross-prong move /migrate owns.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: The other components learn about staging

**Files:**
- Modify: `professor-orb/agents/kb-validator.md` (Step 2, near line 61; the ownership check near line 97)
- Modify: `professor-orb/commands/migrate.md:25` and its Step 2 scope list
- Modify: `professor-orb/skills/forge-prompt/SKILL.md:81` and `:87`

- [ ] **Step 1: Exempt staged articles from kb-validator's index checks**

In `agents/kb-validator.md`, in Step 2, add:

```
**An article inside a campaign's `articles/` folder is staged, not published.** Exempt it from index-ownership and index-parity checks the same way catalog entries are exempt from graph checks: a staged article has no owning index by design, and reporting every one of them as orphaned is noise. Frontmatter, filename, cross-reference, and content checks still apply in full.
```

- [ ] **Step 2: Name promotion as a `/migrate` scope**

In `commands/migrate.md`, add to Step 2's example scope list:

```
promote the staged Vela Thorne article out of the campaign's `articles/` folder into the KB
```

And at line 25, after the sentence declining a bulk `publish` default, add:

```
`chronicler` is the component that does set `publish`, per article, in a proposal the DM approves before execution. That is not the bulk default this rule refuses; it is the opposite of it.
```

- [ ] **Step 3: Teach forge-prompt to find staged articles**

In `skills/forge-prompt/SKILL.md`, grounding source 1 resolves only `kbRoot`, so it misses the article a session-driven `chronicler` pass just wrote, which is exactly the article a DM wants a portrait of right after a session. Find:

```
1. **The subject's KB article,** if the subject is an entity the knowledge base knows, for canonical appearance. Content exclusions apply; the `block-excluded` hook enforces them at PreToolUse regardless of what you intend.
```

Replace with:

```
1. **The subject's KB article,** if the subject is an entity the knowledge base knows, for canonical appearance. Look in `kbRoot` and in the campaign's `articles/` folder, where `chronicler` stages new articles on a session-driven run; an entity canonized in the last session is normally staged rather than published. Say which of the two you found it in, so the DM knows the article's status. Content exclusions apply; the `block-excluded` hook enforces them at PreToolUse regardless of what you intend.
```

Then update the one-line grounding report near line 87 so it names the source it resolved (`kbRoot` or staged) rather than just "KB article".

- [ ] **Step 4: Verify**

```bash
grep -n "articles/" professor-orb/agents/kb-validator.md professor-orb/commands/migrate.md professor-orb/skills/forge-prompt/SKILL.md
grep -c "—" professor-orb/agents/kb-validator.md professor-orb/commands/migrate.md professor-orb/skills/forge-prompt/SKILL.md
```

Expected: at least one hit per file; `0` em dashes in each.

- [ ] **Step 5: Run the full suite**

```bash
for f in $(find professor-orb -name "*.test.mjs" | sort); do node "$f" || break; done
```

Expected: all eight suites pass.

- [ ] **Step 6: Commit**

```bash
git add professor-orb/agents/kb-validator.md professor-orb/commands/migrate.md professor-orb/skills/forge-prompt/SKILL.md
git commit -m "feat(professor-orb): teach the other components about staging

kb-validator exempts staged articles from index-ownership and parity
checks, /migrate names promotion as a scope, and forge-prompt resolves
grounding from the staging folder as well as kbRoot.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: Documentation parity and the version bump

**Files:**
- Modify: `professor-orb/skills/orb/SKILL.md:30`, `:32`, `:42`, `:60`
- Modify: `professor-orb/README.md:23`, `:24`, `:29`
- Modify: `professor-orb/CONTEXT.md` (glossary entry, lane model, log command entry, folder-index parity note)
- Modify: `.claude-plugin/marketplace.json:11`
- Modify: `professor-orb/.claude-plugin/plugin.json:4`

- [ ] **Step 1: Update orb and README**

- `orb:30` and `README:23`: prep's section list gains `outstanding lore items` as a fifth item.
- `orb:32` and `README:29`: change `The only pipeline skill that writes the KB` to `The only pipeline skill that writes KB articles`.
- `orb:42` and `README:24`: add the `articles/` subdirectory to the `/log` lane enumeration.
- `orb:60`: after a `chronicler` run, mention that `/log` commits staged articles alongside `/scribe` committing the KB.

- [ ] **Step 2: Update CONTEXT.md**

Add a glossary entry, following the file's existing entry shape including its `_Avoid_` line:

```markdown
### staging area

The campaign's `articles/` folder, `<sessionReportsRoot>/<campaign>/articles/`, where
`chronicler` writes new articles on a session-driven run. An article lives there while it
moves toward publishable, and reaches `kbRoot` only when the DM promotes it. Staged
articles sit outside folder-index parity, `/sweep`, and every `scope: "kb"` validator rule
until promotion.

_Avoid_: "staging root" (it is a fixed subdirectory, not a configured path), and "draft
folder" (a staged article is finished prose, not a draft).
```

Then amend the lane model entry and the `/log` command entry (near line 232) to include `articles/`, and add one sentence to the folder-index parity entry noting that a staged article sits outside parity until promotion.

- [ ] **Step 3: Bump both version files to 1.16.0**

CLAUDE.md requires these to match. This is new behavior, so a minor bump.

```bash
sed -i 's/"version": "1.15.1"/"version": "1.16.0"/' .claude-plugin/marketplace.json professor-orb/.claude-plugin/plugin.json
grep -n '"version"' .claude-plugin/marketplace.json professor-orb/.claude-plugin/plugin.json
```

Expected: both read `1.16.0`.

- [ ] **Step 4: Verify documentation parity across every enumeration site**

```bash
grep -rn "only pipeline skill that writes the KB" professor-orb/ ; echo "(expect no output)"
grep -c "four sections\|work review, recap, north stars, handout list" professor-orb/skills/orb/SKILL.md professor-orb/README.md
grep -rn "staging area" professor-orb/CONTEXT.md
grep -rc "—" professor-orb/skills/orb/SKILL.md professor-orb/README.md professor-orb/CONTEXT.md
```

Expected: no output for the first; `0` for the second on both files; a line number for the third; `0` em dashes in all three.

- [ ] **Step 5: Run the full suite one final time**

```bash
for f in $(find professor-orb -name "*.test.mjs" | sort); do node "$f" || break; done
```

Expected: all eight suites pass.

- [ ] **Step 6: Commit**

```bash
git add professor-orb/skills/orb/SKILL.md professor-orb/README.md professor-orb/CONTEXT.md .claude-plugin/marketplace.json professor-orb/.claude-plugin/plugin.json
git commit -m "chore(professor-orb): 1.16.0

Documentation parity for staging across orb, README, and the CONTEXT
glossary, and the matching version bump in both plugin manifests.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] **No phantom section references survive anywhere**

```bash
grep -rn "lore resolution section\|P0 lore items\|P0 items" professor-orb/ ; echo "(expect no output)"
```

- [ ] **No component still claims chronicler never touches reports or briefs**

```bash
grep -rn "No changes to session reports or prep files\|Never edit session reports or prep files" professor-orb/ ; echo "(expect no output)"
```

- [ ] **No em dashes anywhere in the plugin**

```bash
grep -rl "—" professor-orb/ --include="*.md" --include="*.mjs" --include="*.json" ; echo "(expect no output)"
```

The plugin has zero em dashes today (verified before this plan was written), so any hit is something this work introduced.

- [ ] **Versions match**

```bash
grep -h '"version"' .claude-plugin/marketplace.json professor-orb/.claude-plugin/plugin.json
```

Expected: two identical `1.16.0` lines.

- [ ] **All eight suites green**

```bash
for f in $(find professor-orb -name "*.test.mjs" | sort); do printf '%-58s ' "$f"; node "$f" >/dev/null 2>&1 && echo PASS || echo FAIL; done
```

Expected: eight `PASS`.
