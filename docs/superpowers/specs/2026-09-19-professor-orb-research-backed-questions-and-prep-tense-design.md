# professor-orb: Research Before Asking, Questions That State Their Subject, and Prep's Two Tenses

**Date:** 2026-09-19
**Status:** Implemented in 1.18.0
**Scope:** `professor-orb/skills/SHARED-PRINCIPLES.md` (two new principles); `professor-orb/skills/debrief/SKILL.md`; `professor-orb/skills/prep/SKILL.md`; `professor-orb/skills/chronicler/SKILL.md`; `professor-orb/skills/timeline/SKILL.md`; `professor-orb/skills/setup/SKILL.md`; `professor-orb/CONTEXT.md`; both version manifests.
**Source:** the DM's report, `docs/professor-orb-report-2026-09-19.md` in the rolara-project repository (commit `0dd728c`), compiled from one worktree session that ran `prep`, `debrief`, and `chronicler` for the campaign Adjustice.

## What went wrong in 1.17.0

1. **debrief asked what the files already said.** Phase 2 measured a gap against intake alone, so a round could ask for something the campaign's articles already recorded, and nothing told the skill to read between rounds. Once the DM asked for research before each round, the rounds surfaced real conflicts instead: a character sheet whose pronouns disagreed with the DM's account, and a sheet still listing a power the player had dropped.

2. **A question depended on text the DM could not see.** debrief proposed a dice pool in chat, then asked about it by referring back to it. The desktop app had folded the chat text holding the pool into a one-line summary, so the question carried nothing the DM could answer. Restating the pool inside the question fixed it the next round.

3. **prep offered past events as scenes to run.** Phase 1's options, drawn from the last report's cliffhangers, restated events that had already happened in a form that read as plans.

## Design decisions and why

### Look it up before every question, and only for that question

Principle 14 is keyed to an action, the AskUserQuestion call, so it runs whether or not the skill judges a question obvious.

The lookup reaches the things the call's questions turn on, and those files alone. That keeps it clear of two rules it could otherwise collide with: debrief leaves deep KB cross-referencing to the `lore` agent, and prep's Step 3b keeps research to the topics the DM names. A lookup scoped to the next question is neither.

A question the files answer drops out, and the answer appears in the call's text with its source. The DM chose this over writing the answer straight into the draft. The report shows files go stale, and a fact stated in the round is caught in the same reply, where one written into the draft is caught at review, if at all.

A disagreement between the files and the DM becomes the question. Principle 1 already says the DM wins and the conflict is surfaced; Principle 14 is where it gets surfaced.

It is a shared principle rather than a debrief step because every component that asks the DM a question has the same exposure. debrief also gets the step spelled out in Phase 2, where the failure happened.

### A question states its subject

Principle 15 is a rule about the question's text, checkable by reading it: the question contains the thing it asks about. Explanations, drafts, and delivered files still come before questions as they do now, and the DM usually sees them. The question carries enough that it no longer depends on them.

The first draft of this design assumed every text above a question is folded away, and routed long drafts around questions to compensate. The DM's screenshot showed otherwise: explanations above a question are usually visible, and the failure was a question that leaned on one that was not. The fix belongs in the question, and the routing was dropped.

For something long, the question states what the decision turns on (a proposal's totals and flagged items) rather than reproducing it, so the DM decides inside the app.

Four places get a clause, because each asks about something shown before the question: debrief's rounds, chronicler's approval, timeline's triage, and setup's prong-mapping confirmation. The last two were not in the report; an audit of every AskUserQuestion call site found them. Timeline's is the most exposed, since the DM picks a triage route for a contradiction whose evidence sits above the question. Every other call site follows the principle with no edit of its own.

### prep writes a report thread in two tenses

An option or north star taken from the report is written as two labeled parts: **Last session**, what happened, in past tense; and **Next**, the scene that follows from it. The form leaves no slot where the old event can stand as the plan, because the Next part names what follows it. The report's suggestion, keeping the two tenses in separate sentences, is the same fix given a fixed shape.

Only prep builds forward-looking material from a report, so the form lives there.

### Numbering

Both principles append after Principle 13, so no existing reference to a principle number changes (`rule-fixer`, `/sweep`, and prep all cite Principle 13).

## What ships

### `professor-orb/skills/SHARED-PRINCIPLES.md`

Two principles append after Principle 13:

> ## 14. Look it up before you ask
>
> Before each AskUserQuestion call, read what the project's files say about each thing a question in that call turns on: its KB article or staged article, the campaign's earlier session reports, and any other file the project keeps on it, such as a character sheet or a prep brief. The lookup covers those files, for the questions at hand. Content exclusions and Principle 13 bound it like any other read.
>
> Each question then takes one of three forms:
>
> - **The files answer it.** The question drops out, and its answer goes in the call's text with its source, where the DM can correct a stale file in the same reply: "From the files: Vela Thorne is the harbormaster's sister ([[Vela Thorne]])." If no question is left to ask, say it in chat instead.
> - **The files and the DM disagree.** Ask about the disagreement, quoting both sides. The DM's answer settles it (Principle 1).
> - **The files say nothing.** Ask the question.
>
> ## 15. A question states what it asks about
>
> Each AskUserQuestion question carries, in its own text or its options, the content of the thing it asks about: enough to answer with nothing else on screen. Earlier messages are not always in view when a question appears; the Claude desktop app sometimes folds them into a one-line summary. Explanations, drafts, and files can still come first, and the question restates what the decision turns on:
>
> - A proposal is written out: "Morale roll: 5 dice. 3 for the militia's numbers, 2 for the fortified gate, 1 for the paladin's speech, minus 1 for the fallen captain. Use it as written?"
> - Something long is summarized by what the decision turns on: "Approve the lore update: 3 new articles (Sunken Temple, Vela Thorne, Cinder Pact), 5 edits, 2 items that need your call?"

### `professor-orb/skills/debrief/SKILL.md`

**Phase 2, What to probe.** "Compare what you already know from intake against this checklist, and only ask about gaps:" becomes:

> Before every round, look up each entity the round will touch, per SHARED-PRINCIPLES Principle 14: its article, the campaign's earlier reports, and any character sheet. Compare what intake and the files tell you against this checklist, and ask about what neither answers:

**Phase 2, Round discipline.** "Do not ask about anything already answered in intake or a prior round." becomes "Do not ask about anything already answered in intake, a prior round, or the files." A sentence follows "Do not ask filler.":

> Anything a question proposes, such as a dice pool, is written out in the question itself (Principle 15).

**Phase 4.** "Do not attempt the deep KB cross-referencing yourself; that is the `lore` agent's job." gains a sentence:

> Phase 2's lookups served its questions and end with them.

### `professor-orb/skills/prep/SKILL.md`

**Step 1b, question 4** gains a closing sentence:

> An option you draw from the report is written in the two-part form under Section 3's "Building the list."

**Section 3, Building the list** gains a bullet after "If supplementing, clearly mark which north stars came from the DM":

> - **Write anything drawn from the report in two parts.** **Last session:** what happened, in past tense. **Next:** the scene that follows from it, which is the north star. For example: **Last session:** Vela Thorne fled the harbor with the ledger. **Next:** the Compact's agents come asking who helped her.

### `professor-orb/skills/chronicler/SKILL.md`

**Step 1c, Ask for approval.** "Use AskUserQuestion to offer the DM a choice:" becomes:

> Use AskUserQuestion, with the summary stated in the question itself (Principle 15), to offer the DM a choice:

### `professor-orb/skills/timeline/SKILL.md`

**Step 3a.** "Use AskUserQuestion with these four routes:" becomes:

> Use AskUserQuestion with these four routes, stating in the question the two claims that conflict, a line each, with the file each comes from (Principle 15):

### `professor-orb/skills/setup/SKILL.md`

**Step 7.** "confirm the source-to-destination mapping with the DM via AskUserQuestion before anything moves." becomes:

> confirm the source-to-destination mapping with the DM via AskUserQuestion before anything moves, stating each prong's move in the question itself (Principle 15).

### `professor-orb/CONTEXT.md`

**interrogation:** "asked via the AskUserQuestion tool (mandatory mechanism, not optional), continuing until the DM explicitly ends it" becomes "asked via the AskUserQuestion tool (mandatory mechanism, not optional), each round preceded by a lookup in the project's files (Principle 14), continuing until the DM explicitly ends it". The entry is rewrapped to the file's width without moving any other line.

### Version

`professor-orb/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`: 1.17.0 becomes 1.18.0. A minor bump, because debrief's rounds and prep's options change behavior.

## Verification

```bash
cd professor-orb/skills
grep -c '^## 14\. Look it up before you ask$' SHARED-PRINCIPLES.md
grep -c '^## 15\. A question states what it asks about$' SHARED-PRINCIPLES.md
grep -c 'only ask about gaps' debrief/SKILL.md
grep -c 'Principle 14' debrief/SKILL.md
grep -c 'Principle 15' debrief/SKILL.md chronicler/SKILL.md timeline/SKILL.md setup/SKILL.md
grep -c '\*\*Last session:\*\*' prep/SKILL.md
```

Expected, in order: `1`, `1`, `0`, `1`, `1` for each file, `1`.

No touched file gains an em dash (Principle 6); every one of them has none today:

```bash
grep -c '—' professor-orb/skills/SHARED-PRINCIPLES.md professor-orb/skills/debrief/SKILL.md professor-orb/skills/prep/SKILL.md professor-orb/skills/chronicler/SKILL.md professor-orb/skills/timeline/SKILL.md professor-orb/skills/setup/SKILL.md professor-orb/CONTEXT.md
```

Expected: `0` for each file.

No executable code is touched, so all eight Node suites pass unchanged:

```bash
for f in $(find professor-orb -name "*.test.mjs" | sort); do node "$f" || break; done
```

Manual verification, in a consumer project:

1. In a debrief, mention an entity whose article records what the next round would ask about. The round states that fact with its source instead of asking it.
2. In a debrief, give an account a character sheet contradicts. The next round asks about the disagreement and quotes both sides.
3. Have debrief propose a roll. The question that asks about it carries the pool itself.
4. Run prep against a report whose open threads include events that already happened. Phase 1's options and any supplemented north stars show a Last session part and a Next part.
5. Run chronicler to its approval question. The question states the totals and any flagged items.

## Not done here

- **A research step of its own in prep or chronicler.** Principle 14 covers both, which is why the report asked for a principle.
- **Edits at the other AskUserQuestion call sites** (content, homebrew, orb, `/catalog`, `/sweep`, `/migrate`, and setup's enforcement-level confirmation). Principle 15 covers them.
- **Routing long drafts around questions.** Dropped with the first draft's reading of the app; see "A question states its subject."
