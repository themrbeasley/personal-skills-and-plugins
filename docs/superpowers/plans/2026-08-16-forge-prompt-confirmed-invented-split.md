# forge-prompt Confirmed/Invented Split Implementation Plan

> **Executed and partially superseded.** See `docs/superpowers/specs/2026-08-18-forge-prompt-style-gate-and-suggestions-design.md`. Task 2 Step 2 of this plan was executed correctly by commit `b718fef`, then undone by commit `15ef497`, which rewrote the Suggestions paragraph this plan explicitly said to leave alone, using text that appears nowhere in this plan or its spec. Do not re-apply Task 2 Step 2 or Task 3's Suggestions-scope bullet; both are replaced by the 08-18 design.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `forge-prompt` from putting invented appearance detail into the Revised Prompt, tighten its corpus reads to the drafted subject alone, and give it a gated path to record a house style in the consumer's `CLAUDE.md`.

**Architecture:** Markdown-only change to one skill plus four inventory files. The governing rule added to `forge-prompt/SKILL.md` is that the Revised Prompt carries confirmed material only (KB article, same-subject prior prompts, recorded house style, the DM's own statements), and every other visual detail routes to the Suggestions section labeled as invented. Suggestions stay approved-by-default, so the loop's engine is unchanged; what changes is that invention is visible and individually declinable at the moment it happens.

**Tech Stack:** Markdown. No executable code is touched. Node built-in test suites exist for the plugin's `.mjs` code and must pass unchanged as a regression check.

## Global Constraints

- **No em dashes anywhere in any output.** SHARED-PRINCIPLES Principle 6. Use commas, colons, parentheses, or restructure. The write-time validator hook enforces an em-dash rule, so a violation is not merely stylistic.
- **`professor-orb/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` versions must match exactly.** Root `CLAUDE.md` states this as a release requirement.
- **Every command, agent, and skill opens by reading `skills/SHARED-PRINCIPLES.md`.** `forge-prompt/SKILL.md` line 6 already carries this preamble. Do not remove or relocate it.
- **Do not touch executable code.** No `.mjs` file is modified by this plan. All eight Node suites must pass unchanged.
- **Prompt files carry no `type` frontmatter field.** Unchanged by this plan, but do not introduce one while editing surrounding text.
- **Read `professor-orb/CONTEXT.md` before writing user-facing prose.** It is the project glossary and names the wrong terms explicitly.

---

## File Structure

| File | Responsibility after this change |
|---|---|
| `professor-orb/skills/forge-prompt/SKILL.md` | The behavior change. Grounding sources and their limits, the new house-style capture path, the confirmed-only rule on the Revised Prompt, the invented-detail class and scope fence on Suggestions, the non-assertion rule on Questions, and the narrowed inference license on "Never stall". |
| `professor-orb/CONTEXT.md` | Glossary truth. The **prompt corpus** entry stops claiming double duty as a style source; the **forge-prompt skill** entry gains the confirmed/invented split and the `CLAUDE.md` capture. |
| `professor-orb/skills/orb/SKILL.md` | Component-table row: the one-line summary of what forge-prompt does and what it writes. |
| `professor-orb/README.md` | Same component-table row, public-facing copy. |
| `professor-orb/.claude-plugin/plugin.json` | Version 1.12.1. |
| `.claude-plugin/marketplace.json` | Version 1.12.1, matching. |

**Note on scope:** the spec's Files table listed four files and did not include `orb/SKILL.md` or `README.md`. Both are included here because both currently state forge-prompt's outputs as "saves to the campaign's `prompts/` directory", which this change makes incomplete, and the spec's own scope sentence covers "the collateral doc updates that keep the plugin's own inventory honest." This is a deliberate two-file addition, not a scope drift.

---

### Task 1: Grounding sources and the house-style capture path

**Files:**
- Modify: `professor-orb/skills/forge-prompt/SKILL.md:41-49` (the `## Grounding, before the first Revised Prompt` section)
- Modify: `professor-orb/skills/forge-prompt/SKILL.md` (insert a new `## Recording a house style` section immediately after the grounding section)

**Interfaces:**
- Consumes: nothing from earlier tasks. This is the first task.
- Produces: the term **confirmed material** and its four-source definition, which Task 2 references by name in the Revised Prompt rule; the section title **"Recording a house style"**, which Task 2's Suggestions text and Task 3's never-do list both cross-reference.

- [ ] **Step 1: Read the current grounding section to confirm the anchor text matches**

Read `professor-orb/skills/forge-prompt/SKILL.md` lines 41 to 50. Confirm line 41 reads `## Grounding, before the first Revised Prompt` and that the numbered list items 1, 2, 3 match the `old_string` in Step 2. If the file has drifted, stop and report rather than guessing at a replacement.

- [ ] **Step 2: Replace the three grounding sources**

Replace this exact block:

```markdown
In this order:

1. **The subject's KB article,** if the subject is an entity the knowledge base knows, for canonical appearance. Content exclusions apply; the `block-excluded` hook enforces them at PreToolUse regardless of what you intend.
2. **Prior prompts for the same subject,** in the campaign's `prompts/` directory. Reuse the descriptors already locked there. This is what keeps a recurring NPC looking like themselves across a year of sessions, and it is the whole reason the prompts are saved.
3. **The project's `CLAUDE.md`,** for campaign visual tone, medium, palette, and any house style the DM has recorded.
```

with:

```markdown
Three sources, in this order. Together with what the DM tells you, they define **confirmed material**, which is the only thing a Revised Prompt may state as settled. Everything else is invented, and invented detail belongs in Suggestions.

1. **The subject's KB article,** if the subject is an entity the knowledge base knows, for canonical appearance. Content exclusions apply; the `block-excluded` hook enforces them at PreToolUse regardless of what you intend.
2. **Prior prompts for this same subject,** in the campaign's `prompts/` directory. Reuse the descriptors already locked there. This is what keeps a recurring NPC looking like themselves across a year of sessions, and it is the whole reason the prompts are saved. A new subject has none. That is the expected result rather than a gap to fill: say so and move to the next source.

   **Read no other prompt file.** Not for house style, not for structure, not for phrasing, and not for the DM's generation preferences. A file that merely looks like a prompt is not a source, and mining the wider corpus is how one subject's choices leak into another subject's prompt.
3. **The project's `CLAUDE.md`,** for the house style the DM has recorded: visual tone, medium, palette, and any standing generation preferences. If it records none, say so plainly and do not infer one from anything else. This is the only place a house style is read from, and the one place this skill may write one (see "Recording a house style" below).

The DM's direct statements this session are confirmed material too, and they outrank all three sources (Principle 1).
```

- [ ] **Step 3: Insert the house-style capture section**

Insert immediately after the grounding section's closing paragraph (the one beginning `**A rendering choice is not canon.**`) and immediately before the line `## The loop`:

```markdown
## Recording a house style

`CLAUDE.md` is where a house style belongs, and this skill may put one there. It is the only file outside `prompts/` this skill writes, and it writes only on the DM's explicit approval.

Offer when either is true:

- The DM states a visual preference, or a standing generation preference, that `CLAUDE.md` does not already record.
- The loop is closing, `CLAUDE.md` records no house style, and the DM has made the same stylistic choice across several rounds.

Propose the exact text, as a short block covering visual tone, medium, palette, and any standing generation preferences, and show it before writing anything. Principle 2 governs: propose, then execute. Until the DM approves, nothing is recorded and nothing is treated as recorded.

Offer once per session rather than every round, and drop it if the DM passes.

`CLAUDE.md` sits at the project root, outside every prong `/log` commits, so this edit is not part of the campaign lane and `/log` will not pick it up. Say so when you write it: committing it is the DM's own step.
```

- [ ] **Step 4: Verify the new text landed and the old claims are gone**

Run:

```bash
cd professor-orb/skills/forge-prompt && grep -c 'Prior prompts for the same subject,' SKILL.md; grep -c 'Read no other prompt file' SKILL.md; grep -c '## Recording a house style' SKILL.md; grep -c 'confirmed material' SKILL.md
```

Expected, in order: `0` (old wording gone), `1`, `1`, `2`.

- [ ] **Step 5: Verify no em dashes were introduced**

Run:

```bash
grep -n '—' professor-orb/skills/forge-prompt/SKILL.md
```

Expected: no output, exit status 1. Any hit is a Principle 6 violation and must be rewritten before committing.

- [ ] **Step 6: Commit**

```bash
git add professor-orb/skills/forge-prompt/SKILL.md
git commit -m "fix(forge-prompt): scope grounding to the drafted subject, add house-style capture

Grounding now defines confirmed material explicitly and forbids reading
any prompt file but this subject's, closing the path by which an
unrelated subject's choices leaked into a draft. CLAUDE.md gains a gated
capture path so the house style source the skill already read is no
longer permanently empty.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The loop, amended

**Files:**
- Modify: `professor-orb/skills/forge-prompt/SKILL.md:55-73` (the `### Revised Prompt`, `### Suggestions`, `### Questions`, and `### Loop rules` subsections)

**Interfaces:**
- Consumes: the term **confirmed material** and the section title **"Recording a house style"**, both defined in Task 1.
- Produces: the phrase **"named as invented"** and the bare-first-round rule, which Task 3's frontmatter description and never-do list restate.

- [ ] **Step 1: Add the confirmed-only rule to the Revised Prompt**

Insert after the line `A complete, copy-paste-ready prompt. Composed per \`references/flux2-prompting.md\`, and in Edit mode also per \`references/flux2-editing.md\`, which governs preservation language and \`image [n]\` notation.` and before the line beginning `**Never write a negative prompt.**`:

```markdown
**It carries confirmed material only.** Grounding defines what that means: the subject's KB article, prior prompts for this same subject, the recorded house style, and what the DM has told you. A visual detail no such source establishes does not go here, however ordinary it looks and however thin the prompt reads without it. Build, age, pose, hair, eyes, skin, clothing, and setting are the usual offenders.

**A bare prompt is a correct first round.** When the subject noun and the house style are all you have, that is the Revised Prompt, and Suggestions carries everything else. Handing the DM a fully specified stranger and inviting them to pick it apart takes their creative license over their own subject, which is a worse failure than handing them something thin they can build on.
```

- [ ] **Step 2: Add the invented-detail class and the scope fence to Suggestions**

Append to the `### Suggestions` subsection, after the existing paragraph ending `it is a Question, not a Suggestion.`:

```markdown
**This is where invented detail lives.** Every visual detail grounding did not confirm goes here, one line per detail, said plainly as your invention rather than slipped in as fact: "Invented: a leather apron scorched at the hem, so he reads as a working smith rather than a posed one." One line each, because a DM who wants the apron and not the scorching has to be able to say so without rejecting a paragraph to get there.

**Suggestions concern the text of the prompt and nothing else.** Never propose a change to how the DM generates: not the workflow, the hardware, the sampler, the model, the aspect ratio, the output dimensions, or the file format. Those are theirs. Never re-propose something `CLAUDE.md` already records as a standing preference either; the DM settled it once and does not need to settle it again every round.
```

- [ ] **Step 3: Add the non-assertion rule to Questions**

Append to the `### Questions` subsection, after the existing paragraph ending `and what the image is actually for.`:

```markdown
**A Question asks; it does not assert.** Offering choices is fine ("clean-shaven, or bearded?"). Stating an unconfirmed detail as settled while appearing to ask about something else is not.
```

- [ ] **Step 4: Narrow the inference license in "Never stall"**

Replace this exact line:

```markdown
- **Never stall.** Produce a Revised Prompt every round. On a vague or incomplete answer, make a reasonable inference, state it explicitly in the prompt, and raise it as a Question only if getting it wrong would be expensive.
```

with:

```markdown
- **Never stall.** Produce a Revised Prompt every round. On a vague or incomplete answer about the request itself (where the image goes, what it is for, which of two readings you meant), make a reasonable inference, state it explicitly, and raise it as a Question only if getting it wrong would be expensive. **This license stops at the subject's appearance.** A visual detail no source confirms is invented, and invented detail goes to Suggestions, never into the prompt. A thin prompt satisfies this rule. An invented one does not.
```

- [ ] **Step 5: Verify the loop changes landed**

Run:

```bash
cd professor-orb/skills/forge-prompt && grep -c 'It carries confirmed material only' SKILL.md; grep -c 'A bare prompt is a correct first round' SKILL.md; grep -c 'This is where invented detail lives' SKILL.md; grep -c 'A Question asks; it does not assert' SKILL.md; grep -c 'This license stops at the subject' SKILL.md
```

Expected, in order: `1`, `1`, `1`, `1`, `1`.

Then confirm the old unrestricted inference line is gone:

```bash
grep -c 'On a vague or incomplete answer, make a reasonable inference' professor-orb/skills/forge-prompt/SKILL.md
```

Expected: `0`.

- [ ] **Step 6: Verify no em dashes were introduced**

Run:

```bash
grep -n '—' professor-orb/skills/forge-prompt/SKILL.md
```

Expected: no output, exit status 1.

- [ ] **Step 7: Commit**

```bash
git add professor-orb/skills/forge-prompt/SKILL.md
git commit -m "fix(forge-prompt): keep invented detail out of the Revised Prompt

The Revised Prompt now carries confirmed material only, and every
invented visual detail routes to Suggestions one line at a time, named
as invented. Suggestions stay approved-by-default, so the loop's engine
is unchanged; what changes is that a DM can decline one invented detail
without rejecting a paragraph. A bare first round is now stated as
correct output rather than a stalled loop.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Sync the skill's declared surface to its new behavior

**Files:**
- Modify: `professor-orb/skills/forge-prompt/SKILL.md:3` (frontmatter `description`)
- Modify: `professor-orb/skills/forge-prompt/SKILL.md:99-108` (the `## Things to never do` list)
- Modify: `professor-orb/skills/forge-prompt/SKILL.md:110-116` (the `## How this skill connects to the others` list)

**Interfaces:**
- Consumes: the grounding limits and capture path from Task 1; the confirmed-only rule and invented-detail class from Task 2.
- Produces: the declared output surface (`prompts/` plus gated `CLAUDE.md`) that Task 4 restates in `CONTEXT.md`, `orb/SKILL.md`, and `README.md`.

- [ ] **Step 1: Update the frontmatter description**

Replace this exact sentence inside the `description:` field on line 3:

```
Grounds each prompt in the subject's KB article for canonical appearance, in prior prompts for the same subject so a recurring NPC stays visually consistent, and in the project's CLAUDE.md for campaign visual tone.
```

with:

```
The prompt carries only what a source confirms: the subject's KB article for canonical appearance, prior prompts for that same subject so a recurring NPC stays visually consistent, the house style recorded in the project's CLAUDE.md, and what the DM says. Every invented detail goes to the suggestions instead, named as invented, so the DM keeps creative license over their own subject and a thin first prompt is correct output rather than a stalled loop. Offers to record a house style in CLAUDE.md when the project has none, and writes it only on approval.
```

- [ ] **Step 2: Add the four new never-do entries**

Append to the `## Things to never do` list, after the existing final entry `- **Never run image generation.** You write the prompt; the DM runs it.`:

```markdown
- **Never state an unconfirmed visual detail as settled,** in a Revised Prompt or inside a Question. It goes to Suggestions, named as invented.
- **Never read a prompt file for any subject but the one being drafted.** Not for house style, not for structure, not for phrasing.
- **Never propose a change to the DM's generation setup** in Suggestions: workflow, hardware, sampler, model, aspect ratio, dimensions, or format. Never re-propose a preference `CLAUDE.md` already records.
- **Never write `CLAUDE.md` without explicit approval,** and never treat a proposed house style as recorded before the DM takes it.
```

- [ ] **Step 3: Update the inputs, outputs, and /log handoff**

Replace these three exact lines:

```markdown
- **Inputs:** the DM's intent, the subject's KB article when one exists, prior prompts in the campaign's `prompts/` directory, and `CLAUDE.md` for visual tone.
- **Outputs:** one markdown prompt file per saved prompt, in the campaign's `prompts/` directory.
```

with:

```markdown
- **Inputs:** the DM's intent, the subject's KB article when one exists, prior prompts for that same subject in the campaign's `prompts/` directory, and `CLAUDE.md` for the recorded house style.
- **Outputs:** one markdown prompt file per saved prompt, in the campaign's `prompts/` directory, and, on approval and only when the project records none, a house style block in `CLAUDE.md`.
```

and replace this exact line:

```markdown
- **Handoff to `/log`:** `/log` commits the campaign lane, which includes `prompts/`.
```

with:

```markdown
- **Handoff to `/log`:** `/log` commits the campaign lane, which includes `prompts/`. It does not reach `CLAUDE.md` at the project root, so that edit stays the DM's to commit.
```

- [ ] **Step 4: Verify the declared surface matches the implemented behavior**

Run:

```bash
cd professor-orb/skills/forge-prompt && grep -c 'Grounds each prompt in the subject' SKILL.md; grep -c 'named as invented' SKILL.md; grep -c 'Never write `CLAUDE.md` without explicit approval' SKILL.md; grep -c 'a house style block in `CLAUDE.md`' SKILL.md
```

Expected, in order: `0` (old description sentence gone), `2` (description plus never-do), `1`, `1`.

- [ ] **Step 5: Verify the preamble and frontmatter survived the edits**

Run:

```bash
cd professor-orb/skills/forge-prompt && head -8 SKILL.md
```

Expected: line 1 is `---`, line 2 is `name: forge-prompt`, line 3 is the single-line `description:` field, line 4 is `---`, and line 6 is the SHARED-PRINCIPLES preamble line. The description must remain one line: a line break inside it breaks YAML frontmatter parsing.

- [ ] **Step 6: Verify no em dashes were introduced**

Run:

```bash
grep -n '—' professor-orb/skills/forge-prompt/SKILL.md
```

Expected: no output, exit status 1.

- [ ] **Step 7: Commit**

```bash
git add professor-orb/skills/forge-prompt/SKILL.md
git commit -m "docs(forge-prompt): declare the confirmed-only rule and the CLAUDE.md write

The description, never-do list, and connections section now state the
behavior the previous two commits implemented, including the one output
this skill writes outside prompts/ and the fact that /log does not
commit it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Correct the plugin's own inventory

**Files:**
- Modify: `professor-orb/CONTEXT.md:84-95` (the **forge-prompt skill** glossary entry)
- Modify: `professor-orb/CONTEXT.md:97-107` (the **prompt corpus** glossary entry)
- Modify: `professor-orb/skills/orb/SKILL.md:35` (component-table row)
- Modify: `professor-orb/README.md:28` (component-table row)

**Interfaces:**
- Consumes: the declared output surface from Task 3.
- Produces: nothing consumed by later tasks. Task 5 is a version bump and a regression run.

- [ ] **Step 1: Rewrite the prompt corpus glossary entry**

Replace this exact block in `professor-orb/CONTEXT.md`:

```markdown
**prompt corpus**:
The accumulated prompt files in a campaign's `prompts/` directory. Serves double
duty, the same way the homebrew catalog does: the DM's record of what was generated,
and the source `forge-prompt` reads before drafting so a recurring NPC keeps the same
locked visual descriptors across sessions. Deliberately not a registry in
```

with:

```markdown
**prompt corpus**:
The accumulated prompt files in a campaign's `prompts/` directory: the DM's record of
what was generated, and the source `forge-prompt` reads before drafting so a recurring
NPC keeps the same locked visual descriptors across sessions. Read for the drafted
subject alone, never as a style or structure reference for anything else, because a
corpus mined broadly leaks one subject's choices into another subject's prompt. House
style lives in `CLAUDE.md`, not here. Deliberately not a registry in
```

Then replace this exact line:

```markdown
_Avoid_: "visual registry", treating a locked descriptor as canon
```

with:

```markdown
_Avoid_: "visual registry", treating a locked descriptor as canon, mining it for house style
```

- [ ] **Step 2: Update the forge-prompt glossary entry**

Replace this exact block in `professor-orb/CONTEXT.md`:

```markdown
asked only when they block. Saves to `<sessionReportsRoot>/<campaign>/prompts/`,
carrying no `type` frontmatter field, because the write-time hook skips a typeless
file and blocks a type it does not recognize. The DM runs generation manually;
deeper ComfyUI integration remains a flagged future investigation.
_Avoid_: "the prompt skill" (ambiguous), calling its output canon
```

with:

```markdown
asked only when they block. The Revised Prompt carries confirmed material only, from
the KB article, prior prompts for that same subject, the recorded house style, and
the DM; invented detail goes to the suggestions instead, named as invented, so a thin
first prompt is correct output and a fully specified stranger is not. Saves to
`<sessionReportsRoot>/<campaign>/prompts/`, carrying no `type` frontmatter field,
because the write-time hook skips a typeless file and blocks a type it does not
recognize. May also offer to record a house style in the project's `CLAUDE.md`, the
only file outside `prompts/` it writes and the one `/log` does not commit. The DM runs
generation manually; deeper ComfyUI integration remains a flagged future investigation.
_Avoid_: "the prompt skill" (ambiguous), calling its output canon, calling an invented
detail confirmed
```

- [ ] **Step 3: Update the orb component-table row**

Replace this exact text in `professor-orb/skills/orb/SKILL.md` line 35:

```
Runs an iterative loop and saves the result to the campaign's `prompts/` directory
```

with:

```
Runs an iterative loop that keeps invented detail in the suggestions rather than the prompt, saves the result to the campaign's `prompts/` directory, and can record a house style in `CLAUDE.md` on approval
```

- [ ] **Step 4: Update the README component-table row**

Replace this exact text in `professor-orb/README.md` line 28:

```
Runs an iterative loop and saves to the campaign's `prompts/` directory
```

with:

```
Runs an iterative loop that keeps invented detail in the suggestions rather than the prompt, saves to the campaign's `prompts/` directory, and can record a house style in `CLAUDE.md` on approval
```

- [ ] **Step 5: Verify the inventory is consistent**

Run:

```bash
grep -c 'Serves double' professor-orb/CONTEXT.md; grep -c 'mining it for house style' professor-orb/CONTEXT.md; grep -c 'calling an invented' professor-orb/CONTEXT.md; grep -c 'record a house style in `CLAUDE.md` on approval' professor-orb/skills/orb/SKILL.md professor-orb/README.md
```

Expected, in order: `0` (double-duty framing gone), `1`, `1`, then `1` for each of the two files.

- [ ] **Step 6: Verify no em dashes and no broken tables**

Run:

```bash
grep -n '—' professor-orb/CONTEXT.md professor-orb/skills/orb/SKILL.md professor-orb/README.md
```

Expected: no output, exit status 1.

Then confirm the two edited table rows still have their full column structure (a replacement that ate a `|` silently breaks the table):

```bash
grep -n 'forge-prompt | Skill' professor-orb/skills/orb/SKILL.md professor-orb/README.md
```

Expected: one match in each file. Each line must begin with `|`, end with `|`, and contain exactly five `|` characters in total, giving four columns (name, kind, description, triggers). A replacement that swallowed a `|` silently collapses the table.

- [ ] **Step 7: Commit**

```bash
git add professor-orb/CONTEXT.md professor-orb/skills/orb/SKILL.md professor-orb/README.md
git commit -m "docs(professor-orb): correct the inventory for forge-prompt's new limits

CONTEXT.md's prompt-corpus entry no longer advertises double duty as a
style source, which was the framing that licensed the broad corpus read.
The forge-prompt entry, the orb component table, and the README table
all now state the confirmed/invented split and the gated CLAUDE.md
write.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Release 1.12.1

**Files:**
- Modify: `professor-orb/.claude-plugin/plugin.json` (the `version` field)
- Modify: `.claude-plugin/marketplace.json` (the `version` field)

**Interfaces:**
- Consumes: all four preceding tasks must be committed first. A version bump ahead of the content it ships is a lie in the manifest.
- Produces: nothing. Terminal task.

- [ ] **Step 1: Confirm both manifests currently read 1.12.0**

Run:

```bash
grep -n '"version"' professor-orb/.claude-plugin/plugin.json .claude-plugin/marketplace.json
```

Expected: both show `"version": "1.12.0",`. If either has already moved, stop and report rather than bumping twice.

- [ ] **Step 2: Bump plugin.json**

In `professor-orb/.claude-plugin/plugin.json`, replace `"version": "1.12.0",` with `"version": "1.12.1",`.

- [ ] **Step 3: Bump marketplace.json**

In `.claude-plugin/marketplace.json`, replace `"version": "1.12.0",` with `"version": "1.12.1",`.

- [ ] **Step 4: Verify the two versions match and both files are still valid JSON**

Run:

```bash
node -e "const a=require('./professor-orb/.claude-plugin/plugin.json'),b=require('./.claude-plugin/marketplace.json');const bv=b.plugins?b.plugins[0].version:b.version;console.log('plugin',a.version,'marketplace',bv,a.version===bv?'MATCH':'MISMATCH')"
```

Expected: `plugin 1.12.1 marketplace 1.12.1 MATCH`. A `MISMATCH` or a JSON parse error blocks the commit.

- [ ] **Step 5: Run the full Node suite as a regression check**

This plan touches no executable code, so every suite must pass exactly as it did before.

```bash
for f in $(find professor-orb -name "*.test.mjs" | sort); do node "$f" || break; done
```

Expected: every suite passes. Confirm the count is eight:

```bash
find professor-orb -name "*.test.mjs" | wc -l
```

Expected: `8`. If a suite fails, this plan did not cause it (no `.mjs` file was modified); confirm that by checking `git diff --stat HEAD~4 -- '*.mjs'` returns empty, then report the failure rather than fixing it here.

- [ ] **Step 6: Commit**

```bash
git add professor-orb/.claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "chore(professor-orb): 1.12.1

Bug-fix release: forge-prompt no longer puts invented appearance detail
into the Revised Prompt, reads prior prompts for the drafted subject
alone, and can record a house style in CLAUDE.md on approval. Patch bump
so the fix reaches consumers.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Manual verification, after all tasks

These cannot be automated: the deliverable is a behavior change in a skill, and the only real test is running it. Run in a consumer project.

1. **Forge mode, brand-new subject, no KB article, no prior prompt.** Confirm the round-one Revised Prompt contains no invented appearance detail, and that build, age, pose, hair, eyes, skin, clothing, and setting appear as separate labeled Suggestions instead.
2. **House style capture.** State a visual preference in a project whose `CLAUDE.md` records none. Confirm the skill proposes exact `CLAUDE.md` text, writes only on approval, and says the commit is yours. Then run `/log` and confirm the `CLAUDE.md` edit is not in the commit.
3. **Standing preference respected.** In a project whose `CLAUDE.md` records "no negative prompt or generation dimensions," confirm Suggestions never proposes changing aspect ratio, dimensions, or generation workflow.
4. **Corpus scope.** Draft for a subject that has prior prompts, in a campaign whose `prompts/` directory also holds unrelated subjects. Confirm the locked descriptors for the drafted subject ground the prompt, and that no other prompt file is read or cited.
