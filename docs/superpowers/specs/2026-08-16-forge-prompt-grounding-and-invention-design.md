# forge-prompt: Confirmed/Invented Split, Grounding Fix, House Style Capture

**Date:** 2026-08-16
**Status:** Draft for DM review
**Scope:** `professor-orb/skills/forge-prompt/` only, plus the collateral doc updates that keep the plugin's own inventory honest. Fixes five defects filed against forge-prompt 1.12.0's shipped skill text. No consumer project file is moved, read, or reorganized by this work beyond what the skill itself already touches (`prompts/` and, newly, `CLAUDE.md`).

## The problem

Five defects were filed against `forge-prompt/SKILL.md` as shipped in professor-orb 1.12.0, all traced to the same root cause: the skill's grounding step is too weak to stop invention, and nothing distinguishes confirmed material from invented material once it reaches the DM.

1. **Forge mode's opening question doesn't stop invention.** Even when answered, it asks purpose and destination, not appearance. Against a subject with no KB article and no prior prompt, round one's "never stall" rule licenses inventing build, age, pose, hair, eyes, skin, clothing, and background all at once, in the Revised Prompt itself, with no flag.
2. **Grounding step 2 (prior prompts for the same subject) self-cancels on a new subject.** A new subject has none, so the step returns nothing exactly when grounding is most needed.
3. **Grounding step 3 (CLAUDE.md) points at a file that, in practice, does not carry house style,** because no capture path into CLAUDE.md exists anywhere in the skill or the design that shipped it.
4. **Nothing requires flagging invented details.** They land in the Revised Prompt indistinguishable from confirmed ones, so correcting one means rejecting the whole paragraph.
5. **Suggestions scope isn't enforced.** The skill has proposed changes to the DM's generation workflow (aspect ratio, dimensions), including one that directly contradicted a standing preference the DM had already stated twice in the same campaign's prompt corpus.

## What this fixes and what it deliberately does not

- Fixes: the five defects above, all within `forge-prompt/SKILL.md`'s grounding, loop, and never-do sections.
- Does not touch: the three entry modes, the write gate, the reference files (`flux2-prompting.md`, `flux2-editing.md`), or anything in `content`. Those are unaffected by this defect set.
- Does not resurrect the wider prompt corpus as a grounding source. Considered and rejected; see "Corpus scope: tightened, not widened" below.

## Design decisions and why

### The governing rule: the Revised Prompt carries only confirmed material

This is the fix that dissolves defects 1 and 4 together, rather than patching each separately.

**Confirmed** means traceable to one of four sources: the subject's KB article, the DM's direct statements this session, descriptors locked in prior prompts for this exact subject, or the recorded house style (see below). Nothing else may appear in the Revised Prompt as a stated fact.

Any visual detail no confirmed source establishes goes to **Suggestions**, explicitly labeled as invented, one line per invented detail so each is individually declinable. A round-one prompt built from nothing but the subject noun and the house style block is correct output, not a stalled loop: "Never stall" is preserved exactly (a Revised Prompt every round is still mandatory) but its license to fill visual gaps by inference is revoked and redirected to Suggestions. Non-visual inference (a reasonable read of what the DM meant by an ambiguous instruction, e.g. "the image is for the players' recap slide, so landscape orientation") is unaffected; the rule targets invented *subject appearance*, not ordinary judgment calls about the request.

**Suggestions stay approved-by-default.** This was the explicit, confirmed decision in this session: an invented detail not addressed by the DM still applies in the following round, same as any other Suggestion. The fix is visibility and declinability at the moment of invention, not a consent gate that blocks the loop's core mechanism. A DM who wants zero invention says so once and the skill stops proposing it (ordinary Suggestion decline behavior, unchanged).

### Corpus scope: tightened, not widened

The DM does not trust the wider prompt corpus as a grounding source, for a concrete reason: reading broadly for house style or structure risks the skill treating any file that looks like a prompt as authoritative, "poisoning its output with any prompts in a project or anything it thinks are prompts" (DM's words).

So the fix for defect 2 is not "read the corpus more broadly for house style" (the report's suggested fix). It is: **same-subject prior prompts remain the only corpus read, and the skill is explicitly forbidden from reading the corpus for anything else** (house style, structure, phrasing, generation preferences). House style moves to CLAUDE.md entirely (see next section), so grounding step 2 no longer needs to self-cancel into a fallback; it simply returns nothing for a new subject, which is expected and stated as such, and grounding proceeds to CLAUDE.md on its own strength rather than as a rescue for step 2's emptiness.

### House style lives in CLAUDE.md; the skill can now write it there

Per the original design ("House style comes from CLAUDE.md, not a new file") and the DM's confirmation this session, CLAUDE.md is where house style was always supposed to live. What was missing was a capture path: nothing in the shipped skill ever proposed writing it there, so a DM who never manually edited CLAUDE.md got a skill permanently reading an empty source.

**New behavior:** when the DM states a visual style preference the project's CLAUDE.md does not yet record, or when a loop closes with no house style on file, forge-prompt proposes CLAUDE.md text capturing it and writes on the DM's approval. Never unasked; mirrors [setup's pointer-paragraph offer](../../../professor-orb/skills/setup/SKILL.md) (`setup/SKILL.md` line 185, "Offer it; do not do it unasked").

The captured block covers both visual house style (tone, medium, palette) *and* standing generation preferences (e.g. "no negative prompt or generation dimensions, per the DM's request"). Folding generation preferences in here is what lets defect 5's fix hold: a preference recorded once in CLAUDE.md is the thing Suggestions checks against before proposing anything that would contradict it, replacing the current failure mode where the same preference was stated twice in prompt files nothing reads back.

**Two consequences, stated plainly:**

- This expands the skill's declared outputs beyond `prompts/`. The frontmatter description and the "How this skill connects to the others" section must say so.
- Root `CLAUDE.md` sits outside every prong `/log` commits. This write is never bundled into the campaign lane; committing it is the DM's own action, same as any other manual CLAUDE.md edit.

### Suggestions scope: prompt text only, enforced by naming what's excluded

Defect 5's fix is not a vague scope note; it lists what's out of bounds. Suggestions may address prompt craft (word order, phrasing, structure, level of detail, invented-detail proposals per the rule above). Suggestions may never address the DM's generation workflow, hardware, sampler, model choice, aspect ratio, output dimensions, or file format. A preference already recorded in CLAUDE.md is never re-proposed, checked against the same house-style block introduced above.

## Grounding, rewritten

In this order:

1. **The subject's KB article,** if the subject is a KB entity, for canonical appearance. Unchanged. Content exclusions apply; `block-excluded` enforces at PreToolUse regardless of intent.
2. **Prior prompts for this same subject only,** in the campaign's `prompts/` directory, for descriptors already locked there. Returns nothing for a new subject; that is expected, not an error condition, and grounding proceeds. Explicit prohibition: never read the wider corpus, and never treat a file that merely resembles a prompt as a grounding source.
3. **The project's CLAUDE.md,** for the recorded house style and any standing generation preferences. If none is recorded, say so plainly and do not infer one. This is where the capture step (above) writes to, closing the loop between "grounding reads here" and "the skill can put something here."

## The loop, amended

Same three sections (Revised Prompt, Suggestions, Questions), same order, one governing rule layered in and one loop rule rewritten:

- **Revised Prompt** carries only confirmed material (subject's KB article, DM's direct statements, same-subject locked descriptors, recorded house style). A bare prompt is valid output when little or nothing is confirmed.
- **Suggestions** gains the invented-detail class: one line per invented visual detail, labeled as invented, ordered by impact same as any other Suggestion, approved-by-default same as any other Suggestion. Scope is prompt text only; the DM's generation workflow, hardware, and output parameters are never proposed, and a preference already recorded in CLAUDE.md is never re-proposed.
- **Questions** unchanged in count and blocking-only criterion, with one added constraint: a Question may offer choices for an unconfirmed detail but must never assert it as settled while doing so.
- **Loop rules:** "Never stall" is restated to make explicit that its inference license does not extend to visual/appearance detail; that detail routes to Suggestions instead. "On a contradiction" and "On 'looks good' with obvious gaps" are unchanged.

## House style capture (new subsection in the skill)

Trigger: (a) the DM states a visual style preference or generation preference not already in CLAUDE.md, or (b) a loop closes with no house style on file and the DM has repeated the same stylistic choice or preference across multiple rounds of the session. Either trigger only ever produces a *proposal*; nothing is asserted as recorded house style until the DM approves the write.

Behavior: propose the exact CLAUDE.md text (a short block covering visual tone/medium/palette and any standing generation preferences), show it to the DM, write only on explicit approval. Follows Principle 2 (propose, then execute) exactly like the existing write gate for prompt files; this is not the Principle 2 exception setup uses, so no snapshot mechanism is needed, just ordinary approval.

Never bundled with `/log`. The DM commits this edit themselves.

## Things to never do (additions)

- **Never state an unconfirmed visual detail as settled in the Revised Prompt or a Question.** Invented details belong in Suggestions only, labeled as invented.
- **Never read the wider prompt corpus.** Same-subject prior prompts only.
- **Never propose a change to the DM's generation workflow, hardware, sampler, model choice, aspect ratio, dimensions, or file format** in Suggestions. Never re-propose a preference already recorded in CLAUDE.md.
- **Never write to CLAUDE.md without explicit DM approval**, matching the existing prompt-file write gate.

(All prior never-do entries are retained unchanged: no negative prompt, no `pipeline-state.json`, no KB writes, no invented canon, no `type` frontmatter field, no mid-loop save, no excluded material, no running generation.)

## Files

| File | Change |
|---|---|
| `professor-orb/skills/forge-prompt/SKILL.md` | Frontmatter description (new CLAUDE.md write capability); grounding section rewrite; loop section (Revised Prompt confirmed-only rule, Suggestions invented-detail class and scope fence, Questions constraint); new "House style capture" subsection; never-do additions; "How this skill connects to the others" outputs list |
| `professor-orb/CONTEXT.md` | Tighten the **prompt corpus** entry to same-subject-only, dropping the double-duty house-style framing; update the **forge-prompt** entry to mention the confirmed/invented split and the CLAUDE.md capture path |
| `professor-orb/.claude-plugin/plugin.json` | 1.12.0 → 1.12.1 (bug-fix release against shipped 1.12.0 behavior, per project convention, e.g. 1.8.1, 1.2.1) |
| `.claude-plugin/marketplace.json` | 1.12.0 → 1.12.1, must match plugin.json |

## Testing

No executable code is touched; this is a skill markdown change, consistent with the original forge-prompt addition adding no test file. All eight existing suites must still pass unchanged:

```
for f in $(find professor-orb -name "*.test.mjs" | sort); do node "$f" || break; done
```

Manual verification, in a consumer project:

1. Run `/forge-prompt` in Forge mode against a brand-new subject with no KB article and no prior prompt. Confirm the round-one Revised Prompt contains no invented appearance detail, and that every invented detail the skill would otherwise have used appears as a labeled Suggestion instead.
2. State a house style preference mid-session where none is recorded in CLAUDE.md. Confirm the skill proposes exact CLAUDE.md text and writes only on approval, and that the write is not bundled into any `/log` commit.
3. In a project where CLAUDE.md already carries a recorded generation preference (e.g. "no negative prompt or dimensions"), confirm Suggestions never re-proposes changing it.
4. Run `/forge-prompt` in Diagnose or Forge mode for a subject that has same-subject prior prompts. Confirm those descriptors ground the prompt, and confirm the skill does not read or cite any other file in `prompts/`.

## Risks

**CLAUDE.md writes are a new class of behavior for this skill and for the plugin's non-setup skills generally.** No other pipeline or standalone skill writes to the consumer's root CLAUDE.md. Contained by: explicit approval gate identical in spirit to the existing prompt-file gate, and by scoping the write to a single proposed block rather than freeform edits.

**"Confirmed" still requires judgment at the boundary.** A DM's offhand remark ("I picture him older") is a direct statement and thus confirmed; a stronger inference from tone is not. The skill will occasionally miscategorize a detail as confirmed when it was actually inferred, or vice versa. Contained by: Questions may probe the boundary when getting it wrong would be expensive, same escalation rule as today.

**A DM who wants the corpus read more broadly (e.g. cross-campaign identity for a recurring NPC) is not served by this fix.** That was already out of scope in the 1.12.0 design ("Cross-campaign identity is unsolved," named there as a deliberate deferral) and remains so here; this spec tightens same-subject reading, it does not widen it.

## Deliberately out of scope

**Any change to the three entry modes, the write gate for prompt files, or the reference files.** None of the five filed defects touch them.

**A visual registry or any new auxiliary document beyond CLAUDE.md capture.** Principle 8 licenses exactly one auxiliary document (setup's migration manifest); this design adds no second one. CLAUDE.md is not a new auxiliary document, it is the consumer's own existing file, already named in the original design as the intended house-style source.

**Retrofitting the confirmed/invented split into `content` or any other skill.** Scoped to forge-prompt, where the defects were filed.
