# Phase 2: apply the schema

Date: 2026-07-28 (revised 2026-07-28 after adversarial verification)
**Phase 2 of 3 in a single 1.6.0 release.** Follows `2026-07-28-canonical-schema-design.md`,
precedes `2026-07-28-lane-commands-design.md`.
Status: design, approved 2026-07-28

> **The three phases ship as one release, in order.** Phase 2 runs `git init` at the project
> root, which makes `/catalog`'s repo-presence check (`commands/catalog.md:49`) return true
> for every consumer and suppress the one-time versioning offer. Phase 2 therefore also
> performs the Step 3 precedence flip and the marker rename, so the hazard never exists in a
> shipped state. Phase 3 collapses the rest of Step 3 and adds the new commands.

## Problem

Phase 1 establishes that professor-orb owns the structural schema and ships it as
`references/base-rules.json`. This phase applies it: lay down the canonical layout,
restructure what the consumer already has, and put version control underneath first so the
restructure is recoverable.

**No subagent in the plugin can move a file.** `rule-fixer` is granted `Read, Edit`
(`agents/rule-fixer.md:20`), `kb-validator` is read-only (`:151`), and the sweep's fix
workers apply changes "using the Write or Edit tool" (`validation-sweep.mjs:214`). Setup
Step 6 already claims move-and-merge authority (`setup/SKILL.md:80`), but only behind an
approval gate and without prechecks or rails. This phase removes that gate and adds them.

**The layout is not representable.** `conventions-schema.md:64-65` defines exactly one root,
`kbRoot`. Both other prongs live inside it today: `debrief/SKILL.md:20` defaults session
reports to "`session-reports/[Campaign-Name]/` at the KB root" and `CONTEXT.md:90` puts the
catalog at `rolara-kb/homebrew/`.

**Scoping is welded to `kbRoot` in more places than is obvious.** `validate-write.mjs:717`
requires a top-level `kbRoot` and exits when it is absent, so a settings-array file with no
such key would silently disable the write-time validator entirely. `:724-729` exits for
paths outside it. `:721` and `:462` use it as the wikilink search root. The sweep's
`SCOUT_SCHEMA` (`validation-sweep.mjs:61-74`) has a `kbRoot` field, `:167` reads it, `:169`
enumerates under it, and `:181`, `:569`, and `:612` use it downstream.

**Resync is the only path the one real consumer takes, and an earlier draft did not design
for it.** Rolara already has `conventions.json`, so the hook is armed for every migration
write, exiting 2 on block violations (`validate-write.mjs:804-807`) and emitting autofix
dispatches (`:790-797`) that race the migration's own edits. The earlier draft's mitigation,
"write `conventions.json` last," only holds for first-time setup.

**The migration can destroy content in several ways**, enumerated in the rails table. The
worst: `git init` alone provides zero revertibility, because an untracked working tree has
no restore point. An earlier draft deferred the first commit to the end of the run, which
would have folded the migration into it.

## Decisions

- Multi-setting from day one, each setting KB its own Obsidian vault. Session reports
  subdivide by setting, then campaign.
- Rules live per setting (phase 1 defines the rule model; this phase relocates it).
- The migration executor is a workflow script, `workflows/migrate.mjs`, distributed the way
  `validation-sweep.mjs` already is.
- The migration runs unattended and reports afterward, with **one** confirmation: the prong
  source-to-destination mapping, before any move. That is the single input the plugin cannot
  derive reliably, and getting it wrong is the one error the after-action report cannot help
  with, because the DM would not know to look.
- GitHub strongly recommended and private by default; declining falls back to local-only
  git; declining that falls back to the changelog baseline.
- Resync re-imposes the schema rather than preserving an earlier run's output.

## Design

### Part 1: run order

The order is the safety design.

1. **Convert the versioning marker.** If `catalog-versioning.json` exists and
   `versioning.json` does not, write the new file with `mode` and `decided` unchanged. Do
   **not** delete the old one yet; that happens at step 11, after the snapshot.
2. **Detect repository state** (Part 4).
3. **Require a clean tree.** If `git status --porcelain` is non-empty, report and stop, or
   offer to commit the DM's existing work under its own message first. An unscoped snapshot
   would otherwise sweep in unrelated uncommitted work.
4. **Establish git** and write `.gitignore` **additions only** (Part 6). No ignore-list
   interview yet.
5. **Commit the snapshot**: `chore: pre-migration snapshot before professor-orb setup`.
   Then **assert** `git status --porcelain` is empty and capture the commit hash. If either
   fails, abort before any mutation. Print the hash and the undo command to the DM now, not
   only in the closing report.
6. **Move any existing `conventions.json` aside** to `conventions.json.pre-migration`,
   tracked and already captured in the snapshot. This is what makes the hook genuinely
   silent (`setup/SKILL.md:10`: it degrades gracefully until the file exists) on **resync**
   as well as first run. Read its extras layer and enforcement choices into memory first.
7. **Discover the prongs and confirm the mapping** (Part 7). The one gate.
8. **Write the migration manifest** to a tracked path (Part 7), then run the prechecks. A
   precheck failure stops before any mutation.
9. **Execute the migration** via `workflows/migrate.mjs`.
10. **Write `.professor-orb/` artifacts**: `conventions.json` (v3), `pipeline-state.json`,
    `tag-registry.json`, `proposals/`. Delete `conventions.json.pre-migration`.
11. **Handle deletions**: the old `catalog-versioning.json`, predecessor plugin artifacts,
    source conventions doc retirement. All irreversible-by-nature, all now after the
    snapshot. Predecessor removal and conventions-doc retirement **keep their approval
    gates** (Part 8).
12. **Ask the large-and-sensitive-material question**, apply any further ignore additions,
    and `git rm --cached` any newly ignored path that the consumer's history already tracks.
13. **Commit the migration**, then push if GitHub is configured.
14. **Report** (Part 10).

**A live predecessor plugin arms its own hook.** `setup/SKILL.md:27-29` detects the Cowork
edition. If one is installed, its `Write|Edit` hook fires throughout the migration
regardless of what professor-orb does with its own conventions file. Detect it at step 2 and
require removal before migrating, or state the expected noise in the report. This is now a
mutation-safety matter, not tidiness.

### Part 2: the canonical layout

```
<project>/
  settings/
    <setting>/                        KB. Its own Obsidian vault (.obsidian/)
      <Setting>-INDEX.md              the setting's root index
      chronologies/
        <Scope>-CHRONOLOGY.md
        Chronologies-INDEX.md
  homebrew/
    <setting>/
      Homebrew-INDEX.md               maintained by /catalog
  session-reports/
    <setting>/
      <campaign>/
        YYYY-MM-DD-<Title>-REPORT.md
        YYYY-MM-DD-<Title>-PREP.md
        content/
  .professor-orb/
  .claude/workflows/
```

`Chronology` articles live in the setting KB, since they are lore. `Session Prep` briefs
live beside the reports they precede, so they ride in `/log`'s lane deliberately.

**Structural rules are KB-scoped** (phase 1, Part 2). Parity, single ownership, and the
split and absorb thresholds apply under `settings/<setting>/` only. The homebrew index
exists because `/catalog` maintains it, not because parity demands it. Frontmatter,
filename, and content rules apply across all three prongs.

**Vault-per-setting is load-bearing.** Wikilink resolution is basename-only
(`validate-write.mjs:430-433` builds candidates and `searchForFileStat` matches on basename
alone, never path). Two settings sharing one vault means a `Tavern.md` in each collides. A
vault boundary per setting keeps each world's namespace self-contained.

**The migration performs vault operations.** Detect the current vault root, create or move
`.obsidian/` per setting, and tell the DM in the report which vault to reopen. Add
`.obsidian/workspace*.json` and `.obsidian/plugins/` to the ignore policy, and exempt
`.obsidian/` from phase 3's surprise guard.

### Part 3: `conventions.json` v3, with per-setting rules

```json
{
  "version": 3,
  "schemaVersion": 1,
  "settings": [
    {
      "name": "rolara",
      "kbRoot": "settings/rolara",
      "homebrewRoot": "homebrew/rolara",
      "sessionReportsRoot": "session-reports/rolara",
      "campaigns": ["ashes-of-the-first-crown"],
      "tagRegistryPath": ".professor-orb/tag-registry.rolara.json",
      "rules": {}
    }
  ],
  "generatedBy": "setup",
  "generatedAt": "2026-07-28T00:00:00Z",
  "sourceConventionsDoc": null
}
```

**`rules` and `tagRegistryPath` move inside each setting.** A second world must be able to
carry its own article types and its own tag vocabulary. Leaving them at the top level would
mean world B's types have to be added to world A's enum, and `checkTagVocabulary`
(`validate-write.mjs:483-513`) would resolve one registry for all worlds, suggesting world
A's tags inside world B. The base layer is identical in every setting's `rules`; only
`extendedBy` and the project rules differ.

**Every `kbRoot` consumer must accept the v3 shape.** The full list, not the three an
earlier draft named:

| Site | Change |
| --- | --- |
| `validate-write.mjs:717` | Accept a `settings` array or a bare `kbRoot`. Today it exits when `kbRoot` is absent, which would silently disable all validation |
| `validate-write.mjs:724-729` | Membership in any prong root, not `kbRoot` |
| `validate-write.mjs:721`, `:462` | Search root is the union of the **owning setting's** prong roots |
| `validation-sweep.mjs:61-74` | `SCOUT_SCHEMA` gains prong roots with their owning setting |
| `validation-sweep.mjs:167`, `:169`, `:181`, `:569`, `:612` | Enumerate and report per prong root |
| `validation-sweep.mjs:450-459` | `toOwnershipKey` becomes setting-scoped |
| `validation-sweep.mjs:500-513` | Collision detection becomes setting-scoped |

**Ownership and collision keys must be setting-scoped.** `toOwnershipKey` reduces every path
to a lowercased basename in one global namespace. Under the vault boundary, two settings are
*entitled* to a `Tavern.md` each, so a global key would merge their owner lists and ask the
DM which index from a different world should own it. The same detector is the migration's
abort gate, so the first legitimate cross-setting duplicate would abort the run for a
duplication the layout exists to permit. The key becomes `<setting>/<basename>`.

**The search root is the union of the owning setting's prong roots**, not its `kbRoot`.
Session reports link to each other and to KB articles; moving them out of `kbRoot` with a
`kbRoot`-only search root would make every such link report as dead. The two-settings
argument still holds, because the union is per setting.

**Backward compatibility, and its limit.** A v1 or v2 file with a bare `kbRoot` and no
`settings` array is read as a single unnamed setting for **validation** purposes. It is
**not** sufficient for lane resolution: in an unmigrated project `kbRoot` physically
contains the other two prongs, so resolving a lane from it would make phase 3's lane
commands stage all three lanes while believing they stayed in one. Phase 3 refuses to
resolve a lane without a settings array.

**Downstream path consumers.** Seven components resolve KB paths from `conventions.json`:
`debrief` (`:20`), `prep`, `content` (`:16`), `chronicler`, `timeline` (`:21`), `catalog`,
and the agents. All are retargeted to resolve from the settings array, with the canonical
layout as fallback and never the old nesting. Left alone, the next debrief re-creates
`session-reports/<campaign>/` inside the KB and quietly undoes the migration. One shared
setting-resolution rule goes in `SHARED-PRINCIPLES.md` rather than being restated seven
times.

**`campaigns` is a cache, not the authority.** Lane resolution enumerates the filesystem
under `sessionReportsRoot`; the array disambiguates and orders. Otherwise a new campaign
created by `debrief` would be invisible to `/log` until setup ran again.

### Part 4: git and GitHub onboarding

A new step is inserted into `setup/SKILL.md` after predecessor detection (current Step 1).
Existing Steps 2 through 6 become 3 through 7. The audit confirmed no file outside
`setup/SKILL.md` references setup's step numbers.

**Detect state.** Enumerate all remotes rather than testing presence. Four cases:

- **Repository with a remote the DM confirms.** Record it. Never push to a remote the DM has
  not confirmed **in this run**: Rolara carries archived read-only remotes from three
  retired repositories, and pushing to one would be both a failure and a surprise.
- **Repository with no usable remote** (Rolara, after the archived remotes are set aside).
  No `git init`. Offer the GitHub connection or record local-git mode.
- **Not a repository, nested inside one.** Name the ancestor's root and ask. Never adopt an
  ancestor silently.
- **No repository anywhere.** The full three-way offer.

**The offer names the migration.** The DM is not choosing version control in the abstract;
they are choosing whether the restructure about to happen is undoable. The AskUserQuestion
body says so: "setup is about to reorganize N files into professor-orb's layout. Version
control is what makes that reversible."

1. **Private GitHub repository (recommended).** Walkthrough below.
2. **Local git only.** No account, offline, full undo. No offsite copy.
3. **No version control.** The changelog baseline, and **the migration then runs with no
   restore point**. On this path the migration requires an explicit second confirmation, and
   Part 10's undo instruction is replaced by a plain statement that there is nothing to
   undo with.

**Voice.** This is the plugin's only encounter with a DM who may never have used git. Every
term is avoided or defined on first use in one clause. Never emit a bare command without
saying what it does and what they will see.

**Privacy.** Campaign material routinely contains what players must not read. Private is the
default, a public repository would expose unrevealed plot, and private is confirmed before
anything is created. Choosing GitHub uploads campaign content to a third party, stated
before creation.

**Boundaries handed back to the DM:** creating a GitHub account; running `gh auth login`
(interactive, cannot be driven from a non-interactive shell); entering any password or
token.

**What the assistant does once authenticated:** verify with `gh --version` and
`gh auth status`; `git init` if needed; write `.gitignore`; commit the snapshot; and at the
end, `gh repo create <name> --private --source=. --remote=origin --push`. The snapshot and
migration commits already exist, so `--push` has something to send.

**If `gh` is absent**, offer installation (`winget install --id GitHub.cli`,
`brew install gh`); if declined, the DM creates the repository in the web UI, pastes the
HTTPS URL, setup runs `git remote add origin`, and the DM runs the first push. A bare
`git push` without `gh` can trigger a credential-manager GUI prompt that would hang a
non-interactive shell call.

**If the DM stalls on account creation**, complete local git immediately, record mode `git`
with `githubPending: true`, and say finishing later is a matter of asking.

### Part 5: `versioning.json`

Renamed from `catalog-versioning.json`. Separate from `conventions.json`, which is
regenerated wholesale on resync.

```json
{
  "mode": "github",
  "decided": "2026-07-28",
  "remote": "https://github.com/<owner>/<repo>",
  "githubPending": false
}
```

`mode` is `github`, `git`, or `changelog`. `github` and `git` both take `/catalog` Step 7's
existing "Git mode" branch; `changelog` takes the existing "Changelog mode" branch, so those
**mode values** need no rewrite. Setup may update `mode`, `remote`, and `githubPending` in
place but **never `decided`**. Rolara's `2026-07-12` survives.

**Conversion owners are exhaustive:** setup, `/catalog`, `/scribe`, `/log`. The Stop hook is
explicitly exempt, since it must stay silent, non-interactive, and non-mutating; it treats a
lone `catalog-versioning.json` as a valid marker for reading.

**Phase 2 also performs `/catalog` Step 3's precedence flip**: read `versioning.json` first,
always, and delete the repo-presence check at `commands/catalog.md:49`. Phase 3 collapses
the rest of Step 3.

**Push policy.** Setup performs the first push. Later pushes happen on request.

### Part 6: `.gitignore`

Ignored, as derived or transient: `.professor-orb/pipeline-state.json`,
`.professor-orb/proposals/`, `.professor-orb/tag-registry*.json`,
`.obsidian/workspace*.json`, `.obsidian/plugins/`.

Tracked: `.professor-orb/conventions.json`, `.professor-orb/versioning.json`, and the
migration manifest.

**Ordering matters, and an earlier draft had it wrong.** The large-and-sensitive-material
interview runs at step 12, **after** the migration commit, not before the snapshot. Asking
first invites the DM to exclude exactly the campaign material the migration is about to
move, which would leave it outside the restore point. Before mutating, the migration
enumerates `git status --ignored --porcelain` under every prong root and **refuses to move
ignored files**, reporting them instead.

Rolara's consolidation already committed files that the new ignore rules would cover, so
step 12 runs `git rm --cached` on those paths and checks for pre-existing ignore rules that
would swallow tracked files.

### Part 7: the migration

**The executor is `workflows/migrate.mjs`**, a workflow script copied into the consumer's
`.claude/workflows/` exactly as `validation-sweep.mjs` already is (`setup/SKILL.md:70-74`).
Setup Step 5 is generalized to copy every workflow the plugin ships rather than one
hardcoded filename. It adopts the sweep's two-phase plan/apply covenant
(`validation-sweep.mjs:3-38`), its per-item parallel workers, its one-file-one-fix worker
contract (`:205-218`), and its dropped-worker accounting (`:276-289`), which is what
prevents a half-applied migration being reported as complete. That accounting is factored
into something both scripts call.

**Prong discovery and the one confirmation.** The plugin's own documents disagree about
where Rolara's prongs are: this spec's Problem section cites `CONTEXT.md:90` placing the
catalog at `rolara-kb/homebrew/`, while an earlier draft described moving `homebrew/`. One
reading makes the move a folder into its own child. So the executor enumerates candidate
prong locations, reports what it found, and confirms the source-to-destination mapping with
the DM before moving anything. Any move whose destination lies inside its own source is
staged through a temporary sibling path.

**Operations, in dependency order**, following the ordering `chronicler/SKILL.md:122-123`
already establishes for index mutation:

1. Relocate prongs to the canonical layout. Pure moves, link-safe.
2. For each rename required by a suffix or charset rule: rename **and** rewrite every
   wikilink to it, as one unit of work with its own applied true/false accounting. Not two
   batched passes.
3. Create missing indexes for content-bearing KB folders.
4. Merge multi-index folders losslessly.
5. Split folders per the threshold rules, using a corrected entry count.
6. Normalize known base-type value mismatches, including `chronology` to `Chronology`.
7. Repair frontmatter: insert missing defaulted fields, reorder to canonical order.
8. Create or move `.obsidian/` per setting.
9. Regenerate the per-setting tag registries.

**Absorb is not executed on the first run.** It is reported. `absorbThreshold` dissolves
folders holding fewer than four entries, which would dissolve the very prong, setting, and
campaign folders the canonical layout mandates, and dissolving a folder that holds
subfolders is undefined. Prong roots, setting folders, and campaign folders are exempt
permanently; absorb applies only to leaf KB folders; and on an established KB the volume of
movement it would produce makes it a report item rather than an unattended move.

**Enforcement levels and the migration.** The migration applies base rules at their default
enforcement, before the DM has adjusted levels. This is stated plainly rather than papered
over: the DM's chosen levels take effect from the next write onward. Phase 1's grounding of
unattended autofix in "the level they confirmed at setup" refers to ongoing operation, not
to this one run, whose authority comes from the snapshot commit and the after-action report.

**Safety rails.**

| Rail | Addresses |
| --- | --- |
| Snapshot commit precedes every mutation, verified empty, hash printed before step 9 | `git init` alone gives no restore point |
| Clean tree required before the snapshot | An unscoped snapshot sweeping in unrelated work |
| Existing `conventions.json` moved aside after the snapshot | Hook storm on **resync**, which is Rolara's only path |
| Prong mapping confirmed; nested destinations staged through a temporary sibling | Relocating the wrong tree, or a folder into its own child |
| Collision precheck scoped to each destination directory, with the KB-wide check kept as a report finding; on abort, list the pairs, state the project is unchanged, and offer to continue after the DM resolves them | Silent overwrite. Reuses `validation-sweep.mjs:500-513`, now setting-scoped |
| Rename and its link rewrite are one unit of work | A dead wikilink is valid markdown and fails silently |
| Index merges concatenate full source content under provenance headings | Merges discarding headings, grouping, ordering, prose |
| Frontmatter reorder is a line-move on raw text, never parse-and-regenerate | `parseYamlLines` is a documented subset (`validate-write.mjs:21-23`): comments and nested maps are dropped, and `parseScalar` strips quoting, erasing a quoted `"false"` that `conventions-schema.md:209` calls "a real bug worth surfacing" |
| Entry counts narrowed to markdown articles, excluding indexes and subdirectories | `:384` and `:400` count raw `readdirSync`, so 3 articles plus 3 subfolders reads as 6 |
| Case-only renames via explicit two-step or `git mv --force` | Windows and OneDrive case-insensitivity |
| Ignored files are never moved, only reported | Files outside the snapshot being relocated unrecoverably |
| Per-file applied true/false with dropped-worker accounting | OneDrive locks half-applying a bulk move |
| Manifest written to a tracked path | A half-applied run must be diagnosable from the repository alone |
| Deletions sequenced after the snapshot | Otherwise unrecoverable |
| Post-migration link-integrity assertion must pass before the migration commit | Catches any rename whose rewrite was dropped |

**The manifest and Principle 8.** `SHARED-PRINCIPLES.md:47` forbids creating "scratch files,
execution logs, or manifests unless the project's conventions call for them," and
`setup/SKILL.md:6` tells setup to apply those rules throughout. Part 8's carve-out names the
manifest explicitly as required by professor-orb's own conventions, and it is tracked rather
than written to the gitignored `proposals/` directory.

**Non-wikilink references are not rewritten automatically.** The consumer's `CLAUDE.md`, its
conventions doc, and the DM's separate wiki-website project all reference prong paths in
prose. The migration reports every such reference it finds and offers to update them. It
does not rewrite prose unattended.

### Part 8: the approval-gate carve-out, stated exhaustively

Removing the gate in one place while four other statements of the same rule stand would make
the migrating skill simultaneously require and forbid the gate it just lost. All five are
edited together:

| Statement | Resolution |
| --- | --- |
| `setup/SKILL.md:14` "Every mutation in this workflow ... requires the DM's explicit approval" | Rewritten to enumerate: the schema migration is exempt; `conventions.json` contents, enforcement levels, the CLAUDE.md pointer paragraph, predecessor removal, and conventions-doc retirement keep their gates |
| `setup/SKILL.md:80` "Only execute the migration after explicit approval" | Replaced. The scan definition in the same sentence survives verbatim |
| `setup/SKILL.md:83` "Migrations stay proposals ... never file state" | Replaced. The prohibition on asserting a migration inside `conventions.json` survives |
| `SHARED-PRINCIPLES.md` Principle 2 | Narrow carve-out: setup's schema migration is exempt because git is the gate. Every pipeline skill remains gated |
| `CONTEXT.md:118-119` | Promises Rolara specifically that the parity migration will be a "proposal file, DM approval, then execution". Rewritten to describe the snapshot-and-report model |

`commands/catalog.md:136` ("Never invent a new sub-index split without proposing it to the
DM first via AskUserQuestion") **survives**, and the initial migration is stated as its one
exception, justified by the snapshot and the report. Phase 1 edits only the split-threshold
clause of `:112`, not the gate.

### Part 9: resync, which is Rolara's only path

Resync runs Part 1 steps 1 through 14 **in full**, including the snapshot, the
conventions-aside step, the mapping confirmation, the manifest, and the prechecks. It is not
a lighter path.

It re-imposes the schema rather than treating the previous run's output as a starting draft:
detect divergence from the base rule set, migrate what has drifted, and regenerate
`conventions.json` preserving the extras layer and the DM's enforcement choices, both read
into memory at step 6 before the file is moved aside.

`setup/SKILL.md:21`'s resync menu is rewritten to say plainly that the run will relocate the
project to the canonical layout, and how to undo it.

`pipeline-state.json`, `proposals/`, and `versioning.json` are untouched.

**Rolara's specifics.** Its layout moves to `settings/rolara/`,
`session-reports/rolara/<campaign>/`, and `homebrew/rolara/`, with the sources determined by
step 7's discovery rather than by either document's current claim. Its `conventions.json`,
produced by the old derive-everything setup, is regenerated with the base layer plus extras
derived from the `type` values actually present in its articles (phase 1, Part 2), not from
a hand-written list. Its `items/` folder holds six sub-index files (`CONTEXT.md:118`), so it
is a certain multi-index merge case.

### Part 10: the after-action report

The DM approved the mapping and nothing else, so the report is the accountability surface.
It reuses the KB Validation Report shape (`agents/kb-validator.md:118-147`).

It states: the layout before and after; every file moved, renamed, created, merged, or
deleted, by count, with the manifest path; every link rewritten; which vault to reopen in
Obsidian; anything declined and why (ignored files, absorb candidates, `-TIMELINE` and
`-HISTORY` files, prose path references); anything that failed, with file and error; and the
git state: snapshot hash, migration hash, and the exact undo command.

**The undo instruction is conditional on a snapshot existing.** On the no-version-control
path it is replaced by a plain statement that the restructure cannot be reversed
automatically.

## Out of scope

- **`/scribe`, `/log`, the rest of `/catalog` Step 3, the Stop hook.** Phase 3.
- **`/migrate`.** This phase builds the executor it will later expose.
- **`/genesis`.** Setup creates the first setting; `/genesis` reuses the same scaffolding.
- **The base rule set's content.** Phase 1.
- **Branching or pull requests.** A single `main` branch.

## Files touched

| File | Change |
| --- | --- |
| `workflows/migrate.mjs` | **New.** The migration executor |
| `skills/setup/SKILL.md` | Git step, Steps 2 to 6 renumbered, intake restructure, run order, approval carve-outs at `:14`/`:80`/`:83`, resync menu at `:21`, Step 5 generalized to copy all workflows, after-action report |
| `skills/SHARED-PRINCIPLES.md` | Principle 2 carve-out; Principle 8 manifest carve-out; shared setting-resolution rule |
| `skills/setup/references/conventions-schema.md` | v3 settings array, per-setting rules and tag registry, prong roots, back-compat limits |
| `hooks/validate-write.mjs` | `:717`, `:721`, `:462`, `:724-729`, entry counts at `:384`/`:400`, per-setting tag registry at `:483-513` |
| `workflows/validation-sweep.mjs` | `SCOUT_SCHEMA` `:61-74`, `:167`, `:169`, `:181`, `:569`, `:612`, setting-scoped `toOwnershipKey` `:450-459` and collisions `:500-513`, parity merge verdict `:544-546` |
| `skills/debrief/SKILL.md` | Path default `:20`; append new campaigns to `campaigns` |
| `skills/content/SKILL.md`, `prep`, `chronicler`, `timeline` | Path resolution from the settings array |
| `commands/catalog.md` | Marker rename `:50`/`:55`/`:56`/`:146`; Step 3 precedence flip; delete `:49` |
| `CONTEXT.md` | Catalog location `:90`, setup entry `:52`, approval promise `:118-119`, rebuild step `:125-127` |
| `README.md` | Getting-started expectations `:70` |

## Verification

- `node workflows/validation-sweep.ownership.test.mjs` still passes.
- **A v3 `conventions.json` loads and the hook emits a violation against it.** Not merely
  that a v1 file still loads. A silently-passing hook is the failure mode this guards.
- **If prong roots are declared and enumeration returns zero files, that is an error**, not
  a clean scan.
- Exercise the migration against a fixture reproducing Rolara's shape: nested prongs,
  multi-index folders with prose and headings, files missing suffixes, a same-directory
  basename collision, a legitimate cross-setting duplicate basename, frontmatter with a
  comment and a quoted `"false"`, a `type: chronology` article, and an ignored file inside a
  prong. Assert: the snapshot precedes every mutation; no content is lost; the comment and
  quoting survive; every wikilink resolves after the run, including report-to-report and
  report-to-article; the same-directory collision aborts before mutation; the cross-setting
  duplicate does **not**; the ignored file is reported and not moved.
- **Exercise the resync path specifically**, asserting the hook is silent throughout because
  `conventions.json` was moved aside, and that extras and enforcement levels survive.
- Exercise the four repository-state cases, including archived remotes that must not be
  pushed to.
- Exercise the marker conversion; confirm `decided` survives and the old file is deleted
  only after the snapshot.
- Run a debrief after a migration and confirm it writes to the canonical path.
- Confirm no em dashes in changed files.

## Notes

An earlier draft placed the first commit at the end of the run, reasoning that "an empty
initial commit followed by a second commit containing everything is worse than one initial
commit that captures the finished setup." That reasoning does not survive contact with a
migration: the initial commit is not empty, it contains the DM's entire pre-existing
campaign, and it is the only thing between an unattended restructure and unrecoverable loss.
