# /unfuck as a user-level skill

- **Date:** 2026-10-16
- **Branch:** `claude/bold-lehmann-0b0eb8`
- **Status:** tested, waiting on the user's read of the skill text

## Goal

The user builds tools with Claude through specs, plans and approval gates. Sometimes they approve something that later turns out not to be what they meant, or lose track when the work gets complex. In their words (2026-10-16), a command "for when I accidentally approve or miss something in a spec or plan, or when things just get over my head", used alongside the superpowers plugin.

Success looks like this:

- Typing `/unfuck` in any project says back what feels wrong in one line, finds the spec or plan line that allowed it and every place it landed by reading, explains built versus meant in plain words, and proposes the smallest way back with a before-and-after.
- After one OK it makes the change, test first where code is involved, and corrects the spec, plan and results so the written history matches what exists.
- Claude also runs it when the user says in words that something isn't what they meant.

## Decisions (settled 2026-10-16)

1. **User level, same setup as `land`.** The master copy is a new top-level folder, `unfuck/`, and `~/.claude/skills/unfuck` is a folder junction to the main checkout's `unfuck/`, so an edit goes live when it lands on `main`. The user needs it in every project (wonderdungeon and the rest), and a user-level skill is the only shape typed as plain `/unfuck`.
2. **Callable by Claude.** No `disable-model-invocation`, for the reason `land` gives: requiring the typed command when Claude already knows the skill is wrong.
3. **The source line gets corrected, not only logged.** Checked against the real case (wonderdungeon commit 0770b7d, the Shadows button): that fix logged the reversal under "Changed after delivery" but left the spec's goal line, the plan's Task 13 and the results file's "What was built" line describing the button as current. The skill rewrites the spec line to say what the user means now, marks old lines in plans and results as history in place, and searches again until every mention is true or marked.
4. **A lost user gets a map before a question.** "Over my head" often means the user can't name the wrong thing. The skill gives a five-line map (asked for, agreed, built, waiting on them) and then asks which part feels wrong.
5. **One OK, then the project's usual finish.** The proposal is the scope and spec gate in one; finishing the branch still asks before merging.
6. **The fix is a fixed list of four things.** The part objected to, code and tests used only by it, the documents that describe it, and what the user wants instead made from what exists. Everything else goes in the report as a suggestion, and the build asks before doing anything the proposal didn't cover. Added after the baseline test (below) showed fixes growing.
7. **The description says only when to use it.** The first draft summarized the steps; superpowers:writing-skills found that a summary in the description gets followed in place of the body.

**Considered and rejected:**

- **A plugin in the marketplace.** Plugin skills are namespaced (`/unfuck:unfuck`), and every edit would need a version bump in two files to reach installs. One `SKILL.md` with no hooks or agents gains nothing from a plugin.
- **Only in `~/.claude/skills`.** No history or backup.

## Test (2026-10-16)

Scenario: a copy of wonderdungeon's main branch, which still has the Shadows button (the real fix, commit 0770b7d, is on another branch and was kept out of the copy). The user's message: "I never wanted a Shadows button in the editor. I meant for shadows to be laid from the conversation, by you." Each run read only, then gave its reply and the full list of changes it would make on "yes". Opus, with the user's global instructions. The answer key was written before any run.

**Without the skill (3 runs, plus the real fix as a fourth):** saying back, finding the source and every code spot, keeping what `wd shadows` needs, the whole-toolbar before-and-after, owning the mistake and one question were already right in all three; the user's global instructions cover them. Two failures repeated:

- The build plan kept describing the button (all four; two runs argued it is "the record of what was planned"). The real fix also left the spec's goal line stale.
- The fix grew. Two of three runs reworked shared shadow code that still works and edited the project's `CLAUDE.md`; one also fixed an unrelated sentence; one never showed its extra changes in the proposal.

Decisions 6 and 7 and the "Common mistakes" section answer these.

**With the skill (3 runs, same scenario, fresh copies):** all three marked the plan's button lines and kept the original text, kept every change inside the four things, left the shared shadow code alone and listed its leftovers as suggestions, and showed every change in the proposal. Everything the baseline already did stayed right. Two runs also said what the user loses (the green and red marks before shadows go down; clearing a light direction). One wording gap: two runs put the "removed" note on every line of the button task (12 notes), one on its heading. Step 5.4 now says to mark a whole section once at its heading; that last line was not retested.

Not tested: the "lost" case in step 1, where the user can't name what is wrong.
