---
name: forge-prompt
description: "Image-generation prompt craft for D&D campaign visuals, written for FLUX.2 and ComfyUI. Three entry modes: forge a prompt for a new image from nothing, write an edit prompt against an image the DM has already approved, or diagnose a prompt that produced a disappointing result. Resolves a visual style before drafting anything: the style the DM names, the house style recorded in the project's CLAUDE.md, a recorded opt-out, or one built with the DM on the spot and offered to the campaign's style catalog. Then runs an iterative refinement loop rather than a single draft, and every round returns exactly three blocks: a complete copy-paste-ready prompt, two to four suggestions that each add, edit, or delete specific text in that prompt, and at most three questions, asked only to settle an ambiguity in what the DM has already said. A suggestion the DM declines is dropped, one they leave alone is adopted, and a counter-offer replaces it in the DM's own words. The prompt states only what a source confirms: the subject's KB article for canonical appearance, prior prompts for that same subject so a recurring NPC stays visually consistent, the resolved style, and what the DM says. Invented detail is offered as a suggestion instead, so the DM keeps creative license over their own subject. Use this skill whenever the DM asks for an 'image prompt,' a 'Flux prompt,' a 'prompt for a portrait or map or item,' wants to 'edit this image,' 'change the outfit,' 'fix this prompt,' or says a generated image came out wrong. Standalone, on demand, like homebrew and timeline: not part of the debrief, prep, content, chronicler, kb-validator session pipeline, and never writes pipeline-state.json. Never writes to the knowledge base, and never runs image generation itself."
---

> **Before you begin:** read `../SHARED-PRINCIPLES.md` and apply its rules throughout this workflow.

# Forge Prompt

You are writing prompts for image generation, for a DM who will run them in ComfyUI and judge the result with their eyes. The prompt is the deliverable. The image is not yours to make.

This skill is prep work, not table work. Nothing here is read aloud, handed to a player, or filed as canon.

## First: what this skill needs from the project

Check `.professor-orb/conventions.json` first, as every skill does. It governs KB frontmatter, folder structure, and writing style. Prompt files and style files are none of those: they are working files for the DM's own pipeline, not KB articles.

If `conventions.json` exists but says nothing about prompt files or style files, that is expected and correct. Say so, and do not invent structural rules for them. Do not force either into the base schema's `type` enum, which has no value for them. If the whole file is missing, apply the base schema per SHARED-PRINCIPLES Principle 11 and note that setup has not run.

Resolve the setting and campaign per SHARED-PRINCIPLES Principle 12.

## Standalone

This skill is **standalone**, like `homebrew`, `timeline`, and `/catalog`. It is not part of the debrief, prep, content, chronicler, kb-validator session pipeline and never writes `.professor-orb/pipeline-state.json`.

## Step 0: determine the mode

Before anything else, work out which of three modes you are in. If the DM's opening message is ambiguous, default to Forge and treat what they said as the subject.

**Forge.** A subject, and no image yet.
Open with the one fork the DM's message leaves open: "Is this a portrait of them, or a scene they are in?" It sets subject, action, and context at once, and the two readings share almost no prompt text. When the message already answers it, skip it and resolve the style.

**Edit.** An image the DM has already approved, plus something to change about it.
Open with: "What should change, and what has to stay exactly as it is?"
If the DM gives you a path to the image, read it. An edit prompt written from the actual image beats one written from a description of it, because preservation language has to name things that are really there.

**Diagnose.** A prompt that produced a disappointing result.
Open with: "What did it produce, versus what you wanted?"
Then, one time only, prepend a **Diagnosis** to your first Revised Prompt: which principles the prompt violates or skips, stated specifically. "The subject is buried behind three clauses of setting, and word order is weighted" is useful. "This could be improved" is not.

## Step 1: resolve the style

**The style is settled before a Revised Prompt exists.** It sets medium, palette, lighting, and mood, which are the opening words of the prompt rather than a coat of paint applied to a finished one. Resolving it afterward means rewriting the prompt you just handed over.

The catalog lives at:

```
<sessionReportsRoot>/<campaign>/prompts/styles/STYLE-<Name>.md
```

`CLAUDE.md` records which of them is the house style, one line per campaign, or records that the DM has opted out. It holds the pointer; the catalog holds the content.

Resolve exactly one of four outcomes from the DM's opening message:

| What the opening message does | What you do |
|---|---|
| Names a style the catalog has | Read that file. It is the resolved style. |
| Names no style, and `CLAUDE.md` records a house style for this campaign | Read that file. It is the resolved style. Say which one you took. |
| Names no style, and `CLAUDE.md` records an opt-out | No style. Proceed to Step 2 without one, and do not offer to record one. |
| Names a style the catalog does not have, or nothing is recorded either way | Build one with the DM now, per "Building a style" below. |

**A recorded opt-out and a missing record are different states, and looking for a style cannot tell them apart.** An opt-out is a line in `CLAUDE.md` saying the DM declined. A missing record is silence. Treat only the written line as an opt-out; where there is silence, the DM has not been asked yet.

**A pointer to a file the catalog does not have is a stale pointer, not an opt-out.** Say the recorded style is missing, and build one.

### Building a style

Two or three questions, no more: the medium (oil painting, ink drawing, photograph, whatever it is), the palette or the mood, and any standing look the DM wants across every image. Propose the style as a short block, show it, and take their corrections.

Once it is settled, the loop starts. Offering to save it comes at the close, not now, per "Finishing" below. A style used once and never saved is a legitimate outcome.

### Style file shape

Frontmatter carries `name` and `date`, and **no `type` field**: the write-time validator hook skips a file with no `type`, and a `type` it does not recognize is blocked outright. The body describes medium, palette, lighting and mood, and anything else the DM wants standing across their images.

## Step 2: grounding, before the first Revised Prompt

Two sources, in this order. Together with the style resolved in Step 1 and what the DM tells you, they define **confirmed material**, which is the only thing a Revised Prompt may state as settled. Everything else is invented, and invented detail is offered as a Suggestion.

1. **The subject's KB article,** if the subject is an entity the knowledge base knows, for canonical appearance. Look in `kbRoot` and in the campaign's `articles/` folder, where `chronicler` stages new articles on a session-driven run; an entity canonized in the last session is normally staged rather than published. Say which of the two you found it in, so the DM knows the article's status. Content exclusions apply; the `block-excluded` hook enforces them at PreToolUse regardless of what you intend.
2. **Prior prompts for this same subject,** in the campaign's `prompts/` directory. Reuse the descriptors already locked there. This is what keeps a recurring NPC looking like themselves across a year of sessions, and it is the whole reason the prompts are saved. A new subject has none. That is the expected result rather than a gap to fill: say so and move on.

   **Read no other prompt file.** Not for style, not for structure, not for phrasing, and not for the DM's generation preferences. A file that merely looks like a prompt is not a source, and mining the wider corpus is how one subject's choices leak into another subject's prompt. Styles come from the catalog, which is read by name.

The DM's direct statements this session are confirmed material too, and they outrank every source (Principle 1).

**Say what grounding found, in one line, before the first Revised Prompt only.** Which style you resolved and where it came from, whether the subject has a KB article and, if so, whether it came from `kbRoot` or the campaign's staged `articles/` folder, whether prior prompts exist. The DM cannot correct a source they never saw you take, and a silent grounding step is indistinguishable from one that did not run.

**A rendering choice is not canon.** When the generator needs a detail the KB never established, you may invent one, but it never lands in the Revised Prompt as settled fact: it is offered as a Suggestion, in your own name, per "The loop" below. It never travels back into a KB article. If a KB article later contradicts a descriptor locked in the corpus, the KB wins: say the corpus entry is stale rather than quietly contradicting canon. SHARED-PRINCIPLES Principle 7 governs, and fabrication reaching the KB is the failure mode it exists to prevent.

## The loop

After the opening exchange, every response has the same three blocks, in this order, and only these three. Repeat until done. Keep your other text short: the three blocks should dominate.

### Revised Prompt

A complete, copy-paste-ready prompt. Composed per `references/flux2-prompting.md`, and in Edit mode also per `references/flux2-editing.md`, which governs preservation language and `image [n]` notation.

**It carries confirmed material only.** Grounding defines what that means: the subject's KB article, prior prompts for this same subject, the resolved style, and what the DM has told you. A visual detail no such source establishes does not go here, however ordinary it looks and however thin the prompt reads without it. Build, age, pose, hair, eyes, skin, clothing, and setting are the usual offenders, and each of them is a Suggestion instead.

**A bare prompt is a correct first round.** When the subject noun and the resolved style are all you have, that is the Revised Prompt, and Suggestions carries everything else. Handing the DM a fully specified stranger and inviting them to pick it apart takes their creative license over their own subject, which is a worse failure than handing them something thin they can build on.

**Never write a negative prompt.** FLUX.2 does not support them. Anything you would have excluded gets stated positively instead.

### Suggestions

Each Suggestion proposes one change to the text of the Revised Prompt: **add** a detail it lacks, **edit** wording working against the image, or **delete** something diluting it. Name the change, name what the image gains. If it does not change the prompt's text, it is not a Suggestion. If it turns on which of two readings the DM meant, it is a Question.

Two to four per round, ordered by impact, one change per line so each can be answered on its own.

**The DM's answer decides each one:**

- **No, or anything reading as a pass:** dropped, and not re-proposed.
- **Silence:** adopted. It goes into the next Revised Prompt, and from that round on it is confirmed material.
- **A counter or an adjustment:** theirs replaces yours, worded as they worded it. Yours is gone.

**Invention is a Suggestion, never a fact.** When the image needs a detail no source confirms, propose it here as an add, in your own name: "Add: a leather apron scorched at the hem, so he reads as a working smith rather than a posed one." One detail per line, so a DM who wants the apron and not the scorching says so in three words. Adopted by silence like anything else, and settled once adopted.

### Questions

**A Question resolves an ambiguity, never an absence.** Something the DM has already said reads two ways, the two readings produce different images, and no source settles which one they meant. That is the entire class. A detail nobody has mentioned is not ambiguous, it is missing, and missing detail is a Suggestion adopted by silence.

The ambiguity sits in one of the four parts a FLUX.2 prompt is built from: **subject**, **action**, **style**, **context**. "You said the tower fell: is this mid-collapse, or the ruin years after?" is an action fork, and the two prompts share almost no words. "Is he bearded?" is not a fork. Nobody said anything about his face, so it is an add.

Zero to three per round. Zero is the normal state once the readings are settled, and a round with no Questions is a finished round rather than a lazy one. Keep the heading and write "None blocking" under it.

**A Question asks; it does not assert.** Naming both readings is the point. Stating an unconfirmed detail as settled while appearing to ask about something else is not.

### Loop rules

- **Never stall.** Produce a Revised Prompt every round. On a vague or incomplete answer about which of two readings you meant, make a reasonable inference, state it explicitly, and raise it as a Question only if getting it wrong would be expensive. **This license stops at the subject's appearance.** A visual detail no source confirms is invented, and invented detail is offered as a Suggestion. A thin prompt satisfies this rule. An invented one does not.
- **This rule governs the loop, which Step 1 precedes.** Resolving the style happens before the first round exists, so waiting on it is not stalling. Once the loop starts, every round produces a prompt.
- **On a contradiction,** acknowledge the change in one line, update the prompt, and do not carry the contradiction forward.
- **On "looks good" with obvious gaps,** do not declare victory. Apply the outstanding Suggestions, ask the single most important remaining Question, and tighten.

## The test runs in ComfyUI, not here

You cannot render FLUX.2, so there is no in-thread test phase. There does not need to be one. When the Revised Prompt stabilizes, which is usually round two or three as the Questions thin out, say so and hand it over:

> "This looks stable. Go run it and bring back what you get, good or bad."

The DM returning with a result is a **Diagnose** re-entry. The loop closes through their real generation rather than a simulation of one. Offer this once, at the right moment, not every round.

## Finishing: the write gate

The loop is complete when the DM says they are satisfied, or when Questions has nothing blocking left and Suggestions has nothing materially impactful left.

**Nothing goes to disk during the loop.** SHARED-PRINCIPLES Principle 2: propose, then execute. When the loop closes, present the final prompt and ask what to save. A prompt used once and thrown away is a legitimate outcome; do not insist.

Three offers, made once each, at the close:

1. **Save the prompt.** On approval, write to:

   ```
   <sessionReportsRoot>/<campaign>/prompts/PROMPT-YYYY-MM-DD-<Subject>.md
   ```

   Create the `prompts/` directory if it does not exist. Frontmatter carries `subject`, `mode`, and `date`, and **no `type` field**. The body holds the final prompt, and for Edit mode a one-line note of what the source image was.

2. **Save the style,** when Step 1 built a new one. On approval, write it to the catalog per "Style file shape" above, creating `prompts/styles/` if it does not exist.

3. **Record the house style,** when `CLAUDE.md` records neither a house style nor an opt-out for this campaign. Propose the exact line, show it, and write only on explicit approval. If the DM passes, offer to record the opt-out instead, so the question is settled rather than asked again next session. This is one offer per session, not one per round.

`/log` commits the campaign lane recursively, which covers both `prompts/` and `prompts/styles/`. `CLAUDE.md` sits at the project root, outside every prong `/log` commits, so that edit is not part of the campaign lane and `/log` will not pick it up. Say so when you write it: committing it is the DM's own step.

## Things to never do

- **Never write a negative prompt.** The model ignores them.
- **Never write `.professor-orb/pipeline-state.json`.** This skill is standalone.
- **Never write to a KB article.** A rendering choice is not canon.
- **Never invent canon to fill a visual gap.** Offer it as a Suggestion, ask the DM, or describe around the absence.
- **Never write a prompt file or a style file carrying a `type` frontmatter field.**
- **Never save mid-loop.** The DM approves at the end.
- **Never draw on excluded material.**
- **Never run image generation.** You write the prompt; the DM runs it.
- **Never state an unconfirmed visual detail as settled,** in a Revised Prompt or inside a Question. It is offered as a Suggestion, in your own name.
- **Never read a prompt file for any subject but the one being drafted.** Styles come from the catalog, read by name.
- **Never draft a Revised Prompt before Step 1 resolves.**
- **Never write `CLAUDE.md` without explicit approval,** and never treat a proposed house style as recorded before the DM takes it.

## How this skill connects to the others

- **Standalone:** not in the session pipeline, never writes pipeline state.
- **Inputs:** the DM's intent, the campaign's style catalog, `CLAUDE.md` for which style is the house style, the subject's KB article when one exists, and prior prompts for that same subject in the campaign's `prompts/` directory.
- **Outputs:** one markdown prompt file per saved prompt in the campaign's `prompts/` directory, one style file per saved style in `prompts/styles/`, and, on approval, a house style line in `CLAUDE.md`.
- **Adjacent to `content`:** when `content` builds a Foundry fragment or printable page with a spot for art, it leaves a marked placeholder and names this skill. It does not hand anything over, and this skill reads nothing it produced. The two are independent.
- **Handoff to `/log`:** `/log` commits the campaign lane recursively, which includes `prompts/` and `prompts/styles/`. It does not reach `CLAUDE.md` at the project root, so that edit stays the DM's to commit.
