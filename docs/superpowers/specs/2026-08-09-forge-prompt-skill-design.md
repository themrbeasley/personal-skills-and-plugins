# forge-prompt: Splitting Image Prompt Craft Out of Content

**Date:** 2026-08-09
**Status:** Draft for DM review
**Scope:** professor-orb plugin only. One new skill, one skill reduced, and the collateral doc updates that keep the plugin's own inventory honest. No consumer project file is moved, read, or reorganized by this work.

## The problem

The `content` skill carries a secondary job it is not equipped to keep: writing Flux2/ComfyUI image-generation prompts. Today that job lives in a nine-line `### Prompt sidecar` section (`professor-orb/skills/content/SKILL.md` lines 156 to 164) plus five scattered rules binding generation dimensions to HTML slot pixels.

Three things are wrong with it.

### 1. The shipped advice is factually wrong for the model it names

`content/SKILL.md` line 160 requires every sidecar to carry:

> A negative prompt, covering anything that would break the piece's fit (modern artifacts, wrong art style, unwanted text or watermarks, as applicable).

The FLUX.2 prompting guide's first stated core principle is that FLUX.2 does not support negative prompts, and that the correct technique is to describe the desired result positively instead. Every sidecar the skill has written carries a field the model ignores.

This is not a one-time fix. Nothing in `content`'s job description is "track BFL's documentation," so the advice will drift again.

### 2. The dimension-matching rules describe a workflow the DM does not run

Five rules bind generated image dimensions to HTML slot pixels:

| Location | Rule |
|---|---|
| line 157 | Placeholder must carry explicit `width` and `height` |
| line 161 | Generation dimensions must match the slot "exactly" |
| line 164 | Never a sidecar whose dimensions do not match its slot |
| line 206 | Self-check before writing to disk |
| line 244 | Never-do entry |

The DM's stated practice: aspect ratio, dimensions, format, and destination are chosen on the fly and revised during visual review. The skill's first guess is usually wrong and gets renegotiated. Nothing downstream tracks these numbers, and the generated images do not enter the KB.

This is dead spec. It reads as load-bearing and is not.

### 3. The newer half of the work has no seam at all

The DM now edits an approved image in a separate ComfyUI workflow rather than regenerating from scratch. That is a different job from the sidecar's, not a variation on it:

- The sidecar is generate-from-nothing, born as a byproduct of an HTML slot, written once, handed off.
- Editing is image-first. The image exists, dimensions are already settled, and the craft is preservation language plus `image [n]` multi-reference notation.

The edit loop frequently involves no content piece at all. `content` has nowhere to put it.

## What the split is not

- Not a rewrite of `content`'s four content types, voice rules, or output formats. Those are untouched.
- Not a change to how `content` handles HTML. Foundry fragments and printable pages keep every existing rule except the ones listed above.
- Not the iterative-loop retrofit for `content`. See "Deliberately out of scope."

## Verified constraints

These were checked against the code, not assumed.

**The write-time validator hook sees the new prompt files.** `hooks/validate-write.mjs` resolves the owning setting by which prong root contains the path (`prongContaining`, line 779). `sessionReportsRoot` is one of the three prongs, so a file written to `session-reports/<setting>/<campaign>/prompts/` is in scope for validation.

**It exits silently only when the file carries no `type`.** Line 905:

```js
const parsed = parseFrontmatter(fileContent);
if (!parsed || parsed.data.type === undefined || parsed.data.type === null) {
  process.exit(0);
}
```

**Therefore prompt files must carry no `type` field.** A typeless file exits at line 905 before any rule runs, which is the outcome we want. A file that does carry `type` proceeds into the rule set, where `frontmatterTypeEnum` in `professor-orb/references/base-rules.json` (enforcement `block`) rejects any value outside its twenty-entry list of article types and homebrew artifact keys. There is no prompt value in that list, so `type: Prompt` would be blocked on write. This is the same trap `content/SKILL.md` line 16 already warns about for content files.

**`/log` already covers the new directory.** `commands/log.md` line 43 defines the lane as `<sessionReportsRoot>/<campaign>/` recursively. A `prompts/` subdirectory needs no pathspec change, only a documentation update, because the same line enumerates the lane's contents and currently names "prompt sidecars."

**The preamble count in `CLAUDE.md` is currently off by one, and this change fixes it by accident.** `CLAUDE.md` states all 19 components carry the SHARED-PRINCIPLES preamble. `grep -rl` finds 18: 8 skills, 4 agents, 6 commands. Adding `forge-prompt` makes the real count 19, so the stated number becomes correct on its own. The action is to verify the count after the change and leave the number at 19, **not** to bump it to 20.

## Design decisions and why

### The new component is a skill, not a command

Professor-orb's own taxonomy: commands are precise, repeatable capture and commit steps ("capture is a command, not a reminder"); skills are judgment craft. Prompt-forging is craft. It is still invocable as `/forge-prompt`, the same way `orb` is a skill invoked as `/orb`.

### No new persistent state, and no visual registry

Two principles decide this.

**Principle 7, never invent canon.** Locking a visual descriptor such as "brass-buttoned charcoal coat" mints canon the table never established, because the image model needed something on the torso. Writing that back into a KB article would let a generator author the DM's lore.

**Principle 8, scope discipline.** The principle states that professor-orb's conventions call for exactly one auxiliary document, the migration manifest, "and it licenses no scratch file, no execution log, and no second manifest anywhere else." A visual registry in `.professor-orb/` would be exactly that second exception. It also could not live there cleanly: `setup/SKILL.md` line 63 gitignores `.professor-orb/tag-registry*.json` as derived, and a locked descriptor is authored and not re-derivable, so it would have to sit in the committed tier where no lane command owns it.

**The resolution: the prompt corpus is the registry.** Before drafting for a subject, `forge-prompt` reads its own prior prompts for that subject and reuses the descriptors already locked there. The files are the skill's specified output rather than an auxiliary document, so Principle 8 is satisfied. This is the homebrew catalog's pattern, which `CONTEXT.md` already blesses: it serves double duty as the DM's record and as few-shot exemplars the skill matches against when drafting.

Precedence is fixed: KB canon outranks the corpus. The corpus holds only the rendering delta the generator needed.

### House style comes from CLAUDE.md, not a new file

Campaign visual tone is the sibling of writing style, which `content` already reads from `CLAUDE.md`. Per the root `CLAUDE.md`, professor-orb reads campaign facts, writing style, and content exclusions from the consumer's `CLAUDE.md` and never structure. Visual tone is a campaign fact. No new file.

### content and forge-prompt are decoupled in both directions

`content` does not call `forge-prompt`, does not emit a slot spec, and does not record dimensions. It mentions the skill and stops. `forge-prompt` reads nothing that `content` produced.

The alternative considered and rejected was preserving `content`'s guarantee ("never produce an image slot without a matching prompt sidecar") by having `content` invoke `forge-prompt` during Phase 3. Rejected because the guarantee is downstream of the dead dimension spec. Once dimensions are not tracked, there is nothing for `content` to hand over.

### The iterative loop is native to forge-prompt

Modeled on the DM's own `ultimate-prompt-creator` skill. The portable mechanism is that **Suggestions are approved by default** and **Questions are blocking-only**, which inverts who generates improvement ideas. `content`'s current Phase 4a is show, wait, hear feedback, show again; the DM supplies every improvement. The loop makes the skill supply them and treats silence as assent.

This directly addresses the DM's stated experience that the first output is usually wrong and gets refined across several rounds of visual review.

## Part 1: the forge-prompt skill (new)

### Files

```
professor-orb/skills/forge-prompt/
  SKILL.md
  references/flux2-prompting.md
  references/flux2-editing.md
```

Two reference files keep `SKILL.md` lean, matching `homebrew`'s three-reference layout.

### Frontmatter and preamble

`name: forge-prompt`. Description follows house form: long, trigger-rich, naming the invocation phrases ("write a prompt for", "make an image of", "fix this prompt", "edit this image", "/forge-prompt") and stating pipeline position explicitly.

Opens with the standard preamble line reading `../SHARED-PRINCIPLES.md`.

*Naming note for DM review:* every other skill in the plugin is a single noun (content, debrief, prep, chronicler, timeline, homebrew, setup, orb). `forge-prompt` breaks that pattern. Retained because it is self-describing and already the DM's working name. Overridable.

### Standalone status

Standalone, like `homebrew`, `timeline`, and `/catalog`. Not part of the debrief, prep, content, chronicler, kb-validator pipeline. **Never writes `.professor-orb/pipeline-state.json`.** Stated in the description, in the body, and in "Things to never do," matching how the other standalone components state it.

### Conventions handling

Check `.professor-orb/conventions.json` first, as every skill does. Prompt files are working files for the table, not KB canon: no `type`, no index participation, no frontmatter schema beyond a plain subject/mode/date header. If `conventions.json` is silent on them, say so and do not invent structural rules, mirroring `content/SKILL.md` lines 14 to 16. Do not force them into the base type enum.

### Three entry modes

Detected at Step 0, before anything else.

| Mode | Trigger | Opening question |
|---|---|---|
| **Forge** | A subject and no existing image. Default when ambiguous. | What is the image for, and where will it be used? |
| **Edit** | An approved image in hand plus a change to make. | What should change, and what must stay exactly as it is? |
| **Diagnose** | A prompt that produced a disappointing result. | What did it produce versus what you wanted? |

Diagnose prepends a one-time diagnosis (which principles the prompt violates or skips, stated specifically) before the first Revised Prompt, then joins the normal loop.

### Grounding, before round one

In this order:

1. **The subject's KB article,** if the subject is a KB entity, for canonical appearance. Content exclusions apply; `block-excluded.mjs` enforces them at PreToolUse regardless.
2. **Prior prompts** in the campaign's `prompts/` directory naming the same subject, for descriptors already locked.
3. **`CLAUDE.md`** for campaign visual tone and any house style the DM has recorded.

Explicit clause in the skill: a rendering choice invented to satisfy the generator is **not canon** and never travels back into the KB. If the KB later contradicts a locked descriptor, the KB wins and the skill says the corpus entry is stale rather than quietly contradicting it.

### The loop

Every round after the opening question produces three sections, in this order:

**Revised Prompt.** Complete, copy-paste ready. Written per `references/flux2-prompting.md`, and for Edit mode carrying preservation clauses and `image [n]` notation per `references/flux2-editing.md`. Never a negative prompt.

**Suggestions.** Two to four, ordered by impact. **Approved by default**: applied surgically in the next Revised Prompt unless the DM says otherwise. Each states what it changes and why it would improve the result. Anything the skill cannot act on without more information is a Question, not a Suggestion.

**Questions.** One to three, blocking only. If it does not block progress, it is a Suggestion.

**Never stall.** A Revised Prompt every round. On a vague or incomplete answer, make a reasonable inference, state it explicitly in the prompt, and raise it as a Question only if it is high-stakes. On a contradiction, acknowledge briefly, update, and do not drag it forward.

### The test closes out-of-band

The in-thread test phase from `ultimate-prompt-creator` has no analog here, because the skill cannot render Flux. It does not need one. When the Revised Prompt stabilizes, `forge-prompt` tells the DM to go generate and bring back the result. Returning with a result is a Diagnose re-entry, which closes the loop through the DM's real ComfyUI run rather than a simulation.

Offered once, when Questions thin out. Not every round.

### Stop condition and the write gate

The loop is complete when the DM says so, or when Questions has nothing blocking left and Suggestions has nothing materially impactful left. Do not declare done prematurely on a "looks good" that leaves obvious gaps: incorporate the outstanding Suggestions, ask the single most important remaining Question, and tighten.

**Nothing hits disk mid-loop.** Principle 2, propose then execute. When the loop closes, present the final prompt, ask whether to save it, and on approval write to:

```
<sessionReportsRoot>/<campaign>/prompts/PROMPT-YYYY-MM-DD-<Subject>.md
```

Frontmatter carries subject, mode, and date. **No `type` field**, per the verified constraint above. `/log` commits it.

The DM may decline to save. A prompt used once and discarded is a legitimate outcome and the skill does not insist.

### Reference file contents

**`references/flux2-prompting.md`:** prompt anatomy (subject, action, style, context), word-order weighting, the no-negative-prompts rule and positive-description technique, length bands, photorealistic style vocabulary, typography and quoted text, hex-code prompting and gradients, JSON structured prompting with its base schema, multi-language notes, sequential-art consistency, aspect ratios and resolution limits, and the parameter quick reference.

**`references/flux2-editing.md`:** virtual try-on and garment-edit patterns, preservation language, `image [n]` multi-reference notation and per-image role description, multi-reference composition, and scene-plus-outfit compound edits.

Both carry a source attribution to the BFL documentation and a staleness note, because this is the material that drifts and the drift is what motivated the split.

### Things to never do

- Never write a negative prompt.
- Never write `.professor-orb/pipeline-state.json`.
- Never write a rendering choice back into a KB article.
- Never invent canon to fill a visual gap. Ask, or describe around the absence.
- Never write a prompt file carrying a `type` frontmatter field.
- Never save mid-loop.
- Never draw on excluded material.

## Part 2: content skill reductions

All in `professor-orb/skills/content/SKILL.md`.

### Removals

| Location | What goes |
|---|---|
| line 3 (description) | "Any output with an image slot gets a matching prompt sidecar for image generation." |
| line 145 | The trailing "use an image slot (below) instead" points at the section being deleted. Repoint it at the new placeholder guidance. |
| lines 156 to 164 | The entire `### Prompt sidecar` section |
| line 176 | "and, if HTML, whether it needs an image slot" as a format sub-question |
| line 198 | "If an image slot was requested, size the placeholder and draft its prompt sidecar now" |
| line 206 | Self-check: "does the sidecar's dimensions match the HTML slot exactly?" |
| line 212 | "along with its prompt sidecar if one exists" |
| line 216 | "and prompt sidecars" in the index-participation sentence |
| line 244 | Never-do: "Never produce an image slot without a matching prompt sidecar..." |
| line 251 | "and any prompt sidecars" in the outputs list |

Roughly 20 lines net removed.

### Addition

Approximately three lines, in the Output formats section. When a piece calls for art, `content` leaves a visibly marked placeholder block in the HTML with no prescribed dimensions, and its closing summary (Step 4c) names which pieces carry one and says that `/forge-prompt` writes the prompt. `content` never asks about dimensions, never asks whether an image slot is wanted as a formatting decision, and never writes a prompt file.

### Unchanged

Everything else. The four content types, all voice and length rules, all three output formats, the historian handoff for timeline visualizations, the approval gate, and the pipeline-state write.

## Part 3: collateral updates

| File | Change |
|---|---|
| `professor-orb/skills/orb/SKILL.md` | New component-table row for `forge-prompt`. Add to the standalone list in the description, in the "What professor-orb is" standalone line, and in the "What to run next" standalone sentence. Not added to the pipeline. |
| `professor-orb/CONTEXT.md` | Retire or rewrite the **prompt sidecar** entry, which currently defines content's now-removed output. Add a **forge-prompt** entry defining the skill, its three modes, the corpus-as-registry rule, and the canon boundary. |
| `professor-orb/commands/log.md` | Line 43 lane enumeration: replace "prompt sidecars" with the `prompts/` subdirectory. Line 2 description and line 16 may need the same. No pathspec change. |
| `CLAUDE.md` (root) | Correct the preamble count from 19 to 19 by way of 18 plus the new skill, that is, state the true post-change count and stop carrying the off-by-one. |
| `professor-orb/.claude-plugin/plugin.json` | Version 1.11.0 to 1.12.0. |
| `.claude-plugin/marketplace.json` | Version 1.11.0 to 1.12.0. Must match plugin.json. |

## Testing

Professor-orb's test suites are Node built-ins covering executable code: `migrate.mjs`, the hooks, lane staging. A skill is markdown and has no unit surface, so this change adds no test file, consistent with the other eight skills.

The change touches no executable code, so all eight existing suites must still pass unchanged:

```
for f in $(find professor-orb -name "*.test.mjs" | sort); do node "$f" || break; done
```

The one most relevant to this change, since it covers the `type`-field constraint above:

```
node professor-orb/hooks/validate-write.test.mjs
```

Manual verification, in a consumer project:

1. Run `content` on a session report and confirm no sidecar is produced and no dimension question is asked.
2. Run `/forge-prompt` in Forge mode, complete a loop, save, and confirm the write-time hook stays silent (no `type` field).
3. Run `/log` and confirm the prompts file is committed inside the campaign lane.
4. Run `/forge-prompt` in Diagnose mode against the saved prompt and confirm the corpus read finds it.

## Risks

**The reference files go stale.** This is the failure the split is meant to contain, not eliminate. Containment is that stale Flux knowledge now sits in two clearly labeled reference files with source attribution rather than scattered through a skill about read-aloud prose. Refreshing is a bounded task.

**Prompt files accumulate in the campaign lane.** The corpus is the consistency mechanism, so growth is the point, but a campaign with many generated images will collect many files. No index, no threshold, no split rule applies to them, since they are working files rather than KB articles. If the pile becomes unmanageable, that is a real signal and the fix is a follow-on, not a pre-emptive constraint.

**Cross-campaign identity is unsolved.** A recurring NPC appearing in two campaigns in the same world has a corpus split across two campaign folders, so the second campaign's first prompt will not find the first campaign's descriptors. Accepted deliberately: the alternative was a setting-level location that `/scribe` would have to commit outside its own lane, which is precisely what the lane model exists to prevent. Named here so it is a decision rather than an oversight.

## Deliberately out of scope

**The iterative loop retrofit for `content`.** It is a good idea and it is a separate spec. Two reasons for the separation:

1. This change's purpose is to shrink `content`. Adding a new process to the same file in the same commit produces a diff that is simultaneously a removal and a rewrite, and the two would not be independently revertible. This plugin cares about clean undo; `/migrate`'s contract is two reverts in order.
2. `content`'s approval gate is a **mutation** gate under Principle 2, not a drafting checkpoint. The loop would sit before it, not replace it. And `content` produces several artifacts per run, so loop-per-artifact has a turn-cost question that does not arise in `forge-prompt`. Both are worth designing properly with the benefit of having actually used the loop in `forge-prompt` first.

**Deeper ComfyUI integration.** `CONTEXT.md` already flags this as a future investigation. The DM generates manually; the skill writes text.
