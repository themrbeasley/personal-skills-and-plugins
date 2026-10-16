---
name: unfuck
description: Use when the user says something they approved in a spec or plan is not what they meant, that they missed or approved something by accident, that a feature they never wanted got built, or that the work has gotten over their head and they are lost.
argument-hint: "[what feels wrong]"
---

# /unfuck

Something the user approved, or something built from it, is not what they meant; or the work has grown past what they can follow. Get back to what they meant with the smallest change, and leave the written record telling the truth.

Write every message about what the user sees and does; when a file name helps, put it after the plain description.

## 1. Say back what feels wrong

Say it back in one line from `$ARGUMENTS` or the user's message: "You never wanted X; you wanted Y." When the message doesn't say what, ask in one line and wait.

When the user is lost rather than pointing at one thing, first give a map of five lines at most: what they asked for, what the spec agreed, what is built, what is waiting on them. Then ask which part feels wrong.

## 2. Find the source and every place it landed

Find these by reading; ask only what reading cannot answer. The project's `CLAUDE.md` may say where specs, plans, results and trackers live.

- **The source:** the exact spec or plan line that allowed it, quoted with file and line (`git grep -n -i "<word>"`; `git log -S"<word>"` finds the commit that added it).
- **Where the miss happened:** the spec said it and the user approved it; the plan added it beyond the spec; or the build added it beyond the plan.
- **Every place it landed:** code, screens, tests, guides, roadmap, tracker, results, plan, other specs, commits. Write it as a list; step 5 works through it.
- **What stays:** anything that something the user does want relies on.

## 3. Explain it in plain words

1. **Built versus meant**, in terms of what the user sees and does.
2. **How it got in.** Quote the source line and own Claude's part plainly, this session's or an earlier one's. A change of mind is normal; say so in a few words.
3. **What held up.**

## 4. Propose the smallest way back

The change covers these four things and only these:

1. the part the user objected to;
2. code and tests used only by that part;
3. the documents that describe it (step 5);
4. what the user said they want instead, made from what already exists. When it needs something new, say so and offer it as its own step.

Shared code that keeps working stays as it is, even when part of it goes unused. Anything else you notice along the way (a wrong sentence elsewhere, a tidy-up, a new instruction for future sessions) goes in the report as a suggestion.

Show a before-and-after of what the user will see: for a screen, the whole area the change touches (the full toolbar, not only the button); for behavior, one line for now and one for after. List what stays. When even the smallest change reaches into the design, say so and offer a fresh spec instead.

Ask for the OK once, as one question, and wait for the yes.

## 5. Make the change and correct the record

Make exactly the change the user approved. When the work turns up something the proposal didn't cover, ask before doing it.

1. **Tests first where code changes behavior.** Change the tests to describe what the user meant and watch them fail; delete tests that only covered the removed part. Then change the code until the whole test suite passes.
2. **Work through the step 2 list.**
3. **Correct the source.** Rewrite the spec line to say what the user means now, and add a dated entry under the spec's changes section (create one when missing) saying what changed and why.
4. **Mark history in place.** In the plan and the results file, keep each line that describes the old thing and add after it "(removed on <date> at the user's request; see <where the entry is>)". When a whole section describes it, such as a plan task, mark its heading once. Add the dated entry where the project keeps its record: the results file's "Changed after delivery" section, the tracker, or what `CLAUDE.md` names.
5. **Check the record.** Search the docs for the thing again; every mention left is either true today or marked as history.
6. **Commit** as a fix whose message says in plain words what the user wanted instead.
7. **Report** what changed, what you checked and how, what you could not check, and the suggestions from step 4. End with numbered steps for the user to see the result. Finish the branch the project's usual way, with the user's OK before merging.

## Common mistakes

- **Logging the reversal but leaving the source.** The wonderdungeon Shadows button was removed and logged under "Changed after delivery", but the spec's goal line, the plan's button task, and the results file's "What was built" and "What to try" lines still described it, ready for a later session to build it again. Steps 5.3 to 5.5 catch this.
- **Leaving the plan untouched as "the record of what was planned".** It is a record, and the next session also reads it as instructions. Keep the line and mark it.
- **Growing the fix.** Reworking shared code that still works, fixing an unrelated sentence, or adding instructions to `CLAUDE.md`, some of it never shown in the proposal. Step 4's four things are the whole change.
