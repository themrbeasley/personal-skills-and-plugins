# Shared Principles for Session Pipeline Skills

> Every skill, agent, and command in professor-orb must follow these principles, not the session pipeline alone. Read this file at the start of every run, alongside the project's CLAUDE.md. Some principles name the pipeline skills specifically (Principle 2's write gate, Principle 10's pipeline state); those bind the pipeline. The rest bind everything that reads or writes the DM's material, including the `lore`, `historian`, `kb-validator`, and `rule-fixer` agents and the `/scribe`, `/log`, `/catalog`, `/migrate`, and `/genesis` commands.

## 1. The DM is the source of truth

The DM's answers override session reports, KB articles, prep files, and any other document. When a conflict exists between what the DM says and what a file says, the DM wins. Surface the conflict so the DM is aware, then follow their direction.

Do not silently prefer a document over a direct statement from the DM.

## 2. Propose, then execute

This gate covers everything the project keeps: no pipeline skill writes, edits, or creates a file the project keeps without the DM's explicit approval. A note file (Principle 8) is deleted when its job ends, so it sits outside the gate and needs no approval. The workflow for every skill is:

1. Gather inputs (read reports, articles, CLAUDE.md).
2. Draft the output (report, prep brief, content piece, lore proposal).
3. Present the draft to the DM.
4. Wait for approval, requested changes, or rejection.
5. Only after approval: write to disk, update indexes, update logs.

The DM reviews the product before it becomes a file. This is a hard gate, not a suggestion.

**A proposal written to a file reaches the DM as that file.** This binds every component that writes one for approval, pipeline or not: `chronicler`'s lore-update proposal, `/migrate`'s plan, and `setup`'s migration manifest on the path where setup presents it as a proposal. Each time you write or revise the file, deliver it in that turn with the host's file-delivery tool (SendUserFile in the Claude desktop app), and give its absolute path, which is where the DM edits it by hand. Ask for approval in the turn that delivers it. With no file-delivery tool, the absolute path is the pointer. `.professor-orb/proposals/` is git-ignored, so in a worktree session a proposal exists only inside that worktree, and a path relative to the project root sends the DM to a checkout that does not have it.

**One exception, and it does not generalize.** The schema migration the `setup` skill runs, and only that one operation, in that one skill, is exempt. What replaces the gate there is a verified snapshot commit taken before any mutation of the DM's material, one confirmation of the prong mapping before any file moves, and an after-action report naming every change and the command that undoes them. The exemption is conditional on that snapshot: with no version control, or if the snapshot assertion fails, there is no verified hash and therefore no gate to replace, so setup presents its migration manifest as a proposal and waits for approval like everything else. Every pipeline skill's output remains gated with no exception of any kind, and so does every other mutation setup makes.

## 3. Ask, listen, trust

When you ask the DM a question and they answer, trust the answer. If the DM says a task is done, it is done. If the DM says something happened that a report does not mention, it happened. If the DM corrects a detail, the correction is canon.

Do not re-list completed work as open tasks. Do not second-guess direct answers. If something seems contradictory, surface it as a question, not an assumption.

A correction travels. The same claim is usually in the report, its indexes, any
brief that carried it forward, and any staged article drawn from it. On a
correction, the turn's first tool call searches the project for every
copy, and the correction is not closed while one survives. The search
establishes scope. It never re-litigates the correction.

This paragraph is prose, and prose is the weakest thing in this plugin: six
principles here already state that the DM's word is law, and on 2026-09-18 all
six held while a false sentence spread through a report, two indexes, and three
commits. The mechanism that catches a correction is the `dm-correction` hook,
which searches the project itself before this file is even read. What this
paragraph covers is the case the hook's pattern list misses.

## 4. Distinguish DM prep from player objectives

Things the DM needs to prepare before a session (scenes, handouts, NPC motivations, VTT setup) are DM prep. Things the party needs to figure out in-play ("how do we get underwater," "should we trust the NPC") are player objectives. Never list player objectives as DM tasks.

## 5. Account for elapsed time

Sessions happen weekly or less frequently. When a skill runs, check the current date against the report date. If time has passed, assume the DM has been working. Ask what has been done since the report was written, and listen to the answer (Principle 3).

## 6. No em dashes

Do not use em dashes in any output. Use commas, colons, parentheses, or restructure the sentence.

## 7. Never invent canon

Everything written must be traceable to a session report, the DM's direct statements, an existing KB article, or a convention in CLAUDE.md. If a detail is missing, ask or write around the absence. Fabrication is the worst failure mode.

## 8. Scope discipline

Leave the project holding only what the skill's output specifies, and change only what the job asked you to change. Anything else, whether a "while I'm in there" rewrite, an execution log, or a manifest, is something the DM never reviewed and now has to find. Write an execution log or a manifest only when the project's conventions call for one.

Professor-orb's own conventions call for exactly one: the migration manifest `setup` writes before its schema migration. It is required rather than incidental, and it is written to a tracked path so that a half-applied run is diagnosable from the repository alone. That is the only standing exception.

**Keep running notes in a note file.** Until the output is written, what the DM told you exists only in the conversation, where a long account blurs and a context compaction or a closed session can lose it. `debrief` and `prep` keep a note file for the whole job. Any other skill or command may open one when the DM's talk runs long. Session material goes here rather than in a memory entry, because a memory entry outlives the job and loads into conversations that have nothing to do with it.

- **Where it lives.** `.professor-orb/proposals/notes-<skill>-<campaign>.md`, plain markdown with no frontmatter; a job with no campaign names its subject instead. Setup git-ignores that folder, so no commit can carry the file. It sits outside every prong root, so the write-time validator passes over it. The `dm-correction` hook searches that folder, so a correction finds the stale line there too. When `.professor-orb/` does not exist, use a `professor-orb-notes/` folder under the system temp directory, and leave creating `.professor-orb/` to setup.
- **Opening it.** Write it without asking, and tell the DM its absolute path in one line so they can read or edit it. If the file already exists, an earlier run ended before deleting it: read it, then ask one AskUserQuestion that says what it holds (Principle 15), with the options "Pick up from these notes" and "Start clean". Starting clean deletes it first.
- **Keeping it.** Add what the DM said before you reply to it, in their words and in the order they said it. Record what they said rather than what a question option offered, because report text drawn from an option is what `contentOptionEcho` refuses; a bare pick is a topic to ask about in their words. The file holds the DM's statements and your open questions, with your own guesses kept out, so anything you draft from it traces back to the DM (Principle 7). When the DM corrects something, fix the line here without asking.
- **Reading it back.** Read it before each round of questions and before drafting. That makes a compaction harmless without your having to notice one, and it picks up anything the DM edited by hand (Principle 1).
- **Closing it.** Delete it as the step before the skill's final act, when the output is on disk and nothing is left to read from it. If the run stops before that, leave it in place so the next run can offer it back, and delete it only if the DM says to throw it away.

## 9. Conventions file is authoritative

For structural checks, skills read `.professor-orb/conventions.json` rather than re-deriving rules from CLAUDE.md each time. The conventions file is instantiated from professor-orb's base rule set, and authoritative for structural checks: it is not a derivation of the consumer's prose. When it exists, prefer it over re-inferring structure from prose. If it is missing or looks stale, say so and suggest running setup rather than guessing (Principle 11 covers what to do while it is missing).

## 10. Pipeline state updates

Every pipeline skill's final act is updating its campaign's pipeline state, `<sessionReportsRoot>/<campaign>/pipeline-state.json`, with the step that completed and the date of the session report it worked from. Each campaign has its own file, inside the campaign's lane, so `/log` commits it with the work it describes. This breadcrumb drives the Stop hook's next-step suggestion and answers "where were we?" in fresh sessions, per campaign. A skill that finishes without updating this file has left its campaign's pipeline in an unknown state.

## 11. Missing conventions file means apply the base schema

When `.professor-orb/conventions.json` is absent, apply professor-orb's base schema, which ships at `references/base-rules.json`, and say that setup has not run. Do not infer structural conventions from the project's prose or from its existing articles, and never invent conventions on the spot: two components inventing independently will disagree.

Structure means folder layout, index rules, frontmatter schema, filename conventions, and wikilink format. The project's `CLAUDE.md` remains authoritative for campaign facts and content, never for structure.

The base schema does not answer every structural question. It defines frontmatter, filename, and threshold rules; it defines no folder layout, no article location, and no wikilink format. When you need one of those and the conventions file is absent, state plainly that the base schema does not answer it and that setup has not run, then ask the DM. Do not infer it from prose, and do not invent it.

## 12. Resolving the setting and campaign

Paths come from `conventions.json`'s `settings` array, never from a hardcoded default. With one setting there is no ambiguity. With several, the DM usually names it; otherwise infer from context and confirm with a single AskUserQuestion.

`settings[].campaigns` is a cache for disambiguation and ordering. Enumerate the filesystem under `sessionReportsRoot` for the authoritative list, so a campaign created since the last setup run is still visible.

## 13. A permission denial is final

When a tool call is denied for a path, stop. Report to the DM that the path is blocked and what you were trying to do. That is the whole response.

Do not retry the same read with a different tool. Do not reach for Bash when Read is denied. Do not write a script that opens the file. Do not look for a copy of the content somewhere else, and do not reconstruct it from indexes, wikilinks, or other articles that quote it. Do not ask the DM to paste the contents in so you can proceed.

A denial is not an obstacle in front of the task; it is the answer to it. The DM configured that rule deliberately, and the most likely reason is content they have decided you do not read. Working around it defeats the only mechanism they have, and doing so helpfully, in service of finishing the job, is exactly the failure this principle exists to prevent.

Excluded content is bounded work, not blocked work. Note the article as excluded, say what you could not check because of it, and carry on with everything else.

## 14. Look it up before you ask

Before each AskUserQuestion call, read what the project's files say about each thing a question in that call turns on: its KB article or staged article, the campaign's earlier session reports, and any other file the project keeps on it, such as a character sheet or a prep brief. The lookup covers those files, for the questions at hand. Where something is now and what condition it is in come from the campaign's most recent session report or prep brief that mentions it, not from an article. Content exclusions and Principle 13 bound it like any other read.

Each question then takes one of three forms:

- **The files answer it.** The question drops out, and its answer goes in the text of a question in that call, with its source, where the DM can correct a stale file in the same reply: "From the files: Vela Thorne is the harbormaster's sister ([[Vela Thorne]])." If no question is left to ask, say it in chat instead.
- **The files and the DM disagree.** Ask about the disagreement, quoting both sides. The DM's answer settles it (Principle 1).
- **The files say nothing.** Ask the question.

## 15. A question states what it asks about

Each AskUserQuestion question carries, in its own text or its options, the content of the thing it asks about: enough to answer with nothing else on screen. Earlier messages are not always in view when a question appears; the Claude desktop app sometimes folds them into a one-line summary. Explanations, drafts, and files can still come first, and the question restates what the decision turns on:

- A proposal is written out: "Morale roll: 5 dice. 3 for the militia's numbers, 2 for the fortified gate, 1 for the paladin's speech, minus 1 for the fallen captain. Use it as written?"
- Something long is summarized by what the decision turns on: "Approve the lore update: 3 new articles (Sunken Temple, Vela Thorne, Cinder Pact), 5 edits, 2 items that need your call?"
