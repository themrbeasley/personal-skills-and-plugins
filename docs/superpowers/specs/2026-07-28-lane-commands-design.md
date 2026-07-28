# Lane commands: `/scribe`, `/log`, and `/catalog` on a recorded versioning decision

Date: 2026-07-28
Spec 3 of 3 (follows: canonical schema; apply the schema)
Components: `commands/scribe.md` (new), `commands/log.md` (new), `commands/catalog.md`,
`hooks/pipeline-next.mjs`, `skills/chronicler/SKILL.md`, `skills/debrief/SKILL.md`,
`skills/content/SKILL.md`, `skills/orb/SKILL.md`, `README.md`, `CONTEXT.md`
Status: design, approved 2026-07-28

## Problem

Spec 2 puts git under every consumer project and lays down a three-prong layout. Nothing yet
commits to it except `/catalog`, which commits only its own two files.

The obvious answer is to auto-commit every KB write. That is wrong for this plugin. Every
consequential act in professor-orb is something the DM invokes or approves, and a background
process committing whatever it finds would be the one place the plugin acts unattended on the
DM's behalf. `/catalog` already models the alternative and CONTEXT.md names the principle:
capture is a command, not a reminder.

So committing becomes a command. Three of them, because the three prongs are genuinely
separate concerns and a commit that mixes them is a commit nobody can read later. A
half-finished session report must not ride along in a lore commit, and out-of-scope homebrew
must not ride along in either.

One thing blocks all of it. `/catalog` Step 3's first check asks whether the catalog folder is
"already inside a git repository" and concludes git-mode versioning if so. That conflated two
facts which used to coincide (a catalog folder that was its own repository) and no longer do.
Under spec 2 it becomes actively harmful: setup runs `git init` at the project root, so every
consumer would silently land in git mode with the one-time offer suppressed. The check is
deleted rather than repaired, because spec 2 gives every project an explicitly recorded
decision to read instead.

## Decisions

Settled with the DM during brainstorming:

- Three lanes, three commands. Each commits only its own lane. `/catalog` keeps its own commit
  rather than deferring to `/scribe`, so a capture stays atomic and durable the moment it
  happens.
- The plugin should suggest the new commands the way it already suggests `/catalog`.
- Pushes happen on request. Setup performs the first push.

## Design

### Part 1: the lane model

| Command | Lane | Fed by |
| --- | --- | --- |
| `/catalog` | `homebrew/<setting>/` | `homebrew` skill |
| `/scribe` | `settings/<setting>/` | `chronicler` |
| `/log` | `session-reports/<setting>/<campaign>/` | `debrief`, `content` |

Lane paths resolve from `conventions.json`'s settings array (spec 2, Part 3). No command
hardcodes a path. `/log`'s lane includes the content skill's output, which lives in a
`content/` subdirectory of the campaign folder.

**A command never stages a path outside its lane.** Not `git add -A`, not `git add .`, ever.
It stages explicit paths under its own lane root. This is the property the whole model rests
on, and it is the one thing an implementation can get wrong invisibly, since a too-broad
`git add` produces a commit that looks fine.

**Cross-lane awareness without cross-lane action.** When a command finds uncommitted work in
another lane, it says so and names the command that owns it. This is how the model becomes
discoverable rather than surprising: a DM who runs `/scribe` and sees "3 uncommitted files in
session-reports, `/log` handles those" learns the model without reading documentation.

### Part 2: the shared command shape

All three follow one sequence. `/catalog` already does most of it; `/scribe` and `/log` adopt
it wholesale.

1. **Resolve the versioning mode** from `.professor-orb/versioning.json`, performing the
   one-time conversion from `catalog-versioning.json` if needed (spec 2, Part 5).
2. **Resolve the setting**, and for `/log` the campaign. With one setting there is no
   ambiguity. With several, resolve the way `debrief` already resolves a campaign: usually
   named upfront, otherwise inferred from context and confirmed with a single
   AskUserQuestion.
3. **Resolve the lane path** from the settings array.
4. **Inspect uncommitted changes within the lane only.**
5. **Run the surprise guard** (below).
6. **Stage explicit lane paths.**
7. **Commit** with a written message (below).
8. **Report** (below).

**None of the three writes `.professor-orb/pipeline-state.json`.** All are standalone, like
`homebrew` and `timeline`. `/catalog` already states this at `commands/catalog.md:137`.

**The invocation is the approval.** `commands/catalog.md:18` establishes this: "The DM
invoking `/catalog` on content they just confirmed is itself the approval for that write."
The same holds here. These commands do not open a second approval loop, and they do not ask
"shall I commit?" after the DM has just said commit.

**The surprise guard is the exception, and it is narrow.** Unlike `/catalog`, which commits
exactly the file it just wrote, `/scribe` and `/log` sweep whatever is outstanding, and the DM
may not know everything that is in there. So the command stops and asks about a *specific*
item, never the whole batch, when it finds:

- A file that looks like it should not be in version control at all: a large binary, a Foundry
  export, something credential-shaped.
- A file inside the lane that does not match the schema (no frontmatter `type`, no recognized
  article shape).
- For `/log` specifically, a session report that looks unfinished: required frontmatter
  missing, or sections present but empty.

Everything else commits without further conversation. The guard exists so a surprise gets
surfaced, not so the DM re-approves work they already did.

**Commit messages** are written from what actually changed, never a generic string:

| Command | Format | Example |
| --- | --- | --- |
| `/scribe` | `kb(<setting>): <summary>` | `kb(rolara): add Thoric article, update Person-INDEX` |
| `/log` | `session(<setting>/<campaign>): <summary>` | `session(rolara/ashes): add 2026-07-24 report` |
| `/catalog` | `catalog(<setting>): <entry> v<version>` | `catalog(rolara): Bionoid Bond v2` |

`/catalog`'s existing format is `catalog: <entry name> v<version>`
(`commands/catalog.md:102`). Adding the setting scope keeps the three consistent and stays
readable once a project holds more than one world.

**The report** states: what was committed and its message; the commit hash; how many commits
are not yet pushed, if a remote exists; anything the guard set aside and why; and any other
lane with uncommitted work, named with its owning command. Short. Facts, not a restatement of
the content.

**Pushing is not part of the default flow.** Spec 2 establishes that setup performs the first
push and later pushes happen on request. These commands commit and report the unpushed count,
which is how the DM knows a push is worth requesting. If the invocation itself asks for a push
("scribe and push"), the command pushes after committing. It never pushes unasked.

### Part 3: `/scribe`

Owns the setting KB: lore and setting articles. Its primary feeder is `chronicler`, the
pipeline skill that writes KB articles after DM approval, but it commits any outstanding KB
work including the DM's own hand edits in Obsidian.

`/scribe` writes nothing. It is purely a committer, which distinguishes it from `/catalog`
(which authors an entry, then commits it). This is worth stating explicitly in the command,
because a command that touches the KB will otherwise be assumed to write to it.

**Multiple settings with changes in both** produce one commit per setting rather than one
mixed commit, keeping each world's history readable on its own. The report names both.

### Part 4: `/log`

Owns session reports and the player-facing content derived from them. Fed by `debrief` (which
writes the report) and `content` (which writes into the campaign's `content/` subdirectory).

Like `/scribe`, it writes nothing.

**The unfinished-report guard matters most here.** A session report is often written across
more than one sitting, so "outstanding" and "ready" genuinely diverge in this lane in a way
they do not in the others. The guard sets aside a report that looks unfinished and says which
one and why, rather than committing it or refusing the whole run.

**Campaign resolution** follows `debrief`'s existing pattern. A project with one campaign in
one setting never sees a question.

### Part 5: `/catalog` Step 3 collapses

Step 3 becomes two cases:

1. **`.professor-orb/versioning.json` exists.** Read `mode`, carry it to Step 7, done. Checked
   first, always. A recorded decision is never overridden by ambient repository state.
2. **It does not exist.** `/catalog` ran before `setup`. Do not guess. Say that setup has not
   established how this project keeps history, point at `setup`, and offer the choice inline
   so the DM is not blocked mid-capture.

   The inline offer covers local git and changelog only. If the DM wants GitHub, record local
   `git` so the capture proceeds with real history, and point at `setup` for the connection
   walkthrough. Account creation and authentication do not belong in the middle of a capture.

**The repo-presence check is deleted, not repaired.** No component infers a versioning
decision from folder structure. Under spec 2 this is not merely tidier: setup runs `git init`
at the project root, so the old check would return true for every consumer and suppress the
one-time offer at `commands/catalog.md:53` universally.

Step 3's heading changes to reflect that it now reads a project-level decision rather than
establishing a catalog-level one. The four marker references at `commands/catalog.md:50`,
`:55`, `:56`, and `:146` update to `versioning.json`. The "Things to never do" entry about the
git offer updates: the offer lives in setup, and the inline fallback is the exception.

**Step 7 is unchanged.** `github` and `git` both take its existing "Git mode" branch;
`changelog` takes the existing "Changelog mode" branch. Keeping the mode values from the
original design is what makes that true.

### Part 6: the Stop hook

`hooks/pipeline-next.mjs` suggests the next pipeline step from `pipeline-state.json`'s
`lastStep`, staying silent when it has nothing to say. It is deterministic, which CONTEXT.md
cites as the reason it replaced the Cowork edition's unreliable prompt hook. Two of its four
messages gain a lane command, and one gains the other:

| `lastStep` | Added |
| --- | --- |
| `debrief` | `/log` can commit the session report |
| `content` | `/log` can commit the recap and handouts |
| `chronicler` | `/scribe` can commit the KB changes |

`prep` is unchanged: it writes a brief, not lane content that wants its own commit.

The hook stays silent when versioning mode is `changelog` or no `versioning.json` exists,
since suggesting a commit command to a project without git would be noise. This requires the
hook to read one more small file, which is consistent with its existing behavior of reading
`pipeline-state.json` and failing silent on any error.

**`/catalog`'s suggestion stays prose-based**, in the homebrew skill
(`skills/homebrew/SKILL.md:166`), because homebrew is standalone and never writes pipeline
state. That asymmetry is correct and stays.

### Part 7: discovery wiring

The audit found 41 places referencing `/catalog`. Most are prose that needs no change, but
several enumerate the plugin's components and would be wrong with three commands:

- **`README.md:7`**: "skills, agents, one command, a pair of hooks" becomes three commands.
- **`README.md:31` and `skills/orb/SKILL.md:39`**: the component tables gain `/scribe` and
  `/log` rows with their trigger phrases.
- **`README.md:53`, `skills/orb/SKILL.md:3`, `:22`, `:56`**: the standalone-components lists
  gain both.
- **`README.md:59` and `skills/orb/SKILL.md:18`**: "only `chronicler` and `/catalog` write to
  the knowledge base." Spec 1 already corrects this claim, which is false for five components.
  It must not be re-broken here: `/scribe` and `/log` are the two components that touch the KB
  without writing to it, and the corrected sentence should make that distinction rather than
  adding two more names to a list of writers.
- **`CONTEXT.md`**: new language entries for the lane model, `/scribe`, and `/log`, alongside
  the existing catalog-command entry at `:101`.

## Edge cases

- **Nothing outstanding in the lane.** Say so. Never create an empty commit.
- **Mode is `changelog`, or no `versioning.json`.** `/scribe` and `/log` have nothing to do:
  there is no git to commit to and, unlike `/catalog`, no single entry to append a changelog
  line to. Say that plainly and point at `setup`. Do not invent a changelog for the KB.
- **Repository in a state that blocks committing** (merge in progress, detached HEAD, dirty
  index from an interrupted operation). Report the state and stop. Never force, never reset,
  never resolve a conflict on the DM's behalf.
- **A lane path does not exist yet.** Treat as nothing outstanding, not as an error. A project
  may legitimately have no homebrew.
- **A file moved between lanes** (a report filed into the KB by mistake, then moved). Each
  command sees only its own lane, so a move shows as a deletion in one and an addition in the
  other, landing in two commits. Acceptable and honest, since the alternative is a command
  reaching outside its lane.
- **The DM invokes a lane command while a pipeline skill is mid-run.** Not this spec's
  concern. The commands are standalone and read no pipeline state.

## Out of scope

- **Auto-committing on write.** Deliberately rejected in favor of these commands.
- **`/migrate` and `/genesis`.** Their own specs.
- **Pushing on a schedule, or any background push.** Pushes are requested.
- **Branching, pull requests, conflict resolution.** A single `main` branch is the model.
- **Rewriting history**, including squashing or amending prior lane commits. A DM who wants
  that does it themselves.
- **Committing anything under `.professor-orb/` or `.claude/`.** Those are setup's, and spec
  2's `.gitignore` policy already decides what is tracked.

## Files touched

| File | Change |
| --- | --- |
| `commands/scribe.md` | New |
| `commands/log.md` | New |
| `commands/catalog.md` | Step 3 collapse, marker rename at `:50`/`:55`/`:56`/`:146`, commit message format at `:102`, never-do entry at `:138` |
| `hooks/pipeline-next.mjs` | Three suggestion messages; read `versioning.json`; stay silent without git |
| `skills/chronicler/SKILL.md` | Hand off to `/scribe` on completion |
| `skills/debrief/SKILL.md`, `skills/content/SKILL.md` | Hand off to `/log` on completion |
| `skills/orb/SKILL.md` | Component table at `:39`, standalone lists at `:3`/`:22`/`:56`, writer claim at `:18` |
| `README.md` | Command count at `:7`, table at `:31`, standalone list at `:53`, writer claim at `:59` |
| `CONTEXT.md` | Lane model, `/scribe`, `/log` entries |
| `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | Version, same commit |

## Verification

- **The staging test, which is the one that matters.** Build a fixture with uncommitted
  changes in all three lanes plus a file at the project root. Run each command. Assert the
  resulting commit contains only its own lane's paths, and that the other lanes and the root
  file remain uncommitted. Repeat with two settings and assert per-setting commits.
- Assert no command writes `pipeline-state.json`.
- Assert an empty lane produces no commit.
- Assert `changelog` mode and a missing `versioning.json` both produce an explanation and no
  commit, from all three commands.
- Assert the surprise guard sets aside exactly the offending file and commits the rest.
- Run `pipeline-next.mjs` against fixtures for each `lastStep` value with and without
  `versioning.json`, asserting the right suggestion and silence respectively.
- Confirm `/catalog` reaches no versioning decision without reading `versioning.json` first,
  and that the repo-presence check is gone from the file entirely.
- Confirm no em dashes in any changed file.

## Notes

This is the spec the original handoff asked for, arrived at from the opposite direction. That
handoff proposed making `/catalog`'s repo-presence check more precise, by testing whether the
git toplevel equals the catalog folder rather than merely containing it. Specs 1 and 2 removed
the need: once the schema is the plugin's and setup records an explicit versioning decision,
there is no inference left to make precise. The check is deleted instead.

The handoff also noted that the marker file "currently cannot override the check because the
repo-presence check runs before the marker is consulted, and that ordering may need to flip
regardless of which fix is chosen." That instinct was right and survives as the first rule of
Step 3's replacement: the recorded decision is read first, always.
