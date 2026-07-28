# `/migrate`: DM-scoped structural change

Date: 2026-07-28
Spec 4. Depends on the 1.6.0 three-phase release
(`2026-07-28-canonical-schema-design.md`, `-apply-the-schema-design.md`,
`-lane-commands-design.md`). Ships as 1.7.0.
Components: `commands/migrate.md` (new), `workflows/migrate.mjs`,
`workflows/validation-sweep.mjs`, `CONTEXT.md`, `README.md`, `skills/orb/SKILL.md`
Status: design, approved 2026-07-28

## Problem

The 1.6.0 release gives professor-orb a canonical schema and a migration executor that
applies it once, at setup. It deliberately leaves work on the floor.

**Setup's initial migration reports rather than executes, in five cases.** Absorb candidates
(dissolving a folder is undefined when it holds subfolders, and the volume on an established
KB is large). Files carrying `-TIMELINE` or `-HISTORY`, valid under
`skills/timeline/SKILL.md:22`'s current text, where renaming is link-breaking for a cosmetic
gain. Ignored files inside a prong, which are outside the snapshot and so must not be moved.
Prose path references in the consumer's `CLAUDE.md`, conventions doc, and the DM's separate
wiki-website project. And whatever the prong-mapping confirmation excluded.

Nothing in the plugin can act on any of it afterward.

**The validation sweep's `needsJudgment` bucket has no consumer.** The sweep returns findings
in two buckets (`validation-sweep.mjs:108`, `:122`), each `needsJudgment` item carrying
`{file, ruleId, description, question}` (`:202`). Its fix phase applies only
`mechanicallyFixable`. The judgment items are printed and forgotten. Ownership conflicts,
ambiguous types, and multi-index folders all land there
(`:544-546`: "which index survives is the DM's call").

**`CONTEXT.md:122-130` describes a component that does not exist.** The `index maintenance`
entry says "The validation sweep detects index violations; the rebuild step proposes
regenerated index files (propose-then-execute, like chronicler)." There is no rebuild step
anywhere in the plugin. Phase 1 corrects the entry to describe what exists; this spec builds
what it described.

**And a KB drifts.** A DM reorganizes, renames a faction, splits a continent into two
regions, retires a campaign, starts a second world. Today every one of those is manual, and
manual restructuring is exactly what breaks a wikilink graph silently.

## Decisions

- `/migrate` is a command driving the executor phase 2 builds, not a second executor.
- It resolves a DM-supplied scope into a concrete plan, shows the plan, and executes on
  approval. This differs from setup's unattended migration deliberately, and the difference
  is grounded rather than cautious: setup's target is professor-orb's own schema, which is
  known and derivable, so the plan is not news. `/migrate`'s target is DM intent, which is
  not derivable, so the resolved plan is the only place a misreading becomes visible before
  it costs anything. `CONTEXT.md:125-127` already specifies propose-then-execute for exactly
  this work, and lists "silent index rewrites" on its avoid list.
- Every run takes its own snapshot and lands as one commit, so undo is one `git revert`.

## Design

### Part 1: three sources of work

`/migrate` invoked with no arguments does not ask "what would you like to migrate?" It reads
the two places the plugin already records outstanding structural work and offers them:

1. **Setup's deferred items.** The initial migration's report names each one. `/migrate`
   re-derives them from the current tree rather than trusting a stale report.
2. **The sweep's `needsJudgment` findings**, if a sweep has run. Each carries its own
   `question`, which is exactly the input scope negotiation needs.
3. **A scope the DM states**, in their own words.

The first two make `/migrate` discoverable without the DM having to know what to ask for,
and they close the loop on two components that currently produce output nobody consumes.

### Part 2: scope negotiation

The DM's scope arrives as free text: "clean up items/", "rename the Ashfall Compact to the
Cinder Pact everywhere", "split my continent article into one per region", "retire the
Karsk campaign", "start a second setting".

Resolution is a conversation, not a parse. The command restates the scope as it understood
it, names what it would touch, and asks about anything genuinely ambiguous. It does not
interrogate: one clarifying exchange, then a plan.

**Scope boundaries.** `/migrate` performs structural operations. It does not rewrite article
prose, invent content, or change what an article says. Renaming a faction updates the
filename, the frontmatter `name`, and every wikilink to it; it does not rewrite the sentences
that mention the faction in body text. That line is stated to the DM when a scope crosses it,
because "rename X to Y everywhere" naturally reads as including prose, and the DM should know
which half they are getting. Prose changes are `chronicler`'s job, and `/migrate` says so.

### Part 3: the plan

The plan is a written artifact, not a chat dump, following the `proposal file` convention
CONTEXT.md already establishes for `chronicler`: written to `.professor-orb/proposals/`, with
a summary and a pointer in chat. The DM may edit the file directly, and `/migrate` executes
exactly what the approved file says rather than re-deriving intent from the discussion.

It states, per operation: every file moved, renamed, created, merged, or deleted, by path;
every wikilink that will be rewritten, with counts per target; every index affected; anything
in scope that `/migrate` declined and why; and the prechecks it has already run.

**The prechecks run before the plan is shown, not after approval.** A plan that cannot
execute is worse than no plan. Basename collisions in destination directories, unresolvable
link targets, ignored files inside the scope, and case-only renames on a case-insensitive
filesystem are all detected while the plan is being built, and appear in it as declined
items rather than surfacing as failures mid-run.

### Part 4: run order

1. **Resolve scope** (Part 2).
2. **Require a clean tree.** Report and stop otherwise, or offer to commit the DM's work
   first. `/migrate` will not fold unrelated changes into its snapshot.
3. **Build the plan and run the prechecks** (Part 3).
4. **Present the plan.** Wait for approval or edits.
5. **Snapshot commit**, verified empty afterward, hash printed:
   `chore: pre-migration snapshot before /migrate`.
6. **Move `conventions.json` aside** for the duration, same as phase 2, so the write-time
   hook stays silent through hundreds of writes instead of storming.
7. **Execute** via `workflows/migrate.mjs`, with its per-item applied true/false accounting.
8. **Restore `conventions.json`**, updated if the scope changed anything it records (a
   setting added, a campaign retired, a prong root moved).
9. **Assert link integrity.** Every wikilink that resolved before must resolve after. This
   must pass before the commit.
10. **Commit** as one commit. **Report**, including the undo command.

Steps 5 through 10 are phase 2's machinery unchanged. `/migrate` supplies a different plan
source and a different gate; the execution and safety layers are shared, which is the point
of building the executor as a workflow script rather than inside setup.

### Part 5: the operation catalog

Everything phase 2's executor can do, plus the deferred five:

| Operation | Notes |
| --- | --- |
| Move or rename files and folders | Rename is paired with its link rewrite as one unit of work |
| Create, merge, split indexes | Merges concatenate losslessly, as in phase 2 |
| **Rebuild indexes** | Regenerate an index from its folder's actual contents. This is `CONTEXT.md:125-127`'s "rebuild step". Retires the DM's ad-hoc Python scripts, which that entry already anticipates |
| **Absorb folders** | Deferred by setup. Leaf folders only; prong, setting, and campaign folders exempt permanently |
| Split folders past the threshold | As phase 2 |
| Rename an entity everywhere | Filename, frontmatter `name`, and every wikilink. Not body prose |
| Retype articles | Change a `type` value across a set, updating the enum's `extendedBy` and any suffix the new type requires |
| Repair frontmatter | Line-move reorder on raw text, never parse-and-regenerate |
| **Rename `-TIMELINE` and `-HISTORY` files** | Deferred by setup. Offered here because the DM asked, with the link cost stated |
| **Handle ignored files** | Deferred by setup. `/migrate` reports them and can move them only after the DM un-ignores them, which puts them in the snapshot |
| **Update prose path references** | Deferred by setup. In the consumer's `CLAUDE.md`, conventions doc, and any file the DM names. Reported, then updated on approval |

### Part 6: multi-setting operations

The layout supports N settings from 1.6.0, but only `/genesis` (spec 5) creates them. The
lifecycle operations belong here:

| Operation | What moves |
| --- | --- |
| Rename a setting | All three prong roots, `conventions.json`'s `settings[].name` and roots, the Obsidian vault folder |
| Retire a setting | Prongs move to an `archive/` sibling; the settings entry is marked rather than deleted, so history stays readable |
| Retire a campaign | `session-reports/<setting>/<campaign>/` moves under the setting's archive; `campaigns` updates |
| Split a setting | The hard one. Articles divide between two vaults, and a wikilink crossing the new boundary breaks, because resolution is per-setting. `/migrate` enumerates every cross-boundary link **in the plan**, before approval, since that is the whole cost of the operation |
| Merge two settings | The inverse, and the case where basename collisions are near-certain: two worlds legitimately holding a `Tavern.md` collide the moment they share a vault. Every collision appears in the plan with a proposed rename |

Splitting and merging are where the vault boundary stops being free. Both are supported, both
state their cost up front, and neither is offered unprompted.

### Part 7: how this connects

- **Fed by `setup`**, whose initial-migration report names the deferred items.
- **Fed by the validation sweep**, whose `needsJudgment` findings become candidate scopes.
  The sweep gains one line pointing at `/migrate`, which is the first time those findings
  have a destination.
- **Shares `workflows/migrate.mjs`** with setup. Setup supplies a schema-derived plan and no
  gate; `/migrate` supplies a scope-derived plan and a gate.
- **Not a lane command.** `/migrate` restructures across prongs by nature, so it commits its
  own work in one commit rather than deferring to `/scribe`, `/log`, or `/catalog`. This is
  stated explicitly, because it is the one exception to phase 3's lane rule and would
  otherwise read as a violation of it.
- **Hands back to the sweep.** The report suggests re-running the validation sweep to confirm
  the KB is clean, which is the natural verification after a structural change.

## Edge cases

- **Scope resolves to nothing.** Say so. No snapshot, no commit.
- **Scope resolves to something enormous** (a rename touching 800 files). Execute it, but say
  the count in the plan before approval, since "rename X everywhere" does not feel like 800
  files until it is.
- **No git.** `versioning.json` mode is `changelog`, so there is no snapshot and no undo.
  `/migrate` states that plainly and requires an explicit second confirmation, the same
  posture phase 2 takes.
- **A plan the DM edited into something inconsistent.** Re-run the prechecks against the
  edited file. Execute what it says or report why it cannot, never a repaired guess.
- **Interrupted run.** The per-item accounting and the manifest make a partial application
  diagnosable; the report names what applied and what did not, and the snapshot hash is the
  undo. Do not auto-resume.
- **Scope crossing settings** (moving an article from one world to another). Supported, and
  treated as a link-boundary operation: outgoing links from the moved article are enumerated
  in the plan, because they will not resolve on the far side.

## Out of scope

- **Creating settings.** `/genesis`, spec 5.
- **Content and prose changes.** `chronicler`.
- **Anything the sweep already auto-fixes.** `mechanicallyFixable` findings stay with the
  sweep's own fix phase; `/migrate` takes the judgment bucket.
- **A second executor.** `/migrate` drives `workflows/migrate.mjs`.
- **Undo beyond `git revert`.** No bespoke rollback.
- **Rewriting history.**

## Files touched

| File | Change |
| --- | --- |
| `commands/migrate.md` | New |
| `workflows/migrate.mjs` | Accepts a scope-derived plan alongside setup's schema-derived one; gains rebuild, absorb, retype, entity-rename, and setting-lifecycle operations |
| `workflows/validation-sweep.mjs` | Point `needsJudgment` output at `/migrate` |
| `CONTEXT.md` | `index maintenance` entry gains the real rebuild step; new `/migrate` entry |
| `README.md`, `skills/orb/SKILL.md` | Command tables, standalone lists, command count |
| `skills/setup/SKILL.md` | The after-action report names `/migrate` as where deferred items go |
| `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | 1.6.0 to 1.7.0 |

## Verification

- Exercise each operation against a fixture, asserting link integrity before and after.
- **The plan-fidelity test.** Approve a plan, hand-edit it, and confirm execution follows the
  edited file rather than the original conversation.
- Assert the prechecks run before the plan is presented: a fixture with a guaranteed
  destination collision must show it as a declined item in the plan, not as a mid-run
  failure.
- Assert the snapshot precedes every mutation and the reported undo command restores the
  tree exactly.
- Assert `conventions.json` is aside for the duration and the hook stays silent.
- **Split a two-setting fixture** and assert every cross-boundary wikilink appears in the
  plan before approval. **Merge two settings** holding the same basename and assert the
  collision appears with a proposed rename.
- Assert `/migrate` commits across prongs in one commit and that the lane commands do not
  subsequently see its work as outstanding.
- Confirm no em dashes in changed files.

## Notes

The three deferrals phase 2 makes are what make this spec obvious rather than speculative.
Absorb, the cosmetic renames, and the prose references were all deferred for the same reason:
each is a judgment about the DM's KB that the plugin can detect but should not decide. That
is a description of `/migrate`'s job, arrived at from the other direction.
