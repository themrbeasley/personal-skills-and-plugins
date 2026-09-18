# forge-prompt: Held Suggestions, Edit Detection, and Prompt Text; Proposal Delivery

**Date:** 2026-09-17
**Status:** Approved, not yet implemented
**Scope:** `professor-orb/skills/forge-prompt/SKILL.md` and both of its reference files; Principle 2 of `professor-orb/skills/SHARED-PRINCIPLES.md`; `professor-orb/skills/chronicler/SKILL.md`; `professor-orb/commands/migrate.md`; `professor-orb/CONTEXT.md`; the header lines of four earlier forge-prompt specs; both version manifests.
**Source:** the DM's report, `docs/professor-orb-report-2026-09-17.md` in the rolara-project repository (commit `1dca2c7`), compiled from that project's sessions of 2026-08-19 through 2026-09-17. Every skill quote in it still matched 1.16.1.
**Supersedes:** Suggestions approved by default, decided in `2026-08-09-forge-prompt-skill-design.md` and confirmed in `2026-08-16-forge-prompt-grounding-and-invention-design.md`; silence as one of the DM's three answers, and the style offers anchored at the close, from `2026-08-18-forge-prompt-style-gate-and-suggestions-design.md`; Step 0's default to Forge, from the 08-09 design.

## What went wrong in 1.16.1

Four defects and two lesser ones.

1. **Unanswered Suggestions were adopted.** Silence moved a Suggestion into the next Revised Prompt, including in rounds before the DM had seen a base prompt, so invented detail the DM never approved reached the prompt. The answer set had no way to defer, and the DM took to rejecting whole batches, some of them unread, to keep invention out.

2. **Edit requests got generation prompts.** Step 0 defaulted to Forge on an ambiguous opening, and a change described against a subject rendered earlier in the session counted as ambiguous. When an edit prompt was written, the editing reference had taught composition from several input images, and the DM's edit workflow takes one. Neither reference said that a campaign name carries no visual information, so prompts named characters, aliases, and forms, and the DM removed them by hand in three sessions.

3. **Proposals the DM could not open.** chronicler writes its proposal to `.professor-orb/proposals/`, which is git-ignored, and points at it by a path relative to the project root. In a worktree session the file exists only inside the worktree. The DM lost sight of a proposal across four revisions in one session and was refused permission to open one in another. Sending the file with the desktop app's file-delivery tool fixed it within a minute.

4. **A house-style answer was lost twice.** Recording a house style waited for the close, and neither session reached one. Step 1 had no row for a style from another campaign's catalog, so one session worked from a paraphrase of the style rather than its file.

5. **Negation inside the prompt text.** The negative-prompt rule was followed for the negative-prompt field only. Exclusions written into the prompt text named the excluded feature, and the renders showed it.

6. **Words that invite lettering.** A style described its look by the printed object it resembles, and renders gained titles nobody asked for.

## Design decisions and why

### Silence holds a Suggestion

The report proposed keeping adoption by silence once the DM has accepted a base prompt, plus a "hold" answer. The DM chose holding by default instead.

The report's version keys the rule to whether some earlier message counts as accepting a base prompt: a judgment about conversation history, which is the kind of rule that gets guessed at. This version keys it to an action, the DM's answer to that Suggestion. A held Suggestion is listed again in the next round, so what is pending sits on screen rather than in memory, and holding needs no keyword because it is what an unanswered Suggestion does.

The cost is the mechanism the 08-09 design borrowed from the DM's ultimate-prompt-creator skill, where silence is assent and the skill supplies the improvements. The DM's own workaround, rejecting whole batches to keep them out of the prompt, is the evidence against keeping it.

Held Suggestions count toward the four per round, so the block never grows past four and new ones take the room that is left. "Looks good" leaves the prompt exactly as shown.

### The style offers move to Step 1, together

Saving the style to this campaign's catalog and recording it as the house style are offered in the turn the style resolves, ahead of the first Revised Prompt. Step 1 runs on every invocation, and the close ran in neither session that lost the answer.

They move together because a house-style line recorded early, for a style saved only at the close, would point at a file the catalog does not have. For the same reason, a yes to the house style saves the style too.

An answer that already asks for both is the approval: the file is copied and the line written in that turn. Finishing keeps one offer, saving the prompt.

### Another campaign's style is read from its file

Step 1 gains a row for a style named from another campaign, by its own name or as that campaign's house style, and the row's action is reading that file. An instruction to read closes off working from a recollection without having to name it. The last row changes from a style "the catalog does not have" to one "no catalog has"; otherwise both rows would claim a style that only another campaign holds.

The setting-level catalog the DM described on 2026-08-22 is not built. Of the two styles the DM's campaigns share, one spans two settings, so a catalog per setting would hold only the other, and it would sit outside every lane `/log` commits. The new row covers both, in any setting, by reading the file and offering the copy.

### Edit is read from the message; anything unclear gets one question

Step 0's default goes. A message describing what changes or what stays, about an image of the subject the DM has approved, is Edit. Approval is what Edit mode's own definition turns on, and keying the rule to it keeps a DM reporting a disappointing render on the Diagnose path. A message that could still be read either way gets one question, naming both outputs, before anything else. An edit prompt and a generation prompt share almost no text: a wrong default costs a round, and a question costs a line.

### One input image unless the DM says otherwise

The report proposed recording how many inputs the DM's edit workflow takes. This design makes one input the default instead: the image being edited is `image [1]`, and anything else the edit needs is described in words. Further images are numbered only when the DM says an edit takes them. That covers the DM's workflow with no new state for the skill to read or write, and a DM with a multi-input workflow says so for the edit that uses it.

The multi-image material the reference carried goes. Material the skill cannot act on, sitting in a file read every round, is where a removed behavior regrows; the 08-18 question-definition spec cut the aspect-ratio tables for the same reason.

The edit frame gains the DM's own written form, which opens on `image [1]` and refers to the subject through the image, leaving no slot for a name.

### A subject is described by what it looks like

A campaign name, alias, or named form means nothing to a model that has never seen the campaign: it draws nothing, or whatever else the word means. The rule goes into `references/flux2-prompting.md`, and one sentence goes into SKILL.md's Revised Prompt section, because in the session where this failed, the skill did not open a reference until the DM told it to.

### Negation becomes a positive rule

The replacement says what every phrase is for: naming something that should appear. Stated that way it covers every construction that names a thing in order to exclude it, where a list of constructions leaves the next one uncovered. The reference's own illustration of the rule quoted an exclusion; it keeps only its positive half.

### Looks are named by technique

The typography section gains a rule that a look is named by its technique and medium, because naming the printed object a look comes from invites that object's lettering. It is worded without the trigger words, so the reference does not carry them into the context where prompts are composed.

### A style is prompt text

A style's body opens every prompt that uses it. Building a style now points at `references/flux2-prompting.md`, as the Revised Prompt does, so a style is held to the same rules as the prompts it opens.

### A proposal reaches the DM as the file

Principle 2 gains a paragraph: a proposal written to a file is delivered as that file, with the host's file-delivery tool and its absolute path, each time it is written or revised, and approval is asked in the turn that delivers it. The paragraph names its own reach (chronicler, `/migrate`, and setup's manifest where setup presents it as a proposal), because the preamble scopes Principle 2's write gate to the pipeline and `/migrate` is outside the pipeline.

The path is absolute in every session, not only a worktree session. An absolute path is right either way, so there is no worktree check to get wrong.

Proposals are still not pasted into chat in full; the glossary's rule against proposal dumps stands. The delivery tool covers the desktop app, and the absolute path covers a terminal.

## What ships

### `professor-orb/skills/forge-prompt/SKILL.md`

**Frontmatter description.** "A suggestion the DM declines is dropped, one they leave alone is adopted, and a counter-offer replaces it in the DM's own words." becomes:

> A suggestion enters the prompt only when the DM takes it: a yes adopts it, a decline drops it, a counter-offer replaces it in the DM's own words, and one left unanswered stays listed, outside the prompt, until the DM rules on it.

**Step 0.** "If the DM's opening message is ambiguous, default to Forge and treat what they said as the subject." is replaced:

> When the subject has an image the DM has approved (one they have shared, pointed to, or reported rendering), a message describing what changes or what stays ("still has green hair," "the background becomes an alley") is Edit. When the opening message could still be asking for either an edit or a fresh render, ask one question before anything else: "An edit of that image, or a fresh render?" An edit prompt and a generation prompt share almost no text.

**Step 1.** "Resolve exactly one of four outcomes" becomes "five outcomes". The table gains a row after its first:

> | Names a style from another campaign, by the style's name or as that campaign's house style | Read that file from that campaign's catalog; for a house style, `CLAUDE.md` names which one. It is the resolved style. |

The last row's first cell becomes:

> Names a style no catalog has, or names none and nothing is recorded either way

And a sentence after the table:

> Another campaign's catalog sits at the same path under that campaign's folder, in whichever setting's `sessionReportsRoot` holds it (Principle 12).

**Building a style.** "Propose the style as a short block, show it, and take their corrections." becomes:

> Propose the style as a short block, written per `references/flux2-prompting.md` because its words open every prompt that uses it, show it, and take their corrections.

The paragraph deferring the save to the close is replaced:

> Once it is settled, make the offers in "Recording the style" below, then start the loop.

**New subsection, after Building a style:**

> ### Recording the style
>
> Two offers, made once each, in the turn the style resolves and ahead of the first Revised Prompt. An answer left for the close is lost whenever a session ends without one.
>
> 1. **Save it to this campaign's catalog,** when it is not there already: a style built here, or one read from another campaign's catalog. On approval, write it per "Style file shape" below, creating `prompts/styles/` if it does not exist. A style from another campaign is copied as it is.
> 2. **Record it as the house style,** when `CLAUDE.md` records neither a house style nor an opt-out for this campaign. Propose the exact line, show it, and write only on explicit approval. A yes saves the style to this campaign's catalog too, if it is not there yet, because the line must point at a file this catalog holds. If the DM passes, offer to record the opt-out instead, so the question is settled rather than asked again next session.
>
> **An answer that already asks for this is the approval.** When the DM's own words request it ("copy that campaign's house style over to this one"), copy the file and write the line in that turn, and show the line you wrote.
>
> `CLAUDE.md` sits at the project root, outside every prong `/log` commits. Say so when you write it: committing it is the DM's own step.
>
> A style used once and never saved is a legitimate outcome, and so is a DM who takes neither offer.

**Revised Prompt.** "which governs preservation language and `image [n]` notation" becomes "which governs the edit frame, preservation language, and how input images are numbered". A paragraph after "A bare prompt is a correct first round":

> **The subject appears as what it looks like.** The model has never seen the campaign, so a name, an alias, or a named form draws nothing, or draws whatever else the word means. The prompt carries what the confirmed sources say the subject looks like, and the name stays in the conversation.

The negative-prompt paragraph is replaced:

> **Every phrase names something that should appear.** FLUX.2 has no negative prompt, and it draws what the words name, including a thing named in order to rule it out. Keep something out of the image by naming what takes its place, and leave the excluded thing's name out of the prompt.

**Suggestions.** "**The DM's answer decides each one:**" and its three bullets become:

> **The DM's answer decides each one, and only a yes or a counter puts one in the prompt:**
>
> - **Yes:** adopted. It goes into the next Revised Prompt, and from that round on it is confirmed material.
> - **No, or anything reading as a pass:** dropped, and not re-proposed.
> - **A counter or an adjustment:** theirs replaces yours, worded as they worded it. Yours is gone.
> - **Hold, not yet, or no answer:** held. It stays out of the prompt and is listed again next round, word for word, until the DM rules on it. Held Suggestions count toward the four, and new ones take the room that is left.

The invention paragraph's last sentence becomes:

> Like any Suggestion, it enters the prompt on a yes, and is settled once it does.

**Questions.** "missing detail is a Suggestion adopted by silence" becomes "missing detail is a Suggestion".

**Loop rules.** The "looks good" bullet becomes:

> - **On "looks good,"** the prompt stands exactly as shown, and held Suggestions stay held, out of it. Ask a Question only if one still blocks; otherwise the prompt is stable, so hand it over per the next section.

**Finishing.** The three offers become one:

> One offer at the close: **save the prompt.** On approval, write to:
>
> ```
> <sessionReportsRoot>/<campaign>/prompts/PROMPT-YYYY-MM-DD-<Subject>.md
> ```
>
> Create the `prompts/` directory if it does not exist. Frontmatter carries `subject`, `mode`, and `date`, and **no `type` field**. The body holds the final prompt, and for Edit mode a one-line note of what the source image was.
>
> The style offers come earlier, in the turn the style resolves, per "Recording the style" in Step 1.

The closing paragraph keeps its first sentence ("`/log` commits the campaign lane recursively, which covers both `prompts/` and `prompts/styles/`.") and loses the `CLAUDE.md` sentences, which moved to Recording the style.

**Things to never do.** The negative-prompt entry becomes:

> - **Never name a thing to keep it out of the image,** in a negative prompt or in the prompt text. The model draws what the words name.

**How this skill connects.** Inputs: "the campaign's style catalog" becomes "the campaign's style catalog, and another campaign's when the DM names a style from it".

### `professor-orb/skills/forge-prompt/references/flux2-prompting.md`

Core principles 1 and 3 are replaced; 2 is unchanged:

> 1. **Every phrase names something that should appear.** FLUX.2 has no negative prompt, and it draws what the words name, including a thing named in order to rule it out. Keep something out by naming what takes its place, such as "sharp focus," and leave the excluded thing's name out of the prompt.
> 2. Word order carries weight. Elements placed early receive more attention from the model.
> 3. **Describe the subject by what it looks like.** The model has never seen the campaign, so a character's name, an alias, or a named form draws nothing, or draws whatever else the word means. Build, face, hair, clothing, and pose carry the subject.

`## Typography and text rendering` gains an opening paragraph, ahead of its bullets:

> Text appears where the prompt asks for it, and naming a printed object asks for it: the object's lettering comes with the name, and the model writes titles nobody chose. Name a look by its technique and medium instead: inked linework, cel-shaded color, halftone dots.

### `professor-orb/skills/forge-prompt/references/flux2-editing.md`

`## The edit frame` gains, after its paragraph:

> Written out, the frame opens on the image and the change, then names what survives:
>
> ```
> Edit image [1]: <the change>. Preserve exactly: <everything the edit could disturb, by visible property>.
> ```
>
> Context goes in whichever clause it belongs to: a new setting is part of the change, an unchanged pose is part of what is preserved. The subject is whoever is in image [1], so the prompt refers to it through the image and by what it looks like.

`## Multi-reference notation` is replaced in full:

> ## Input images
>
> An edit prompt is written against the inputs the DM's edit workflow takes. One is the default: the image being edited is `image [1]`, and anything else the edit needs (a garment, a setting, a region to change) is described in words. When the DM says an edit takes more inputs, number them `image [2]` onward and state the role each one plays: which supplies the garment, which the subject, which the setting.

### `professor-orb/skills/SHARED-PRINCIPLES.md`

Principle 2 gains a paragraph after "This is a hard gate, not a suggestion.":

> **A proposal written to a file reaches the DM as that file.** This binds every component that writes one for approval, pipeline or not: `chronicler`'s lore-update proposal, `/migrate`'s plan, and `setup`'s migration manifest on the path where setup presents it as a proposal. Each time you write or revise the file, deliver it in that turn with the host's file-delivery tool (SendUserFile in the Claude desktop app), and give its absolute path, which is where the DM edits it by hand. Ask for approval in the turn that delivers it. With no file-delivery tool, the absolute path is the pointer. `.professor-orb/proposals/` is git-ignored, so in a worktree session a proposal exists only inside that worktree, and a path relative to the project root sends the DM to a checkout that does not have it.

### `professor-orb/skills/chronicler/SKILL.md`

- Step 1c, "Chat gets a summary, not the dump": "and a pointer to the proposal file's path" becomes ", and deliver the file itself per SHARED-PRINCIPLES Principle 2".
- Step 1c, "The DM may edit the file directly": "Tell the DM they can open the proposal file and revise it by hand" becomes "Tell the DM they can revise the file by hand at the absolute path you gave".
- Step 1d: "then re-summarize only the changed sections in chat" becomes "then re-summarize only the changed sections in chat and deliver the revised file (Principle 2)".

### `professor-orb/commands/migrate.md`

Step 4: "Give the DM a summary and a pointer to the file in chat; do not paste the whole plan into the conversation." becomes "Give the DM a summary in chat and deliver the file itself per SHARED-PRINCIPLES Principle 2; do not paste the whole plan into the conversation."

### `professor-orb/CONTEXT.md`

- **forge-prompt:** "the DM's answer decides it, with a decline dropping it, silence adopting it, and a counter replacing it in the DM's own words" becomes "the DM's answer decides it: a yes adopts it, a decline drops it, a counter replaces it in the DM's own words, and silence holds it outside the prompt until they rule". "from the style the DM names" becomes "from a style the DM names from any campaign's catalog". The _Avoid_ line gains "calling an unanswered Suggestion adopted".
- **proposal file:** "(chat gets a summary and a pointer)" becomes "(chat gets a summary, and the DM gets the file itself with its absolute path)".

### Earlier specs

Each gains one line under its header pointing here, so a session reading it before a change does not act on a superseded rule:

- `2026-08-09-forge-prompt-skill-design.md`: approved-by-default Suggestions, Step 0's default to Forge, and multi-reference composition in the editing reference are superseded.
- `2026-08-16-forge-prompt-grounding-and-invention-design.md`: approved-by-default Suggestions are superseded.
- `2026-08-18-forge-prompt-style-gate-and-suggestions-design.md`: silence as an answer, and the style offers at the close, are superseded.
- `2026-08-18-forge-prompt-question-definition-design.md`: its Status line changes from "Approved, not yet implemented" to "Implemented (`7d62069`)", and its pointer notes that silence no longer adopts a Suggestion.

### Version

`professor-orb/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`: 1.16.1 becomes 1.17.0. A minor bump, because what silence does to a Suggestion is a behavior change.

## Verification

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
```

Expected, in order: `0`, `0`, `0`, `0`, `1`, `1` for each file, `0`, `0`, `1`.

The loop must still expose exactly three output blocks:

```bash
sed -n '/^## The loop/,/^## The test runs/p' professor-orb/skills/forge-prompt/SKILL.md | grep '^### '
```

Expected: `Revised Prompt`, `Suggestions`, `Questions`, and `Loop rules`, which is guidance rather than an output block.

Proposal delivery:

```bash
grep -c 'file-delivery tool' professor-orb/skills/SHARED-PRINCIPLES.md
grep -c 'pointer to the' professor-orb/skills/chronicler/SKILL.md professor-orb/commands/migrate.md
```

Expected: `1`, then `0` for each file.

No touched file gains an em dash (Principle 6); every one of them has none today:

```bash
grep -c '—' professor-orb/skills/forge-prompt/SKILL.md professor-orb/skills/forge-prompt/references/*.md professor-orb/skills/SHARED-PRINCIPLES.md professor-orb/skills/chronicler/SKILL.md professor-orb/commands/migrate.md professor-orb/CONTEXT.md
```

Expected: `0` for each file.

No executable code is touched, so all eight Node suites pass unchanged:

```bash
for f in $(find professor-orb -name "*.test.mjs" | sort); do node "$f" || break; done
```

Manual verification, in a consumer project:

1. In Forge mode, leave every Suggestion unanswered. The next Revised Prompt is unchanged, and the Suggestions block lists them again word for word.
2. Say "looks good" with Suggestions held. The prompt comes back unchanged.
3. Describe a change to a subject whose image you have approved. The skill writes an edit prompt in the frame's written form, against `image [1]` alone, with no names in it. Report a disappointing render instead, and it opens in Diagnose.
4. In a campaign with no house style recorded, name another campaign's house style. The skill reads that file, and offers the copy and the `CLAUDE.md` line before the first Revised Prompt, or makes both at once if the request already asked for them.
5. Run chronicler in a worktree session and revise the proposal once. The file arrives with its absolute path after the write and again after the revision, each time with the approval question.

## Not done here

- **A setting-level style catalog.** Reasons under "Another campaign's style is read from its file."
- **Recording the edit workflow's input count.** One input is the default instead.
- **The consumer's own style files.** Two copies of one style in the rolara-project describe their look by a printed object and carry exclusions inside their text. They are the DM's to fix by hand.
