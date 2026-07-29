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

| # | Step | Setup step | Runs in |
| --- | --- | --- | --- |
| 1 | **Detect repository state** (Part 4), including a scan of every candidate prong root and the project root for a nested `.git` below the project root. A nested repository's contents are invisible to the outer snapshot, so if one exists, stop here and resolve it (absorb its history, or have the DM archive and remove it) before anything else. | 2 | main |
| 2 | **Require a clean tree.** If `git status --porcelain` is non-empty, report and stop, or offer to commit the DM's existing work under its own message first. Nothing has been written yet, so this gate is reachable. | 2 | main |
| 3 | **Establish git** and write `.gitignore` **additions only** (Part 6). No ignore-list interview yet. | 2 | main |
| 4 | **Convert the versioning marker.** If `catalog-versioning.json` exists and `versioning.json` does not, write the new file with `mode` and `decided` unchanged. Both files exist at this point; the old one is deleted at step 12, after the snapshot captures it. | 2 | main |
| 5 | **Commit the snapshot**: `chore: pre-migration snapshot before professor-orb setup`. Then **assert** `git status --porcelain` is empty and capture the hash. If either fails, abort before any mutation. Print the hash and the undo command now, not only in the closing report. | 2 | main |
| 6 | **Move any existing `conventions.json` aside** to `conventions.json.pre-migration`, already captured by the snapshot. Read its rules, extras, and enforcement levels into memory first. This is what makes the hook silent (`setup/SKILL.md:10`) on **resync** as well as first run. | 2 | main |
| 7 | **Discover the prongs and confirm the mapping** (Part 7). The one gate. | 2 | main |
| 8 | **Copy the workflows** into `.claude/workflows/`, including `migrate.mjs`, which step 10 needs. | 6 | main |
| 9 | **Write the migration manifest** to a tracked path and run the prechecks. A precheck failure stops before any mutation. | 3 | main |
| 10 | **Execute the migration.** | 3 | `migrate.mjs` |
| 11 | **Derive the extras layer, draft the rule set, and confirm enforcement levels** with the DM via AskUserQuestion. Both gates survive (Part 8) and both belong here, after the migration, because the migration runs at base defaults and because the extras are derived from the KB's post-migration state. | 4, 5 | main |
| 12 | **Write `.professor-orb/` artifacts**: `conventions.json` (v3), `pipeline-state.json`, per-setting `tag-registry`, `proposals/`. Delete `conventions.json.pre-migration` and the old `catalog-versioning.json`. | 5 | main |
| 13 | **Handle remaining deletions**: predecessor plugin artifacts, source conventions doc retirement. Both **keep their approval gates** (Part 8). | 5 | main |
| 14 | **Ask the large-and-sensitive-material question**, apply further ignore additions, and `git rm --cached` any newly ignored path the consumer's history already tracks. | 7 | main |
| 15 | **Commit the migration**, then push if GitHub is configured. | 7 | main |
| 16 | **Report** (Part 10). | 7 | main |

**The step column is normative and replaces the earlier renumbering shorthand.** An earlier
draft said only "Existing Steps 2 through 6 become 3 through 7," which left setup's own
ordering writing `conventions.json` before the migration and so arming the hook for the
entire run, contradicting this table. `setup/SKILL.md`'s steps are restated in full against
this mapping rather than shifted by one.

**`conventions.json` exists on disk at no point between steps 6 and 12.** That is the
hook-storm mitigation, and it holds identically on first run and on resync. Verification
asserts it on both paths.

**A live predecessor plugin arms its own hook.** `setup/SKILL.md:27-29` detects the Cowork
edition. Its `Write|Edit` hook fires throughout the migration regardless of what
professor-orb does with its own conventions file, so detection happens at step 1 and removal
is required before migrating. This is a mutation-safety matter, not tidiness.

**Without a verified snapshot there is no carve-out.** Part 8 exempts setup's migration from
Principle 2 on the grounds that git is the gate. That reasoning is conditional on step 5
having produced a verified hash. On `changelog` mode, or if the snapshot assertion fails, the
migration falls back to the old contract: the manifest from step 9 is presented as a
proposal, and execution happens only on approval. It never runs unattended without a restore
point.

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
`**/.obsidian/workspace*.json`, `**/.obsidian/plugins/`.

**The `**/` prefix is load-bearing and was verified against real git.** A gitignore pattern
containing a slash anywhere but at its end is anchored to the directory holding the
`.gitignore`, so `.obsidian/workspace*.json` matches a vault at the project root and nothing
else. Measured: with that pattern, `git check-ignore` does not match
`settings/rolara/.obsidian/workspace.json`, and `git add -A` stages the vault's plugin
bundles. Three consequences follow, and they compound: vault state and plugin binaries get
pushed to the DM's private repository; `workspace.json` is rewritten every time Obsidian
opens or closes, so `git status --porcelain` is never clean again and the clean-tree gate at
Part 1 step 3 fails on every later resync; and that churn sits inside `/scribe`'s lane, where
phase 3 exempts `.obsidian/` from the surprise guard. The `**/` form matches at any depth and
does not over-match articles.

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

**Its workers need `Bash`, which is a real departure from the sweep's grant and must not be
copied over unexamined.** The sweep's fix workers apply changes "using the Write or Edit
tool" (`validation-sweep.mjs:214`), and `rule-fixer` is granted `Read, Edit`
(`agents/rule-fixer.md:20`). Neither can move or rename a file, and that is the migration's
core operation. Verified: a Write-only worker can only copy content to the new path, leaving
the original in place, which for a suffix rename produces two files claiming the same article
and a guaranteed basename collision. `migrate.mjs`'s workers are granted `Bash` and perform
every relocation through `git mv`.

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
2. Normalize known base-type value mismatches, including `chronology` to `Chronology`.
   **Before the rename pass**, because a file's required suffix is derived from its `type`,
   so renaming first would compute suffixes from stale values and leave the corrected files
   permanently mis-suffixed.
3. For each rename required by a suffix or charset rule: rename **and** rewrite every
   wikilink to it, as one unit of work with its own applied true/false accounting. Not two
   batched passes.
4. Create missing indexes for content-bearing KB folders.
5. Merge multi-index folders losslessly.
6. Repair frontmatter: insert missing defaulted fields **except `publish`**, and reorder to
   canonical order. `publish` is never inserted or changed by any unattended process
   (phase 1, Part 2): articles missing it are reported, because setting a disclosure flag is
   the DM's call and guessing wrong leaks unmarked secret lore into their public wiki.
7. Create or move `.obsidian/` per setting.
8. Regenerate the per-setting tag registries.

**Split is reported, not executed, on the first run**, for the same reason absorb is.
Crossing the threshold tells you a folder should divide; it does not tell you *how*. Choosing
the partition and naming the resulting subfolders is a judgment about the DM's own material,
and `commands/catalog.md:136`'s AskUserQuestion gate on sub-index splits survives (Part 8).
The migration proposes a partition per over-threshold folder and reports it; `/migrate`
(spec 4) executes it once the DM has chosen. An earlier draft executed splits unattended with
no partition rule specified anywhere, while simultaneously stating that the split gate
survives.

**Absorb is not executed on the first run.** It is reported. `absorbThreshold` dissolves
folders holding fewer than four entries, which would dissolve the very prong, setting, and
campaign folders the canonical layout mandates, and dissolving a folder that holds
subfolders is undefined. Prong roots, setting folders, and campaign folders are exempt
permanently; absorb applies only to leaf KB folders; and on an established KB the volume of
movement it would produce makes it a report item rather than an unattended move.

**Enforcement levels and the migration.** The migration applies base rules at their default
enforcement, because the DM confirms levels at run-order step 11, after it. This is stated
plainly rather than papered over: the DM's chosen levels take effect from the next write
onward. Phase 1's grounding of unattended autofix in "the level they confirmed at setup"
refers to ongoing operation, not to this one run, whose authority comes from the snapshot
commit and the after-action report.

**Both operations the migration defers, split and absorb, are structural judgments rather
than structural facts.** The threshold detects that a folder should divide or dissolve; it
does not determine how to partition it or where its contents belong. That is the same line
`validation-sweep.mjs:544-546` already draws for multi-index folders. Deferred items go to
the report and then to `/migrate` (spec 4), which exists to execute exactly this class of
work once the DM has scoped it.

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
| All moves and renames go through `git mv`, never a filesystem rename | Verified: `git mv` records a single staged rename with a coherent index. A plain filesystem rename leaves `D` plus `??`, recoverable only if both sides are staged, and a worker that can only Write cannot delete the old path at all, producing duplicate content under both names and a guaranteed basename collision on any suffix rename |
| Case-only renames use `git mv` directly; the two-step is a fallback, not a requirement | Verified on this platform (`core.ignorecase = true`): `git mv items-index.md items-INDEX.md` succeeds and the corrected casing survives a commit. An earlier draft mandated a two-step unconditionally, which was unnecessary. Fall back to the two-step only if `git mv` reports an error |
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

**Rolara's specifics, now measured rather than assumed.** Its `homebrew/` sits at the project
root as a sibling of `rolara-kb/`, not inside it: `CONTEXT.md:90`'s `rolara-kb/homebrew/` is
stale. All three prong moves are therefore clean sibling relocations, and the
folder-into-its-own-child hazard that motivated step 7's confirmation does not arise here.
Step 7 still runs, because the confirmation exists for the consumer whose layout has not been
measured.

Its 71 catalog entries already carry correct `type` values and `publish: false`, so neither
the type normalization nor the `publish` reporting touches them. Its `conventions.json`,
produced by the old derive-everything setup, is reconciled by phase 1's rule (v1 rules
matching a base rule fold into `extendedBy`, carrying their enforcement level). Its `items/`
folder holds six sub-index files (`CONTEXT.md:118`), so it is a certain multi-index merge
case.

### Part 10: the after-action report

The DM approved the mapping and nothing else, so the report is the accountability surface.
It reuses the KB Validation Report shape (`agents/kb-validator.md:118-147`).

It states: the layout before and after; every file moved, renamed, created, merged, or
deleted, by count, with the manifest path; **every file whose contents were edited, by
count and by which operation edited it**; every link rewritten; which vault to reopen in
Obsidian; anything declined and why (ignored files, absorb candidates, `-TIMELINE` and
`-HISTORY` files, articles missing `publish`, prose path references); anything that failed,
with file and error; and the git state: snapshot hash, migration hash, and the exact undo
command.

**The edited category is not optional.** An earlier draft enumerated only location changes,
which left operations 6 and 7, the two that change file *contents* rather than where they
sit, absent from the report entirely. The snapshot-plus-report bargain that replaces the
approval gate has to cover the edits, or the DM approved a mapping and received an accounting
of everything except what was rewritten inside their articles.

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
  pushed to, and a fixture carrying a **nested** `.git` inside a prong root, asserting the
  run stops at step 1 rather than taking a snapshot that cannot capture it.
- **Assert no `conventions.json` exists on disk at any point during step 10**, on both the
  first-run and the resync path. This is the hook-storm mitigation and it is the claim an
  earlier draft got wrong.
- Assert the `changelog` path never runs the migration unattended: with no snapshot hash, the
  manifest must be presented as a proposal and execution must wait for approval.
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
