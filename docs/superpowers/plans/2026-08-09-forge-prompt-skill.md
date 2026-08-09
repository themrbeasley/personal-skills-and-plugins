# forge-prompt Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split Flux2/ComfyUI image prompt craft out of the `content` skill into a new standalone `forge-prompt` skill with three entry modes and an iterative refinement loop.

**Architecture:** One new skill directory (`SKILL.md` plus two reference files), a reduction of about twenty lines from `content/SKILL.md`, and collateral updates to the four documents that track the plugin's own inventory. The two skills are decoupled in both directions: `content` mentions `forge-prompt` and stops; `forge-prompt` reads nothing `content` produced.

**Tech Stack:** Markdown only. No executable code changes. Verification is grep assertions plus the existing Node built-in test suites, which must continue to pass untouched.

**Spec:** `docs/superpowers/specs/2026-08-09-forge-prompt-skill-design.md`

## Global Constraints

- **No em dashes** anywhere in plugin prose. SHARED-PRINCIPLES Principle 6, enforced by the `contentNoEmDashes` rule.
- **Every command, agent, and skill opens with the preamble line** reading `SHARED-PRINCIPLES.md`. Exact form for a skill: `> **Before you begin:** read \`../SHARED-PRINCIPLES.md\` and apply its rules throughout this workflow.`
- **Agent `color` must be one of** `red`, `blue`, `green`, `yellow`, `purple`, `orange`, `pink`, `cyan`. Not used in this plan; no agents are added.
- **A release bumps `version` in both** `.claude-plugin/marketplace.json` (repo root) and `professor-orb/.claude-plugin/plugin.json`. They must match. Current: `1.11.0`. Target: `1.12.0`.
- **Prompt files must carry no `type` frontmatter field.** `hooks/validate-write.mjs:905` exits silently on a missing `type`; a present `type` proceeds into `frontmatterTypeEnum` (enforcement `block`), whose twenty-value list has no prompt entry.
- **All edits to existing files use exact string matching**, not line numbers. Line numbers in this plan are orientation only.
- **Work happens in the current worktree**, branch `claude/professor-orb-prompt-skill-8f6977`.

---

## File Structure

| Path | Responsibility | Task |
|---|---|---|
| `professor-orb/skills/forge-prompt/references/flux2-prompting.md` | Generation-from-scratch craft: anatomy, weighting, hex, JSON, parameters | 1 |
| `professor-orb/skills/forge-prompt/references/flux2-editing.md` | Edit-an-existing-image craft: preservation language, multi-reference | 1 |
| `professor-orb/skills/forge-prompt/SKILL.md` | The skill: modes, loop, grounding, write gate | 2 |
| `professor-orb/skills/content/SKILL.md` | Loses the prompt job; keeps everything else | 3 |
| `professor-orb/skills/orb/SKILL.md` | Menu inventory gains a row and three list entries | 4 |
| `professor-orb/CONTEXT.md` | Glossary: retire `prompt sidecar`, add `forge-prompt` | 4 |
| `professor-orb/commands/log.md` | Lane enumeration names `prompts/` instead of sidecars | 4 |
| `CLAUDE.md` (repo root) | Preamble count verified at 19 | 4 |
| `professor-orb/.claude-plugin/plugin.json` | Version 1.12.0 | 5 |
| `.claude-plugin/marketplace.json` | Version 1.12.0, matching | 5 |

Task order matters. Task 2 points at files Task 1 creates. Tasks 3 and 4 describe a skill Task 2 creates. Task 5 gates the release on everything above.

---

### Task 1: Flux 2 reference files

Two reference files carrying the model-specific knowledge, so `SKILL.md` stays lean. This mirrors `professor-orb/skills/homebrew/references/`, whose house format is: `# Title`, a `Source:` line, a one-paragraph statement of what the file is for, a `---`, then `##` sections.

**Files:**
- Create: `professor-orb/skills/forge-prompt/references/flux2-prompting.md`
- Create: `professor-orb/skills/forge-prompt/references/flux2-editing.md`

**Interfaces:**
- Consumes: nothing.
- Produces: two paths that Task 2's `SKILL.md` references by name. The exact strings later tasks use are `references/flux2-prompting.md` and `references/flux2-editing.md`, referenced from `SKILL.md` as relative paths.

- [ ] **Step 1: Create the directory and verify it is new**

```bash
ls professor-orb/skills/forge-prompt 2>/dev/null && echo "EXISTS - STOP" || echo "new, proceed"
mkdir -p professor-orb/skills/forge-prompt/references
```

Expected: `new, proceed`

- [ ] **Step 2: Write `references/flux2-prompting.md`**

Create `professor-orb/skills/forge-prompt/references/flux2-prompting.md` with this exact opening, then the sections enumerated below it:

```markdown
# FLUX.2 Prompting Reference

Source: Black Forest Labs documentation, `docs.bfl.ai/guides/prompting_guide_flux2`

Model-specific prompt craft for FLUX.2 generation from scratch. This file is the reason the forge-prompt skill exists as its own component: this material goes stale when the model does, and isolating it here means refreshing it is a bounded task rather than an audit of a skill about read-aloud prose. Check it against the live guide when results stop matching what it describes.

---
```

Then these sections, in this order.

**The enumeration below is the content, not a summary of it.** Every rule listed must appear, and no fact outside this list may be added. The implementer writes only the connective sentences that turn each bullet into readable prose, plus the tables exactly as given. Do not consult the live BFL guide while writing this file and do not add material from memory: the point of pinning the content here is that a future refresh is a diff against a known baseline rather than a re-derivation.

**`## Core principles`**
1. FLUX.2 does not support negative prompts. Describe what you want, not what you do not want. Replace an exclusion with a positive specification: "sharp focus" rather than "no blur."
2. Word order carries weight. Elements placed early receive more attention from the model.
3. Describe positively throughout.

**`## Prompt anatomy`**
The four-part frame: **Subject** (the main focus), **Action** (what it does, or its pose), **Style** (medium, artistic approach, aesthetic), **Context** (setting, lighting, time, mood, atmosphere).

**`## Length bands`** (as a table)

| Band | Words | Use |
|---|---|---|
| Short | 10 to 30 | Quick concept exploration |
| Medium | 30 to 80 | Ideal for most work |
| Long | 80 plus | Complex scenes needing detailed specification |

**`## Photorealistic style`**
Reference specific eras, cameras, lenses, and film stocks. Examples: "shot on Sony A7IV," "80s vintage photo," "Kodak Portra 400."

**`## Typography and text rendering`**
- Put the literal text in quotation marks: the text 'OPEN' appears in red neon.
- Specify placement relative to other elements.
- Describe the font: serif, bold, handwritten.
- Give colors as hex codes when brand or palette consistency matters.

**`## Hex color prompting`**
- Signal a color with the keyword "color" or "hex" immediately before the code.
- Associate each hex code with a specific object rather than placing it vaguely.
- For gradients, specify both the start and end color so the transition is defined.

**`## JSON structured prompting`**
When to use: production workflows, automation, complex multi-subject scenes, and consistent iteration across a series.
Base schema keys: `scene`, `subjects` (each with `description`, `position`, `action`), `style`, `color_palette`, `lighting`, `mood`, `background`, `composition`, `camera` (with `angle`, `lens`, `depth_of_field`).

**`## Series and sequential consistency`**
Repeat detailed, identical character descriptions across every panel or frame. Consistency comes from repetition of the description, not from the model remembering.

**`## Multi-language`**
Prompting in the native language of the content being depicted often produces more culturally authentic results.

**`## Aspect ratios and resolution`** (as a table)

| Ratio | Typical use |
|---|---|
| 1:1 | Social, product shots |
| 16:9 | Landscapes, cinematic |
| 9:16 | Mobile, portraits |
| 4:3 | Magazine, presentation |
| 21:9 | Panorama |

Limits: 4MP maximum total, 64x64 minimum, dimensions in multiples of 16.

**`## Parameters`** (as a table)

| Parameter | Range or use |
|---|---|
| Seed | Reproducibility |
| Guidance (flex) | 1.5 to 10, prompt adherence |
| Steps (flex) | Up to 50, quality against speed |

**`## Prompt upsampling`**
Automatically expands a basic prompt with detail while preserving the original intent.

- [ ] **Step 3: Write `references/flux2-editing.md`**

Create `professor-orb/skills/forge-prompt/references/flux2-editing.md` with this exact opening:

```markdown
# FLUX.2 Image Editing Reference

Source: Black Forest Labs documentation, `docs.bfl.ai/guides/usecases_editing_clothing_tryon`

Prompt craft for editing an image that already exists rather than generating one from nothing. The governing difference: an edit prompt must say what stays as loudly as it says what changes, because anything left unspecified is a candidate for the model to reinvent. Check this against the live guide when results stop matching what it describes.

---
```

Then these sections, in this order:

**`## The edit frame`**
Three parts, all required: the **change** (what becomes different), the **preservation** (what must survive untouched), and the **context** (scene and pose continuity). Omitting the preservation clause is the single most common cause of an edit that alters things you did not ask it to.

**`## Preservation language`**
Name the things that must survive, specifically, by their visible properties. Working patterns from the source guide:
- "keeping all lace embroidery details white and fully visible"
- "preserve the original fabric texture, transparency, patterns, highlights, and natural folds"
- "Keep [subject's] pose"

The rule generalized: for every attribute the edit could plausibly disturb (texture, transparency, pattern, highlight, fold, pose, lighting direction, background), either change it deliberately or preserve it explicitly.

**`## Multi-reference notation`**
Refer to input images as `image [1]`, `image [2]`, and so on. State the role each input plays rather than merely listing them: which supplies the garment, which the subject, which the setting. The source guide composes editorial scenes from five or six inputs (shoes, jacket, jeans, shirt, cap, accessories) synthesized into one styled result.

**`## Color control in edits`**
Hex codes work the same as in generation and matter more here, because "recolor the dress blue" against an existing image invites drift. Bind the code to the specific garment or object.

**`## Compound edits`**
Outfit plus scene changes in a single prompt work when each element is specified separately and the preservation clause still covers everything not being changed.

**`## Known gap`**
The source guide publishes no troubleshooting section. When an edit fails, the highest-yield first move is to add preservation language for whatever drifted, then re-run.

- [ ] **Step 4: Verify both files against house rules**

```bash
grep -c "—" professor-orb/skills/forge-prompt/references/*.md
grep -l "^Source:" professor-orb/skills/forge-prompt/references/*.md
wc -l professor-orb/skills/forge-prompt/references/*.md
```

Expected: em dash count `0` for both files; both filenames listed by the `Source:` grep; both files non-trivial in length.

- [ ] **Step 5: Commit**

```bash
git add professor-orb/skills/forge-prompt/references/
git commit --only -m "feat(professor-orb): add Flux 2 prompting and editing references

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- professor-orb/skills/forge-prompt/references/
```

Note the argument order: `git commit --only -m "<message>" -- <pathspec>`. Placing `-m` after the `--` makes git read the message as a pathspec and the commit fails.

---

### Task 2: The forge-prompt skill

**Files:**
- Create: `professor-orb/skills/forge-prompt/SKILL.md`

**Interfaces:**
- Consumes: `references/flux2-prompting.md` and `references/flux2-editing.md` from Task 1, by relative path.
- Produces: the skill name `forge-prompt`, invoked as `/forge-prompt`. Tasks 3 and 4 reference that exact string. Also produces the output path convention `<sessionReportsRoot>/<campaign>/prompts/PROMPT-YYYY-MM-DD-<Subject>.md`, which Task 4 references when updating `commands/log.md`.

- [ ] **Step 1: Verify the failing state**

```bash
ls professor-orb/skills/forge-prompt/SKILL.md 2>/dev/null && echo "EXISTS" || echo "absent, proceed"
```

Expected: `absent, proceed`

- [ ] **Step 2: Write `SKILL.md`**

Create `professor-orb/skills/forge-prompt/SKILL.md` with exactly this content:

````markdown
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

In this order:

1. **The subject's KB article,** if the subject is an entity the knowledge base knows, for canonical appearance. Content exclusions apply; the `block-excluded` hook enforces them at PreToolUse regardless of what you intend.
2. **Prior prompts for the same subject,** in the campaign's `prompts/` directory. Reuse the descriptors already locked there. This is what keeps a recurring NPC looking like themselves across a year of sessions, and it is the whole reason the prompts are saved.
3. **The project's `CLAUDE.md`,** for campaign visual tone, medium, palette, and any house style the DM has recorded.

**A rendering choice is not canon.** When the generator needs a detail the KB never established, you may invent it for the prompt, and it stays in the prompt. It never travels back into a KB article. If a KB article later contradicts a descriptor locked in the corpus, the KB wins: say the corpus entry is stale rather than quietly contradicting canon. SHARED-PRINCIPLES Principle 7 governs, and fabrication reaching the KB is the failure mode it exists to prevent.

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
````

- [ ] **Step 3: Verify the skill against house rules**

```bash
grep -c "—" professor-orb/skills/forge-prompt/SKILL.md
grep -c "SHARED-PRINCIPLES" professor-orb/skills/forge-prompt/SKILL.md
grep -c "pipeline-state.json" professor-orb/skills/forge-prompt/SKILL.md
grep -o "references/flux2-[a-z]*\.md" professor-orb/skills/forge-prompt/SKILL.md | sort -u
```

Expected: em dashes `0`; SHARED-PRINCIPLES referenced at least 4 times; `pipeline-state.json` mentioned at least 2 times (description and never-do); both reference paths listed and both resolving to files that exist from Task 1.

- [ ] **Step 4: Verify both referenced files actually exist**

```bash
for f in $(grep -o "references/flux2-[a-z]*\.md" professor-orb/skills/forge-prompt/SKILL.md | sort -u); do
  test -f "professor-orb/skills/forge-prompt/$f" && echo "OK $f" || echo "MISSING $f"
done
```

Expected: two `OK` lines, no `MISSING`.

- [ ] **Step 5: Commit**

```bash
git add professor-orb/skills/forge-prompt/SKILL.md
git commit --only -m "feat(professor-orb): add forge-prompt skill

Three entry modes (forge, edit, diagnose) and an iterative loop whose
suggestions are approved by default. Standalone: never writes pipeline
state, never writes the KB.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- professor-orb/skills/forge-prompt/SKILL.md
```

---

### Task 3: Reduce the content skill

Remove the prompt job from `content` and replace it with a three-line pointer. Everything else in the file is untouched: the four content types, all voice and length rules, the three output formats, the historian handoff, the approval gate, and the pipeline-state write.

**Files:**
- Modify: `professor-orb/skills/content/SKILL.md`

**Interfaces:**
- Consumes: the skill name `forge-prompt` from Task 2.
- Produces: a `content/SKILL.md` with zero occurrences of the strings `sidecar` and `IMAGE-PROMPT`. Task 4's verification depends on that.

- [ ] **Step 1: Establish the failing state**

```bash
grep -c -i "sidecar" professor-orb/skills/content/SKILL.md
grep -c "IMAGE-PROMPT" professor-orb/skills/content/SKILL.md
wc -l professor-orb/skills/content/SKILL.md
```

Expected before changes: sidecar count `12`, IMAGE-PROMPT count `2`, file length `255`. These are grep line counts, measured, not estimated. If they differ, the file has moved since this plan was written. Stop and re-read it before editing.

The twelve sidecar lines are 3, 21, 155, 157, 164, 198, 206, 212, 214, 216, 244, and 251. Lines 155, 157, and 164 are removed together as one block in Step 4. The spec's removal table omitted lines 21 and 214; they are covered here in Steps 2b and 8b.

- [ ] **Step 2: Edit the frontmatter description**

Use Edit with this exact `old_string`:

```
or a printable page (a standalone HTML file with print CSS for physical handouts or PDF export). Any output with an image slot gets a matching prompt sidecar for image generation. Use this skill whenever
```

Replace with:

```
or a printable page (a standalone HTML file with print CSS for physical handouts or PDF export). A piece with a spot for art gets a marked placeholder and a pointer to the forge-prompt skill, which writes image prompts; this skill does not. Use this skill whenever
```

- [ ] **Step 2b: Remove the sidecar filename convention**

Line 21 defines a filename suffix for a file type that will no longer exist. Use Edit with this exact `old_string`:

```
- **Content filename conventions.** Look for prefix patterns (for example `RECAP-`, `HANDOUT-`). If not specified, default to `[TYPE]-YYYY-MM-DD-[Title].md` for markdown, with `-FRAGMENT.html`, `-PRINT.html`, and `-IMAGE-PROMPT.md` suffixes for the Foundry fragment, printable page, and prompt sidecar variants described below.
```

Replace with:

```
- **Content filename conventions.** Look for prefix patterns (for example `RECAP-`, `HANDOUT-`). If not specified, default to `[TYPE]-YYYY-MM-DD-[Title].md` for markdown, with `-FRAGMENT.html` and `-PRINT.html` suffixes for the Foundry fragment and printable page variants described below.
```

- [ ] **Step 3: Repoint the Foundry fragment bullet**

The trailing clause points at the section being deleted in the next step. Use Edit with this exact `old_string`:

```
- **No external assets.** No linked fonts, no remote image URLs, unless the DM has confirmed the destination world can load them. If the piece calls for art, use an image slot (below) instead.
```

Replace with:

```
- **No external assets.** No linked fonts, no remote image URLs, unless the DM has confirmed the destination world can load them. If the piece calls for art, leave an art placeholder (below) instead.
```

- [ ] **Step 4: Replace the Prompt sidecar section**

This is the main removal. Use Edit with this exact `old_string`, which spans the whole section from its heading through its closing rule:

```
### Prompt sidecar

Whenever a Foundry fragment or printable page includes an image slot (a letterhead illustration, an item's icon, a portrait, a map fragment), reserve the slot as a placeholder element with explicit `width` and `height` in the HTML, and produce a companion sidecar file alongside it (same base filename, `-IMAGE-PROMPT` suffix, plain markdown). The sidecar contains:

- **A positive prompt**, written for Flux2/ComfyUI-style generation: subject, composition, medium, lighting, and the campaign's established visual tone.
- **A negative prompt**, covering anything that would break the piece's fit (modern artifacts, wrong art style, unwanted text or watermarks, as applicable).
- **Output settings**, most importantly generation **dimensions that match the HTML slot's pixel dimensions or aspect ratio exactly**, so the DM's generated image drops into the slot without cropping or distortion. Note the project's established house style or checkpoint if one exists.
- A one-line reminder that the DM generates the image manually and replaces the placeholder once it exists; this skill does not run image generation itself.

Never produce an image slot without its sidecar, and never produce a sidecar whose dimensions do not match the slot it belongs to.
```

Replace with:

```
### Art placeholders

When a Foundry fragment or printable page has a spot for art (a letterhead illustration, an item's icon, a portrait, a map fragment), leave a visibly marked placeholder block where the image goes. Do not prescribe its dimensions: aspect ratio, size, and format are the DM's call, made against the real image.

Writing the image prompt is the `forge-prompt` skill's job, not this one. Name it in the closing summary and move on.
```

- [ ] **Step 5: Remove the image-slot question from Phase 1**

Use Edit with this exact `old_string`:

```
**Choose the output format.** For each item in the work list, confirm the output format (markdown, Foundry fragment, or printable page) and, if HTML, whether it needs an image slot. This is a structured, enumerable decision
```

Replace with:

```
**Choose the output format.** For each item in the work list, confirm the output format (markdown, Foundry fragment, or printable page). This is a structured, enumerable decision
```

- [ ] **Step 6: Remove the Phase 3 drafting instruction**

Use Edit with this exact `old_string`:

```
**Render into the chosen output format.** Once the prose is right, wrap it per the Output formats section: plain markdown as-is, or the drafted text carried into a self-contained Foundry fragment or a standalone printable page. If an image slot was requested, size the placeholder and draft its prompt sidecar now, alongside the piece.
```

Replace with:

```
**Render into the chosen output format.** Once the prose is right, wrap it per the Output formats section: plain markdown as-is, or the drafted text carried into a self-contained Foundry fragment or a standalone printable page. If the piece has a spot for art, leave a marked placeholder per the Art placeholders section.
```

- [ ] **Step 7: Fix the Phase 3 self-check list**

Use Edit with this exact `old_string`:

```
- **Image slot:** does the sidecar's dimensions match the HTML slot exactly?
```

Replace with:

```
- **Art placeholder:** is it visibly marked, and free of prescribed dimensions?
```

- [ ] **Step 8: Fix the Phase 4a review step**

Use Edit with this exact `old_string`:

```
For a Foundry fragment or printable page, show the rendered HTML content (and describe how it will look) along with its prompt sidecar if one exists.
```

Replace with:

```
For a Foundry fragment or printable page, show the rendered HTML content and describe how it will look.
```

- [ ] **Step 8b: Fix the Phase 4b save instruction**

Line 214 still tells content to write a sidecar to disk. Use Edit with this exact `old_string`:

```
**Step 4b: save approved content.** Write each approved file, and any prompt sidecar, to the content directory using the project's conventions. Create the directory if it does not exist.
```

Replace with:

```
**Step 4b: save approved content.** Write each approved file to the content directory using the project's conventions. Create the directory if it does not exist.
```

- [ ] **Step 9: Fix the Phase 4b index sentence**

Use Edit with this exact `old_string`:

```
Foundry fragments, printable pages, and prompt sidecars are working files for the table, not KB articles, and do not need index entries unless the project's conventions say otherwise.
```

Replace with:

```
Foundry fragments and printable pages are working files for the table, not KB articles, and do not need index entries unless the project's conventions say otherwise.
```

- [ ] **Step 10: Replace the never-do entry**

Use Edit with this exact `old_string`:

```
- **Never produce an image slot without a matching prompt sidecar**, and never let the sidecar's dimensions drift from the slot's.
```

Replace with:

```
- **Never write an image prompt.** That is `forge-prompt`'s job. Leave the placeholder, name the skill, and stop.
```

- [ ] **Step 11: Fix the outputs line in the connections section**

Use Edit with this exact `old_string`:

```
- **Outputs:** content files (markdown, Foundry fragments, printable pages) and any prompt sidecars, in the campaign's content subdirectory.
```

Replace with:

```
- **Outputs:** content files (markdown, Foundry fragments, printable pages) in the campaign's content subdirectory.
```

- [ ] **Step 12: Add the forge-prompt line to the connections section**

Use Edit with this exact `old_string`:

```
- **Orthogonal to `chronicler`:** content never modifies KB articles.
```

Replace with:

```
- **Adjacent to `forge-prompt`:** a piece with an art placeholder names that skill in the closing summary. Nothing is handed over and no file is shared; `forge-prompt` reads nothing content produced.
- **Orthogonal to `chronicler`:** content never modifies KB articles.
```

- [ ] **Step 13: Verify the passing state**

```bash
grep -c -i "sidecar" professor-orb/skills/content/SKILL.md
grep -c "IMAGE-PROMPT" professor-orb/skills/content/SKILL.md
grep -c "forge-prompt" professor-orb/skills/content/SKILL.md
grep -c "—" professor-orb/skills/content/SKILL.md
wc -l professor-orb/skills/content/SKILL.md
```

Expected: sidecar `0`, IMAGE-PROMPT `0`, forge-prompt at least `4`, em dashes `0`, file length `251`. The arithmetic: the Step 4 block removal is 10 lines replaced by 5, and Step 12 adds 1 line. Every other edit is a same-line replacement. 255 minus 5 plus 1 is 251.

`grep -c` returns exit status 1 when the count is zero, which is the desired result for the first two. If you are running these in a `&&` chain, they will halt there. Run them as separate lines.

- [ ] **Step 14: Confirm nothing else changed**

```bash
git diff --stat professor-orb/skills/content/SKILL.md
```

Expected: one file changed. Read the full diff and confirm no content-type rule, voice rule, or output-format rule was touched beyond the thirteen edits above (Steps 2, 2b, 3 through 8, 8b, 9 through 12).

- [ ] **Step 15: Commit**

```bash
git add professor-orb/skills/content/SKILL.md
git commit --only -m "refactor(professor-orb): remove prompt sidecar from content

Content no longer writes image prompts. Deletes the sidecar section and
the five dimension-matching rules, which described a workflow the DM
does not run, and whose spec required a negative prompt that FLUX.2
does not support. A piece with art now leaves a marked placeholder and
names forge-prompt.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- professor-orb/skills/content/SKILL.md
```

---

### Task 4: Collateral inventory updates

Four documents track what the plugin contains. All four are now wrong.

**Files:**
- Modify: `professor-orb/skills/orb/SKILL.md`
- Modify: `professor-orb/CONTEXT.md`
- Modify: `professor-orb/commands/log.md`
- Verify only: `CLAUDE.md` (repo root)

**Interfaces:**
- Consumes: the skill name `forge-prompt` and the output path convention from Task 2; the sidecar-free `content/SKILL.md` from Task 3.
- Produces: nothing later tasks depend on, other than a consistent inventory for Task 5's release gate.

- [ ] **Step 1: Establish the failing state**

```bash
grep -c "forge-prompt" professor-orb/skills/orb/SKILL.md
grep -c "forge-prompt" professor-orb/CONTEXT.md
grep -c -i "sidecar" professor-orb/commands/log.md
grep -rl "SHARED-PRINCIPLES" professor-orb --include="*.md" | grep -v "skills/SHARED-PRINCIPLES.md" | wc -l
```

Expected, as the state this task fixes: forge-prompt `0` in orb, `0` in CONTEXT.md, and a `sidecar` count of at least `1` in log.md.

The fourth command is a precondition rather than a failing state. It must already read `19`: 18 carriers before this work plus the skill Task 2 added. If it reads 18, Task 2's `SKILL.md` is missing its preamble line. Go fix that before continuing, because Step 8 below depends on this number being right.

- [ ] **Step 2: Add the orb component-table row**

Use Edit on `professor-orb/skills/orb/SKILL.md` with this exact `old_string`:

```
| orb | Skill | This menu: what is available and what to run next | `/orb`, "what tools are available," "what should I run next" |
```

Replace with:

```
| forge-prompt | Skill | Image-generation prompt craft for FLUX.2 and ComfyUI: forge a new prompt, write an edit prompt against an approved image, or diagnose one that underperformed. Runs an iterative loop and saves the result to the campaign's `prompts/` directory | `/forge-prompt`, "write an image prompt," "edit this image," "fix this prompt" |
| orb | Skill | This menu: what is available and what to run next | `/orb`, "what tools are available," "what should I run next" |
```

- [ ] **Step 3: Add forge-prompt to the orb description's standalone list**

Use Edit with this exact `old_string`:

```
Standalone components (setup after first install, homebrew, timeline, /catalog, /scribe, /log, /genesis, /migrate, /sweep) are always available on demand and never presented as a required next step.
```

Replace with:

```
Standalone components (setup after first install, homebrew, timeline, forge-prompt, /catalog, /scribe, /log, /genesis, /migrate, /sweep) are always available on demand and never presented as a required next step.
```

- [ ] **Step 4: Add forge-prompt to the orb body's standalone line**

Use Edit with this exact `old_string`:

```
**Standalone, on demand, never part of pipeline state:** setup (after the first install), homebrew, timeline, `/catalog`, `/scribe`, `/log`, `/genesis`, `/migrate`, `/sweep`, and orb itself.
```

Replace with:

```
**Standalone, on demand, never part of pipeline state:** setup (after the first install), homebrew, timeline, forge-prompt, `/catalog`, `/scribe`, `/log`, `/genesis`, `/migrate`, `/sweep`, and orb itself.
```

- [ ] **Step 5: Add forge-prompt to the orb "What to run next" standalone sentence**

Use Edit with this exact `old_string`:

```
Standalone components (`homebrew`, `timeline`, `/catalog`, `/scribe`, `/log`, `/migrate`, `/sweep`) never count as a required next step
```

Replace with:

```
Standalone components (`homebrew`, `timeline`, `forge-prompt`, `/catalog`, `/scribe`, `/log`, `/migrate`, `/sweep`) never count as a required next step
```

- [ ] **Step 6: Replace the CONTEXT.md glossary entry**

`CONTEXT.md` currently defines `prompt sidecar` as content's output, which no longer exists. Use Edit with this exact `old_string`:

```
**prompt sidecar**:
A companion file the content skill emits alongside visual-bearing outputs: Flux2/
ComfyUI generation prompts plus output settings, with image dimensions matched to
the slots in the HTML. The DM runs generation manually for now; deeper ComfyUI
integration is a flagged future investigation.
```

Replace with:

```
**forge-prompt skill**:
Image-generation prompt craft, split out of `content` in 1.12.0 because the material
is model-specific, goes stale with the model, and is prep work rather than table
work. Three entry modes: forge a prompt from nothing, write an edit prompt against
an image the DM has already approved, or diagnose one that underperformed. Runs an
iterative loop borrowed from the DM's own ultimate-prompt-creator skill, whose
load-bearing rule is that suggestions are approved by default and questions are
asked only when they block. Saves to `<sessionReportsRoot>/<campaign>/prompts/`,
carrying no `type` frontmatter field, because the write-time hook skips a typeless
file and blocks a type it does not recognize. The DM runs generation manually;
deeper ComfyUI integration remains a flagged future investigation.
_Avoid_: "the prompt skill" (ambiguous), calling its output canon

**prompt corpus**:
The accumulated prompt files in a campaign's `prompts/` directory. Serves double
duty, the same way the homebrew catalog does: the DM's record of what was generated,
and the source `forge-prompt` reads before drafting so a recurring NPC keeps the same
locked visual descriptors across sessions. Deliberately not a registry in
`.professor-orb/`: Principle 8 licenses exactly one auxiliary document and this is
not it, and a locked descriptor is authored rather than derived so it could not live
in the gitignored tier. KB canon outranks the corpus; the corpus holds only the
rendering delta the generator needed, and a rendering choice never travels back into
a KB article.
_Avoid_: "visual registry", treating a locked descriptor as canon

**prompt sidecar**:
_Retired in 1.12.0._ Content's former companion file for visual-bearing outputs,
carrying Flux2 prompts and dimensions matched to the HTML slot. Removed because its
spec required a negative prompt, which FLUX.2 does not support, and because the
dimension matching described a workflow the DM does not run. Superseded by the
forge-prompt skill and the prompt corpus above. The term survives here only so that
older session transcripts and commits remain legible.
```

- [ ] **Step 7: Fix the log.md lane enumeration**

Use Edit on `professor-orb/commands/log.md` with this exact `old_string`:

```
and the `content/` subdirectory holding recaps, handouts, setpieces, and prompt sidecars, all as a single path for staging and committing (Step 7).
```

Replace with:

```
the `content/` subdirectory holding recaps, handouts, and setpieces, and the `prompts/` subdirectory holding what `forge-prompt` saved, all as a single path for staging and committing (Step 7).
```

- [ ] **Step 8: Verify the CLAUDE.md preamble count**

The root `CLAUDE.md` states that all 19 components carry the preamble. Before this work the real count was 18, so the statement was wrong by one. Adding `forge-prompt` makes it 19 and the existing number becomes correct.

```bash
grep -n "carry the preamble" CLAUDE.md
grep -rl "SHARED-PRINCIPLES" professor-orb --include="*.md" | grep -v "skills/SHARED-PRINCIPLES.md" | wc -l
```

Expected: `CLAUDE.md` says 19, and the count is 19. **Leave the number alone.** Do not bump it to 20. If the count is not 19, Task 2's skill is missing its preamble line; go fix that instead of editing this number.

- [ ] **Step 9: Verify the passing state**

```bash
grep -c "forge-prompt" professor-orb/skills/orb/SKILL.md
grep -c "forge-prompt" professor-orb/CONTEXT.md
grep -c -i "sidecar" professor-orb/commands/log.md
grep -c "—" professor-orb/skills/orb/SKILL.md professor-orb/CONTEXT.md professor-orb/commands/log.md
```

Expected: forge-prompt at least `4` in orb and at least `2` in CONTEXT.md; `sidecar` in log.md now `0`; em dashes `0` in all three.

- [ ] **Step 10: Commit**

```bash
git add professor-orb/skills/orb/SKILL.md professor-orb/CONTEXT.md professor-orb/commands/log.md
git commit --only -m "docs(professor-orb): register forge-prompt in the plugin inventory

Adds the orb menu row and three standalone-list entries, replaces the
retired prompt sidecar glossary entry with forge-prompt and prompt
corpus, and repoints the /log lane enumeration at prompts/.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- professor-orb/skills/orb/SKILL.md professor-orb/CONTEXT.md professor-orb/commands/log.md
```

---

### Task 5: Version bump and release gate

**Files:**
- Modify: `professor-orb/.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`

**Interfaces:**
- Consumes: everything above.
- Produces: a releasable 1.12.0.

- [ ] **Step 1: Confirm the full test suite still passes**

This change touches no executable code, so all eight suites must pass exactly as before.

```bash
for f in $(find professor-orb -name "*.test.mjs" | sort); do echo "== $f"; node "$f" || break; done
```

Expected: all eight run and none exits non-zero. The suites are `commands/lane-staging`, `hooks/block-excluded`, `hooks/pipeline-next`, `hooks/validate-write`, `workflows/migrate.apply`, `workflows/migrate.plan`, `workflows/migrate.proposal`, `workflows/validation-sweep.ownership`.

If any suite fails, stop. A markdown-only change cannot legitimately break them, so a failure means something outside this plan's scope moved.

- [ ] **Step 2: Establish the failing state**

```bash
grep '"version"' professor-orb/.claude-plugin/plugin.json
grep '"version"' .claude-plugin/marketplace.json
```

Expected: both show `1.11.0`.

- [ ] **Step 3: Bump the plugin manifest**

Use Edit on `professor-orb/.claude-plugin/plugin.json` with this exact `old_string`:

```
  "version": "1.11.0",
```

Replace with:

```
  "version": "1.12.0",
```

- [ ] **Step 4: Bump the marketplace manifest**

Use Edit on `.claude-plugin/marketplace.json` with this exact `old_string`:

```
      "version": "1.11.0",
```

Replace with:

```
      "version": "1.12.0",
```

Note the indentation differs between the two files. Match what is actually there.

- [ ] **Step 5: Verify the versions match and both files are valid JSON**

```bash
node -e "
const a=require('./professor-orb/.claude-plugin/plugin.json').version;
const b=require('./.claude-plugin/marketplace.json').plugins[0].version;
console.log('plugin.json', a, '| marketplace.json', b, '|', a===b ? 'MATCH' : 'MISMATCH');
process.exit(a===b && a==='1.12.0' ? 0 : 1);
"
```

Expected: `plugin.json 1.12.0 | marketplace.json 1.12.0 | MATCH` and exit 0.

If `plugins[0]` is not the professor-orb entry, read `.claude-plugin/marketplace.json` and index the correct one.

- [ ] **Step 6: Final whole-change verification**

```bash
echo "-- sidecar must be gone from content and log:"
grep -ri "sidecar" professor-orb/skills/content/SKILL.md professor-orb/commands/log.md
echo "-- forge-prompt must be registered in all four places:"
grep -l "forge-prompt" professor-orb/skills/forge-prompt/SKILL.md professor-orb/skills/content/SKILL.md professor-orb/skills/orb/SKILL.md professor-orb/CONTEXT.md professor-orb/commands/log.md
echo "-- preamble carriers (expect 19):"
grep -rl "SHARED-PRINCIPLES" professor-orb --include="*.md" | grep -v "skills/SHARED-PRINCIPLES.md" | wc -l
echo "-- em dashes across the plugin (expect no output):"
grep -rn "—" professor-orb --include="*.md"
```

Expected: the first grep prints nothing; the second lists all five files; the count is 19; the last prints nothing.

- [ ] **Step 7: Commit**

```bash
git add professor-orb/.claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit --only -m "chore(professor-orb): 1.12.0

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- professor-orb/.claude-plugin/plugin.json .claude-plugin/marketplace.json
```

- [ ] **Step 8: Confirm a clean tree**

```bash
git status --porcelain
git log --oneline -7
```

Expected: no output from `status`. `-7` surfaces seven commits, newest first: Task 5, Task 4, Task 3, Task 2, Task 1, the plan doc, and the spec doc.

---

## Manual verification in a consumer project

Not part of the automated gate. Run these against a real campaign repo after installing 1.12.0, per the update procedure (`claude plugin marketplace update professor-orb-marketplace`, then `claude plugin update professor-orb@professor-orb-marketplace --scope project`).

1. Run `content` on a session report with a handout destined for Foundry. Confirm no sidecar file appears, no dimension question is asked, and the closing summary names `/forge-prompt`.
2. Run `/forge-prompt` in Forge mode. Confirm the three-section loop appears, that suggestions are stated as applied-by-default, and that nothing is written to disk until the loop closes.
3. Save the prompt. Confirm the write-time hook stays silent, which verifies the no-`type` constraint.
4. Run `/log`. Confirm the prompts file is committed inside the campaign lane.
5. Run `/forge-prompt` again for the same subject. Confirm it finds and reuses the descriptors from step 3's saved prompt.
6. Run `/forge-prompt` in Diagnose mode against that prompt. Confirm the one-time Diagnosis block appears before the first Revised Prompt.
