---
description: "Commits the session-reports lane (session-reports/<setting>/<campaign>/, or a v1/v2 project's session-reports location once setup has recorded it) for a git- or github-versioned project. Fed by the debrief skill's session reports and Session Prep briefs, and the content skill's recaps and handouts, all of which live inside the same campaign folder. Resolves the versioning mode from .professor-orb/versioning.json (performing the one-time conversion from catalog-versioning.json if needed), refuses if no settings array has been recorded, checks the git index for anything staged outside the lane and stops rather than working around it, sets aside any session report that looks unfinished (missing required frontmatter or an empty section) by name while committing the rest, then stages exactly the lane's changed paths and commits with the identical pathspec: git add -- <lane> followed by git commit --only -- <lane>, never a bare git commit and never commit --only without the prior add. Authors no KB content itself. Use whenever the DM wants to commit a session report, prep brief, recap, or handout that debrief or content just wrote. Standalone: not part of the debrief, prep, content, chronicler, kb-validator pipeline, and never writes pipeline-state.json."
argument-hint: "[optional: campaign name if the setting has more than one, or \"push\" to push after committing]"
---

# /log: Commit the Session Reports Lane

> **Before you begin:** read `../skills/SHARED-PRINCIPLES.md` (relative to this plugin) and apply its rules throughout this workflow.

You are committing the session-reports lane: the session reports `debrief` writes, the Session Prep briefs `prep` saves alongside them, and the recaps and handouts `content` writes into the campaign's content subdirectory. This command commits exactly that lane, one campaign at a time, and nothing else. It is precise and repeatable by design: capture is a command, not a reminder.

This command is **standalone**. It is not part of the debrief, prep, content, chronicler, kb-validator session pipeline and never writes `.professor-orb/pipeline-state.json`, even though its own inputs come from that pipeline.

## What this command is not

- Not a KB author, and not an author of session reports, prep briefs, recaps, or handouts. `/log` writes none of that content. It commits what `debrief` and `content` (and `prep`, for the briefs sitting beside the reports) already put on disk.
- Not a second approval loop. The DM invoking `/log` is itself the approval to commit whatever is currently sitting uncommitted in this lane (Shared Principle 2 still gates every write that put the content there in the first place; this command only commits what already passed that gate).
- Not a cross-lane tool. `/log` never stages or commits a path outside the session-reports lane, even when it notices uncommitted work elsewhere.

## Step 1: Resolve the versioning mode

Read `.professor-orb/versioning.json`.

**Conversion first.** If `.professor-orb/catalog-versioning.json` exists and `.professor-orb/versioning.json` does not, copy its `mode` and `decided` values unchanged into the new file and mention the conversion in passing. Never rewrite `decided`: the decision was made when it was made, and a fresh date would destroy the only record of that. Do not delete the old file here; setup deletes it after its snapshot commit captures it.

**No marker at all, after the conversion check.** Versioning has never been established for this project. Say plainly that setup has not recorded a versioning decision, and point at setup. Do not offer to establish one here: that first-time offer belongs to `/catalog` and setup alone, not to this command.

**Mode is `changelog`.** The DM explicitly declined version control, or setup recorded the no-git baseline. `/log` has nothing to do: there is no git to commit to, and unlike `/catalog`, there is no single entry to append a changelog line to for a whole session-reports lane. Say so and point at setup if the DM wants to reconsider. Never invent a changelog for the KB.

**Mode is `git` or `github`.** Proceed. The staging and commit mechanism below is identical for both; `github` differs only in that a remote exists to report an unpushed count against and to push to if asked.

## Step 2: Resolve the setting and campaign

Read `.professor-orb/conventions.json`. **A lane is never resolved from a bare `kbRoot`.** If the file is missing, or it has no `settings` array (a v1 or v2 shape), the lane root cannot be resolved at all: refuse, say plainly that setup has not recorded the lane roots, and point at setup. This is a distinct message from an empty lane (Step 5): one says the path is unknown, the other says the path is known and simply has nothing outstanding.

With the `settings` array in hand:

- **Resolve the setting.** With one setting, no question. With more than one, use the one the DM named; otherwise infer from context or check which one has outstanding work, and if more than one setting has outstanding work, ask which to commit rather than guessing, the same resolution the campaign case below already uses. Never silently pick one: this command does not fan out across settings the way `/scribe` does, so a wrong guess here commits into the wrong world's history.
- **Resolve the campaign.** Enumerate the filesystem under that setting's `sessionReportsRoot` for the authoritative list of campaigns (Principle 12); the `campaigns` array in `conventions.json` is a cache that only disambiguates and orders, so a campaign folder created since the last setup run is still visible here. With one campaign, no question. With more than one, use the one the DM named in the invocation; otherwise check which campaign has outstanding work, and if more than one does, ask which to commit rather than guessing. Unlike `/scribe`, which fans out to one commit per setting automatically, `/log` commits one resolved campaign per invocation.

## Step 3: Resolve the lane path

The lane is `<sessionReportsRoot>/<campaign>/`, recursively: the session reports themselves, the Session Prep briefs `prep` saves alongside them in the same folder, the campaign's own index, and the `content/` subdirectory holding recaps, handouts, setpieces, and prompt sidecars, all as a single path for staging and committing (Step 7).

**A lane path that does not exist yet on disk is not an error.** It means nothing has been written there yet; report "nothing outstanding" (Step 5) and stop.

## Step 4: Check the index for foreign paths

Before touching anything, run `git diff --cached --name-only` and check every path it returns against the resolved campaign folder. If anything staged there falls outside the lane, a path the DM staged themselves for another purpose, **stop and report it**. Never silently commit it, and never unstage it: the correct posture on a foreign staged path is to stop and tell the DM, not to quietly work around their own staging. This check is the primary defense; Step 7's mechanism is a second line of defense that happens to leave a foreign staged path untouched even if this check were somehow bypassed, but it is not a substitute for stopping here.

## Step 5: Inspect uncommitted changes within the lane

Run `git status -- ":(literal)<sessionReportsRoot>/<campaign>"` scoped to the campaign folder to see what is new, modified, or deleted inside it, using the same literal pathspec form Step 7 uses and for the same reason: a setting or campaign name containing `*`, `?`, or `[` must not cause this scoping to widen or miss paths. If there is nothing outstanding, say so plainly and do not create an empty commit. This is different from Step 2's "lane root could not be resolved": here the path is known and simply has nothing to commit right now.

**Note uncommitted work in the other two lanes, without acting on it.** While looking at the repository's state, also check whether `kbRoot` or `homebrewRoot` have uncommitted work. If they do, name it in the final report and name the command that owns it (`/scribe` for the KB, `/catalog` for homebrew). Never stage or commit anything in those lanes yourself. The same applies to any other campaign folder under this setting's `sessionReportsRoot` that also has outstanding work: name it and note that `/log` can commit it too, in a separate invocation.

## Step 6: Run the surprise guard, including the unfinished-report guard

Before staging, look over what Step 5 found inside the lane for anything that looks like it does not belong in version control: a large binary, a Foundry export, a file that looks credential-shaped, or a file inside the lane that does not match the schema. `.obsidian/` is exempt: it is expected inside the project and never trips the guard.

**The unfinished-report guard matters most in this lane.** A session report is often written across more than one sitting, so "outstanding" and "ready" genuinely diverge here in a way the other two lanes rarely see. Check every session report file inside the lane that Step 5 found outstanding: if it is missing required frontmatter fields, or carries an empty section where the project's report structure expects content, treat it as unfinished. Set it aside by name rather than folding it into the general guard's stop-and-ask: an unfinished report is expected, ordinary, and not an error to interrupt over. Commit the rest of the lane normally (Step 7) and name the set-aside report in the final report (Step 8) so the DM knows it is still pending.

For anything else that trips the general guard (large binary, Foundry export, credential-shaped file, schema mismatch), **stop and ask about that specific item**, never the whole batch. The DM has three options, each with its own mechanism:

- **Include it.** Continue as normal; it is staged and committed with the rest of the lane.
- **Exclude it, just for now.** The same technique as the unfinished-report guard above: list the lane's cleared paths explicitly in Step 7's pathspec instead of the whole campaign folder, each with its own `:(literal)` prefix, so the flagged item is never staged while everything else commits normally.
- **Exclude it permanently.** Adjust `.gitignore`. That answers a different question than "just for now": it stops the item from tripping the guard on every future run, rather than setting it aside for this one commit.

## Step 7: Stage the lane, then commit

**The staging mechanism is specified, not left to the implementer, because obvious approaches are wrong, in different directions:**

- `git commit --only -- <lane>` with no prior `git add` **silently omits new files**. Measured against real git: in a lane holding one new and one modified article, it committed only the modified one, with no error and exit 0. A freshly written session report or recap is exactly this kind of new file, so this fails at precisely the common case, and it fails quietly.
- `git add -- <lane>` followed by a **bare `git commit`** (no pathspec) commits the **entire index**, including anything the DM staged from another lane, or another campaign. The lane guarantee this command exists to provide would be silently false the moment the DM has staged something themselves.
- **A bare pathspec is not a literal path.** `--` stops option parsing, but git still reads `*`, `?`, and `[` inside the pathspec that follows as wildcards, not as literal text. Measured against real git: with a campaign folder named `settings/zi[st]` sitting next to an unrelated file `settings/zis`, running `git add -- settings/zi[st]` staged `settings/zis` too, and that unrelated file rode along into the commit. A setting or campaign name is DM-chosen and can plausibly contain any of those characters. `:(literal)` disables wildcard interpretation for that pathspec element; `--` and `:(literal)` fix different halves of the same line, and neither substitutes for the other.

The verified mechanism is both steps, in order, with the identical, literal pathspec, and it excludes whatever Step 6 set aside from the pathspec entirely (stage and commit only the files that cleared the guard):

```
git add -- ":(literal)<sessionReportsRoot>/<campaign>"
git commit --only -- ":(literal)<sessionReportsRoot>/<campaign>"
```

If Step 6 set aside an unfinished report, or anything the general guard set aside for temporary exclusion, list the cleared paths explicitly in the pathspec instead of the whole campaign folder, each with its own `:(literal)` prefix, so the set-aside file is never staged or committed alongside the rest. Never substitute `-A`, `.`, or `-a` for the explicit lane pathspec, and never drop the `:(literal)` prefix, even for a name that looks safe: the guarantee should not depend on inspecting the name first.

**Commit message**, written from what actually changed: `session(<setting>/<campaign>): <summary>`, for example `session(rolara/ashes): add 2026-07-24 report`.

## Step 8: Report back

Tell the DM in one short block:

- The commit message and its hash.
- A one-line summary of what was committed (the report, the prep brief if present, any recaps or handouts).
- Anything Step 6 set aside as unfinished, by name, and why (missing frontmatter, an empty section).
- Anything else Step 6's general guard set aside, and why.
- How many commits are unpushed, if a remote exists for this project (`git` mode with a recorded remote, or `github` mode).
- Any uncommitted work Step 5 noticed in `kbRoot`, `homebrewRoot`, or another campaign folder, named with the command that owns it (`/scribe`, `/catalog`, or `/log` again for the other campaign).

**Pushing is not part of the default flow.** Report the unpushed count; that is how the DM knows a push is worth requesting. Only push if the invocation asked for one. Never push unasked, and never push to a remote the project has not already confirmed.

## Things to never do

- **Never stage or commit a path outside the resolved campaign folder.** Not the DM's own foreign-staged path, not another lane, not another campaign.
- **Never commit a report the unfinished-report guard set aside.** Exclude it from the pathspec entirely; do not stage it and then decline to mention it.
- **Never run a bare `git commit` after staging the lane**, and **never run `git commit --only` without first running `git add` on the identical pathspec.** Both are measured failure modes, not style preferences.
- **Never drop the `:(literal)` prefix from a lane pathspec, and never drop the `--` separator either.** They fix different problems (wildcard interpretation vs. option parsing); a setting or campaign name with a glob character can otherwise pull in an unrelated file lying next to the lane.
- **Never resolve a lane from a bare `kbRoot` on a v1 or v2 conventions file.** Refuse and point at setup instead.
- **Never invent a changelog entry.** In `changelog` mode there is nothing for this command to do; say so.
- **Never create an empty commit.** If nothing is outstanding in the lane, say so and stop.
- **Never unstage the DM's own staged work**, even a foreign path found at Step 4. Report it and stop; do not touch it.
- **Never write `.professor-orb/pipeline-state.json`.** This command is outside the session pipeline.
- **Never push without being asked, or to an unconfirmed remote.**
- **Never force, reset, or resolve a repository-state problem (a merge in progress, a detached HEAD) on the DM's behalf.** Report it and stop.

## Edge cases

- **Nothing outstanding in the lane.** Say so. Never create an empty commit.
- **Lane root unresolvable** (no `settings` array). Refuse, point at setup. Distinct from an empty lane.
- **Foreign paths already staged.** Report and stop (Step 4).
- **Mode is `changelog`, or no `versioning.json` (and no legacy marker to convert).** Nothing to do. Say so and point at setup.
- **Repository state blocks committing** (a merge in progress, a detached HEAD). Report and stop.
- **A lane path does not exist yet.** Nothing outstanding, not an error.
- **A session report looks unfinished.** Set it aside by name, commit the rest of the lane (Step 6).
- **More than one setting has outstanding work.** Ask which to commit, or commit the one the DM named; do not silently pick one.
- **More than one campaign has outstanding work.** Ask which to commit, or commit the one the DM named; do not silently pick one or fan out across all of them the way `/scribe` fans out across settings.
- **A file moved between this lane and another prong.** Each command sees only its own lane, so the move lands in two separate commits, one from each command. Acceptable: the alternative is reaching outside the lane.

## How this command connects to the others

- **Standalone**: runs on demand, independent of the session pipeline's state, and never writes `.professor-orb/pipeline-state.json`, even though its own content comes from pipeline skills.
- **Fed by:** the `debrief` skill, which writes the session report and campaign index, the `prep` skill, which saves its Session Prep brief alongside the report in the same campaign folder, and the `content` skill, which writes recaps, handouts, setpieces, and prompt sidecars into the campaign's `content/` subdirectory.
- **Reads:** `.professor-orb/versioning.json` (performing the one-time conversion from `.professor-orb/catalog-versioning.json` if needed) and `.professor-orb/conventions.json`'s `settings` array for the resolved setting's `sessionReportsRoot`.
- **Writes:** one commit per resolved campaign with outstanding session-reports-lane changes. Writes `.professor-orb/versioning.json` only when Step 1's conversion is pending. Never writes session-reports content itself.
- **Names, but never touches,** uncommitted work in the KB or homebrew lanes, pointing at `/scribe` or `/catalog` respectively, and uncommitted work in another campaign, pointing at another `/log` run.
