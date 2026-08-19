# forge-prompt: Style Gate, Style Catalog, and the Suggestions Rewrite

**Date:** 2026-08-18
**Status:** Implemented
**Scope:** `professor-orb/skills/forge-prompt/SKILL.md` plus the three inventory files that describe it.
**Supersedes:** the Suggestions and house-style portions of `2026-08-16-forge-prompt-grounding-and-invention-design.md`. That document's grounding fix and confirmed-only rule survive; its invented-detail class and its floating "Recording a house style" section do not.

## What went wrong in 1.14.0

Three defects, reported by the DM after using the shipped skill.

1. **The Suggestions block was never corrected, only appended to.** The 08-16 plan said to append two paragraphs after the existing opening paragraph and leave that paragraph alone. Commit `b718fef` did exactly that. Commit `15ef497` then rewrote the paragraph anyway, with text appearing in neither the plan nor the spec, and added a cap exemption ("Invented-detail lines are not counted against this cap") contradicting the spec's "ordered by impact same as any other Suggestion." The result was a mangled definition of a Suggestion with a second, better one immediately below it.

2. **Suggestions still proposed generation settings.** The 08-16 fix for this was a prohibition list naming the workflow, hardware, sampler, model, aspect ratio, output dimensions, and file format. Naming them is what kept them available: a rule spelled "never propose X" ships an example of X into the context where it matters. The block had no positive definition of what a Suggestion *is*, so the prohibition was the only guidance and it pointed at the wrong things.

3. **House style capture never fired.** `## Recording a house style` sat between Grounding and The loop, and nothing called it. The loop never referenced it; the write gate never referenced it. Its two triggers described conditions with no step in the executed sequence to check them, so the section was inert. Grounding had the same problem in miniature: it was told to read `CLAUDE.md` and "say so plainly" if nothing was recorded, but the three output blocks had no slot for grounding to report anything.

## Design decisions and why

### The Suggestions block is defined by construction, not prohibition

A Suggestion proposes one change to the text of the Revised Prompt: add, edit, or delete. "If it does not change the prompt's text, it is not a Suggestion" is the entire scope fence. ComfyUI settings, seeds, aspect ratio, and output dimensions are excluded because they are not prompt text, not because a list forbids them. The prohibition bullet in "Things to never do" is removed for the same reason.

### The DM's answer has three branches, not two

The shipped skill wrote only "approved by default unless the DM declines." The mechanic the DM actually operates has three outcomes, and the third was never written down:

- **Declined:** dropped, and not re-proposed.
- **Silence:** adopted, and confirmed material from that round on.
- **Countered:** the DM's wording replaces the suggestion entirely.

### Invention is an ordinary Suggestion, not a class of its own

The 08-16 design gave invented detail its own paragraph, its own label, and an exemption from the cap. That produced a wall of "Invented:" lines every round and a fourth thing on screen in all but name. Invention is now an **add** suggestion made in the skill's own name, ordered by impact and counted against the same cap as everything else. The rule that keeps invention out of the Revised Prompt is unchanged and still load-bearing; only its delivery mechanism is simplified.

**Exactly three blocks per round: Revised Prompt, Suggestions, Questions.** This is a hard constraint on the loop, not a default.

### The style is resolved before the loop starts

Medium, palette, lighting, and mood are the prompt's opening words, not a finish applied at the end, so resolving them after a draft exists means rewriting that draft. Step 1 gates the first Revised Prompt on one of four outcomes: a style the DM names, the house style `CLAUDE.md` points at, a recorded opt-out, or one built with the DM on the spot.

This creates an apparent conflict with "Never stall," which mandates a Revised Prompt every round. It is stated explicitly in the loop rules that Step 1 precedes the loop, so waiting on it is not stalling. An unstated version of this reconciliation is what produced defect 1: two rules that appear to contradict each other invite a later session to "bridge" them off-plan.

### Storage: content in the catalog, pointer in CLAUDE.md

The catalog is `<sessionReportsRoot>/<campaign>/prompts/styles/STYLE-<Name>.md`, one file per named style, no `type` frontmatter field (the write-time validator skips a typeless file and blocks an unrecognized type).

`CLAUDE.md` records only which style is the house style for a campaign, or that the DM opted out. Two reasons for the split:

- `CLAUDE.md` is always in context, so "the DM named no style" resolves to the house style without reading the catalog first. A catalog of many styles living in `CLAUDE.md` would load all of them into every session of every skill.
- **A recorded opt-out and a missing record are different states, and no amount of looking for a style distinguishes them.** Writing the opt-out down is what stops the skill asking every session. A rule keyed to unobservable state gets guessed at.

`conventions.json` was considered and rejected as the catalog's home: it governs KB frontmatter, filenames, and structure, and the skill already states that prompt files are none of those.

### Campaign-scoped, deliberately

`/log` commits `<sessionReportsRoot>/<campaign>/` recursively, which covers `prompts/styles/` with no new lane rule. A setting-level catalog would share styles across campaigns but fall outside the lane and become a manual commit like `CLAUDE.md`. The cost accepted: a style used in two campaigns lives in both. The cost refused: a style file that silently fails to commit.

### The house-style offer is anchored in the write gate

The close now makes three offers, once each: save the prompt, save the style when Step 1 built one, and record the house style when `CLAUDE.md` records neither a style nor an opt-out. A declined house style becomes an offer to record the opt-out, so the question is settled rather than re-asked next session.

Grounding also reports what it found, in one line, before the first Revised Prompt only. A silent grounding step is indistinguishable from one that did not run, which is precisely how defect 3 stayed invisible.

## What shipped

| File | Change |
|---|---|
| `professor-orb/skills/forge-prompt/SKILL.md` | Frontmatter description; new `## Step 1: resolve the style`; grounding renumbered to Step 2 and reduced to two sources plus a reporting line; `### Suggestions` fully replaced; loop rules gain the gate reconciliation; write gate gains the three offers; never-do list updated; connections list updated |
| `professor-orb/CONTEXT.md` | forge-prompt entry rewritten; prompt corpus entry repointed; new **style catalog** glossary entry |
| `professor-orb/README.md` | forge-prompt table row |
| `professor-orb/skills/orb/SKILL.md` | forge-prompt table row |

## Verification

```bash
cd professor-orb/skills/forge-prompt && grep -c 'Each Suggestion proposes one change' SKILL.md; grep -c 'theirs replaces yours' SKILL.md; grep -c 'Step 1: resolve the style' SKILL.md; grep -ci 'sampler\|aspect ratio\|output dimensions' SKILL.md
```

Expected, in order: `1`, `1`, `1`, `0`. The last is the construction-not-prohibition check: reintroducing the banned-settings list is a regression, not a clarification.

The loop must expose exactly three output blocks:

```bash
sed -n '/^## The loop/,/^## The test runs/p' professor-orb/skills/forge-prompt/SKILL.md | grep '^### '
```

Expected: `Revised Prompt`, `Suggestions`, `Questions`, and `Loop rules`, which is guidance rather than an output block. A fifth heading is a regression.

All eight Node test suites pass unchanged; no executable code was touched.

## Not done here

The plugin version was not bumped. `marketplace.json` and `plugin.json` both read `1.14.0` and match. Releasing is the DM's call.
