# `/migrate` split buckets merge into existing folders

> Ships in professor-orb 1.8.0, alongside `/genesis` (its own spec). The two are
> independent: this one changes one planner inside `workflows/migrate.mjs`, that one
> adds a command. They share a release and nothing else.

## Problem

`planSplitFolders` declines any bucket whose destination folder already exists:

> That subfolder already exists. Moving articles into it would merge the split into an
> existing folder whose contents the proposal never listed.

That refusal is directly contrary to the most common real use of the feature: taking
unorganized or partially organized material and merging it into material that is already
organized. A DM with a tidy `locations/north/` and a heap of loose files in `locations/`
cannot use `/migrate` to bring the two together, which is the ordinary case rather than
an exotic one.

## The guard is a coarse proxy for a check that already exists in a sharper form

The stated hazard is an article silently overwriting a file the proposal never showed the
DM. That hazard is already covered per file, and not by this guard.

Every bucket article contributes its own `{from, to}` destination entry through
`articleMovesOf`, and `findDestinationCollisions` runs its on-disk half against each one
with `mayExist: false`. An article landing on an existing file is an on-disk collision, and
a collision aborts the whole run in the plan phase, before the snapshot, before anything
moves.

`migrate.plan.test.mjs` already pins exactly that, at "a bucket destination already on disk
aborts before anything moves". Its own comment observes that the shape can only reach the
prechecks through a hand-edited plan **because** the folder guard makes it unreachable from
the planner. That is the whole argument in one sentence: the folder guard's only remaining
job is to keep a sharper check from ever being needed, and the sharper check is the one
that actually protects the DM's files.

Merging into existing material is also not a new posture for this module. `planSettingMerges`
merges a whole world into an existing one and resolves conflicts per child, with
`disambiguatedName` proposing a rename for each collision, rather than refusing because the
destination has contents.

## Design

### 1. The existence check becomes a kind check

Delete the existence decline. Replace it with a narrower one: decline only when something is
at the destination path **and it is not a directory**.

```
namedPathPresent(ctx, dest, "split-folder", operations) &&
namedPathNotAFolder(ctx, dest, "split-folder", operations)
```

This case is not a merge and cannot execute. `git mv locations/Ashfall.md
locations/north/Ashfall.md` with a *file* at `locations/north` fails at apply time, and the
per-article collision check does not catch it: the article's destination path genuinely does
not exist, so nothing on disk collides. Removing the guard without this narrowing would trade
a false refusal for a partition that half-applies after the snapshot, which is the outcome
the plan phase exists to prevent ("a plan that cannot execute is worse than no plan").

Both predicates are plan-aware and both already exist. `namedPathPresent` keeps its other
callers unchanged; only this call site changes shape.

### 2. A merged bucket rebuilds its index rather than creating one

The planner emits `create-index` per bucket unconditionally. `create-index` is deliberately
absent from `DESTINATION_MAY_EXIST`, so a bucket merging into a folder that already holds an
index is a destination collision and the run refuses anyway — one refusal traded for another,
with a worse message.

Per bucket, ask `existingIndexIn(ctx, dest, suffix, "split-folder", operations)`, the helper
the parent rebuild already uses:

- **An index is there** — emit `rebuild-index` against *that* index, whatever its stem.
  Not `create-index` at `<name>-INDEX.md`: a bucket named `north` merging into a folder whose
  index is `Northern-Reaches-INDEX.md` would otherwise end with two indexes in one folder,
  which is precisely the multi-index finding the validation sweep reports as needing judgment.
- **No index is there** — `create-index`, unchanged. This covers both a bucket folder that
  does not exist yet and an existing folder that never had an index.

`existingIndexIn` returns null when an earlier operation in the plan creates the folder, so a
genuinely new bucket takes the create path with no special case.

**Bucket rebuilds dedupe on the index path**, through the same mechanism the parent rebuild
already uses. Two scope entries naming one bucket would otherwise emit the same `rebuild-index`
twice, which is an in-plan collision by the generic rule, and the run would refuse with a
message about an index path rather than about the scope the DM wrote. The existing `rebuilds`
Map carries `{folder, bucketCount, groups}` and renders a parent-specific reason, so bucket
rebuilds need their own entry shape rather than sharing that value; keyed on the same index
path so the two can never both claim one destination.

Ordering needs nothing new. `split-folder` ranks 3 and `rebuild-index` ranks 9, so the rebuild
reads the folder after the articles have arrived, which is the point.

### 3. The proposal discloses what is already there

The guard's stated reason — contents "the proposal never listed" — is a real gap, and it
survives the guard's removal. Close it rather than drop it.

When a bucket lands in a folder that already holds something, the planner records that
folder's contents on the bucket, and `renderProposal` gains a section below the operations
table:

```
## Merging into existing folders

**settings/rolara/locations/north** — 6 entries already there:
Ashfall-Ridge.md, Emberwatch.md, Frosthollow.md, North-INDEX.md,
Stormgate.md, Winterfell-Pass.md

3 moving in: Coldwater.md, Hailstone.md, Ironpeak.md
```

**A section rather than a table column.** The operations table is one row per operation with
short cells; forty filenames in a cell is unreadable. A section below it can list them in full,
which is what makes the disclosure worth having.

**Computed at plan time, carried on the operation.** `renderProposal` reads no disk — it renders
the plan object it is handed — so the list has to be recorded when the plan is built. That is
also the correct place for it: the enumeration must be plan-aware, because a single run can move
things in stages, and a file an earlier operation in the same plan carries *out* of the
destination must not be listed as already there. Listing a file that is about to leave would
mislead a DM reading carefully, which is worse than listing nothing. `prongChildrenAfterPlan`
is the existing model for a plan-aware folder enumeration; this needs the same shape at the
`split-folder` rank, without `PRONG_CHILDREN_SKIPPED`, which is prong-specific.

The recorded list is **disclosure only**. Nothing at apply time reads it, and a stale list in a
hand-edited plan misinforms the reader without endangering a file: the per-article collision
check is what protects the destination, and it re-runs against whatever operations actually
arrive.

## What stays refused

Unchanged, and worth stating so the narrowing does not read as broader than it is:

- An article landing on an existing file (on-disk collision, aborts the run).
- Two operations targeting one destination (in-plan collision).
- A bucket whose destination path holds a file rather than a folder (new shape of the
  narrowed decline).
- A protected folder as the split's own target — a prong root or campaign folder.
- An article claimed by two buckets, or listed twice by one bucket.
- A bucket article that is not on disk.
- A git-ignored article anywhere in the entry, which declines the whole entry.

## Files touched

| File | Change |
| --- | --- |
| `professor-orb/workflows/migrate.mjs` | `planSplitFolders`: narrowed decline, per-bucket index branch, bucket rebuild dedup, recorded destination contents. New plan-aware folder enumeration helper. `proposalDetail`/`renderProposal`: the merge section. Comment blocks stating the old rule. |
| `professor-orb/workflows/migrate.plan.test.mjs` | Flip the existing decline test; add merge, index-rebuild, file-at-destination, dedup, and disclosure tests. |
| `professor-orb/commands/migrate.md` | Remove the statement of the old guarantee; state that a bucket may merge and that the proposal discloses the destination's contents. |
| `professor-orb/CONTEXT.md` | If it records the old rule. |

## Tests

The existing test "a bucket whose folder already exists is declined" inverts: the same fixture
now plans the split, with no decline.

New cases:

1. A bucket merging into an existing folder with **no** index plans `split-folder` +
   `create-index`, prechecks ok.
2. A bucket merging into an existing folder **with** an index plans `split-folder` +
   `rebuild-index` against that index path, and no `create-index`.
3. An existing index under a **non-matching stem** is the one rebuilt; no second index is
   created.
4. A destination path holding a **file** is declined, with the reason naming the path.
5. An article merging onto a **same-named existing file** still aborts on the on-disk
   collision — the protection the guard was standing in for, now exercised from the planner
   rather than only from a hand-edited plan.
6. **Two entries naming one bucket** emit one `rebuild-index`, not two, and prechecks stay ok.
7. The recorded contents **exclude a file an earlier operation carries away**, and include
   one an earlier operation moves in.
8. `renderProposal` emits the merge section for a merged bucket and omits it entirely when no
   bucket merges.

## Out of scope

- **`/genesis`.** Its own spec, same release.
- **Any change to `absorb-folder`.** It dissolves a folder into its parent, whose contents are
  necessarily pre-existing, so it already merges and needs nothing here.
- **A merge mode for `relocate-path` folder moves.** Moving a whole folder onto an existing
  folder still collides. File-granular `pathMoves` into an existing folder already work.
- **Automatic renaming of a colliding article**, the way `planSettingMerges` proposes
  `disambiguatedName`. A collision inside a split stays a refusal the DM resolves by editing
  the scope. Adding a rename proposal here is a larger decision about what a split may do
  unattended, and nothing in the reported problem needs it.
