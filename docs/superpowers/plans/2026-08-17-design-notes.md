# Design Notes Block Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Specify the `## Design Notes` catalog-entry block, which is used in practice but defined nowhere, as a closed grammar that setting material cannot occupy.

**Architecture:** The block is defined once, in `commands/references/catalog-type-templates.md`, which `/catalog` Step 4 already reads on every capture regardless of source path. The `homebrew` skill gains a conditional offer at its existing `/catalog` handoff and points at that definition rather than restating it. `commands/catalog.md` needs no change: Step 4 already delegates body-block handling to the template's rules.

**Tech Stack:** Markdown prose in a Claude Code plugin. No build, no runtime, no automated test suite covers these files — verification is by parsing the shipped text against known-good exemplars and by cold-reading round trips.

**Spec:** `docs/superpowers/specs/2026-08-17-design-notes-design.md`

## Global Constraints

- **Derive from `Loom-of-Marrow-and-Flesh` and `Bodkin` only.** Other catalog entries carrying a Design Notes section predate this spec and are not exemplars. Do not read them for guidance.
- **No prohibitions in shipped plugin text.** Negation ships an example of the failure into the context where the rule applies. Specify a closed form the failure cannot occupy. (`CONTEXT.md` glossary entries are the one exception — `_Avoid_:` is that file's established house format.)
- **The grammar must accept every paragraph of both exemplars.** Any revision is checked this way; it holds only if all of them parse.
- **No rule may depend on unobservable state.** Nothing marks which text in a conversation the DM typed and which the assistant produced, so no rule keys to authorship.
- **`professor-orb/CONTEXT.md` is the project glossary.** Read it before writing any user-facing prose in this repo.
- **Version must match** in `.claude-plugin/marketplace.json` and `professor-orb/.claude-plugin/plugin.json`.
- **Commit messages** end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

### Task 1: Specify the block in the type templates

**Files:**
- Modify: `professor-orb/commands/references/catalog-type-templates.md` — append a subsection after the `## Shared rules for every template` bullet list (currently ends at line 24, immediately before `## spell` at line 26)
- Read only, expect no edit: `professor-orb/commands/catalog.md:69,78,145`
- Test: none automated; verification is Steps 2–4

**Interfaces:**
- Consumes: nothing
- Produces: the section heading `### Design Notes (optional, every type)` inside `## Shared rules for every template`, referenced by path from `skills/homebrew/SKILL.md` in Task 2 and quoted in Task 3's doc sync

- [ ] **Step 1: Add the Design Notes subsection**

Insert after the `- **Required frontmatter floor (all types):** ...` bullet (line 24) and before `## spell` (line 26), separated by a blank line:

```markdown
### Design Notes (optional, every type)

A record of the design decisions behind the artifact. Present when the design produced
decisions worth recording, absent otherwise. Available to every type key.

**Structure.** A list of labeled records, each answering one design question about this
artifact.

**Every paragraph carries a label, and the label is a design question.** The shapes in use:

- `Why <the design> exists.` — the gap it fills
- `Rejected: <the alternative>.` — what was cut, and why
- `<The mechanic>.` — what it was assembled out of, and why that shape
- `<The question>, raised but not settled.` — deliberately left open
- `Why <a fiction-driven choice>.` — how the fiction produced the mechanic
- `Naming.` — naming intent
- `What the design responded to.` — the campaign, the month and year, and the conditions
  the design answered

**The body answers the label's question,** about the artifact as a designed object: why it
is the way it is.

**Where a choice was made among alternatives, the record says it was made and says what was
cut.** The verbs carrying this are past tense: was cut, was weighed and declined, was
assembled out of, was chosen for, was kept instead, was set aside, was left in place rather
than designed around.

**Campaign conditions belong in `What the design responded to.`,** bound to the campaign and
the month and year, as conditions the design answered. Stated that way, a condition stays
true after play moves past it.

**Each record is a decision the DM made.**

**The block is shown to the DM and confirmed before the entry is written.** This holds
however the text came to exist, so it needs no account of who drafted which part.

**Tagging: `[H]` alone.** It has no SRD 5.2.1 basis and never reads as published-rules
apparatus. It carries no `[B]` tag: `[B]` means content supplied to the command and
preserved verbatim, and this block's own rules cover how it comes to exist.
```

- [ ] **Step 2: Confirm `commands/catalog.md` needs no change**

Read `professor-orb/commands/catalog.md` at lines 69, 78, and 145. All three state that `[B]` blocks hold the DM's finalized content and are carried verbatim, never rewritten, reformatted, or completed.

Expected: **no edit.** These govern *not altering supplied content*; none of them prohibits originating a block, so none conflicts with a block composed during the session. Line 69 further directs the command to treat body blocks "per the template's Preservation rule," so specifying the block in the template is already sufficient.

This step exists because the contradiction looks real on a first read and an earlier draft of the design invented a `[D]` tag to resolve it. That tag was cut: it keyed a rule to who authored the text, which nothing in the conversation marks and the command therefore cannot observe. If you find yourself reaching for an authorship distinction here, stop — the show-before-write rule already covers the case without one.

- [ ] **Step 3: Parse both exemplars against the shipped text**

Read the two exemplar entries:

```bash
sed -n '/## Design Notes/,$p' "C:/Users/jorda/OneDrive/Documents/Claude/Projects/World of Rolara/.claude/worktrees/soulweaver-artifact-pair-ff8d8d/homebrew/rolara/magic-items/Loom-of-Marrow-and-Flesh.md"
```

```bash
sed -n '/## Design Notes/,$p' "C:/Users/jorda/OneDrive/Documents/Claude/Projects/World of Rolara/.claude/worktrees/soulweaver-artifact-pair-ff8d8d/homebrew/rolara/magic-items/Bodkin.md"
```

For each paragraph, confirm against the text you just wrote (not against the spec — the shipped text is a condensation and could have lost a rule):

1. It carries a label, and the label is a design question.
2. Its body answers that question about the artifact as a designed object.
3. Where alternatives were weighed, it says so and says what was cut.
4. Any campaign condition appears under `What the design responded to.`, with campaign and date.

Expected: all 13 paragraphs across the two entries pass. Loom has 7 (`Why the pair exists.`, `Rejected: material cost and a multi-day ritual.`, `Rejected: cursed.`, `The percentile clause.`, `Both undead spells, both at level 9.`, `Raised but not settled.`, `What the design responded to.`); Bodkin has 6 (`Rejected: soul theft, then body snatching.`, `Why a rapier.`, `3d12 on every hit.`, `Raise Dead at will, paid in Exhaustion.`, `Naming.`, `What the design responded to.`).

**If any paragraph fails, the shipped text is wrong, not the exemplar.** Three specific paragraphs — Loom's `Why the pair exists.` and Bodkin's `Why a rapier.` and `Naming.` — are present tense throughout. They must pass. A draft requiring past tense in every record was already cut for rejecting exactly these.

- [ ] **Step 4: Cold round-trip test**

Dispatch a fresh subagent (Task tool, `general-purpose`) whose entire context is the modified `catalog-type-templates.md` plus this prompt. Do **not** give it the spec, this plan, or either exemplar:

```
Read the attached catalog-type-templates.md. Following its "Design Notes" rules exactly,
write a Design Notes block for this finalized homebrew magic item.

ITEM: The Bodkin — Weapon (rapier), artifact, requires attunement. +3 to attack and damage,
deals Bludgeoning instead of Piercing, extra 3d12 Necrotic on a hit, and a creature killed
by it is affected by Gentle Repose. While attuned you can cast Raise Dead at will with no
slot or components; each casting gives you 1 level of Exhaustion. Vex mastery property.

DESIGN CONVERSATION, in brief:
- Two earlier drafts had it tear a soul loose on a killing blow, then force a carried soul
  into a dying target's body. Both cut — it weaves souls into bodies and the verb only runs
  that direction. Not a horror implement.
- It is an instrument built for a dragon's grip; a mortal uses it as a rapier because that
  is the closest its size and balance allow. The blunt head is why it deals Bludgeoning.
- 3d12 was picked for its spread, 3 to 36. An earlier draft limited the rider to once per
  turn; that limit was cut because an artifact's rider should not carry a restriction a
  Very Rare weapon's would not.
- Exhaustion as the cost governs frequency with no bookkeeping.
- Built August 2026 for the Girl-Squad campaign, against an intent to place it and its
  paired artifact far apart, and a player character carrying his dead brother's soul with
  another power holding a prior claim.

Output only the block.
```

Check the returned block:
- Every paragraph carries a design-question label.
- No paragraph asserts a setting fact that was not in the prompt.
- The campaign material appears only under `What the design responded to.`, with the month and year.

Expected: passes on all three. If it invents lore or scatters campaign state, the shipped text is underspecified — fix it and re-run.

- [ ] **Step 5: Commit**

```bash
git add -- ":(literal)professor-orb/commands/references/catalog-type-templates.md"
```

```bash
git commit --only -m "feat(catalog): specify the Design Notes block for every type key

The block is used in catalog entries in practice but was defined nowhere,
so it drifted from recording design decisions toward asserting setting
facts. Specified as a closed grammar: every paragraph carries a label,
and the label is a design question. A world fact answers no design
question and so has no label to sit under.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- ":(literal)professor-orb/commands/references/catalog-type-templates.md"
```

---

### Task 2: Add the conditional offer to the homebrew skill

**Files:**
- Modify: `professor-orb/skills/homebrew/SKILL.md:166-171` — append to the `## When a design is finalized: point to /catalog` section, after the paragraph ending `...a separate command the DM runs when ready.`
- Test: none automated; verification is Step 2

**Interfaces:**
- Consumes: the section heading and relative path `../../commands/references/catalog-type-templates.md` established in Task 1
- Produces: nothing consumed downstream

- [ ] **Step 1: Add the offer**

Append two paragraphs to that section, before the `---` that follows it:

```markdown
**Offer the Design Notes block while the reasoning is fresh.** If the design conversation
produced decisions worth recording — an alternative rejected, a benchmark named, a departure
from published convention made deliberately, a constraint that shaped the design — offer to
compose the entry's Design Notes block now, before the DM leaves for `/catalog`. The
reasoning is freshest here and is largely lost by capture time. Where the design produced
none of these, the design flow ends as it did before, with the `/catalog` pointer alone.

The block's definition lives in `../../commands/references/catalog-type-templates.md`
(relative to this skill), under "Shared rules for every template". Read it and follow it
rather than composing from memory. Show the draft to the DM and get confirmation; the
confirmed text travels to `/catalog` as part of the finalized design, the same way
everything else this skill produces reaches capture.
```

The relative path resolves: `skills/homebrew/` → `../../` → `professor-orb/` → `commands/references/`. This matches the existing `../SHARED-PRINCIPLES.md` style used at line 6.

Do **not** add anything to the skill's `## Things to never do` list. The offer is specified positively and needs no negative counterpart.

- [ ] **Step 2: Verify the offer is conditional**

Two cold subagent runs (Task tool, `general-purpose`), each given only the modified `SKILL.md` section plus the scenario. The offer must fire in one and stay silent in the other.

Fires: *"The DM and I finalized a Rare wondrous item. We rejected a charges-based version as bookkeeping, benchmarked it against Cloak of Displacement, and deliberately dropped the attunement requirement that comparable items carry. The DM confirmed the design."*

Silent: *"The DM asked for a +1 longsword with a name. We named it. The DM confirmed."*

Expected: the first offers the Design Notes block; the second mentions `/catalog` only.

- [ ] **Step 3: Commit**

```bash
git add -- ":(literal)professor-orb/skills/homebrew/SKILL.md"
```

```bash
git commit --only -m "feat(homebrew): offer the Design Notes block at finalization

The reasoning behind a design is freshest at the moment it is finalized
and is largely lost by capture time. The skill now offers to compose the
block there, conditional on the conversation having produced decisions
worth recording, and points at the type-templates definition rather than
restating it so the two copies cannot drift apart.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- ":(literal)professor-orb/skills/homebrew/SKILL.md"
```

---

### Task 3: Sync the inventory docs

**Files:**
- Modify: `professor-orb/CONTEXT.md:138-143` (the `**catalog command**:` entry) and add a new `**Design Notes**:` entry after it
- Modify: `professor-orb/README.md:66` and `professor-orb/README.md:72`
- Check (likely no edit): `professor-orb/skills/orb/SKILL.md:40`
- Test: none automated; verification is Step 4

**Interfaces:**
- Consumes: the block name and rules from Task 1
- Produces: nothing consumed downstream

Precedent for this task: commit `e7bc78a` ("correct the inventory for forge-prompt's new limits") touched `CONTEXT.md`, `README.md`, and `skills/orb/SKILL.md` together. A behavior change travels with its inventory.

- [ ] **Step 1: Update CONTEXT.md's catalog entry and add a Design Notes entry**

Replace lines 138–143 entirely. Current text:

```markdown
**catalog command**:
The `/catalog` capture step: DM pastes the locked, post-tweak Foundry HTML; the
command writes the markdown-wrapped entry, updates the owning Homebrew index, and
nothing else. Precise and repeatable by design: capture is a command, not a
reminder.
```

Replacement:

```markdown
**catalog command**:
The `/catalog` capture step: takes one finalized, DM-confirmed piece of homebrew,
writes one type-specific entry, stamps its lifecycle status and version, updates the
owning Homebrew index, and nothing else. Body blocks hold the DM's finalized content
verbatim. Design Notes is the one block composed during the session rather than
supplied to the command, so it is shown to the DM and confirmed before the entry is
written. Precise and repeatable by design: capture is a command, not a reminder.
_Avoid_: describing it as an HTML paste (superseded by the 2026-07-11 redesign)

**Design Notes**:
The optional catalog-entry block recording why an artifact was designed the way it
was: a list of labeled records, each answering one design question about that
artifact. Specified in `commands/references/catalog-type-templates.md` under the
shared rules, and offered by the `homebrew` skill at finalization, where the
reasoning is freshest and from which it is largely lost by capture time. The label
being a design question is what keeps setting material out, since a world fact
answers no design question and has no label to sit under. Campaign conditions have
one home, `What the design responded to.`, bound to a campaign and a date, where a
condition stays true after play moves past it.
_Avoid_: lore commentary under this heading, current campaign state, calling it canon
```

**Judgment call flagged for the reviewer:** the existing entry describes an HTML paste, which the 2026-07-11 catalog redesign superseded — it was already stale before this change. The replacement corrects it, since the entry is being edited anyway and `CLAUDE.md` directs readers here before writing user-facing prose. Reject this half if you would rather keep the change minimal.

**Second judgment call:** the `_Avoid_:` lines are `CONTEXT.md`'s established house format, present on nearly every entry, and this file is a human-facing glossary rather than text loaded at drafting time. If you would rather hold the no-prohibitions line even here, drop both `_Avoid_:` lines.

- [ ] **Step 2: Update README.md's two claims**

Line 66 currently ends the `/catalog` clause with:

```
and `/catalog` treats the DM's own act of invoking it on homebrew already finalized and confirmed as that approval.
```

Replace with:

```
and `/catalog` treats the DM's own act of invoking it on homebrew already finalized and confirmed as that approval, with one exception: the Design Notes block is composed during the session rather than supplied to the command, so an invocation cannot have approved it and it is shown to the DM and confirmed before the write.
```

Line 72 currently reads, in part:

```
while its body blocks preserve the DM's finalized content verbatim, never reformatted or completed.
```

Replace with:

```
while its body blocks preserve the DM's finalized content verbatim, never reformatted or completed. One block is different by design: Design Notes records why the artifact was designed the way it was, as labeled records each answering one design question about it, and is confirmed with the DM before the entry is written.
```

- [ ] **Step 3: Check orb/SKILL.md, expect no edit**

Read `professor-orb/skills/orb/SKILL.md:40`:

```
| /catalog | Command | Capture a finalized piece of homebrew as a type-specific, versioned catalog entry across its playtest life | Invoking `/catalog` once a design is finalized, optionally pasting it or naming what to catalog |
```

Expected: no edit. Design Notes sits below the resolution of that row, which describes what the command is for rather than how any one block is handled. Line 18's approval statement ("Every skill drafts its output and waits for your approval before writing files") is already consistent with show-before-write. Confirm both, then move on. If you disagree at that altitude, edit line 40 and say so in the commit body.

- [ ] **Step 4: Verify the docs agree with the shipped rules**

Re-read the Task 1 subsection and the three docs together. Confirm no doc claims something the shipped rules do not say — particularly that none of them describes Design Notes as DM-authored, assistant-authored, or otherwise keyed to who wrote it. The rule is show-before-write, which is deliberately silent on authorship.

- [ ] **Step 5: Commit**

```bash
git add -- ":(literal)professor-orb/CONTEXT.md" ":(literal)professor-orb/README.md"
```

```bash
git commit --only -m "docs(professor-orb): record the Design Notes block in the inventory

CONTEXT.md gains a Design Notes entry and its catalog-command entry drops
the superseded HTML-paste framing. README's approval covenant now names
the one block an invocation cannot have approved, since it is composed
during the session rather than supplied to the command.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- ":(literal)professor-orb/CONTEXT.md" ":(literal)professor-orb/README.md"
```

---

### Task 4: Version bump

**Files:**
- Modify: `professor-orb/.claude-plugin/plugin.json` — `"version": "1.12.1"` → `"1.13.0"`
- Modify: `.claude-plugin/marketplace.json:11` — `"version": "1.12.1"` → `"1.13.0"`

**Interfaces:**
- Consumes: Tasks 1–3 complete
- Produces: nothing

- [ ] **Step 1: Bump both files to 1.13.0**

Minor rather than patch: this adds a specified block and a new skill behavior, neither of which existed before. Change to `1.12.2` instead if you read it as a documentation correction, but change **both** files either way — `CLAUDE.md` requires them to match.

- [ ] **Step 2: Verify they match**

```bash
grep -h '"version"' professor-orb/.claude-plugin/plugin.json .claude-plugin/marketplace.json
```

Expected: two identical `"version": "1.13.0",` lines.

- [ ] **Step 3: Commit**

```bash
git add -- ":(literal)professor-orb/.claude-plugin/plugin.json" ":(literal).claude-plugin/marketplace.json"
```

```bash
git commit --only -m "chore(professor-orb): 1.13.0

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- ":(literal)professor-orb/.claude-plugin/plugin.json" ":(literal).claude-plugin/marketplace.json"
```

---

## Out of scope

- **Existing entries carrying a Design Notes section.** Consumer content in an unmerged worktree. `/migrate` performs structural operations only and never rewrites body prose, so bringing one into this form is a DM-side edit.
- **VTT import-file authoring** in the same skill file. Tracked separately; shares a file with this change and nothing else.
- **The missing `-m` in the documented git commit patterns** in `catalog.md`, `scribe.md`, and `log.md`. Tracked separately. Note the commit commands in this plan are written correctly, with `-m` before the `--` separator.
