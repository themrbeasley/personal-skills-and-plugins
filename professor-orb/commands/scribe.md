---
description: "Commits the setting KB lane (settings/<setting>/, or a v1/v2 project's kbRoot once setup has recorded it) for a git- or github-versioned project. Fed by the chronicler skill's lore updates and the timeline skill's chronology documents, and also captures the DM's own direct Obsidian edits to the KB. Resolves the versioning mode from .professor-orb/versioning.json (performing the one-time conversion from catalog-versioning.json if needed), refuses if no settings array has been recorded, checks the git index for anything staged outside the lane and stops rather than working around it, runs a narrow per-item surprise guard, then stages exactly the lane's changed paths and commits with the identical pathspec: git add -- <lane> followed by git commit --only -m \"<message>\" -- <lane>, never a bare git commit, never commit --only without the prior add, and never -m after the -- separator. Authors no KB content itself, though it does perform the versioning.json conversion when one is pending. Use whenever the DM wants to commit KB changes chronicler or timeline just wrote, or their own manual KB edits. Standalone, like homebrew, timeline, and catalog: not part of the debrief, prep, content, chronicler, kb-validator pipeline, and never writes pipeline-state.json."
argument-hint: "[optional: setting name if the project has more than one, or \"push\" to push after committing]"
---

# /scribe: Commit the Setting KB

> **Before you begin:** read `../skills/SHARED-PRINCIPLES.md` (relative to this plugin) and apply its rules throughout this workflow.

You are committing the setting knowledge base: the lore and setting articles `chronicler` writes, the chronology documents `timeline` writes, and any edits the DM has made directly in Obsidian. This command commits exactly that lane, one setting at a time, and nothing else. It is precise and repeatable by design: capture is a command, not a reminder.

This command is **standalone**, like `homebrew`, `timeline`, and `catalog`. It is not part of the debrief, prep, content, chronicler, kb-validator session pipeline and never writes `.professor-orb/pipeline-state.json`.

## What this command is not

- Not a KB author. `/scribe` writes no lore, no articles, no chronology content. It commits what `chronicler`, `timeline`, and the DM's own edits already put on disk. The one thing it does write is `.professor-orb/versioning.json`, when Step 1's one-time conversion is pending, so "writes nothing" would be false for this command; it is a committer that also happens to carry that one small piece of state across.
- Not a second approval loop. The DM invoking `/scribe` is itself the approval to commit whatever is currently sitting uncommitted in the KB lane (Shared Principle 2 still gates every write that put the content there in the first place; this command only commits what already passed that gate).
- Not a cross-lane tool. `/scribe` never stages or commits a path outside the setting KB lane, even when it notices uncommitted work elsewhere.

## Step 1: Resolve the versioning mode

Read `.professor-orb/versioning.json`.

**Conversion first.** If `.professor-orb/catalog-versioning.json` exists and `.professor-orb/versioning.json` does not, copy its `mode` and `decided` values unchanged into the new file and mention the conversion in passing. Never rewrite `decided`: the decision was made when it was made, and a fresh date would destroy the only record of that. Do not delete the old file here; setup deletes it after its snapshot commit captures it.

**No marker at all, after the conversion check.** Versioning has never been established for this project. Say plainly that setup has not recorded a versioning decision, and point at setup. Do not offer to establish one here: that first-time offer belongs to `/catalog` and setup alone, not to this command.

**Mode is `changelog`.** The DM explicitly declined version control, or setup recorded the no-git baseline. `/scribe` has nothing to do: there is no git to commit to, and unlike `/catalog`, there is no single entry to append a changelog line to for a whole KB lane. Say so and point at setup if the DM wants to reconsider. Never invent a changelog for the KB.

**Mode is `git` or `github`.** Proceed. The staging and commit mechanism below is identical for both; `github` differs only in that a remote exists to report an unpushed count against and to push to if asked.

## Step 2: Resolve the setting(s)

Read `.professor-orb/conventions.json`. **A lane is never resolved from a bare `kbRoot`.** If the file is missing, or it has no `settings` array (a v1 or v2 shape), the lane root cannot be resolved at all: on that shape `kbRoot` physically contains all three prongs, and resolving from it would silently stage homebrew and session-report content into a commit labelled `kb(...)`. Refuse, say plainly that setup has not recorded the lane roots, and point at setup. This is a distinct message from an empty lane (Step 5): one says the path is unknown, the other says the path is known and simply has nothing outstanding.

With the `settings` array in hand, resolve which setting(s) have outstanding work in their `kbRoot`:

- **One setting.** No question. That setting's `kbRoot` is the lane.
- **More than one setting.** If the DM named one in the invocation, use it. Otherwise check every setting's `kbRoot` for uncommitted content; if only one has anything outstanding, use that one without asking. If more than one does, this command commits **one per setting** (Step 7), never merging two settings' changes into a single commit: each world's history stays readable on its own.

## Step 3: Resolve the lane path

The lane is the resolved setting's `kbRoot`, recursively: every lore and setting article, every index inside it, and any chronology document `timeline` wrote there, all as a single path for staging and committing (Step 7).

**A lane path that does not exist yet on disk is not an error.** It means nothing has been written there yet; report "nothing outstanding" (Step 5) and stop for that setting.

## Step 4: Check the index for foreign paths

Before touching anything, run `git diff --cached --name-only` and check every path it returns against the resolved `kbRoot`. If anything staged there falls outside the lane, a path the DM staged themselves for another purpose, **stop and report it**. Never silently commit it, and never unstage it: the correct posture on a foreign staged path is to stop and tell the DM, not to quietly work around their own staging. This check is the primary defense; Step 7's mechanism is a second line of defense that happens to leave a foreign staged path untouched even if this check were somehow bypassed, but it is not a substitute for stopping here.

## Step 5: Inspect uncommitted changes within the lane

Run `git status -- ":(literal)<kbRoot>"` scoped to the lane path to see what is new, modified, or deleted inside `kbRoot`, using the same literal pathspec form Step 7 uses and for the same reason: a setting name containing `*`, `?`, or `[` must not cause this scoping to widen or miss paths. If there is nothing outstanding, say so plainly for that setting and do not create an empty commit. This is different from Step 2's "lane root could not be resolved": here the path is known and simply has nothing to commit right now.

**Note uncommitted work in the other two lanes, without acting on it.** While you are looking at the repository's state, also check whether `homebrewRoot` or `sessionReportsRoot` (for any campaign) have uncommitted work. If they do, name it in the final report and name the command that owns it (`/catalog` for homebrew, `/log` for session reports). Never stage or commit anything in those lanes yourself.

## Step 6: Run the surprise guard

Before staging, look over what Step 5 found inside the lane for anything that looks like it does not belong in version control: a large binary, a Foundry export, a file that looks credential-shaped, or a file inside the lane that does not match the KB's frontmatter schema. `.obsidian/` is exempt: it is expected inside a setting KB and never trips the guard.

If something trips it, **stop and ask about that specific item**, never the whole batch. The DM has three options, each with its own mechanism:

- **Include it.** Continue as normal; it is staged and committed with the rest of the lane.
- **Exclude it, just for now.** Commit the rest of the lane without it: list the lane's cleared paths explicitly in Step 7's pathspec instead of the whole `kbRoot`, each with its own `:(literal)` prefix, so the flagged item is never staged or committed while everything else goes through.
- **Exclude it permanently.** Adjust `.gitignore`. That answers a different question than "just for now": it stops the item from ever tripping the guard again, rather than setting it aside for this one commit.

Once resolved, continue with the rest of the lane; do not re-run the whole guard over items already cleared.

## Step 7: Stage the lane, then commit

**The staging mechanism is specified, not left to the implementer, because obvious approaches are wrong, in different directions:**

- `git commit --only -- <lane>` with no prior `git add` **silently omits new files**. Measured against real git: in a lane holding one new and one modified article, it committed only the modified one, with no error and exit 0. New articles are the primary artifact of every `chronicler` and `timeline` run, so this fails at precisely the common case, and it fails quietly.
- `git add -- <lane>` followed by a **bare `git commit`** (no pathspec) commits the **entire index**, including anything the DM staged from another lane. The lane guarantee this command exists to provide would be silently false the moment the DM has staged something themselves.
- **A bare pathspec is not a literal path.** `--` stops option parsing, but git still reads `*`, `?`, and `[` inside the pathspec that follows as wildcards, not as literal text. Measured against real git: with a lane directory named `settings/zi[st]` sitting next to an unrelated file `settings/zis`, running `git add -- settings/zi[st]` staged `settings/zis` too, and that unrelated file rode along into the commit. A setting name is DM-chosen and can plausibly contain any of those characters. `:(literal)` disables wildcard interpretation for that pathspec element; `--` and `:(literal)` fix different halves of the same line, and neither substitutes for the other.
- **`-m "<message>"` after the `--` separator is not a commit message.** `--` tells git that everything following it is a pathspec, so a message placed after it is read as an (almost always non-matching) path, not attached to the commit. `-m "<message>"` has to sit before `--`, immediately after `--only`.

The verified mechanism is both steps, in order, with the identical, literal pathspec:

```
git add -- ":(literal)<kbRoot>"
git commit --only -m "<message>" -- ":(literal)<kbRoot>"
```

Run this once per setting resolved in Step 2. Never substitute `-A`, `.`, or `-a` for the explicit lane pathspec, never drop the `:(literal)` prefix even for a setting name that looks safe, and never move `-m "<message>"` after the `--` separator: the guarantee should not depend on inspecting the name first.

If Step 6 set aside an item for temporary exclusion, list the lane's cleared paths explicitly in the pathspec instead of the whole `kbRoot`, each with its own `:(literal)` prefix, so the excluded item is never staged or committed alongside the rest.

**Commit message** (the `<message>` above), written from what actually changed: `kb(<setting>): <summary>`, for example `kb(rolara): add Thoric article, update Person-INDEX`.

## Step 8: Report back

For each setting committed, tell the DM in one short block:

- The commit message and its hash.
- A one-line summary of what was committed (new articles, edited articles, index updates).
- How many commits are unpushed, if a remote exists for this project (`git` mode with a recorded remote, or `github` mode).
- Anything Step 6's guard set aside, and why.
- Any uncommitted work Step 5 noticed in `homebrewRoot` or `sessionReportsRoot`, named with the command that owns it (`/catalog` or `/log`).

If more than one setting was committed, name each one and its commit hash; do not collapse them into one summary line.

**Pushing is not part of the default flow.** Report the unpushed count; that is how the DM knows a push is worth requesting. Only push if the invocation asked for one (for example, the DM included "push" in the command's argument). Never push unasked, and never push to a remote the project has not already confirmed.

## Things to never do

- **Never stage or commit a path outside the resolved `kbRoot`.** Not the DM's own foreign-staged path, not another lane, not the project root.
- **Never run a bare `git commit` after staging the lane**, and **never run `git commit --only` without first running `git add` on the identical pathspec.** Both are measured failure modes, not style preferences.
- **Never place `-m "<message>"` after the `--` separator.** Git reads it as a pathspec, not a commit message; the message has to come before `--`, right after `--only`.
- **Never drop the `:(literal)` prefix from a lane pathspec, and never drop the `--` separator either.** They fix different problems (wildcard interpretation vs. option parsing); a setting name with a glob character can otherwise pull in an unrelated file lying next to the lane.
- **Never resolve a lane from a bare `kbRoot` on a v1 or v2 conventions file.** Refuse and point at setup instead.
- **Never invent a changelog entry for the KB.** In `changelog` mode there is nothing for this command to do; say so.
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
- **A file moved between the KB lane and another prong.** Each lane command sees only its own lane, so a move the DM makes by hand lands in two separate commits, one from each command. Acceptable: the alternative is reaching outside the lane. `/migrate` is the exception: it restructures across prongs by design and lands a cross-prong move in one commit of its own (see `commands/migrate.md`).

## How this command connects to the others

- **Standalone**, like `homebrew`, `timeline`, and `catalog`: runs on demand, independent of the session pipeline's state, and never writes `.professor-orb/pipeline-state.json`.
- **Fed by:** the `chronicler` skill, which writes lore and setting articles after DM approval, and the `timeline` skill, which writes chronology documents in the same KB after its own approval step. Also captures the DM's own direct Obsidian edits.
- **Reads:** `.professor-orb/versioning.json` (performing the one-time conversion from `.professor-orb/catalog-versioning.json` if needed) and `.professor-orb/conventions.json`'s `settings` array for each setting's `kbRoot`.
- **Writes:** one commit per setting with outstanding KB changes. Writes `.professor-orb/versioning.json` only when Step 1's conversion is pending. Never writes KB content itself.
- **Names, but never touches,** uncommitted work in the homebrew or session-reports lanes, pointing at `/catalog` or `/log` respectively.
