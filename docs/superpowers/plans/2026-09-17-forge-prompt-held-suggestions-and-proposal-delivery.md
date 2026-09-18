# forge-prompt Held Suggestions and Proposal Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the four defects and two lesser ones in the DM's 2026-09-17 report: silence holds a Suggestion instead of adopting it, the style offers move to Step 1, Edit is recognized from the message and written against one input, prompt text names only what should appear, and a proposal file reaches the DM as the file.

**Architecture:** Prose edits across eight markdown files, plus the Status lines of five specs and the two version manifests. No executable code. There is no test framework for skill prose, so each task's test cycle is a `grep` gate: run it first to see the failing state, make the edits, run it again to see the passing state, commit. Tasks 1 to 4 each change one forge-prompt behavior; Task 5 changes proposal delivery across SHARED-PRINCIPLES, chronicler, and `/migrate`; Task 6 points the earlier specs here, releases 1.17.0, and runs the full verification.

**Tech Stack:** Markdown and JSON. Verification by `grep`, `sed`, and one `node -e` JSON read. The eight Node test suites (plain `node <file>.test.mjs`, no framework) run once at the end to confirm nothing executable moved.

**Spec:** `docs/superpowers/specs/2026-09-17-forge-prompt-held-suggestions-and-proposal-delivery-design.md`. Its "What ships" section holds the approved wording, and this plan copies that wording into exact edits. Read the spec's "Design decisions and why" before any task: it says why each rule is stated the way it is, and a reworded rule can quietly undo the reason.

## Global Constraints

Copied from the spec, or from the repo's `CLAUDE.md` where noted. Every task's requirements implicitly include this section.

- **No em dashes in any file this plan touches.** SHARED-PRINCIPLES Principle 6. Every touched file has zero today and must have zero after. Use commas, colons, parentheses, or restructure the sentence.
- **`## The loop` in forge-prompt's `SKILL.md` keeps exactly four `###` headings:** `Revised Prompt`, `Suggestions`, `Questions`, `Loop rules`. The new `### Recording the style` belongs to Step 1, not the loop.
- **No specimen of a failure goes into any file.** No example of a negated phrase, no example of a printed-object word, no campaign name used as a descriptor. Each rule is stated positively, and that is the design, not an omission. Where this plan has to point at old text carrying such a specimen, it names the line by its opening words instead of quoting it.
- **No consumer specifics in plugin files.** No campaign or setting name from any consumer project appears in skill or reference text. (`professor-orb/CONTEXT.md`: no consumer's specifics are baked in.)
- **No `type` frontmatter field** is introduced anywhere in forge-prompt. The write-time validator hook skips a typeless file and blocks a type it does not recognize.
- **The SHARED-PRINCIPLES preamble** (`> **Before you begin:** read ...SHARED-PRINCIPLES.md...`) survives in every skill and command touched. (repo `CLAUDE.md`)
- **Match each file's wrapping.** `professor-orb/CONTEXT.md` is hard-wrapped near 88 columns. Every other touched markdown file keeps each paragraph on one line. The `description:` in forge-prompt's frontmatter is one long single-line YAML string: do not reflow it or add line breaks.
- **Working-tree files use CRLF** (`core.autocrlf=true`). Make every edit with the Edit tool, which matches across line endings. Do not use `sed -i`.
- **Line numbers below are from the files before this plan.** Earlier tasks shift later ones, so find each target by its quoted text, not its number.
- **Version 1.16.1 becomes 1.17.0** in both `.claude-plugin/marketplace.json` and `professor-orb/.claude-plugin/plugin.json`, and the two must match. (repo `CLAUDE.md`)
- **No executable code is touched.** All eight Node suites pass unchanged.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `professor-orb/skills/forge-prompt/SKILL.md` | The skill: modes, style resolution, grounding, the three-block loop, the write gate | Tasks 1 to 4 |
| `professor-orb/skills/forge-prompt/references/flux2-editing.md` | Edit-prompt craft | Task 3: the edit frame's written form; `## Multi-reference notation` replaced by `## Input images` |
| `professor-orb/skills/forge-prompt/references/flux2-prompting.md` | Generation-prompt craft | Task 4: core principles 1 and 3; the typography section's opening paragraph |
| `professor-orb/skills/SHARED-PRINCIPLES.md` | Rules every component reads first | Task 5: Principle 2 gains the proposal-delivery paragraph |
| `professor-orb/skills/chronicler/SKILL.md` | Lore-update proposals | Task 5: Steps 1c and 1d deliver the file |
| `professor-orb/commands/migrate.md` | Structural migration proposals | Task 5: Step 4 delivers the file |
| `professor-orb/CONTEXT.md` | The glossary | Tasks 1 and 2: the forge-prompt entry. Task 5: the proposal file entry |
| `docs/superpowers/specs/2026-08-09-forge-prompt-skill-design.md`, `2026-08-16-forge-prompt-grounding-and-invention-design.md`, `2026-08-18-forge-prompt-style-gate-and-suggestions-design.md`, `2026-08-18-forge-prompt-question-definition-design.md` | Earlier forge-prompt designs | Task 6: a pointer line each; two stale Status lines corrected |
| `docs/superpowers/specs/2026-09-17-forge-prompt-held-suggestions-and-proposal-delivery-design.md` | This work's spec | Task 6: Status becomes Implemented |
| `.claude-plugin/marketplace.json`, `professor-orb/.claude-plugin/plugin.json` | Release version | Task 6: 1.17.0 |

Tasks 1 to 4 all edit forge-prompt's `SKILL.md`. They are split because a reviewer could accept one behavior and reject its neighbor: the held Suggestion, the style offers, edit detection, and the prompt-text rules are independent decisions. Each task edits the glossary lines for its own behavior, so the glossary never describes a state that has not shipped. Task 6 runs last because its pointers and version describe the finished work.

---

## Task 1: Silence holds a Suggestion

**Files:**
- Modify: `professor-orb/skills/forge-prompt/SKILL.md:3` (frontmatter description)
- Modify: `professor-orb/skills/forge-prompt/SKILL.md:111-115` (the DM's answers)
- Modify: `professor-orb/skills/forge-prompt/SKILL.md:117` (invention paragraph, last sentence)
- Modify: `professor-orb/skills/forge-prompt/SKILL.md:121` (Questions, first paragraph)
- Modify: `professor-orb/skills/forge-prompt/SKILL.md:134` (the "looks good" loop rule)
- Modify: `professor-orb/CONTEXT.md:94-95, 105-106` (forge-prompt entry)
- Test: the grep gate in Steps 1 and 7. No test suite covers skill prose.

**Interfaces:**
- Consumes: nothing. This is the first task.
- Produces: the answer label `**Hold, not yet, or no answer:** held.` and the loop rule's phrase "held Suggestions stay held". The spec's manual checks rely on "held" meaning exactly what this task writes: out of the prompt, listed again word for word.

- [ ] **Step 1: Run the gate and confirm it fails**

```bash
cd professor-orb/skills/forge-prompt
grep -ci 'adopted by silence' SKILL.md
grep -cF 'one they leave alone is adopted' SKILL.md
grep -cF '**Silence:** adopted' SKILL.md
grep -cF 'Hold, not yet, or no answer' SKILL.md
grep -cF 'On "looks good" with obvious gaps' SKILL.md
grep -cF 'silence adopting it' ../../CONTEXT.md
grep -cF 'calling an unanswered Suggestion adopted' ../../CONTEXT.md
```

Expected before the edit, in order: `2`, `1`, `1`, `0`, `1`, `1`, `0`. If any already reads its Step 7 value, stop: the file is not in the state this plan was written against.

- [ ] **Step 2: Edit the frontmatter description**

In the `description:` string on line 3, replace this exact substring:

```
A suggestion the DM declines is dropped, one they leave alone is adopted, and a counter-offer replaces it in the DM's own words.
```

with:

```
A suggestion enters the prompt only when the DM takes it: a yes adopts it, a decline drops it, a counter-offer replaces it in the DM's own words, and one left unanswered stays listed, outside the prompt, until the DM rules on it.
```

Leave the rest of the string untouched and on its one line.

- [ ] **Step 3: Replace the DM's answers in `### Suggestions`**

Replace this block:

```markdown
**The DM's answer decides each one:**

- **No, or anything reading as a pass:** dropped, and not re-proposed.
- **Silence:** adopted. It goes into the next Revised Prompt, and from that round on it is confirmed material.
- **A counter or an adjustment:** theirs replaces yours, worded as they worded it. Yours is gone.
```

with:

```markdown
**The DM's answer decides each one, and only a yes or a counter puts one in the prompt:**

- **Yes:** adopted. It goes into the next Revised Prompt, and from that round on it is confirmed material.
- **No, or anything reading as a pass:** dropped, and not re-proposed.
- **A counter or an adjustment:** theirs replaces yours, worded as they worded it. Yours is gone.
- **Hold, not yet, or no answer:** held. It stays out of the prompt and is listed again next round, word for word, until the DM rules on it. Held Suggestions count toward the four, and new ones take the room that is left.
```

"The four" refers to the `Two to four per round` line directly above this block. Leave that line as it is.

- [ ] **Step 4: Edit the invention paragraph's last sentence**

In the paragraph beginning `**Invention is a Suggestion, never a fact.**`, replace:

```
Adopted by silence like anything else, and settled once adopted.
```

with:

```
Like any Suggestion, it enters the prompt on a yes, and is settled once it does.
```

- [ ] **Step 5: Edit the Questions definition and the "looks good" rule**

In the paragraph beginning `**A Question resolves an ambiguity, never an absence.**`, replace:

```
and missing detail is a Suggestion adopted by silence.
```

with:

```
and missing detail is a Suggestion.
```

In `### Loop rules`, replace the whole bullet:

```markdown
- **On "looks good" with obvious gaps,** do not declare victory. Apply the outstanding Suggestions, ask the single most important remaining Question, and tighten.
```

with:

```markdown
- **On "looks good,"** the prompt stands exactly as shown, and held Suggestions stay held, out of it. Ask a Question only if one still blocks; otherwise the prompt is stable, so hand it over per the next section.
```

- [ ] **Step 6: Edit the glossary's forge-prompt entry**

In `professor-orb/CONTEXT.md`, replace these two lines:

```
decides it, with a decline dropping it, silence adopting it, and a counter replacing it
in the DM's own words. A Question resolves an ambiguity in what the DM already said,
```

with these three:

```
decides it: a yes adopts it, a decline drops it, a counter replaces it in the DM's own
words, and silence holds it outside the prompt until they rule. A Question resolves an
ambiguity in what the DM already said,
```

Then replace the entry's `_Avoid_` lines:

```
_Avoid_: "the prompt skill" (ambiguous), calling its output canon, calling an invented
detail confirmed
```

with:

```
_Avoid_: "the prompt skill" (ambiguous), calling its output canon, calling an invented
detail confirmed, calling an unanswered Suggestion adopted
```

- [ ] **Step 7: Run the gate and confirm it passes**

```bash
cd professor-orb/skills/forge-prompt
grep -ci 'adopted by silence' SKILL.md
grep -cF 'one they leave alone is adopted' SKILL.md
grep -cF '**Silence:** adopted' SKILL.md
grep -cF 'Hold, not yet, or no answer' SKILL.md
grep -cF 'On "looks good" with obvious gaps' SKILL.md
grep -cF 'silence adopting it' ../../CONTEXT.md
grep -cF 'calling an unanswered Suggestion adopted' ../../CONTEXT.md
sed -n '/^## The loop/,/^## The test runs/p' SKILL.md | grep '^### '
grep -c '—' SKILL.md ../../CONTEXT.md
```

Expected, in order: `0`, `0`, `0`, `1`, `0`, `0`, `1`; then exactly four headings, `### Revised Prompt`, `### Suggestions`, `### Questions`, `### Loop rules`; then `0` em dashes for each file.

- [ ] **Step 8: Commit**

```bash
git add -- professor-orb/skills/forge-prompt/SKILL.md professor-orb/CONTEXT.md
git commit -F - <<'EOF'
fix(forge-prompt): hold an unanswered Suggestion instead of adopting it

Only a yes or a counter puts a Suggestion in the prompt. One left
unanswered is listed again, word for word, until the DM rules on it,
and "looks good" keeps the prompt exactly as shown.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 2: Offer the style records when the style resolves

**Files:**
- Modify: `professor-orb/skills/forge-prompt/SKILL.md:53` ("four outcomes")
- Modify: `professor-orb/skills/forge-prompt/SKILL.md:57-60` (the Step 1 table)
- Modify: `professor-orb/skills/forge-prompt/SKILL.md:70` (Building a style, second paragraph)
- Create: a `### Recording the style` subsection in `professor-orb/skills/forge-prompt/SKILL.md`, between `### Building a style` and `### Style file shape`
- Modify: `professor-orb/skills/forge-prompt/SKILL.md:150-164` (Finishing)
- Modify: `professor-orb/skills/forge-prompt/SKILL.md:184` (Inputs)
- Modify: `professor-orb/CONTEXT.md:89-90` (forge-prompt entry)
- Test: the grep gate in Steps 1 and 9.

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: the heading `### Recording the style`, which three places name by that exact title: the paragraph after the Step 1 table, Building a style's second paragraph, and Finishing. Task 4 edits Building a style's first paragraph and leaves the second paragraph, written here, intact.

- [ ] **Step 1: Run the gate and confirm it fails**

```bash
cd professor-orb/skills/forge-prompt
grep -cF 'four outcomes' SKILL.md
grep -c '^### Recording the style' SKILL.md
grep -c '^| Names' SKILL.md
grep -cF 'Names a style from another campaign' SKILL.md
grep -cF 'Names a style no catalog has' SKILL.md
grep -cF 'Whichever row resolves the style' SKILL.md
grep -cF 'Three offers' SKILL.md
grep -cF 'Offering to save it comes at the close' SKILL.md
grep -cF "another campaign's when the DM names a style from it" SKILL.md
grep -cF "any campaign's catalog" ../../CONTEXT.md
```

Expected before, in order: `1`, `0`, `4`, `0`, `0`, `0`, `1`, `1`, `0`, `0`.

- [ ] **Step 2: Make Step 1 resolve five outcomes**

Replace `Resolve exactly one of four outcomes` with `Resolve exactly one of five outcomes`. The rest of that line stays.

- [ ] **Step 3: Add the table row and correct the last row**

Replace the table's first data row:

```markdown
| Names a style the catalog has | Read that file. It is the resolved style. |
```

with itself followed by the new row:

```markdown
| Names a style the catalog has | Read that file. It is the resolved style. |
| Names a style from another campaign, by the style's name or as that campaign's house style | Read that file from that campaign's catalog; for a house style, `CLAUDE.md` names which one. It is the resolved style. |
```

Then replace the table's last row:

```markdown
| Names a style the catalog does not have, or nothing is recorded either way | Build one with the DM now, per "Building a style" below. |
```

with:

```markdown
| Names a style no catalog has, or names none and nothing is recorded either way | Build one with the DM now, per "Building a style" below. |
```

- [ ] **Step 4: Add the paragraph after the table**

Insert this paragraph between the table's last row and the paragraph beginning `**A recorded opt-out and a missing record are different states`, with one blank line on each side:

```markdown
Another campaign's catalog sits at the same path under that campaign's folder, in whichever setting's `sessionReportsRoot` holds it (Principle 12). Whichever row resolves the style, the offers in "Recording the style" below come next, before the first Revised Prompt.
```

Its second sentence is what makes the offers fire on every row. Do not drop it: the 08-18 spec records a section that nothing in the executed sequence called, which shipped inert.

- [ ] **Step 5: Point Building a style at the offers**

Replace the second paragraph of `### Building a style`:

```markdown
Once it is settled, the loop starts. Offering to save it comes at the close, not now, per "Finishing" below. A style used once and never saved is a legitimate outcome.
```

with:

```markdown
Once it is settled, make the offers in "Recording the style" below, then start the loop.
```

- [ ] **Step 6: Add `### Recording the style`**

Insert this subsection after the paragraph from Step 5 and before `### Style file shape`, with one blank line before and after:

```markdown
### Recording the style

Two offers, made once each, in the turn the style resolves and ahead of the first Revised Prompt. An answer left for the close is lost whenever a session ends without one.

1. **Save it to this campaign's catalog,** when it is not there already: a style built here, or one read from another campaign's catalog. On approval, write it per "Style file shape" below, creating `prompts/styles/` if it does not exist. A style from another campaign is copied as it is.
2. **Record it as the house style,** when `CLAUDE.md` records neither a house style nor an opt-out for this campaign. Propose the exact line, show it, and write only on explicit approval. A yes saves the style to this campaign's catalog too, if it is not there yet, because the line must point at a file this catalog holds. If the DM passes, offer to record the opt-out instead, so the question is settled rather than asked again next session.

**An answer that already asks for this is the approval.** When the DM's own words request it ("copy that campaign's house style over to this one"), copy the file and write the line in that turn, and show the line you wrote.

`CLAUDE.md` sits at the project root, outside every prong `/log` commits. Say so when you write it: committing it is the DM's own step.

A style used once and never saved is a legitimate outcome, and so is a DM who takes neither offer.
```

- [ ] **Step 7: Reduce Finishing to one offer**

In `## Finishing: the write gate`, replace this block, from `Three offers` through the end of item 3:

````markdown
Three offers, made once each, at the close:

1. **Save the prompt.** On approval, write to:

   ```
   <sessionReportsRoot>/<campaign>/prompts/PROMPT-YYYY-MM-DD-<Subject>.md
   ```

   Create the `prompts/` directory if it does not exist. Frontmatter carries `subject`, `mode`, and `date`, and **no `type` field**. The body holds the final prompt, and for Edit mode a one-line note of what the source image was.

2. **Save the style,** when Step 1 built a new one. On approval, write it to the catalog per "Style file shape" above, creating `prompts/styles/` if it does not exist.

3. **Record the house style,** when `CLAUDE.md` records neither a house style nor an opt-out for this campaign. Propose the exact line, show it, and write only on explicit approval. If the DM passes, offer to record the opt-out instead, so the question is settled rather than asked again next session. This is one offer per session, not one per round.
````

with:

````markdown
One offer at the close: **save the prompt.** On approval, write to:

```
<sessionReportsRoot>/<campaign>/prompts/PROMPT-YYYY-MM-DD-<Subject>.md
```

Create the `prompts/` directory if it does not exist. Frontmatter carries `subject`, `mode`, and `date`, and **no `type` field**. The body holds the final prompt, and for Edit mode a one-line note of what the source image was.

The style offers come earlier, in the turn the style resolves, per "Recording the style" in Step 1.
````

The path block moves from inside a numbered item, indented three spaces, to top level with no indent.

Then replace the section's closing paragraph:

```markdown
`/log` commits the campaign lane recursively, which covers both `prompts/` and `prompts/styles/`. `CLAUDE.md` sits at the project root, outside every prong `/log` commits, so that edit is not part of the campaign lane and `/log` will not pick it up. Say so when you write it: committing it is the DM's own step.
```

with:

```markdown
`/log` commits the campaign lane recursively, which covers both `prompts/` and `prompts/styles/`.
```

- [ ] **Step 8: Update Inputs and the glossary**

In `## How this skill connects to the others`, on the `**Inputs:**` line, replace `the campaign's style catalog,` with `the campaign's style catalog, and another campaign's when the DM names a style from it,`.

In `professor-orb/CONTEXT.md`, replace these two lines:

```
style before drafting anything, from the style the DM names, the house style
`CLAUDE.md` points at, a recorded opt-out, or one built with the DM on the spot. Then
```

with these three:

```
style before drafting anything, from a style the DM names from any campaign's catalog,
the house style `CLAUDE.md` points at, a recorded opt-out, or one built with the DM on
the spot. Then
```

- [ ] **Step 9: Run the gate and confirm it passes**

```bash
cd professor-orb/skills/forge-prompt
grep -cF 'four outcomes' SKILL.md
grep -c '^### Recording the style' SKILL.md
grep -c '^| Names' SKILL.md
grep -cF 'Names a style from another campaign' SKILL.md
grep -cF 'Names a style no catalog has' SKILL.md
grep -cF 'Whichever row resolves the style' SKILL.md
grep -cF 'Three offers' SKILL.md
grep -cF 'Offering to save it comes at the close' SKILL.md
grep -cF "another campaign's when the DM names a style from it" SKILL.md
grep -cF "any campaign's catalog" ../../CONTEXT.md
grep -n '^##' SKILL.md
sed -n '/^## The loop/,/^## The test runs/p' SKILL.md | grep '^### '
grep -c '—' SKILL.md ../../CONTEXT.md
```

Expected, in order: `0`, `1`, `5`, `1`, `1`, `1`, `0`, `0`, `1`, `1`. The heading list shows `### Building a style`, `### Recording the style`, `### Style file shape` consecutively under `## Step 1: resolve the style`. The loop still shows exactly the four headings. `0` em dashes for each file.

- [ ] **Step 10: Commit**

```bash
git add -- professor-orb/skills/forge-prompt/SKILL.md professor-orb/CONTEXT.md
git commit -F - <<'EOF'
fix(forge-prompt): offer the style records when the style resolves

Saving the style and recording the house style are offered in the turn
the style resolves, from every Step 1 row, not at a close the session
may never reach. A style named from another campaign is read from that
campaign's catalog, and an answer that already asks for the copy and
the line is the approval.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 3: Recognize an edit, and write it against one input

**Files:**
- Modify: `professor-orb/skills/forge-prompt/SKILL.md:28` (Step 0)
- Modify: `professor-orb/skills/forge-prompt/SKILL.md:97` (Revised Prompt, the editing-reference clause)
- Modify: `professor-orb/skills/forge-prompt/references/flux2-editing.md:9-11` (the edit frame)
- Modify: `professor-orb/skills/forge-prompt/references/flux2-editing.md:22-24` (`## Multi-reference notation`, replaced)
- Test: the grep gate in Steps 1 and 6.

**Interfaces:**
- Consumes: nothing from Tasks 1 and 2.
- Produces: the section title `## Input images` and the term "the edit frame", which SKILL.md's editing-reference clause names after Step 3.

- [ ] **Step 1: Run the gate and confirm it fails**

```bash
cd professor-orb/skills/forge-prompt
grep -cF 'default to Forge' SKILL.md
grep -cF 'An edit of that image, or a fresh render?' SKILL.md
grep -cF 'image [n]' SKILL.md
grep -cF 'how input images are numbered' SKILL.md
grep -c '^## Multi-reference notation' references/flux2-editing.md
grep -c '^## Input images' references/flux2-editing.md
grep -cF 'Preserve exactly:' references/flux2-editing.md
```

Expected before, in order: `1`, `0`, `1`, `0`, `1`, `0`, `0`.

- [ ] **Step 2: Replace Step 0's default**

In the paragraph under `## Step 0: determine the mode`, replace:

```
If the DM's opening message is ambiguous, default to Forge and treat what they said as the subject.
```

with:

```
When the subject has an image the DM has approved (one they have shared, pointed to, or reported rendering), a message describing what changes or what stays ("still has green hair," "the background becomes an alley") is Edit. When the opening message could still be asking for either an edit or a fresh render, ask one question first: "An edit of that image, or a fresh render?" An edit prompt and a generation prompt share almost no text.
```

The paragraph's first sentence, `Before anything else, work out which of three modes you are in.`, stays.

- [ ] **Step 3: Name what the editing reference governs**

In the first paragraph under `### Revised Prompt`, replace:

```
which governs preservation language and `image [n]` notation.
```

with:

```
which governs the edit frame, preservation language, and how input images are numbered.
```

- [ ] **Step 4: Give the edit frame its written form**

In `references/flux2-editing.md`, insert this after the paragraph under `## The edit frame` (the paragraph ending `alters things you did not ask it to.`), with one blank line on each side:

````markdown
Written out, the frame opens on the image and the change, then names what survives:

```
Edit image [1]: <the change>. Preserve exactly: <everything the edit could disturb, by visible property>.
```

Context goes in whichever clause it belongs to: a new setting is part of the change, an unchanged pose is part of what is preserved. The subject is whoever is in image [1], so the prompt refers to it through the image and by what it looks like.
````

- [ ] **Step 5: Replace the multi-reference section**

Replace the heading `## Multi-reference notation` and the single paragraph under it (the paragraph beginning `Refer to input images as`) with:

```markdown
## Input images

An edit prompt is written against the inputs the DM's edit workflow takes. One is the default: the image being edited is `image [1]`, and anything else the edit needs (a garment, a setting, a region to change) is described in words. When the DM says an edit takes more inputs, number them `image [2]` onward and state the role each one plays: which supplies the garment, which the subject, which the setting.
```

The old paragraph goes whole, including its account of the source guide's many-input compositions. Carry none of it forward.

- [ ] **Step 6: Run the gate and confirm it passes**

```bash
cd professor-orb/skills/forge-prompt
grep -cF 'default to Forge' SKILL.md
grep -cF 'An edit of that image, or a fresh render?' SKILL.md
grep -cF 'image [n]' SKILL.md
grep -cF 'how input images are numbered' SKILL.md
grep -c '^## Multi-reference notation' references/flux2-editing.md
grep -c '^## Input images' references/flux2-editing.md
grep -cF 'Preserve exactly:' references/flux2-editing.md
grep -c '—' SKILL.md references/flux2-editing.md
```

Expected, in order: `0`, `1`, `0`, `1`, `0`, `1`, `1`; then `0` em dashes for each file.

- [ ] **Step 7: Commit**

```bash
git add -- professor-orb/skills/forge-prompt/SKILL.md professor-orb/skills/forge-prompt/references/flux2-editing.md
git commit -F - <<'EOF'
fix(forge-prompt): recognize an edit request and write it against one input

A change described against an approved image is Edit, and a message
that could be either gets one question instead of a default to Forge.
An edit prompt takes the frame's written form against image [1] alone
unless the DM says the edit takes more.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 4: Every phrase names something that should appear

**Files:**
- Modify: `professor-orb/skills/forge-prompt/SKILL.md:68` (Building a style, first paragraph)
- Modify: `professor-orb/skills/forge-prompt/SKILL.md:103` (Revised Prompt: the negative-prompt paragraph becomes two paragraphs)
- Modify: `professor-orb/skills/forge-prompt/SKILL.md:168` (Things to never do)
- Modify: `professor-orb/skills/forge-prompt/references/flux2-prompting.md:11, 13` (core principles 1 and 3)
- Modify: `professor-orb/skills/forge-prompt/references/flux2-prompting.md:31-33` (typography)
- Test: the grep gate in Steps 1 and 7.

**Interfaces:**
- Consumes: Task 2's second paragraph of `### Building a style` (`Once it is settled, make the offers...`), which this task leaves as it is.
- Produces: the sentence `Every phrase names something that should appear.`, worded identically in SKILL.md and the reference. The spec's verification greps for it in both files.

- [ ] **Step 1: Run the gate and confirm it fails**

```bash
cd professor-orb/skills/forge-prompt
grep -cF 'Every phrase names something that should appear' SKILL.md references/flux2-prompting.md
grep -cF 'The subject appears as what it looks like' SKILL.md
grep -cF 'Never write a negative prompt' SKILL.md
grep -cF 'Never name a thing to keep it out of the image' SKILL.md
grep -cF 'because its words open every prompt' SKILL.md
grep -cF 'positive specification' references/flux2-prompting.md
grep -cF 'Describe the subject by what it looks like' references/flux2-prompting.md
grep -cF 'naming a printed object asks for it' references/flux2-prompting.md
```

Expected before: `SKILL.md:0` and `references/flux2-prompting.md:0`, then in order `0`, `2`, `0`, `0`, `1`, `0`, `0`.

- [ ] **Step 2: Hold a style to the prompt rules**

In the first paragraph of `### Building a style`, replace:

```
Propose the style as a short block, show it, and take their corrections.
```

with:

```
Propose the style as a short block, written per `references/flux2-prompting.md` because its words open every prompt that uses it, show it, and take their corrections.
```

- [ ] **Step 3: Rewrite the Revised Prompt's closing rule as two**

Replace this paragraph, the last one in `### Revised Prompt`:

```markdown
**Never write a negative prompt.** FLUX.2 does not support them. Anything you would have excluded gets stated positively instead.
```

with these two paragraphs, separated by one blank line:

```markdown
**The subject appears as what it looks like.** The model has never seen the campaign, so a name, an alias, or a named form draws nothing, or draws whatever else the word means. The prompt carries what the confirmed sources say the subject looks like, and the name stays in the conversation.

**Every phrase names something that should appear.** FLUX.2 has no negative prompt, and it draws what the words name, including a thing named in order to rule it out. Keep something out of the image by naming what takes its place, and leave the excluded thing's name out of the prompt.
```

They follow the paragraph beginning `**A bare prompt is a correct first round.**`, which is unchanged.

- [ ] **Step 4: Rewrite the never-do entry**

In `## Things to never do`, replace:

```markdown
- **Never write a negative prompt.** The model ignores them.
```

with:

```markdown
- **Never name a thing to keep it out of the image,** in a negative prompt or in the prompt text. The model draws what the words name.
```

- [ ] **Step 5: Rewrite core principles 1 and 3 in the prompting reference**

In `references/flux2-prompting.md`, under `## Core principles`, replace item 1, the line beginning `1. FLUX.2 does not support negative prompts.`, with:

```markdown
1. **Every phrase names something that should appear.** FLUX.2 has no negative prompt, and it draws what the words name, including a thing named in order to rule it out. Keep something out by naming what takes its place, such as "sharp focus," and leave the excluded thing's name out of the prompt.
```

The old item 1 goes whole, including its illustration. Carry none of it forward.

Leave item 2 (`2. Word order carries weight.`) unchanged. Replace item 3:

```markdown
3. Describe positively throughout.
```

with:

```markdown
3. **Describe the subject by what it looks like.** The model has never seen the campaign, so a character's name, an alias, or a named form draws nothing, or draws whatever else the word means. Build, face, hair, clothing, and pose carry the subject.
```

- [ ] **Step 6: Open the typography section with the technique rule**

Under `## Typography and text rendering`, insert this paragraph between the heading and the first bullet (`- Put the literal text in quotation marks`), with one blank line on each side:

```markdown
Text appears where the prompt asks for it, and naming a printed object asks for it: the object's lettering comes with the name, and the model writes titles nobody chose. Name a look by its technique and medium instead: inked linework, cel-shaded color, halftone dots.
```

- [ ] **Step 7: Run the gate and confirm it passes**

```bash
cd professor-orb/skills/forge-prompt
grep -cF 'Every phrase names something that should appear' SKILL.md references/flux2-prompting.md
grep -cF 'The subject appears as what it looks like' SKILL.md
grep -cF 'Never write a negative prompt' SKILL.md
grep -cF 'Never name a thing to keep it out of the image' SKILL.md
grep -cF 'because its words open every prompt' SKILL.md
grep -cF 'positive specification' references/flux2-prompting.md
grep -cF 'Describe the subject by what it looks like' references/flux2-prompting.md
grep -cF 'naming a printed object asks for it' references/flux2-prompting.md
sed -n '/^## The loop/,/^## The test runs/p' SKILL.md | grep '^### '
grep -c '—' SKILL.md references/flux2-prompting.md
```

Expected: `SKILL.md:1` and `references/flux2-prompting.md:1`, then in order `1`, `0`, `1`, `1`, `0`, `1`, `1`; then the same four loop headings; then `0` em dashes for each file.

- [ ] **Step 8: Commit**

```bash
git add -- professor-orb/skills/forge-prompt/SKILL.md professor-orb/skills/forge-prompt/references/flux2-prompting.md
git commit -F - <<'EOF'
fix(forge-prompt): name only what should appear, and describe the subject

Every phrase in a prompt names something that should appear, in the
text as well as in the negative-prompt field FLUX.2 lacks. The subject
is described by what it looks like, a look by its technique, and a
style is written to the same rules as the prompts it opens.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 5: Deliver a proposal as the file

**Files:**
- Modify: `professor-orb/skills/SHARED-PRINCIPLES.md:21` (Principle 2; a paragraph is inserted after this line)
- Modify: `professor-orb/skills/chronicler/SKILL.md:154, 156, 162` (Steps 1c and 1d)
- Modify: `professor-orb/commands/migrate.md:59` (Step 4)
- Modify: `professor-orb/CONTEXT.md:359-360` (proposal file entry)
- Test: the grep gate in Steps 1 and 6.

**Interfaces:**
- Consumes: nothing from Tasks 1 to 4.
- Produces: the Principle 2 paragraph titled `**A proposal written to a file reaches the DM as that file.**`. chronicler and `/migrate` cite it as "SHARED-PRINCIPLES Principle 2", and chronicler's Step 1d, which already sits near that citation, as "Principle 2".

- [ ] **Step 1: Run the gate and confirm it fails**

```bash
grep -cF 'file-delivery tool' professor-orb/skills/SHARED-PRINCIPLES.md
grep -cF 'pointer to the' professor-orb/skills/chronicler/SKILL.md professor-orb/commands/migrate.md
grep -cF 'open the proposal file and revise it by hand' professor-orb/skills/chronicler/SKILL.md
grep -cF 'deliver the revised file' professor-orb/skills/chronicler/SKILL.md
grep -cF 'the file itself with its absolute path' professor-orb/CONTEXT.md
grep -cF 'chat gets a summary and a' professor-orb/CONTEXT.md
```

Expected before: `0`; then `1` for each of the two files; then `1`, `0`, `0`, `1`.

- [ ] **Step 2: Add the delivery paragraph to Principle 2**

In `professor-orb/skills/SHARED-PRINCIPLES.md`, insert this paragraph after the line `The DM reviews the product before it becomes a file. This is a hard gate, not a suggestion.` and before the paragraph beginning `**One exception, and it does not generalize.**`, with one blank line on each side:

```markdown
**A proposal written to a file reaches the DM as that file.** This binds every component that writes one for approval, pipeline or not: `chronicler`'s lore-update proposal, `/migrate`'s plan, and `setup`'s migration manifest on the path where setup presents it as a proposal. Each time you write or revise the file, deliver it in that turn with the host's file-delivery tool (SendUserFile in the Claude desktop app), and give its absolute path, which is where the DM edits it by hand. Ask for approval in the turn that delivers it. With no file-delivery tool, the absolute path is the pointer. `.professor-orb/proposals/` is git-ignored, so in a worktree session a proposal exists only inside that worktree, and a path relative to the project root sends the DM to a checkout that does not have it.
```

- [ ] **Step 3: Deliver the file from chronicler**

In `professor-orb/skills/chronicler/SKILL.md`, in Step 1c's paragraph beginning `**Chat gets a summary, not the dump.**`, replace:

```
(the totals from the header, and any items flagged for their attention) and a pointer to the proposal file's path.
```

with:

```
(the totals from the header, and any items flagged for their attention), and deliver the file itself per SHARED-PRINCIPLES Principle 2.
```

In the next paragraph, beginning `**The DM may edit the file directly.**`, replace:

```
Tell the DM they can open the proposal file and revise it by hand
```

with:

```
Tell the DM they can revise the file by hand at the absolute path you gave
```

In Step 1d, replace:

```
then re-summarize only the changed sections in chat.
```

with:

```
then re-summarize only the changed sections in chat and deliver the revised file (Principle 2).
```

- [ ] **Step 4: Deliver the file from `/migrate`**

In `professor-orb/commands/migrate.md`, Step 4, replace:

```
Give the DM a summary and a pointer to the file in chat; do not paste the whole plan into the conversation.
```

with:

```
Give the DM a summary in chat and deliver the file itself per SHARED-PRINCIPLES Principle 2; do not paste the whole plan into the conversation.
```

- [ ] **Step 5: Update the glossary's proposal file entry**

In `professor-orb/CONTEXT.md`, replace these two lines:

```
`.professor-orb/` rather than pushed into chat (chat gets a summary and a
pointer). The DM reviews the file, may edit it directly, and approves; chronicler
```

with these three:

```
`.professor-orb/` rather than pushed into chat (chat gets a summary, and the DM gets
the file itself with its absolute path). The DM reviews the file, may edit it
directly, and approves; chronicler
```

- [ ] **Step 6: Run the gate and confirm it passes**

```bash
grep -cF 'file-delivery tool' professor-orb/skills/SHARED-PRINCIPLES.md
grep -cF 'pointer to the' professor-orb/skills/chronicler/SKILL.md professor-orb/commands/migrate.md
grep -cF 'open the proposal file and revise it by hand' professor-orb/skills/chronicler/SKILL.md
grep -cF 'deliver the revised file' professor-orb/skills/chronicler/SKILL.md
grep -cF 'the file itself with its absolute path' professor-orb/CONTEXT.md
grep -cF 'chat gets a summary and a' professor-orb/CONTEXT.md
grep -c '—' professor-orb/skills/SHARED-PRINCIPLES.md professor-orb/skills/chronicler/SKILL.md professor-orb/commands/migrate.md professor-orb/CONTEXT.md
```

Expected: `1` (the phrase appears twice, on one line); then `0` for each of the two files; then `0`, `1`, `1`, `0`; then `0` em dashes for each file.

- [ ] **Step 7: Commit**

```bash
git add -- professor-orb/skills/SHARED-PRINCIPLES.md professor-orb/skills/chronicler/SKILL.md professor-orb/commands/migrate.md professor-orb/CONTEXT.md
git commit -F - <<'EOF'
fix(professor-orb): deliver a proposal to the DM as the file itself

Principle 2 now requires a proposal written to a file to reach the DM
as that file, sent with the host's file-delivery tool along with its
absolute path on every write and revision, with approval asked in the
same turn. chronicler and /migrate point at it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 6: Point the earlier specs here, release 1.17.0, and verify

**Files:**
- Modify: `docs/superpowers/specs/2026-08-09-forge-prompt-skill-design.md:4`
- Modify: `docs/superpowers/specs/2026-08-16-forge-prompt-grounding-and-invention-design.md:4`
- Modify: `docs/superpowers/specs/2026-08-18-forge-prompt-style-gate-and-suggestions-design.md:4`
- Modify: `docs/superpowers/specs/2026-08-18-forge-prompt-question-definition-design.md:4`
- Modify: `docs/superpowers/specs/2026-09-17-forge-prompt-held-suggestions-and-proposal-delivery-design.md:4`
- Modify: `.claude-plugin/marketplace.json:11`, `professor-orb/.claude-plugin/plugin.json:4`
- Test: the grep gate in Steps 1 and 5, the spec's full verification in Step 6, and the eight Node suites in Step 7.

**Interfaces:**
- Consumes: the finished state of Tasks 1 to 5.
- Produces: nothing downstream.

- [ ] **Step 1: Run the gate and confirm it fails**

```bash
cd docs/superpowers/specs
grep -c '^\*\*Superseded in part by:\*\*' 2026-08-09-forge-prompt-skill-design.md 2026-08-16-forge-prompt-grounding-and-invention-design.md 2026-08-18-forge-prompt-style-gate-and-suggestions-design.md 2026-08-18-forge-prompt-question-definition-design.md
grep -cF 'Draft for DM review' 2026-08-09-forge-prompt-skill-design.md
grep -cF 'Approved, not yet implemented' 2026-08-18-forge-prompt-question-definition-design.md 2026-09-17-forge-prompt-held-suggestions-and-proposal-delivery-design.md
cd ../../..
node -e "const r=f=>JSON.parse(require('fs').readFileSync(f,'utf8')); console.log(r('professor-orb/.claude-plugin/plugin.json').version, r('.claude-plugin/marketplace.json').plugins.find(p=>p.name==='professor-orb').version)"
```

Expected before: `0` for each of the four specs; `1`; `1` for each of the two; `1.16.1 1.16.1`.

- [ ] **Step 2: Add the pointer lines and correct the Status lines**

In each spec below, insert the given line directly after its `**Status:**` line, and make the Status change where one is given.

`2026-08-09-forge-prompt-skill-design.md`: change `**Status:** Draft for DM review` to ``**Status:** Implemented (`89a6516`)``, then insert:

```markdown
**Superseded in part by:** `2026-09-17-forge-prompt-held-suggestions-and-proposal-delivery-design.md`, for approved-by-default Suggestions, Step 0's default to Forge, and multi-reference composition in the editing reference.
```

`2026-08-16-forge-prompt-grounding-and-invention-design.md`: keep its Status line, then insert:

```markdown
**Superseded in part by:** `2026-09-17-forge-prompt-held-suggestions-and-proposal-delivery-design.md`, for Suggestions approved by default.
```

`2026-08-18-forge-prompt-style-gate-and-suggestions-design.md`: keep its Status line, then insert:

```markdown
**Superseded in part by:** `2026-09-17-forge-prompt-held-suggestions-and-proposal-delivery-design.md`, for silence as one of the DM's answers, and the style offers at the close.
```

`2026-08-18-forge-prompt-question-definition-design.md`: change `**Status:** Approved, not yet implemented` to ``**Status:** Implemented (`7d62069`)``, then insert:

```markdown
**Superseded in part by:** `2026-09-17-forge-prompt-held-suggestions-and-proposal-delivery-design.md`, for what silence does to a Suggestion: it now holds one rather than adopting it.
```

`2026-09-17-forge-prompt-held-suggestions-and-proposal-delivery-design.md`: change `**Status:** Approved, not yet implemented` to `**Status:** Implemented in 1.17.0`. No pointer line.

- [ ] **Step 3: Bump the version**

In `.claude-plugin/marketplace.json` and in `professor-orb/.claude-plugin/plugin.json`, change `"version": "1.16.1",` to `"version": "1.17.0",`. Nothing else in either file changes.

- [ ] **Step 4: Confirm both manifests parse and match**

```bash
node -e "const r=f=>JSON.parse(require('fs').readFileSync(f,'utf8')); console.log(r('professor-orb/.claude-plugin/plugin.json').version, r('.claude-plugin/marketplace.json').plugins.find(p=>p.name==='professor-orb').version)"
```

Expected: `1.17.0 1.17.0`. A parse error means a comma or quote was damaged in Step 3.

- [ ] **Step 5: Run the gate and confirm it passes**

```bash
cd docs/superpowers/specs
grep -c '^\*\*Superseded in part by:\*\*' 2026-08-09-forge-prompt-skill-design.md 2026-08-16-forge-prompt-grounding-and-invention-design.md 2026-08-18-forge-prompt-style-gate-and-suggestions-design.md 2026-08-18-forge-prompt-question-definition-design.md
grep -cF 'Draft for DM review' 2026-08-09-forge-prompt-skill-design.md
grep -cF 'Approved, not yet implemented' 2026-08-18-forge-prompt-question-definition-design.md 2026-09-17-forge-prompt-held-suggestions-and-proposal-delivery-design.md
grep -c '—' 2026-08-09-forge-prompt-skill-design.md 2026-08-16-forge-prompt-grounding-and-invention-design.md 2026-08-18-forge-prompt-style-gate-and-suggestions-design.md 2026-08-18-forge-prompt-question-definition-design.md
cd ../../..
```

Expected: `1` for each of the four specs; `0`; `0` for each of the two; `0` em dashes for each of the four specs.

- [ ] **Step 6: Run the spec's full verification**

```bash
cd professor-orb/skills/forge-prompt
grep -ci 'adopted by silence' SKILL.md
grep -c 'default to Forge' SKILL.md
grep -c 'Three offers' SKILL.md
grep -c 'four outcomes' SKILL.md
grep -c '^### Recording the style' SKILL.md
grep -c 'Every phrase names something that should appear' SKILL.md references/flux2-prompting.md
grep -c 'positive specification' references/flux2-prompting.md
grep -c '^## Multi-reference notation' references/flux2-editing.md
grep -c '^## Input images' references/flux2-editing.md
cd ../../..
sed -n '/^## The loop/,/^## The test runs/p' professor-orb/skills/forge-prompt/SKILL.md | grep '^### '
grep -c 'file-delivery tool' professor-orb/skills/SHARED-PRINCIPLES.md
grep -c 'pointer to the' professor-orb/skills/chronicler/SKILL.md professor-orb/commands/migrate.md
grep -c '—' professor-orb/skills/forge-prompt/SKILL.md professor-orb/skills/forge-prompt/references/*.md professor-orb/skills/SHARED-PRINCIPLES.md professor-orb/skills/chronicler/SKILL.md professor-orb/commands/migrate.md professor-orb/CONTEXT.md
grep -c 'All 19 carry the preamble' CLAUDE.md
grep -rl 'SHARED-PRINCIPLES.md' professor-orb/skills/*/SKILL.md professor-orb/agents/*.md professor-orb/commands/*.md | wc -l
```

Expected, in order: `0`, `0`, `0`, `0`, `1`, `1` for each file, `0`, `0`, `1`; the four loop headings; `1`; `0` for each file; `0` em dashes for each file; `1`; `19`. The last two confirm the preamble count in the repo's `CLAUDE.md` still matches the components carrying it, since no component was added or removed.

- [ ] **Step 7: Run all eight Node suites**

```bash
for f in $(find professor-orb -name "*.test.mjs" | sort); do node "$f" || { echo "FAIL: $f"; break; }; done
```

Expected: every suite exits 0 and no `FAIL:` line prints (about a minute). No executable code changed, so a failure here means something outside this plan moved: stop and report it rather than fixing it.

- [ ] **Step 8: Commit the spec records**

```bash
git add -- docs/superpowers/specs/2026-08-09-forge-prompt-skill-design.md docs/superpowers/specs/2026-08-16-forge-prompt-grounding-and-invention-design.md docs/superpowers/specs/2026-08-18-forge-prompt-style-gate-and-suggestions-design.md docs/superpowers/specs/2026-08-18-forge-prompt-question-definition-design.md docs/superpowers/specs/2026-09-17-forge-prompt-held-suggestions-and-proposal-delivery-design.md
git commit -F - <<'EOF'
docs(professor-orb): point the earlier forge-prompt specs at the 09-17 design

Each earlier forge-prompt spec now names what the 09-17 design
supersedes in it, two stale Status lines are corrected, and the 09-17
design is marked implemented.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 9: Commit the release**

```bash
git add -- .claude-plugin/marketplace.json professor-orb/.claude-plugin/plugin.json
git commit -F - <<'EOF'
chore(professor-orb): 1.17.0

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

## After Task 6

This repo lands work as a local merge commit on `main`, not a pull request. Merge the branch locally once every task is committed and Step 7 passed.

The spec's manual verification (five checks in a consumer project) runs after the consumer picks up 1.17.0. It is the DM's to run, because it needs live forge-prompt and chronicler sessions in their own project.
