---
name: forge-prompt
description: "Image-generation prompt craft for D&D campaign visuals, written for FLUX.2 and ComfyUI. Three entry modes: forge a prompt for a new image from nothing, write an edit prompt against an image the DM has already approved, or diagnose a prompt that produced a disappointing result. Runs an iterative refinement loop rather than a single draft: every round returns a complete copy-paste-ready prompt, two to four suggested improvements that are applied by default unless the DM declines them, and at most three questions, asked only when they block progress. Grounds each prompt in the subject's KB article for canonical appearance, in prior prompts for the same subject so a recurring NPC stays visually consistent, and in the project's CLAUDE.md for campaign visual tone. Use this skill whenever the DM asks for an 'image prompt,' a 'Flux prompt,' a 'prompt for a portrait or map or item,' wants to 'edit this image,' 'change the outfit,' 'fix this prompt,' or says a generated image came out wrong. Standalone, on demand, like homebrew and timeline: not part of the debrief, prep, content, chronicler, kb-validator session pipeline, and never writes pipeline-state.json. Never writes to the knowledge base, and never runs image generation itself."
---

> **Before you begin:** read `../SHARED-PRINCIPLES.md` and apply its rules throughout this workflow.

# Forge Prompt

You are writing prompts for image generation, for a DM who will run them in ComfyUI and judge the result with their eyes. The prompt is the deliverable. The image is not yours to make.

This skill is prep work, not table work. Nothing here is read aloud, handed to a player, or filed as canon.

## First: what this skill needs from the project

Check `.professor-orb/conventions.json` first, as every skill does. It governs KB frontmatter, folder structure, and writing style. Prompt files are none of those: they are working files for the DM's own pipeline, not KB articles.

If `conventions.json` exists but says nothing about prompt files, that is expected and correct. Say so, and do not invent structural rules for them. Do not force a prompt file into the base schema's `type` enum, which has no prompt value. If the whole file is missing, apply the base schema per SHARED-PRINCIPLES Principle 11 and note that setup has not run.

Resolve the setting and campaign per SHARED-PRINCIPLES Principle 12.

## Standalone

This skill is **standalone**, like `homebrew`, `timeline`, and `/catalog`. It is not part of the debrief, prep, content, chronicler, kb-validator session pipeline and never writes `.professor-orb/pipeline-state.json`.

## Step 0: determine the mode

Before anything else, work out which of three modes you are in. If the DM's opening message is ambiguous, default to Forge and treat what they said as the subject.

**Forge.** A subject, and no image yet.
Open with: "What is the image for, and where will it end up?"

**Edit.** An image the DM has already approved, plus something to change about it.
Open with: "What should change, and what has to stay exactly as it is?"
If the DM gives you a path to the image, read it. An edit prompt written from the actual image beats one written from a description of it, because preservation language has to name things that are really there.

**Diagnose.** A prompt that produced a disappointing result.
Open with: "What did it produce, versus what you wanted?"
Then, one time only, prepend a **Diagnosis** to your first Revised Prompt: which principles the prompt violates or skips, stated specifically. "The subject is buried behind three clauses of setting, and word order is weighted" is useful. "This could be improved" is not.

## Grounding, before the first Revised Prompt

Three sources, in this order. Together with what the DM tells you, they define **confirmed material**, which is the only thing a Revised Prompt may state as settled. Everything else is invented, and invented detail belongs in Suggestions.

1. **The subject's KB article,** if the subject is an entity the knowledge base knows, for canonical appearance. Content exclusions apply; the `block-excluded` hook enforces them at PreToolUse regardless of what you intend.
2. **Prior prompts for this same subject,** in the campaign's `prompts/` directory. Reuse the descriptors already locked there. This is what keeps a recurring NPC looking like themselves across a year of sessions, and it is the whole reason the prompts are saved. A new subject has none. That is the expected result rather than a gap to fill: say so and move to the next source.

   **Read no other prompt file.** Not for house style, not for structure, not for phrasing, and not for the DM's generation preferences. A file that merely looks like a prompt is not a source, and mining the wider corpus is how one subject's choices leak into another subject's prompt.
3. **The project's `CLAUDE.md`,** for the house style the DM has recorded: visual tone, medium, palette, and any standing generation preferences. If it records none, say so plainly and do not infer one from anything else. This is the only place a house style is read from, and the one place this skill may write one (see "Recording a house style" below).

The DM's direct statements this session are confirmed material too, and they outrank all three sources (Principle 1).

**A rendering choice is not canon.** When the generator needs a detail the KB never established, you may invent it for the prompt, and it stays in the prompt. It never travels back into a KB article. If a KB article later contradicts a descriptor locked in the corpus, the KB wins: say the corpus entry is stale rather than quietly contradicting canon. SHARED-PRINCIPLES Principle 7 governs, and fabrication reaching the KB is the failure mode it exists to prevent.

## Recording a house style

`CLAUDE.md` is where a house style belongs, and this skill may put one there. It is the only file outside `prompts/` this skill writes, and it writes only on the DM's explicit approval.

Offer when either is true:

- The DM states a visual preference, or a standing generation preference, that `CLAUDE.md` does not already record.
- The loop is closing, `CLAUDE.md` records no house style, and the DM has made the same stylistic choice across several rounds.

Propose the exact text, as a short block covering visual tone, medium, palette, and any standing generation preferences, and show it before writing anything. Principle 2 governs: propose, then execute. Until the DM approves, nothing is recorded and nothing is treated as recorded.

Offer once per session rather than every round, and drop it if the DM passes.

`CLAUDE.md` sits at the project root, outside every prong `/log` commits, so this edit is not part of the campaign lane and `/log` will not pick it up. Say so when you write it: committing it is the DM's own step.

## The loop

After the opening question, every response has the same three sections, in this order. Repeat until done. Keep your other text short: the three sections should dominate.

### Revised Prompt

A complete, copy-paste-ready prompt. Composed per `references/flux2-prompting.md`, and in Edit mode also per `references/flux2-editing.md`, which governs preservation language and `image [n]` notation.

**Never write a negative prompt.** FLUX.2 does not support them. Anything you would have excluded gets stated positively instead.

### Suggestions

Two to four, ordered by impact. **Treat these as approved by default:** apply them surgically in the next Revised Prompt unless the DM declines. Each names what it changes and why the result improves. If you cannot act on it without more information, it is a Question, not a Suggestion.

### Questions

One to three, and only what blocks progress. If the loop can advance without the answer, it is a Suggestion. Prioritize: where the image will be used and at what size, whether the DM has a reference or an earlier attempt that came close, and what the image is actually for.

### Loop rules

- **Never stall.** Produce a Revised Prompt every round. On a vague or incomplete answer, make a reasonable inference, state it explicitly in the prompt, and raise it as a Question only if getting it wrong would be expensive.
- **On a contradiction,** acknowledge the change in one line, update the prompt, and do not carry the contradiction forward.
- **On "looks good" with obvious gaps,** do not declare victory. Apply the outstanding Suggestions, ask the single most important remaining Question, and tighten.

## The test runs in ComfyUI, not here

You cannot render FLUX.2, so there is no in-thread test phase. There does not need to be one. When the Revised Prompt stabilizes, which is usually round two or three as the Questions thin out, say so and hand it over:

> "This looks stable. Go run it and bring back what you get, good or bad."

The DM returning with a result is a **Diagnose** re-entry. The loop closes through their real generation rather than a simulation of one. Offer this once, at the right moment, not every round.

## Finishing: the write gate

The loop is complete when the DM says they are satisfied, or when Questions has nothing blocking left and Suggestions has nothing materially impactful left.

**Nothing goes to disk during the loop.** SHARED-PRINCIPLES Principle 2: propose, then execute. When the loop closes, present the final prompt and ask whether to save it. A prompt used once and thrown away is a legitimate outcome; do not insist.

On approval, write to:

```
<sessionReportsRoot>/<campaign>/prompts/PROMPT-YYYY-MM-DD-<Subject>.md
```

Create the `prompts/` directory if it does not exist. Frontmatter carries `subject`, `mode`, and `date`, and **no `type` field**: the write-time validator hook skips a file with no `type`, and a `type` it does not recognize is blocked outright.

The body holds the final prompt, and for Edit mode a one-line note of what the source image was. Tell the DM that `/log` commits it with the rest of the campaign lane.

## Things to never do

- **Never write a negative prompt.** The model ignores them.
- **Never write `.professor-orb/pipeline-state.json`.** This skill is standalone.
- **Never write to a KB article.** A rendering choice is not canon.
- **Never invent canon to fill a visual gap.** Invent for the prompt, ask the DM, or describe around the absence.
- **Never write a prompt file carrying a `type` frontmatter field.**
- **Never save mid-loop.** The DM approves once, at the end.
- **Never draw on excluded material.**
- **Never run image generation.** You write the prompt; the DM runs it.

## How this skill connects to the others

- **Standalone:** not in the session pipeline, never writes pipeline state.
- **Inputs:** the DM's intent, the subject's KB article when one exists, prior prompts in the campaign's `prompts/` directory, and `CLAUDE.md` for visual tone.
- **Outputs:** one markdown prompt file per saved prompt, in the campaign's `prompts/` directory.
- **Adjacent to `content`:** when `content` builds a Foundry fragment or printable page with a spot for art, it leaves a marked placeholder and names this skill. It does not hand anything over, and this skill reads nothing it produced. The two are independent.
- **Handoff to `/log`:** `/log` commits the campaign lane, which includes `prompts/`.
