# Apply the schema: multi-setting layout, git-first onboarding, and setup's initial migration

Date: 2026-07-28
Spec 2 of 3 (follows: canonical schema. Precedes: lane commands)
Components: `skills/setup/SKILL.md`, `skills/setup/references/conventions-schema.md`,
`hooks/validate-write.mjs`, `workflows/validation-sweep.mjs`, `skills/debrief/SKILL.md`,
`skills/content/SKILL.md`, `commands/catalog.md`, `CONTEXT.md`, `README.md`
Status: design, approved 2026-07-28

## Problem

Spec 1 establishes that professor-orb owns the structural schema. This spec makes setup
apply it: lay down the canonical layout, restructure whatever the consumer already has to
match, and put version control underneath the whole thing first so the restructure is
recoverable.

Four things stand in the way today.

**Nothing in the plugin can move a file.** `rule-fixer` is granted `Read, Edit`
(`agents/rule-fixer.md:20`), `kb-validator` is read-only (`agents/kb-validator.md:151`), and
the sweep's fix workers apply changes "using the Write or Edit tool"
(`workflows/validation-sweep.mjs:214`). A migration executor is entirely new capability with
filesystem-mutation authority no existing component has.

**The layout the plugin wants is not representable.** `conventions-schema.md:64-65` defines
exactly one root: "Path to the KB folder, relative to the project root", `kbRoot`. Today both
other prongs live inside it:
`skills/debrief/SKILL.md:20` defaults session reports to "`session-reports/[Campaign-Name]/`
at the KB root" and `CONTEXT.md:90` puts the catalog at `rolara-kb/homebrew/`. There is no
field for a second setting, and no field for a prong that is a sibling of the KB rather than
a child.

**Scoping is welded to `kbRoot`.** `hooks/validate-write.mjs:724-729` exits 0 for any path
outside `kbRoot`, and the sweep enumerates "every markdown article file under kbRoot"
(`validation-sweep.mjs:169`). Moving session reports and homebrew out of the KB without
changing this makes both prongs invisible to all validation. `kbRoot` is also the search root
for wikilink resolution (`validate-write.mjs:721`), so cross-prong links would begin
reporting as dead.

**The migration can destroy content in five distinct ways**, enumerated in the risk table
below. The one that matters most: `git init` alone provides zero revertibility. An untracked
working tree has no restore point, because `git checkout`, `git reset`, and `git stash` all
restore from committed or staged state. The superseded spec deferred the first commit to the
end of the run, which would have folded the migration into the initial commit and left the
DM's original layout unrecoverable. That ordering is inverted here.

## Decisions

Settled with the DM during brainstorming:

- The canonical layout is multi-setting from day one, with each setting KB its own Obsidian
  vault. Session reports subdivide by setting, then campaign.
- Setup applies the schema and migrates without a confirmation gate, reporting afterward.
  Git is established first so the whole migration is revertible.
- GitHub is strongly recommended and private by default. Declining falls back to local-only
  git, not to nothing. The DM can add GitHub later at any time.
- Resync re-imposes the schema properly rather than preserving an earlier run's output.
- The marker file is renamed from `catalog-versioning.json` to `versioning.json`, with a
  one-time conversion that preserves the original `decided` date.

## Design

### Part 1: run order

The order is the safety design. It is not an implementation detail.

1. **Detect repository state** (four cases, Part 4).
2. **Establish git**, including `.gitignore` (Part 6).
3. **Commit the untouched tree.** This is the restore point. Message names it as such:
   `chore: pre-migration snapshot before professor-orb setup`. Nothing has moved yet.
4. **Write the migration manifest** to `.professor-orb/proposals/` (Part 7). Machine-readable
   record of intent, written before any mutation. Not presented for approval; it exists so a
   half-applied run can be diagnosed.
5. **Run the prechecks.** Basename collisions across the proposed post-migration path set,
   link-rewrite targets, case-rename hazards. A precheck failure aborts before any mutation.
6. **Execute the migration** (Part 7).
7. **Write `conventions.json`**, `pipeline-state.json`, `tag-registry.json`, `proposals/`.
8. **Copy the validation sweep workflow** to `.claude/workflows/`.
9. **Handle deletions**, if any: predecessor plugin artifacts, source conventions doc
   retirement. These are irreversible-by-nature operations and now sit safely after the
   snapshot commit.
10. **Commit the migration**, then push if GitHub is configured (Part 5).
11. **Report** (Part 10).

**Why `conventions.json` is written after the migration, not before.** The write-time hook
fires on every Write and Edit. `validate-write.mjs:804-807` exits 2 on any block violation
and `:790-797` emits an autofix request per failing rule, which instructs the main session to
dispatch `rule-fixer`. A migration touching hundreds of still-nonconforming files would
generate hundreds of subagent dispatches racing the migration's own edits on the same files.
The hook already degrades gracefully and stays silent until `conventions.json` exists
(`setup/SKILL.md:10`), so writing it last is a complete fix requiring no new gating
mechanism. The migration does not need the file: it targets professor-orb's base schema,
which is static and known to the plugin.

### Part 2: the canonical layout

```
<project>/
  settings/
    <setting>/                    KB. Its own Obsidian vault (.obsidian/)
      <Setting>-INDEX.md
  homebrew/
    <setting>/
      Homebrew-INDEX.md
  session-reports/
    <setting>/
      <campaign>/
        content/                  player-facing output
  .professor-orb/
  .claude/workflows/
```

**Vault-per-setting is load-bearing, not cosmetic.** Wikilink resolution is basename-only:
`validate-write.mjs:430-433` builds candidates from the target name and hands them to
`searchForFileStat`, which walks the tree matching on basename alone, never on path. Two
settings sharing one vault means a `Tavern.md` in each collides in the link graph. A vault
boundary per setting keeps each world's namespace self-contained.

**Homebrew and session reports subdivide by setting** because they are setting-scoped
material. Session reports subdivide again by campaign, since two campaigns can run in one
world.

### Part 3: `conventions.json` v3

Spec 1 takes the file to version 2 (per-rule `provenance`, `schemaVersion`). This spec takes
it to version 3, replacing the single `kbRoot` with a settings array. If both specs ship in
one release, a single bump to version 2 covers both.

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
      "campaigns": ["ashes-of-the-first-crown"]
    }
  ],
  "generatedBy": "setup",
  "generatedAt": "2026-07-28T00:00:00Z",
  "sourceConventionsDoc": null,
  "tagRegistryPath": ".professor-orb/tag-registry.json",
  "rules": {}
}
```

**Validation scope becomes the union of all prong roots across all settings**, not `kbRoot`
alone. Three call sites change:

- `validate-write.mjs:724-729`, which exits 0 for paths outside `kbRoot`, now tests
  membership in any prong root.
- `validate-write.mjs:721` and `:462`, the wikilink search root, resolves against the owning
  setting's `kbRoot` rather than a single global one. A link inside `settings/rolara/`
  resolves within that setting only, which is what the vault boundary means in practice.
- `validation-sweep.mjs:169`, the scout's enumeration, walks every prong root.

**Backward compatibility.** A v1 or v2 file carrying a bare `kbRoot` and no `settings` array
is read as a single unnamed setting whose `kbRoot` is that value and whose other prong roots
are unknown. Every component keeps working; setup rewrites the file on next run.

**Downstream defaults must move with the layout.** `skills/debrief/SKILL.md:20` and
`skills/content/SKILL.md:16` still describe the old nesting. Left alone, the next debrief
quietly re-creates `session-reports/<campaign>/` inside the KB and undoes the migration.
Both are rewritten to resolve from `conventions.json` and to fall back to the canonical
layout, never to the old one.

### Part 4: git and GitHub onboarding

A new step is inserted into `setup/SKILL.md` after predecessor detection (current Step 1).
Existing Steps 2, 3, 4, 5, and 6 become 3, 4, 5, 6, and 7, and their internal
cross-references shift with them. The audit confirmed no file outside `setup/SKILL.md`
references setup's step numbers, so the renumbering is contained.

**Detect state first.** Four cases:

- **Already a repository with a remote.** Nothing to establish. Record it, name the remote so
  the DM can confirm it is the one they expect.
- **Already a repository, no remote** (Rolara's case). Do not run `git init`. Offer the
  GitHub connection, or record local-git mode.
- **Not a repository, but nested inside one.** Name the ancestor's root path and ask whether
  the DM wants a repository for this project specifically. Never adopt an ancestor silently:
  that conflation is the original defect this work started from.
- **No repository anywhere.** The full three-way offer.

**The offer**, via AskUserQuestion, stated in concrete terms rather than version-control
vocabulary: every change is undoable, the campaign can be viewed as it stood on any past
date, and an offsite copy survives a dead hard drive.

1. **Private GitHub repository (recommended).** Walkthrough below.
2. **Local git only.** No account, works offline, full history and undo. The tradeoff is
   stated plainly: no offsite copy, so hardware failure loses the campaign. GitHub can be
   added later by asking.
3. **No version control.** The changelog baseline. What is given up is stated: no undo, no
   history, only a running description of what changed.

**If the DM declines version control entirely, the migration still runs.** It is the plugin's
schema either way. The report says plainly that there is no restore point, which is the
honest consequence of that choice rather than a reason to withhold the schema.

**Voice requirement.** This is the plugin's only encounter with a DM who may never have used
git. Every term is avoided or defined on first use in one clause. Write "a free account at
github.com, where a private copy of your campaign is stored online" rather than "a remote
origin". Never emit a bare command without saying what it does and what the DM will see.

**Privacy is a requirement, not framing.** Campaign material routinely contains what players
must not read. Private is the default, a public repository would expose unrevealed plot, and
private is confirmed before anything is created. Choosing GitHub uploads campaign content to
a third party, and setup says so before creating the repository, not after.

**Boundaries the assistant cannot cross, handed back to the DM:**

- Creating a GitHub account. Setup gives the short version and waits.
- Running `gh auth login`. It is interactive and cannot be driven from a non-interactive
  shell. Setup describes the browser window and one-time code, and waits for confirmation.
- Entering any password or token.

**What the assistant does once authenticated:**

- Verify with `gh --version` and `gh auth status`. Never assume.
- `git init` at the project root if needed, write `.gitignore`, commit the snapshot.
- At the end of the run: `gh repo create <name> --private --source=. --remote=origin --push`.
  The snapshot and migration commits already exist, so `--push` has something to send.

**If `gh` is absent.** First offer installation (`winget install --id GitHub.cli`,
`brew install gh`). If declined, the DM creates the private repository in the web UI and
pastes the HTTPS URL; setup runs `git remote add origin <url>` and the DM runs the first
push. The manual path exists because a bare `git push` without `gh` can trigger a
credential-manager GUI prompt that would hang a non-interactive shell call.

**If the DM stalls on account creation.** Setup must not hang. Complete local git
immediately, record mode `git` with `githubPending: true`, and state that finishing later is
a matter of asking.

### Part 5: `versioning.json`

Renamed from `.professor-orb/catalog-versioning.json`. Same directory, name no longer
implying the decision covers only homebrew. It stays separate from `conventions.json`
because `conventions.json` is regenerated wholesale on resync and the versioning decision
must survive that untouched.

```json
{
  "mode": "github",
  "decided": "2026-07-28",
  "remote": "https://github.com/<owner>/<repo>",
  "githubPending": false
}
```

`mode` is `github` (git with a private remote), `git` (local only), or `changelog` (no git).
`github` and `git` are both git mode downstream, so `/catalog` Step 7's existing "Git mode"
and "Changelog mode" prose needs no rewrite. `decided` is never rewritten after it is first
set.

**One-time conversion.** Any component reading the marker checks first: if
`catalog-versioning.json` exists and `versioning.json` does not, copy `mode` and `decided`
unchanged into the new file, delete the old one, mention it in passing. The `decided` date is
preserved, not reset. This is shared behavior for every install predating the change, not a
Rolara special case.

**Push policy.** Setup performs the first push. After that, commits happen where they already
do and pushes happen when the DM asks. Nothing pushes silently in the background.

### Part 6: `.gitignore`

Written when setup initializes a repository; proposed as additions to an existing one rather
than overwriting it.

Ignored, as derived or transient: `.professor-orb/pipeline-state.json` (a breadcrumb,
rewritten constantly), `.professor-orb/proposals/` (transient), and
`.professor-orb/tag-registry.json` (regenerated by every sweep, so tracking it produces
commit noise on every run).

Tracked, as durable decisions: `.professor-orb/conventions.json` and
`.professor-orb/versioning.json`.

Setup also asks about large or sensitive material a campaign project commonly holds (Foundry
exports, map images, audio) rather than silently committing hundreds of megabytes on the
first push. The tag-registry exclusion is a judgment call the DM may override.

### Part 7: the migration

**Operations, in dependency order.** Indexes are written only after the articles they
reference are settled, following the ordering `skills/chronicler/SKILL.md:122-123` already
establishes.

1. **Relocate prongs** to the canonical layout. Pure moves, link-safe.
2. **Rename files** to carry their mandatory suffix and to satisfy the charset rule. Not
   link-safe on its own; see the link-rewrite rail below.
3. **Rewrite wikilinks** KB-wide for every rename performed in step 2.
4. **Create missing indexes** for content-bearing folders that lack one.
5. **Merge multi-index folders** losslessly (rail below).
6. **Split and absorb** folders per the threshold rules, using a corrected entry count.
7. **Repair frontmatter**: insert missing defaulted fields, reorder fields to canonical order.
8. **Regenerate** the tag registry.

**Safety rails.** Each addresses a specific audited failure mode.

| Rail | Addresses |
| --- | --- |
| Snapshot commit precedes every mutation (Part 1 step 3) | `git init` alone gives no restore point |
| Basename-collision precheck across the proposed post-migration path set, aborting before any mutation | Moves and merges silently overwriting same-basename files. Reuses `validation-sweep.mjs:500-513` |
| Every rename paired with a KB-wide link rewrite in the same operation | Renames break `[[Old-Name]]` silently, since a dead wikilink is valid markdown. Reuses `toOwnershipKey` (`validation-sweep.mjs:450-459`) |
| Index merges concatenate full source content under provenance headings, never extract the union of links | Merges discarding headings, groupings, ordering, and prose |
| Frontmatter reorder is a line-move on raw text, never parse-and-regenerate | `parseYamlLines` is a documented subset (`validate-write.mjs:21-23`): comments and nested maps are dropped, and `parseScalar` strips quoting, which would erase a quoted `"false"` that `conventions-schema.md:209` calls "a real bug worth surfacing" |
| Entry counts narrowed to markdown articles, excluding indexes and subdirectories | `validate-write.mjs:384` and `:400` count raw `readdirSync` entries, so 3 articles plus 3 subfolders reads as 6 and wrongly earns a split |
| Case-only renames performed as an explicit two-step or `git mv --force` | Windows and OneDrive: a `-index` to `-INDEX` rename is a no-op or an error on a case-insensitive filesystem |
| Per-file worker returns applied true or false, with dropped-worker accounting | OneDrive file locks can half-apply a bulk move. Reuses the sweep's accounting (`validation-sweep.mjs:276-289`) so a partial run is never reported as complete |
| Deletions sequenced after the snapshot commit (Part 1 step 9) | Predecessor artifact removal and source-doc retirement are otherwise unrecoverable |
| `conventions.json` written after the migration (Part 1 step 7) | Hook storm: hundreds of racing autofix dispatches |

**On lossless index merges.** `validation-sweep.mjs:544-546` currently refuses to automate
this: "which index survives is the DM's call, so it is a needs-judgment finding, never an
auto-fix." That refusal exists because the obvious merge (take the union of wikilinks) throws
away everything else in the file. A concatenating merge does not have that problem: nothing
is lost, the result is verifiably a superset, and it is therefore mechanical rather than a
judgment call. The merged index will read untidily and the report says so, inviting the DM to
reorganize. Lossless and revertible beats tidy and destructive.

**Reused machinery.** The migration is mostly assembly, not invention. The parity detector
(`validation-sweep.mjs:550-585`), the ownership pass (`:515-538`), the scout inventory
(`:162-172`), the two-phase scan and fix engine with its dropped-worker accounting
(`:236-326`), the one-file-one-fix worker contract (`:205-218`), the suffix detector
(`validate-write.mjs:293-304`), the charset detector (`:306-322`), the default resolver
(`:246-260`), the field-order detector (`:209-234`), and fuzzy basename matching (`:150-173`)
all exist and are reused. What is new: move and rename authority, the link rewriter, the
concatenating merge, and the raw-text field reorder.

### Part 8: setup's intake restructure

Spec 1 rewrites setup's posture sentences. This spec restructures the workflow they sat in.

The three intake tiers stop being three ways to derive a rule set and become one flow with
three levels of available extras:

1. **Start from the base.** Professor-orb's rule set is written first, always, identically
   for every consumer.
2. **Collect extras.** What the base does not cover: additional article types in use, tag
   vocabulary, Obsidian-specific practices, VTT platform, content conventions. Where those
   come from is what the old tiers actually distinguished, and that distinction survives: an
   existing conventions document is the richest source, scattered prose is next, and an
   interview is the fallback when nothing is written down.
3. **Confirm enforcement levels.** Unchanged in mechanism. The DM adjusts levels on base and
   project rules alike, including setting a base rule to `off`.

Step 6's greenfield branch already builds structure from scratch and survives, retargeted at
the canonical multi-setting layout. Its established-KB branch keeps its scan definition
(`setup/SKILL.md:80` names exactly the right detection scope) and loses its approval gate.

### Part 9: resync

Resync re-imposes the schema rather than treating the previous run's output as a starting
draft. Concretely, it re-runs the same flow: detect divergence from the base schema, migrate
what has drifted, regenerate `conventions.json` preserving only the extras layer and the DM's
enforcement choices.

Two things resync must not clobber, as today: `pipeline-state.json` and `proposals/`.
`versioning.json` is likewise untouched, since the versioning decision is not a convention.

**Rolara's resync is the migration's first real exercise.** Its layout moves from
`rolara-kb/`, `session-reports/<campaign>/`, and `homebrew/` to `settings/rolara/`,
`session-reports/rolara/<campaign>/`, and `homebrew/rolara/`. Its `conventions.json`, produced
by the old derive-everything setup, is regenerated with the base layer plus its genuine
extras (the `Settlement`, `Landmark`, `Species`, `Ethnicity`, `Natural-Law`,
`Supernatural-Law`, and `Law` types, its tag vocabulary, its Obsidian practices).

### Part 10: the after-action report

The DM did not approve the migration in advance, so the report is the whole accountability
surface. It reuses the shape of the KB Validation Report
(`agents/kb-validator.md:118-147`): scope, what was done, what was not, and a summary.

It states: the layout before and after; every file moved, renamed, created, merged, or
deleted, by count with the manifest path for detail; every link rewritten; anything the
migration declined to touch and why; anything that failed, with the file and the error; and
the git state, meaning the snapshot commit hash, the migration commit hash, and the exact
command to undo the whole thing.

**The undo instruction is not optional.** A DM who did not approve the change in advance must
be told, in the same message, precisely how to reverse it.

## Out of scope

- **`/scribe`, `/log`, `/catalog` Step 3, the Stop hook.** Spec 3. This spec records lane
  paths in `conventions.json`; it does not build the commands that consume them.
- **`/migrate`.** The generalized, DM-scoped migration command. This spec builds the executor
  it will later expose; `/migrate` gets its own spec.
- **`/genesis`.** Adding the Nth setting to an existing project. Setup creates the first;
  `/genesis` reuses the same scaffolding.
- **The base rule set's content.** Defined in spec 1.
- **Auto-committing KB writes.** Spec 3's lane commands, deliberately.
- **Branching or pull requests.** A single `main` branch is the whole model.

## Files touched

| File | Change |
| --- | --- |
| `skills/setup/SKILL.md` | New git step, Steps 2 to 6 renumbered 3 to 7, intake restructure, migration execution, run order, after-action report |
| `skills/setup/references/conventions-schema.md` | v3 settings array, prong roots, backward compatibility, tier text |
| `hooks/validate-write.mjs` | Prong-root scoping at `:724-729`, per-setting wikilink search root at `:721`/`:462`, entry-count narrowing at `:384`/`:400` |
| `workflows/validation-sweep.mjs` | Scout enumerates all prong roots at `:169`; parity merge verdict at `:544-546` |
| `skills/debrief/SKILL.md` | Session-report path default at `:20` |
| `skills/content/SKILL.md` | Content path default at `:16` |
| `commands/catalog.md` | Catalog path resolution; marker rename |
| `CONTEXT.md` | Catalog location at `:90`, setup entry at `:52`, the nonexistent rebuild step at `:125-127` |
| `README.md` | Getting-started expectations at `:70` |
| `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | Version, same commit |

## Verification

- `node workflows/validation-sweep.ownership.test.mjs` still passes.
- Exercise the migration against a disposable fixture reproducing Rolara's pre-consolidation
  shape: nested prongs, multi-index folders, files missing suffixes, a basename collision, an
  index carrying prose and headings, and frontmatter containing a comment and a quoted
  `"false"`. Assert: the snapshot commit exists and precedes every mutation; no file content
  is lost; the comment and the quoting survive; every wikilink still resolves; the collision
  aborts the run before any mutation.
- Assert the hook stays silent for the entire migration (no `conventions.json` yet).
- Exercise the four repository-state cases, at minimum "already a repository, no remote".
- Exercise the marker conversion against a fixture holding only `catalog-versioning.json`,
  and confirm `decided` survives unchanged.
- Confirm a v1 `conventions.json` still loads under the v3 reader.
- Run a debrief after a migration and confirm it writes to the canonical path rather than
  re-creating the old nesting.
- Confirm no em dashes in any changed file.

## Notes

The superseded `2026-07-28-project-repo-onboarding-design.md` placed the first commit at the
end of the run, reasoning that "an empty initial commit followed by a second commit containing
everything is worse than one initial commit that captures the finished setup." That reasoning
does not survive contact with a migration: the initial commit is not empty, it contains the
DM's entire pre-existing campaign, and it is the only thing standing between an unattended
restructure and unrecoverable loss.
