# Phase 3: lane commands

Date: 2026-07-28 (revised 2026-07-28 after adversarial verification)
**Phase 3 of 3 in a single 1.6.0 release.** Follows
`2026-07-28-canonical-schema-design.md` and `2026-07-28-apply-the-schema-design.md`.
Status: design, approved 2026-07-28

## Problem

Phase 2 puts git under every consumer project and lays down the three-prong layout. Nothing
yet commits to it except `/catalog`, which commits only its own two files.

The obvious answer is to auto-commit every KB write. That is wrong for this plugin. Every
consequential act in professor-orb is something the DM invokes or approves, and a background
process committing whatever it finds would be the one place the plugin acts unattended on
the DM's behalf outside setup's one-time migration. `/catalog` already models the
alternative, and `CONTEXT.md` names the principle: capture is a command, not a reminder.

So committing becomes a command. Three, because the three prongs are separate concerns and a
commit that mixes them is a commit nobody can read later. A half-finished session report
must not ride along in a lore commit, and out-of-scope homebrew must not ride along in
either.

## Decisions

- Three lanes, three commands. Each commits only its own lane. `/catalog` keeps its own
  commit, so a capture stays atomic and durable the moment it happens.
- The plugin suggests the new commands the way it already suggests `/catalog`.
- Pushes happen on request. Setup performs the first push.

## Design

### Part 1: the lane model

| Command | Lane | Fed by |
| --- | --- | --- |
| `/catalog` | `homebrew/<setting>/` | `homebrew` skill |
| `/scribe` | `settings/<setting>/` | `chronicler`, `timeline` |
| `/log` | `session-reports/<setting>/<campaign>/` | `debrief`, `content` |

Lane paths resolve from `conventions.json`'s settings array. `/log`'s lane includes the
content skill's output and the `Session Prep` briefs that sit beside the reports, both
deliberately.

**A lane is never resolved from a bare `kbRoot`.** On a v1 or v2 file with no settings
array, `kbRoot` physically contains the other two prongs, so resolving from it would make
`/scribe` stage all three lanes into a commit labelled `kb(...)` while believing it stayed
in its lane. All three commands refuse to run against a file with no settings array, say
setup has not recorded the lane roots, and point at setup. "Lane root resolved and is empty"
and "lane root could not be resolved" are reported differently.

**A command never stages a path outside its lane.** This is the property the model rests on,
and Part 2 specifies the mechanism, because the obvious implementation gets it wrong.

**Cross-lane awareness without cross-lane action.** A command that finds uncommitted work in
another lane says so and names the command that owns it, which is how the model becomes
discoverable rather than surprising.

### Part 2: the shared command shape

1. **Resolve the versioning mode** from `.professor-orb/versioning.json`, performing the
   one-time conversion from `catalog-versioning.json` if it has not happened.
2. **Resolve the setting**, and for `/log` the campaign, enumerating the filesystem under
   the prong root and using `conventions.json`'s `campaigns` only to disambiguate and order.
   With one setting and one campaign there is no question.
3. **Resolve the lane path.** Refuse if unresolvable.
4. **Check the index is clean of foreign paths.** If `git diff --cached --name-only`
   contains anything outside the lane, report and stop. Do not silently commit it, and do
   not unstage the DM's work.
5. **Inspect uncommitted changes within the lane only.**
6. **Run the surprise guard.**
7. **Stage the lane, then commit with the same pathspec.** Never a bare `git commit`, and
   never a pathspec commit without the add.
8. **Report.**

**The staging mechanism is specified, not left to the implementer, and it was verified
against real git rather than reasoned about.** Two mechanisms are wrong in opposite
directions:

- `git add <lane>` then a bare `git commit` commits the **entire index**, including anything
  staged earlier from another lane, so the lane guarantee is silently false whenever the DM
  has staged something themselves.
- `git commit --only -- <lane>` with no prior add **silently omits new files**. Measured: in
  a lane holding one new and one modified article, it committed only the modified one, with
  no error and exit 0. New files are the primary artifact of every lane, so this fails at
  precisely the common case.

The verified mechanism is both, in order:

```
git add -- <lane paths>
git commit --only -- <lane paths>
```

Measured behavior: commits exactly the new and modified files inside the lane; leaves a
pre-staged out-of-lane path staged and uncommitted; leaves other lanes and the repository
root dirty. Step 4's precondition remains as a second line of defence, since the correct
posture on a foreign staged path is to stop and tell the DM rather than quietly work around
their staging.

The staging test in Verification covers exactly this, because it is the one failure that
produces a commit that looks fine.

**None of the three writes `.professor-orb/pipeline-state.json`.** All are standalone, like
`homebrew` and `timeline` (`commands/catalog.md:137`).

**The invocation is the approval** (`commands/catalog.md:18`). These commands do not open a
second approval loop.

**The surprise guard is narrow and per-item.** Unlike `/catalog`, which commits the file it
just wrote, `/scribe` and `/log` sweep whatever is outstanding. The command stops and asks
about a **specific** item, never the whole batch, when it finds a file that looks like it
does not belong in version control (a large binary, a Foundry export, something
credential-shaped), a file inside the lane that does not match the schema, or, for `/log`, a
session report that looks unfinished. `.obsidian/` is exempt: it is expected inside a
setting KB.

**Commit messages** are written from what changed:

| Command | Format | Example |
| --- | --- | --- |
| `/scribe` | `kb(<setting>): <summary>` | `kb(rolara): add Thoric article, update Person-INDEX` |
| `/log` | `session(<setting>/<campaign>): <summary>` | `session(rolara/ashes): add 2026-07-24 report` |
| `/catalog` | `catalog(<setting>): <entry> v<version>` | `catalog(rolara): Bionoid Bond v2` |

**The report** states what was committed and its message, the commit hash, how many commits
are unpushed if a remote exists, anything the guard set aside, and any other lane with
uncommitted work named with its owning command.

**Pushing is not part of the default flow.** The commands report the unpushed count, which
is how the DM knows a push is worth requesting. If the invocation asks for one, the command
pushes after committing. It never pushes unasked.

### Part 3: `/scribe`

Owns the setting KB: lore and setting articles, including the chronology documents `timeline`
writes. Fed by `chronicler` and `timeline`, and commits the DM's own Obsidian edits.

**`/scribe` authors no KB content.** It is a committer. The precise wording matters: it does
perform the `versioning.json` conversion in step 1, which writes one small state file and
deletes another, so "writes nothing" would be false and an implementer following it would
have contradictory instructions.

**Changes in more than one setting** produce one commit per setting, keeping each world's
history readable. The report names both.

### Part 4: `/log`

Owns session reports, the `Session Prep` briefs beside them, and the player-facing content
derived from them. Fed by `debrief` and `content`. Authors no KB content, same as `/scribe`.

**The unfinished-report guard matters most here.** A session report is often written across
more than one sitting, so "outstanding" and "ready" genuinely diverge in this lane. The
guard sets aside a report that looks unfinished, names it, and commits the rest.

### Part 5: what remains of `/catalog` Step 3

Phase 2 already deleted the repo-presence check at `commands/catalog.md:49`, flipped the
precedence so `versioning.json` is read first, and renamed the marker. This phase collapses
what is left:

1. **`versioning.json` exists.** Read `mode`, carry to Step 7, done.
2. **It does not.** `/catalog` ran before `setup`. Say setup has not established how this
   project keeps history, point at `setup`, and offer the choice inline so the DM is not
   blocked mid-capture.

   The inline offer covers **changelog only**, plus a pointer to setup for anything else.
   `commands/catalog.md:55`'s existing behavior runs `git init` **in the catalog root**,
   which under phase 2's layout is `homebrew/<setting>/` inside the project repository, and
   would plant a nested repository that setup's state detection has no case for. Deleting
   the repo-presence check without also removing the repo-*creation* behavior would leave
   that trap in place.

Step 3's heading changes to reflect that it reads a project-level decision.

**Step 7's mode branching is unchanged**; only its example commit message at
`commands/catalog.md:102` gains the setting scope. An earlier draft claimed Step 7 was
untouched while also editing a line inside it.

**`/catalog` gets explicit staging language** in Step 7: stage exactly the entry file and
the owning index, by path, never a directory-wide or `-a` add. It also gains the cross-lane
notice and the unpushed count in Step 9's report, so all three commands report alike. It
does not gain the surprise guard, since it commits only what it just authored.

### Part 6: the Stop hook

`hooks/pipeline-next.mjs` suggests the next pipeline step from `pipeline-state.json`'s
`lastStep`. Two messages gain a lane command, one gains the other:

| `lastStep` | Appended clause |
| --- | --- |
| `debrief` | `/log` can commit the session report |
| `content` | `/log` can commit the recap and handouts |
| `chronicler` | `/scribe` can commit the KB changes |

`prep` is unchanged.

**The versioning gate suppresses only the appended clause.** The existing next-step sentence
always emits. An earlier draft made the whole hook silent without `versioning.json`, which
would have deleted the pipeline suggestions that already work for every project that has not
run setup.

**The hook never performs the marker conversion.** It must stay silent, non-interactive, and
non-mutating, so it treats a lone `catalog-versioning.json` as a valid marker for reading.

**`/catalog`'s suggestion stays prose-based**, in `skills/homebrew/SKILL.md:166`, because
homebrew is standalone and never writes pipeline state. That asymmetry is correct.

### Part 7: discovery wiring

The audit found 41 places referencing `/catalog`. Those that enumerate components:

- **`README.md:7`**: "skills, agents, one command, a pair of hooks" becomes three commands.
- **`README.md:31`, `skills/orb/SKILL.md:39`**: component tables gain `/scribe` and `/log`.
- **`README.md:53`, `skills/orb/SKILL.md:3`, `:22`, `:56`**: standalone-component lists.
- **`README.md:59`, `skills/orb/SKILL.md:18`**: "only `chronicler` and `/catalog` write to
  the knowledge base." Phase 1 corrects this claim, which is false for five components. It
  must not be re-broken here: `/scribe` and `/log` touch the KB without authoring in it, and
  the corrected sentence draws that distinction rather than adding two names to a list of
  writers.
- **`CONTEXT.md`**: new entries for the lane model, `/scribe`, and `/log`, alongside the
  catalog-command entry at `:101`.

## Edge cases

- **Nothing outstanding in the lane.** Say so. Never create an empty commit.
- **Lane root unresolvable** (no settings array). Refuse, point at setup. Distinct from an
  empty lane.
- **Foreign paths already staged.** Report and stop (Part 2, step 4).
- **Mode is `changelog`, or no `versioning.json`.** `/scribe` and `/log` have nothing to do:
  no git to commit to and, unlike `/catalog`, no single entry to append a changelog line to.
  Say so and point at setup. Do not invent a changelog for the KB.
- **Repository state blocks committing** (merge in progress, detached HEAD). Report and
  stop. Never force, reset, or resolve a conflict on the DM's behalf.
- **A lane path does not exist yet.** Nothing outstanding, not an error.
- **A file moved between lanes.** Each command sees its own lane, so the move lands in two
  commits. Acceptable, since the alternative is reaching outside the lane.

## Out of scope

- **Auto-committing on write.** Deliberately rejected.
- **`/migrate` and `/genesis`.** Their own specs.
- **Background or scheduled pushes.**
- **Branching, pull requests, conflict resolution.**
- **Rewriting history**, including squashing or amending prior lane commits.
- **Committing anything under `.professor-orb/` or `.claude/`.** Phase 2's `.gitignore`
  policy already decides what is tracked.

## Files touched

| File | Change |
| --- | --- |
| `commands/scribe.md` | New |
| `commands/log.md` | New |
| `commands/catalog.md` | Step 3 collapse; remove the `git init` in the catalog root at `:55`; commit message at `:102`; staging language and report additions in Steps 7 and 9; never-do entry at `:138` |
| `hooks/pipeline-next.mjs` | Three appended clauses; read `versioning.json`; suppress only the clause |
| `skills/chronicler/SKILL.md`, `skills/timeline/SKILL.md` | Hand off to `/scribe` |
| `skills/debrief/SKILL.md`, `skills/content/SKILL.md` | Hand off to `/log` |
| `skills/orb/SKILL.md` | Table `:39`, standalone lists `:3`/`:22`/`:56`, writer claim `:18` |
| `README.md` | Command count `:7`, table `:31`, standalone list `:53`, writer claim `:59` |
| `CONTEXT.md` | Lane model, `/scribe`, `/log` entries |
| `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | 1.5.1 to 1.6.0, same commit. The single bump for all three phases |

## Verification

- **The staging test, which is the one that matters.** Build a fixture with uncommitted
  changes in all three lanes plus a file at the project root, **and with an out-of-lane file
  already staged**. Run each command. Assert the resulting commit contains only its own
  lane's paths, that the pre-staged foreign path caused a stop rather than a silent
  inclusion, and that other lanes and the root file remain uncommitted. Repeat with two
  settings and assert per-setting commits.
- Assert no command writes `pipeline-state.json`.
- Assert an empty lane produces no commit, and that an unresolvable lane root produces a
  different message than an empty one.
- Assert `changelog` mode and a missing `versioning.json` both produce an explanation and no
  commit, from all three commands.
- Assert the surprise guard sets aside exactly the offending file and commits the rest, and
  that `.obsidian/` is not flagged.
- Run `pipeline-next.mjs` against fixtures for each `lastStep`, with and without
  `versioning.json`, asserting **the base message always emits** and only the lane clause is
  conditional.
- Confirm `/catalog` reaches no versioning decision without reading `versioning.json` first,
  and that neither the repo-presence check nor the catalog-root `git init` remains.
- Confirm no em dashes in changed files.

## Notes

This is the spec the original handoff asked for, arrived at from the opposite direction. The
handoff proposed making `/catalog`'s repo-presence check more precise, by testing whether the
git toplevel equals the catalog folder rather than merely containing it. Phases 1 and 2
removed the need: once the schema is the plugin's and setup records an explicit versioning
decision, there is no inference left to make precise, so the check is deleted.

The handoff also noted the marker "currently cannot override the check because the
repo-presence check runs before the marker is consulted, and that ordering may need to flip
regardless of which fix is chosen." That instinct was right and survives as the first rule of
Step 3's replacement.
