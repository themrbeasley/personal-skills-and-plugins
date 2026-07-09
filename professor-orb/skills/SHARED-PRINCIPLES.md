# Shared Principles for Session Pipeline Skills

> Every pipeline skill (debrief, prep, content, chronicler) must follow these principles. Read this file at the start of every run, alongside the project's CLAUDE.md.

## 1. The DM is the source of truth

The DM's answers override session reports, KB articles, prep files, and any other document. When a conflict exists between what the DM says and what a file says, the DM wins. Surface the conflict so the DM is aware, then follow their direction.

Do not silently prefer a document over a direct statement from the DM.

## 2. Propose, then execute

No pipeline skill writes, edits, or creates files without the DM's explicit approval. The workflow for every skill is:

1. Gather inputs (read reports, articles, CLAUDE.md).
2. Draft the output (report, prep brief, content piece, lore proposal).
3. Present the draft to the DM.
4. Wait for approval, requested changes, or rejection.
5. Only after approval: write to disk, update indexes, update logs.

The DM reviews the product before it becomes a file. This is a hard gate, not a suggestion.

## 3. Ask, listen, trust

When you ask the DM a question and they answer, trust the answer. If the DM says a task is done, it is done. If the DM says something happened that a report does not mention, it happened. If the DM corrects a detail, the correction is canon.

Do not re-list completed work as open tasks. Do not second-guess direct answers. If something seems contradictory, surface it as a question, not an assumption.

## 4. Distinguish DM prep from player objectives

Things the DM needs to prepare before a session (scenes, handouts, NPC motivations, VTT setup) are DM prep. Things the party needs to figure out in-play ("how do we get underwater," "should we trust the NPC") are player objectives. Never list player objectives as DM tasks.

## 5. Account for elapsed time

Sessions happen weekly or less frequently. When a skill runs, check the current date against the report date. If time has passed, assume the DM has been working. Ask what has been done since the report was written, and listen to the answer (Principle 3).

## 6. No em dashes

Do not use em dashes in any output. Use commas, colons, parentheses, or restructure the sentence.

## 7. Never invent canon

Everything written must be traceable to a session report, the DM's direct statements, an existing KB article, or a convention in CLAUDE.md. If a detail is missing, ask or write around the absence. Fabrication is the worst failure mode.

## 8. Scope discipline

Do not create files, memory entries, or auxiliary documents beyond what the skill's output specifies. Do not do "while I'm in there" rewrites. Do not create scratch files, execution logs, or manifests unless the project's conventions call for them.

## 9. Conventions file is authoritative

For structural checks, skills read `.professor-orb/conventions.json` rather than re-deriving rules from CLAUDE.md each time. The conventions file is a machine-checkable derivation maintained by the setup skill; when it exists, prefer it over re-inferring structure from prose. If it is missing or looks stale, say so and suggest running setup rather than guessing.

## 10. Pipeline state updates

Every pipeline skill's final act is updating `.professor-orb/pipeline-state.json` with what completed and what comes next. This breadcrumb drives the Stop hook's next-step suggestion and answers "where were we?" in fresh sessions. A skill that finishes without updating this file has left the pipeline in an unknown state.
