# forge-prompt: What a Question Is

**Date:** 2026-08-18
**Status:** Approved, not yet implemented
**Scope:** `professor-orb/skills/forge-prompt/SKILL.md`, `professor-orb/skills/forge-prompt/references/flux2-prompting.md`, `professor-orb/CONTEXT.md`.
**Extends:** `2026-08-18-forge-prompt-style-gate-and-suggestions-design.md`. That document gave the Suggestions block a positive definition and left the Questions block untouched. This one applies the same treatment to Questions. Nothing in it is superseded.

## What went wrong in 1.15.0

Every Forge session opens with a variant of the same question, reported verbatim by the DM:

> Where does this end up, and at what size? Handout, VTT token, Discord post, print? That sets the aspect ratio, which I will write into the prompt.

Three defects, and the third is what makes it insistent.

1. **The question is answerable and worthless.** Aspect ratio is a ComfyUI node setting, not prompt text. Nothing the DM answers here reaches the deliverable. The clause "which I will write into the prompt" is false on its face, and the skill states it confidently every session.

2. **The 08-09 design already ruled on this and the ruling was not applied here.** That document called aspect ratio, dimensions, format, and destination *"dead spec"* for `content`: "chosen on the fly and revised during visual review. The skill's first guess is usually wrong and gets renegotiated. Nothing downstream tracks these numbers." `content/SKILL.md` carries the fix and refuses to prescribe dimensions. The same document then made destination and size the first priority of forge-prompt's Questions block.

3. **Three rules stack into a standing order to ask something.** `### Questions` opened "One to three, and only what blocks progress," setting a floor of one. `## The loop` mandates "exactly three blocks per round, and only these three." The priority list then named destination and size first. On a round with nothing genuinely blocking, the skill is required to produce a Question and told where to find one. It complies, correctly, with the rules as written.

Defect 3 is defect 2 of the 08-18 spec in a different block: "The block had no positive definition of what a Suggestion *is*, so the prohibition was the only guidance and it pointed at the wrong things." Questions had no positive definition either. It had a priority list, which is worse than a prohibition, because it points at the wrong things affirmatively.

## Design decisions and why

### A Question resolves an ambiguity, never an absence

This is the positive definition, and it is the whole enforcement mechanism. Something the DM has already said reads two ways, the two readings produce different images, and no source settles which was meant. A detail nobody has mentioned is not ambiguous. It is missing, and missing detail is already a Suggestion adopted by silence.

The line falls exactly where the DM drew it: the purpose of a Question is to gain clarity, not to collect a fact. Facts arrive through grounding, or through Suggestions the DM lets stand.

This makes the destination question structurally impossible rather than forbidden. It is not a reading of anything the DM said, and it is not part of the prompt, so no rule needs to name it. Consistent with the 08-18 finding that naming a thing to exclude it is what keeps it available.

### The ambiguity lives in the four-part frame

`references/flux2-prompting.md` defines the frame a FLUX.2 prompt is built from: **subject**, **action**, **style**, **context**. Scoping Questions to those four does two things. It ties the block to the material the prompt is actually made of, which is what the DM asked for. And it gives the model somewhere to look that is not a priority list of dead settings.

"You said the tower fell: is this mid-collapse, or the ruin years after?" is an action fork, and the two prompts share almost no words. "Is he bearded?" is not a fork; nobody said anything about his face.

### The floor drops to zero

"One to three" is replaced by "Zero to three." Zero is the normal state once the readings are settled. The three-block structure is unchanged and still hard: the heading stays and carries "None blocking." An empty Questions block is a finished round, not a lazy one, and saying so in the skill is what stops the model treating the heading as a quota.

### The counter-example replaces the example

The shipped text illustrates "a Question asks; it does not assert" with *"clean-shaven, or bearded?"* Under this definition that was never a Question at all. It becomes the counter-example, because it is the clearest available case of an absence wearing a question's grammar.

### No new never-do entry

Not "never ask about destination," not "never ask about size," not "never ask about aspect ratio." The 08-18 spec established why: a rule spelled "never propose X" ships an example of X into the context where it matters. The definition is the fence.

### The reference file loses what the skill cannot act on

`references/flux2-prompting.md` documents aspect ratios, resolution limits, seed, guidance, and steps. None are prompt text, so none can be a Suggestion, and none are a reading fork, so none can be a Question. They are unreachable material sitting in the file the skill reads every round, and they are where this regrew from. Both tables are cut.

The cost accepted: the reference becomes a curated subset of the BFL guide rather than a mirror of it. Paid for by a positive scope line in the header note, so a future refresh knows what belongs without a list of what does not.

## What ships

### `professor-orb/skills/forge-prompt/SKILL.md`

**Frontmatter description.** "and at most three questions, asked only when they block progress" becomes "and at most three questions, asked only to settle an ambiguity in what the DM has already said."

**Step 0, Forge mode.** The opener line is replaced:

> **Forge.** A subject, and no image yet.
> Open with the one fork the DM's message leaves open: "Is this a portrait of them, or a scene they are in?" It sets subject, action, and context at once, and the two readings share almost no prompt text. When the message already answers it, skip it and resolve the style.

**`### Questions`.** The section is replaced in full:

> ### Questions
>
> **A Question resolves an ambiguity, never an absence.** Something the DM has already said reads two ways, the two readings produce different images, and no source settles which one they meant. That is the entire class. A detail nobody has mentioned is not ambiguous, it is missing, and missing detail is a Suggestion adopted by silence.
>
> The ambiguity sits in one of the four parts a FLUX.2 prompt is built from: **subject**, **action**, **style**, **context**. "You said the tower fell: is this mid-collapse, or the ruin years after?" is an action fork, and the two prompts share almost no words. "Is he bearded?" is not a fork. Nobody said anything about his face, so it is an add.
>
> Zero to three per round. Zero is the normal state once the readings are settled, and a round with no Questions is a finished round rather than a lazy one. Keep the heading and write "None blocking" under it.
>
> **A Question asks; it does not assert.** Naming both readings is the point. Stating an unconfirmed detail as settled while appearing to ask about something else is not.

**Loop rules, "Never stall."** The parenthetical loses its first two items:

> On a vague or incomplete answer about which of two readings you meant, make a reasonable inference, state it explicitly, and raise it as a Question only if getting it wrong would be expensive.

The rest of that bullet, from "**This license stops at the subject's appearance**" onward, is unchanged.

### `professor-orb/skills/forge-prompt/references/flux2-prompting.md`

Cut `## Aspect ratios and resolution` and `## Parameters` entirely. The header note gains this sentence, appended to its existing paragraph:

> This file covers prompt text. Generator settings live in ComfyUI and are the DM's, not this skill's.

### `professor-orb/CONTEXT.md`

The forge-prompt entry defines a Suggestion and says nothing about a Question. Add the definition for parity, immediately after the sentence ending "in the DM's own words":

> A Question resolves an ambiguity in what the DM already said, never an absence, and an absence is a Suggestion.

### Untouched

The Suggestions block, the three-block structure, Step 1's style gate, Step 2 grounding, the write gate, the never-do list, `README.md`, and `skills/orb/SKILL.md`. No executable code is involved.

## Verification

```bash
cd professor-orb/skills/forge-prompt && grep -c 'A Question resolves an ambiguity, never an absence' SKILL.md; grep -ci 'where will it end up\|at what size\|where the image goes' SKILL.md; grep -c 'Zero to three' SKILL.md; grep -ci 'One to three' SKILL.md
```

Expected, in order: `1`, `0`, `1`, `0`. The second is the regression check that matters: any count above zero means a destination or size prompt survived somewhere in the file.

```bash
grep -ci 'aspect ratio\|Guidance (flex)' professor-orb/skills/forge-prompt/references/flux2-prompting.md
```

Expected: `0`.

The loop must still expose exactly three output blocks:

```bash
sed -n '/^## The loop/,/^## The test runs/p' professor-orb/skills/forge-prompt/SKILL.md | grep '^### '
```

Expected: `Revised Prompt`, `Suggestions`, `Questions`, and `Loop rules`, which is guidance rather than an output block.

No Node test suite covers forge-prompt. The eight suites are unaffected and should pass unchanged.

## Not done here

The plugin version is not bumped. `marketplace.json` and `professor-orb/.claude-plugin/plugin.json` both read `1.15.0` and match. Releasing is the DM's call.
