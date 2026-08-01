# Split buckets merge into existing folders: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a `/migrate` split bucket land in a subfolder that already has content, so unorganized material can be merged into organized material.

**Architecture:** Three changes inside `planSplitFolders` in `professor-orb/workflows/migrate.mjs`, plus one new module-level helper and one new section in `renderProposal`. The existence decline narrows to a kind decline; a bucket whose destination already holds an index rebuilds that index instead of creating a second one; and the destination's current contents are recorded on the bucket so the proposal can list them. No executor change, no new operation kind.

**Tech Stack:** Node 20 ESM, built-ins only. No test framework: the suites are plain scripts that call a local `check()` and `process.exit(1)` on failure.

**Spec:** `docs/superpowers/specs/2026-08-01-migrate-split-merge-design.md`

## Global Constraints

- **No em dashes in any output.** Code, comments, commit messages, doc prose. Use commas, colons, parentheses, or restructure. This is `professor-orb/skills/SHARED-PRINCIPLES.md` Principle 6, enforced by the `kb-validator` and `historian` agents. Every shipped professor-orb file has zero. Verify with `grep -c $'\xe2\x80\x94' <file>` before each commit. The byte escape is used because this Git Bash supports neither backslash-u escapes nor PCRE. En dashes are fine and already in use.
- **Node built-ins only** in `workflows/`. No dependencies, no test framework.
- **Never edit the marketplace cache** under `C:\Users\jorda\.claude\plugins\cache\`. It is a build artifact.
- **Never run `professor-orb:setup`.** It regenerates `conventions.json` wholesale and would discard hand-tuned rules.
- **Do not bump the version in this plan.** Both 1.8.0 features ship together and `2026-08-01-genesis-command.md` owns the single version bump.
- **Commit style:** `fix(professor-orb): ...` subject, blank line, body paragraph, blank line, then `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Comment blocks in `migrate.mjs` are load-bearing.** Each records the invariant its guard holds. When a rule changes, update the comment in the same edit.
- **Line numbers are as of this plan's writing and drift as tasks land.** Earlier tasks in this plan add comment blocks to the same files, so a later task's cited line will have moved. The quoted code is the anchor: locate it by its text, not by its number.

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `professor-orb/workflows/migrate.mjs` | Planner and executor | `planSplitFolders` (guard, index routing, disclosure); new `folderContentsAfterPlan` helper; `renderProposal` merge section |
| `professor-orb/workflows/migrate.plan.test.mjs` | Plan-phase regression suite | Flip one case, add seven |
| `professor-orb/workflows/migrate.proposal.test.mjs` | Proposal render and parse suite | Add two cases |
| `professor-orb/commands/migrate.md` | The `/migrate` command | State that a bucket may merge and that the proposal discloses the destination |

Run any suite directly:

```
node professor-orb/workflows/migrate.plan.test.mjs
```

All seven suites, each exiting non-zero on failure:

```
for f in $(find professor-orb -name "*.test.mjs" | sort); do node "$f" || break; done
```

---

### Task 1: Narrow the existence decline to a kind decline

The old decline refuses any bucket whose destination exists. The overwrite hazard it stood in for is already covered per file by `findDestinationCollisions`, which gives every bucket article its own destination entry with `mayExist: false`. What existence cannot cover is a destination that is not a directory: `git mv` into a path holding a file fails at apply time, and the per-article check does not see it because that article's destination genuinely does not exist.

**Files:**
- Modify: `professor-orb/workflows/migrate.mjs:2216-2226`
- Test: `professor-orb/workflows/migrate.plan.test.mjs:1866-1880` (flip), plus two new cases

**Interfaces:**
- Consumes: `namedPathPresent(ctx, rel, kind, pending)` and `namedPathNotAFolder(ctx, rel, kind, pending)`, both already defined at `migrate.mjs:1429-1446`. Both answer false when `ctx.rootUsable` is false, which is the undetermined verdict.
- Produces: nothing new. `planSplitFolders` keeps its `{operations, declined}` return shape.

- [ ] **Step 1: Flip the test that pins the old decline**

In `migrate.plan.test.mjs`, replace the block at lines 1866 to 1880 in full:

```javascript
{
  const root = splitFixture();
  mkdirSync(path.join(root, "settings", "rolara", "locations", "north"), { recursive: true });
  const r = scoped(
    {
      splitFolders: [
        { folder: "settings/rolara/locations", buckets: [{ name: "north", articles: ["Ashfall.md"] }] },
      ],
    },
    root
  );
  // Merging unorganized material into organized material is the ordinary use of
  // a split, not a hazard. The overwrite this used to refuse for is caught per
  // file by findDestinationCollisions, which is the check that actually protects
  // the DM's files; see the case below that exercises it from the planner.
  check("a bucket whose folder already exists merges into it",
    [kindsOf(r.operations), r.declined.length, r.prechecks.ok],
    [["split-folder", "create-index", "rebuild-index"], 0, true]);
  check("and the bucket index is created inside the folder it merged into",
    find(r.operations, "create-index").to,
    "settings/rolara/locations/north/North-INDEX.md");
  rmSync(root, { recursive: true, force: true });
}
```

- [ ] **Step 2: Run the suite to verify the flipped case fails**

Run: `node professor-orb/workflows/migrate.plan.test.mjs`

Expected: FAIL on "a bucket whose folder already exists merges into it", reporting `actual: [[],0,true]` against `expected: [["split-folder","create-index","rebuild-index"],0,true]`. The planner still declines, so it emits nothing. Note the exit code is 1.

- [ ] **Step 3: Narrow the guard**

In `migrate.mjs`, replace lines 2216 through 2226 (the `const dest` line through the closing brace of the decline) with:

```javascript
      const dest = `${folder}/${name}`;
      // A BUCKET MAY LAND IN A FOLDER THAT ALREADY EXISTS. Merging unorganized
      // material into organized material is the ordinary use of a split, and this
      // used to refuse it outright with "That subfolder already exists".
      //
      // The hazard that decline named, an article silently overwriting a file the
      // proposal never showed, is covered per file and always was:
      // destinationEntriesOf gives every bucket article its own entry with
      // mayExist false, so an article landing on an existing file is an on-disk
      // collision and aborts the run in the plan phase, before the snapshot.
      // migrate.plan.test.mjs pinned that from a hand-edited plan precisely
      // because this guard made it unreachable from the planner; it is now
      // reachable from both sides and pinned from both.
      //
      // WHAT EXISTENCE CANNOT COVER is a destination that is not a directory, so
      // that is what this refuses now. `git mv locations/Ashfall.md
      // locations/north/Ashfall.md` with a FILE at locations/north fails at apply
      // time, and the per-article check cannot see it: that article's destination
      // path genuinely does not exist, so nothing on disk collides. Declining a
      // plan that cannot execute is the plan phase's own stated posture.
      //
      // Both predicates are plan-aware and both answer false when the root is
      // unusable, so an unanswerable question plans rather than declines.
      if (
        namedPathPresent(ctx, dest, "split-folder", operations) &&
        namedPathNotAFolder(ctx, dest, "split-folder", operations)
      ) {
        declined.push({
          op: "split-folder",
          target: dest,
          reason: `${dest} is a file, not a folder, so articles cannot be moved into it. Rename the bucket, or move that file aside first.`,
        });
        refused = true;
        break;
      }
```

- [ ] **Step 4: Run the suite to verify the flipped case passes**

Run: `node professor-orb/workflows/migrate.plan.test.mjs`

Expected: PASS on both new checks. The suite prints "N passed, 0 failed" and exits 0. If "the bucket index is created inside the folder it merged into" fails with a `rebuild-index` in the kinds list, Task 2 has been started early; revert to the guard change alone.

- [ ] **Step 5: Add the file-at-destination case**

Append immediately after the block from Step 1:

```javascript
{
  const root = splitFixture();
  // A FILE where the bucket names a folder. git mv into it fails at apply time,
  // and the per-article collision check cannot catch it, because the article's
  // own destination path (north/Ashfall.md) does not exist either.
  writeAt(root, "settings/rolara/locations/north", "not a folder\n");
  const r = scoped(
    {
      splitFolders: [
        { folder: "settings/rolara/locations", buckets: [{ name: "north", articles: ["Ashfall.md"] }] },
      ],
    },
    root
  );
  check("a bucket whose destination holds a file is declined",
    [r.operations.length, r.declined.length], [0, 1]);
  check("and the reason names the path and says it is a file",
    [String(obj(r.declined[0]).target), /is a file, not a folder/.test(String(obj(r.declined[0]).reason))],
    ["settings/rolara/locations/north", true]);
  rmSync(root, { recursive: true, force: true });
}
```

- [ ] **Step 6: Add the case proving the per-article check still protects the destination**

Append immediately after Step 5's block:

```javascript
{
  const root = splitFixture();
  // The protection the old guard stood in for, now reachable from the PLANNER
  // rather than only from a hand-edited plan. An article merging onto a
  // same-named file in the destination is an on-disk collision, and a collision
  // aborts the whole run before anything moves.
  writeAt(root, "settings/rolara/locations/north/Ashfall.md",
    "---\ntype: Location\n---\n\nA different article that already lives here.\n");
  const r = scoped(
    {
      splitFolders: [
        { folder: "settings/rolara/locations", buckets: [{ name: "north", articles: ["Ashfall.md"] }] },
      ],
    },
    root
  );
  check("an article merging onto a same-named existing file aborts the run",
    [r.prechecks.ok, list(r.prechecks.collisions).map((c) => [c.kind, c.op, c.to])],
    [false, [["on-disk", "split-folder", "settings/rolara/locations/north/Ashfall.md"]]]);
  rmSync(root, { recursive: true, force: true });
}
```

- [ ] **Step 7: Run the suite and verify all three new cases pass**

Run: `node professor-orb/workflows/migrate.plan.test.mjs`

Expected: PASS on all five checks added or flipped so far. "N passed, 0 failed", exit 0.

- [ ] **Step 8: Verify no em dashes were introduced**

Run: `grep -c $'\xe2\x80\x94' professor-orb/workflows/migrate.mjs professor-orb/workflows/migrate.plan.test.mjs`

Expected: `0` for both files.

- [ ] **Step 9: Commit**

```bash
git add professor-orb/workflows/migrate.mjs professor-orb/workflows/migrate.plan.test.mjs
git commit -m "$(cat <<'EOF'
fix(professor-orb): let a split bucket land in a folder that already exists

planSplitFolders declined any bucket whose destination folder existed,
which refused the feature's most common real use: merging unorganized
material into organized material.

The decline was a coarse proxy for a check that already exists in a
sharper form. Every bucket article contributes its own destination entry
to findDestinationCollisions with mayExist false, so an article landing
on an existing file already aborts the run before the snapshot. The plan
suite pinned that from a hand-edited plan only because this guard made it
unreachable from the planner; it is now pinned from both sides.

Narrowed to the case existence cannot cover: a destination holding a file
rather than a folder, where git mv fails at apply time and the
per-article check sees no collision because that article's destination
does not exist either.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Route a merged bucket's index to rebuild, deduped across entries

A bucket merging into a folder that already holds an index must rebuild that index, not create a second one. `create-index` is deliberately absent from `DESTINATION_MAY_EXIST`, so emitting one against an existing index is a destination collision and the run refuses: one refusal traded for another.

Deduplication is not optional here, and Task 1 is what makes it necessary. `planCreatesOutright` (`migrate.mjs:1252`) reports a split-folder operation's own bucket as creating that directory, so the old existence guard was also what stopped two scope entries from claiming one bucket folder. With the guard narrowed, two entries naming one bucket would emit two index operations against one path, which is an in-plan collision, and the run would refuse with a message about an index path rather than about the scope the DM wrote.

**Files:**
- Modify: `professor-orb/workflows/migrate.mjs:2287-2294` (the bucket index loop) and the tail of `planSplitFolders` around line 2304
- Test: `professor-orb/workflows/migrate.plan.test.mjs`, three new cases

**Interfaces:**
- Consumes: `existingIndexIn(ctx, folder, suffix, kind, pending)` at `migrate.mjs:3858`, which returns the posix path of the first `.md` file in `folder` whose stem ends with `suffix`, or null when the folder is absent, vacated, or created by an earlier operation in the plan. Also `indexStemFor(name, suffix)` at `migrate.mjs:2133`, which Title Cases the bucket name and appends the suffix.
- Produces: `planSplitFolders` now emits `rebuild-index` operations for merged buckets in addition to the parent rebuild it already emitted. Both are rank 9. `buildScopedPlan` sorts the accumulated list by `APPLY_ORDER` at `migrate.mjs:1527`, so emitting them at the end of the planner is free.

- [ ] **Step 1: Write the failing tests**

Append three blocks to `migrate.plan.test.mjs`, after the cases added in Task 1:

```javascript
{
  const root = splitFixture();
  // The destination already has an index. Creating a second one would be a
  // destination collision, and a folder with two indexes is the multi-index
  // finding the validation sweep reports as needing judgment.
  writeAt(root, "settings/rolara/locations/north/North-INDEX.md",
    "---\ntype: Index\n---\n\n- [[Emberwatch]]\n");
  writeAt(root, "settings/rolara/locations/north/Emberwatch.md",
    "---\ntype: Location\n---\n\nBody.\n");
  const r = scoped(
    {
      splitFolders: [
        { folder: "settings/rolara/locations", buckets: [{ name: "north", articles: ["Ashfall.md"] }] },
      ],
    },
    root
  );
  check("a bucket merging into a folder that has an index rebuilds it",
    [kindsOf(r.operations), r.prechecks.ok],
    [["split-folder", "rebuild-index", "rebuild-index"], true]);
  check("and the rebuild names the index that was already there",
    list(r.operations).filter((o) => o.op === "rebuild-index").map((o) => o.to).sort(),
    ["settings/rolara/locations/Locations-INDEX.md", "settings/rolara/locations/north/North-INDEX.md"]);
  rmSync(root, { recursive: true, force: true });
}

{
  const root = splitFixture();
  // The existing index does NOT match the stem indexStemFor would pick. Rebuild
  // what is there rather than creating North-INDEX.md beside it.
  writeAt(root, "settings/rolara/locations/north/Northern-Reaches-INDEX.md",
    "---\ntype: Index\n---\n\n- [[Emberwatch]]\n");
  const r = scoped(
    {
      splitFolders: [
        { folder: "settings/rolara/locations", buckets: [{ name: "north", articles: ["Ashfall.md"] }] },
      ],
    },
    root
  );
  check("an existing index under a different stem is the one rebuilt",
    [kindsOf(r.operations),
     list(r.operations).filter((o) => o.op === "rebuild-index").map((o) => o.to).sort()],
    [["split-folder", "rebuild-index", "rebuild-index"],
     ["settings/rolara/locations/Locations-INDEX.md",
      "settings/rolara/locations/north/Northern-Reaches-INDEX.md"]]);
  rmSync(root, { recursive: true, force: true });
}

{
  const root = splitFixture();
  // Two entries naming ONE bucket folder. Legal now that a bucket may merge, and
  // it was the narrowed guard that made it reachable: planCreatesOutright reports
  // the first entry's bucket as creating that directory, so the old existence
  // check declined the second entry outright. Two index operations on one path
  // would be an in-plan collision.
  const r = scoped(
    {
      splitFolders: [
        { folder: "settings/rolara/locations", buckets: [{ name: "north", articles: ["Ashfall.md"] }] },
        { folder: "settings/rolara/locations", buckets: [{ name: "north", articles: ["Karsk.md"] }] },
      ],
    },
    root
  );
  check("two entries naming one bucket emit one index operation, not two",
    [kindsOf(r.operations), r.declined.length, r.prechecks.ok],
    [["split-folder", "split-folder", "create-index", "rebuild-index"], 0, true]);
  rmSync(root, { recursive: true, force: true });
}
```

- [ ] **Step 2: Run the suite to verify the new cases fail**

Run: `node professor-orb/workflows/migrate.plan.test.mjs`

Expected: FAIL on all three. The first two report `create-index` where `rebuild-index` is expected. The third reports two `create-index` entries and `prechecks.ok` false, with an in-plan collision on `settings/rolara/locations/north/North-INDEX.md`.

- [ ] **Step 3: Add the dedup map**

In `migrate.mjs`, immediately after the `rebuilds` Map declaration and its comment (which ends at line 2169 with `const rebuilds = new Map();`), add:

```javascript
  // Bucket index path -> the ONE operation that writes it, across every scope
  // entry rather than within one.
  //
  // Two entries naming one bucket folder became reachable when the existence
  // decline narrowed to a kind decline. planCreatesOutright reports a
  // split-folder operation's own bucket as creating that directory, so the old
  // guard declined the second entry with "That subfolder already exists" and this
  // case could not arise. Emitting per entry now gives two operations one
  // destination, which is an in-plan collision by the generic rule, so the run
  // would refuse with a message about an index path rather than about the scope
  // the DM wrote. That is the same failure the parent `rebuilds` Map above exists
  // to prevent, one level down.
  //
  // ONE MAP FOR BOTH KINDS rather than one per kind, because the two are
  // alternatives for a single question (does this bucket folder already have an
  // index) and a bucket must not receive both. foldDuplicateRebuilds later folds
  // duplicate rebuild-index operations ACROSS planners, but it does not fold
  // create-index, so relying on it would leave exactly half of this closed.
  const bucketIndexes = new Map();
```

- [ ] **Step 4: Replace the bucket index loop, and move it ABOVE the split-folder push**

Replace the `for (const bucket of buckets)` loop that pushes `create-index` with the block below, and place it **before** the `operations.push({ op: "split-folder", ... })` call rather than after it.

The placement is load-bearing and was proven by test. With the loop after the push, `existingIndexIn` is handed an `operations` list containing this entry's own `split-folder` operation. `planCreatesOutright` iterates `o.buckets` and returns `"directory"` when a bucket's `folder` matches the target, so `planResolve` answers `{creates: "directory"}` and `existingIndexIn` returns null for every bucket. An index genuinely on disk would never be found and every merged bucket would take the create path, which is the exact bug this task exists to fix. Measured: three cases fail permanently under the later placement. `precedingOperations` already states the rule this honours: "No planner pushes its own item's operations before checking them, so a check never sees its own."

The key is `samePathKey(bucket.folder)`, not the index path. Keying on the index path only dedupes when two entries compute the same path, and they do not always: entry 2's `existingIndexIn` is blinded by entry 1's operation and falls back to the default stem, so when entry 1 found an index under a different stem the keys diverge and one bucket receives both a rebuild and a create. Measured: two indexes in one folder, zero declines, `prechecks.ok` true.

```javascript
    // A bucket landing in a folder that already holds an index REBUILDS that
    // index rather than creating a second one, and rebuilds it under whatever
    // stem the DM gave it rather than under indexStemFor's. create-index is
    // deliberately absent from DESTINATION_MAY_EXIST, so emitting one against an
    // existing index is a destination collision and the run refuses: the merge
    // would trade one refusal for another with a worse message. Creating
    // North-INDEX.md beside an existing Northern-Reaches-INDEX.md would also
    // leave two indexes in one folder, which is the multi-index finding the
    // validation sweep reports as needing judgment.
    //
    // existingIndexIn returns null for a folder an earlier operation creates, so
    // a genuinely new bucket takes the create path with no special case here.
    for (const bucket of buckets) {
      const already = bucketIndexes.get(samePathKey(bucket.folder));
      if (already) {
        already.groups.push(group);
        continue;
      }
      const existing = existingIndexIn(ctx, bucket.folder, suffix, "split-folder", operations);
      bucketIndexes.set(samePathKey(bucket.folder), {
        to: existing || `${bucket.folder}/${indexStemFor(bucket.name, suffix)}.md`,
        kind: existing ? "rebuild-index" : "create-index",
        bucketFolder: bucket.folder,
        name: bucket.name,
        splitFolder: folder,
        groups: [group],
      });
    }
```

- [ ] **Step 5: Emit the deduped index operations**

In `migrate.mjs`, immediately before the existing `for (const [to, { folder, bucketCount, groups }] of rebuilds)` loop near line 2304, add:

```javascript
  // Emitted after the entry loop so the dedup above is complete, and in whatever
  // order the Map iterates: buildScopedPlan sorts the accumulated operations into
  // APPLY_ORDER before anything reads them, so a planner's own emission order
  // carries no meaning. create-index ranks 7 and rebuild-index 9, both above
  // splitFolders' declared rank of 3, which is what the emit-side check in
  // buildScopedPlan requires.
  for (const [, { to, kind, bucketFolder, name, splitFolder, groups }] of bucketIndexes) {
    operations.push(
      kind === "rebuild-index"
        ? {
            op: "rebuild-index",
            to,
            folder: bucketFolder,
            groups,
            reason: `Rebuilt because the ${name} bucket merged articles into the existing folder ${bucketFolder}.`,
          }
        : {
            op: "create-index",
            to,
            groups,
            reason: `Created for the ${name} bucket of the ${splitFolder} split.`,
          }
    );
  }
```

- [ ] **Step 6: Run the suite to verify the new cases pass**

Run: `node professor-orb/workflows/migrate.plan.test.mjs`

Expected: PASS on all three new cases and on every case flipped or added in Task 1. "N passed, 0 failed", exit 0.

- [ ] **Step 7: Run the apply suite, which shares these operation shapes**

Run: `node professor-orb/workflows/migrate.apply.test.mjs`

Expected: "471 passed, 0 failed", exit 0. This suite exercises `applySplitFolder` and the paired index operations end to end. A failure here means the emitted `rebuild-index` is missing its `folder` field, which `applyRebuildIndex` reads to decide which directory to list.

- [ ] **Step 8: Verify no em dashes**

Run: `grep -c $'\xe2\x80\x94' professor-orb/workflows/migrate.mjs professor-orb/workflows/migrate.plan.test.mjs`

Expected: `0` for both.

- [ ] **Step 9: Commit**

```bash
git add professor-orb/workflows/migrate.mjs professor-orb/workflows/migrate.plan.test.mjs
git commit -m "$(cat <<'EOF'
fix(professor-orb): rebuild a merged bucket's existing index instead of creating a second

A bucket merging into a folder that already holds an index emitted
create-index against an occupied path. create-index is deliberately
absent from DESTINATION_MAY_EXIST, so that is a destination collision and
the run refused: the merge traded one refusal for another. It also risked
leaving two indexes in one folder when the existing index carried a stem
other than the one indexStemFor picks.

Merged buckets now rebuild whatever index is there. New buckets still
create one.

Both kinds share a dedup map keyed on the index path. Two entries naming
one bucket folder became reachable when the existence decline narrowed,
because planCreatesOutright reports a split's own bucket as creating that
directory and the old guard declined the second entry outright.
foldDuplicateRebuilds folds duplicate rebuilds across planners but not
create-index, so relying on it would close only half of this.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Record and render what the destination already holds

The old decline's stated reason was that the destination's contents were never listed in the proposal. That gap survives the decline's removal, so close it rather than drop it.

**Files:**
- Modify: `professor-orb/workflows/migrate.mjs` (new `folderContentsAfterPlan` helper near `prongChildrenAfterPlan` at line 3618; one line in the bucket build loop around line 2270; new section in `renderProposal` after the operations table, which ends at line 4347)
- Test: `professor-orb/workflows/migrate.plan.test.mjs` (two cases), `professor-orb/workflows/migrate.proposal.test.mjs` (two cases)

**Interfaces:**
- Consumes: `planResolve(ctx, rel, kind, pending)` at `migrate.mjs:1371`, returning `{path}`, `{creates}`, or `{vacated}`. `namedPathPresent` as in Task 1.
- Produces: a bucket object in a `split-folder` operation may now carry `existing: string[]`, the sorted direct child names of its destination folder. The field is **omitted entirely when the destination holds nothing**, so an ordinary split's operation shape is byte for byte what it was. `renderProposal` reads it and nothing at apply time does.

- [ ] **Step 1: Write the failing planner tests**

Append to `migrate.plan.test.mjs`:

```javascript
{
  const root = splitFixture();
  writeAt(root, "settings/rolara/locations/north/Emberwatch.md", "---\ntype: Location\n---\n\nBody.\n");
  writeAt(root, "settings/rolara/locations/north/Frosthollow.md", "---\ntype: Location\n---\n\nBody.\n");
  const r = scoped(
    {
      splitFolders: [
        { folder: "settings/rolara/locations", buckets: [{ name: "north", articles: ["Ashfall.md"] }] },
      ],
    },
    root
  );
  check("a merging bucket records what the destination already holds",
    obj(list(find(r.operations, "split-folder").buckets)[0]).existing,
    ["Emberwatch.md", "Frosthollow.md"]);
  rmSync(root, { recursive: true, force: true });
}

{
  const root = splitFixture();
  // A bucket destination that does not exist holds nothing, and the field is
  // omitted rather than set to an empty array, so an ordinary split's operation
  // shape is unchanged.
  const r = scoped(
    {
      splitFolders: [
        { folder: "settings/rolara/locations", buckets: [{ name: "north", articles: ["Ashfall.md"] }] },
      ],
    },
    root
  );
  check("a bucket that merges into nothing carries no existing field",
    Object.prototype.hasOwnProperty.call(
      obj(list(find(r.operations, "split-folder").buckets)[0]), "existing"),
    false);
  rmSync(root, { recursive: true, force: true });
}
```

- [ ] **Step 2: Run the suite to verify both fail**

Run: `node professor-orb/workflows/migrate.plan.test.mjs`

Expected: FAIL on "a merging bucket records what the destination already holds" with `actual: undefined`. The second case PASSES already, because nothing writes the field yet; it is a regression guard for Step 3.

- [ ] **Step 3: Add the plan-aware folder enumeration helper**

In `migrate.mjs`, immediately after `prongChildrenAfterPlan` ends at line 3636, add:

```javascript
// The direct children a folder holds BY THE TIME an operation naming it runs,
// sorted, for DISCLOSURE rather than for a decision.
//
// Modelled on prongChildrenAfterPlan above and deliberately not sharing it: that
// one skips PRONG_CHILDREN_SKIPPED (.git, .obsidian, node_modules), which is
// right for a prong root and wrong here. A bucket destination holding a
// node_modules is holding something the DM should be told about.
//
// PLAN-AWARE because a run can move material in stages. planResolve rewinds the
// folder itself through any earlier move, and the per-child namedPathPresent
// drops a child an earlier operation carries away. Listing a file that is about
// to leave would mislead a DM reading the proposal carefully, which is worse
// than listing nothing.
//
// EMPTY IS THE ANSWER FOR EVERY UNCERTAIN CASE: no usable root, a folder an
// earlier operation creates or vacates, or a folder that is not there. This
// field is disclosure only, nothing at apply time reads it, and the per-article
// collision check is what actually protects the destination. An absent list
// understates; it cannot license an overwrite.
function folderContentsAfterPlan(ctx, rel, kind, pending) {
  if (!ctx.rootUsable) return [];
  const at = planResolve(ctx, rel, kind, pending);
  if (at.vacated || at.creates || !at.path) return [];
  let names;
  try {
    names = readdirSync(path.resolve(ctx.projectRoot, at.path)).sort();
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (!namedPathPresent(ctx, `${rel}/${name}`, kind, pending)) continue;
    out.push(name);
  }
  return out;
}
```

- [ ] **Step 4: Record the contents on the bucket**

In `migrate.mjs`, replace the single line at 2270 that reads `buckets.push({ folder: dest, name, articles });` with:

```javascript
      // Computed BEFORE this entry's split-folder operation is pushed, so what is
      // recorded is what the destination already held rather than what this split
      // is about to put there. Omitted when empty so an ordinary split's operation
      // shape is unchanged and nothing downstream has to tell [] from absent.
      const present = folderContentsAfterPlan(ctx, dest, "split-folder", operations);
      buckets.push(present.length > 0
        ? { folder: dest, name, articles, existing: present }
        : { folder: dest, name, articles });
```

- [ ] **Step 5: Run the suite to verify both planner cases pass**

Run: `node professor-orb/workflows/migrate.plan.test.mjs`

Expected: PASS on both. "N passed, 0 failed", exit 0.

- [ ] **Step 6: Write the failing proposal tests**

Append to `migrate.proposal.test.mjs`:

```javascript
{
  const plan = {
    operations: [
      {
        op: "split-folder",
        from: "settings/rolara/locations",
        buckets: [
          {
            folder: "settings/rolara/locations/north",
            name: "north",
            articles: [
              { from: "settings/rolara/locations/Coldwater.md", to: "settings/rolara/locations/north/Coldwater.md" },
              { from: "settings/rolara/locations/Hailstone.md", to: "settings/rolara/locations/north/Hailstone.md" },
            ],
            existing: ["Emberwatch.md", "Frosthollow.md", "North-INDEX.md"],
          },
          {
            folder: "settings/rolara/locations/south",
            name: "south",
            articles: [
              { from: "settings/rolara/locations/Dustmoor.md", to: "settings/rolara/locations/south/Dustmoor.md" },
            ],
          },
        ],
        reason: "DM scope",
      },
    ],
    declined: [],
    prechecks: { ok: true, collisions: [], ignored: [] },
  };
  const text = renderProposal({ scope: { summary: "split locations" }, plan, projectRoot: "/p", settings: [] });
  check("a merging bucket gets a disclosure section naming the folder and its contents",
    [text.includes("## Merging into existing folders"),
     text.includes("**settings/rolara/locations/north** (3 entries already there)"),
     text.includes("Emberwatch.md, Frosthollow.md, North-INDEX.md"),
     text.includes("2 moving in: Coldwater.md, Hailstone.md")],
    [true, true, true, true]);
  // Asserted against the BOLDED heading, which only the merge section emits, not
  // against the bare path. proposalTo renders every bucket folder into the
  // operations table's To cell and the fenced plan block serializes the operation
  // whole, so a bare `text.includes("settings/rolara/locations/south")` is true
  // before this section exists and can never go false. Both halves are asserted
  // because the negative alone would also pass if the section failed to render at
  // all, which is the failure worth catching here.
  check("and a bucket merging into nothing is not listed there",
    [text.includes("**settings/rolara/locations/north**"),
     text.includes("**settings/rolara/locations/south**")],
    [true, false]);
}

{
  const plan = {
    operations: [
      { op: "create-index", to: "settings/rolara/notes/Notes-INDEX.md", reason: "new folder" },
    ],
    declined: [],
    prechecks: { ok: true, collisions: [], ignored: [] },
  };
  const text = renderProposal({ scope: { summary: "no merges" }, plan, projectRoot: "/p", settings: [] });
  check("a plan with no merging bucket has no disclosure section at all",
    text.includes("Merging into existing folders"), false);
}
```

- [ ] **Step 7: Run the proposal suite to verify the new cases fail**

Run: `node professor-orb/workflows/migrate.proposal.test.mjs`

Expected: FAIL on both checks in the first block. The first reports `actual: [false,false,false,false]`, and the second reports `actual: [false,false]` because no merge section has rendered yet, so the bolded north heading is absent. The second block's check PASSES already and is a regression guard. Note the exit code is 1.

- [ ] **Step 8: Render the section**

In `migrate.mjs`, insert immediately after line 4347 (the closing brace of the `if (operations.length === 0) { ... } else { ... }` block that renders the table) and before the `lines.push("");` that precedes `"## Declined"`:

```javascript
  // Every bucket landing in a folder that already holds material, listed in full.
  //
  // A SECTION rather than a column in the table above, because that table is one
  // row per operation with short cells and a destination holding forty files
  // cannot be read in one. This is the disclosure the old existence decline's own
  // reason asked for, "an existing folder whose contents the proposal never
  // listed", and it is what makes approving a merge an informed act. The decline
  // is gone; the reason it named is answered here instead.
  //
  // Reads the operation objects the fenced block below serializes whole, so
  // nothing shown here can drift from what the executor sees.
  const merges = [];
  for (const op of operations) {
    if (op.op !== "split-folder") continue;
    for (const b of list(op.buckets)) {
      if (!b || typeof b !== "object") continue;
      const existing = list(b.existing).filter((n) => typeof n === "string" && n);
      if (existing.length === 0) continue;
      merges.push({ folder: toPosix(b.folder), existing, articles: list(b.articles) });
    }
  }
  if (merges.length > 0) {
    lines.push("");
    lines.push("## Merging into existing folders");
    lines.push("");
    lines.push(
      "Each bucket below lands in a folder that already holds material. Nothing listed as already there is moved, renamed, or overwritten by this plan."
    );
    for (const m of merges) {
      const n = m.existing.length;
      lines.push("");
      lines.push(`**${m.folder}** (${n} ${n === 1 ? "entry" : "entries"} already there):`);
      lines.push("");
      lines.push(m.existing.join(", "));
      lines.push("");
      const incoming = m.articles
        .map((a) => path.posix.basename(toPosix(a && a.to)))
        .filter(Boolean);
      lines.push(`${incoming.length} moving in: ${incoming.join(", ") || "(none)"}`);
    }
  }
```

- [ ] **Step 9: Run the proposal suite to verify it passes**

Run: `node professor-orb/workflows/migrate.proposal.test.mjs`

Expected: PASS on all three new checks. "99 passed, 0 failed" becomes a higher count, exit 0.

- [ ] **Step 10: Run every suite**

Run: `for f in $(find professor-orb -name "*.test.mjs" | sort); do node "$f" || break; done`

Expected: all seven report a passing line and the loop completes without breaking. Roughly 48 seconds.

- [ ] **Step 11: Verify no em dashes**

Run: `grep -c $'\xe2\x80\x94' professor-orb/workflows/migrate.mjs professor-orb/workflows/migrate.plan.test.mjs professor-orb/workflows/migrate.proposal.test.mjs`

Expected: `0` for all three.

- [ ] **Step 12: Commit**

```bash
git add professor-orb/workflows/migrate.mjs professor-orb/workflows/migrate.plan.test.mjs professor-orb/workflows/migrate.proposal.test.mjs
git commit -m "$(cat <<'EOF'
feat(professor-orb): disclose what a merged bucket's destination already holds

The decline this release removed gave as its reason that the destination
was "an existing folder whose contents the proposal never listed". That
gap is real and survives the decline, so it is answered rather than
dropped.

A bucket landing in a folder that holds something records that folder's
direct children, and the proposal gains a section listing them in full
alongside what is moving in. A section rather than a table column,
because the operations table is one row per operation with short cells.

The enumeration is plan-aware: planResolve rewinds the folder through any
earlier move and the per-child check drops a child an earlier operation
carries away, so a file about to leave is never listed as already there.
Every uncertain case answers empty. The field is disclosure only, omitted
when the destination is empty, and nothing at apply time reads it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Update the command documentation

`commands/migrate.md` states the old guarantee. A DM reading it would still believe a split cannot merge.

**Files:**
- Modify: `professor-orb/commands/migrate.md:55` (the prechecks paragraph in Step 4)

**Interfaces:**
- Consumes: nothing. Documentation only.
- Produces: nothing.

- [ ] **Step 1: Read the paragraph that describes the prechecks**

Run: `grep -n "A git-ignored source declines its whole scope entry" professor-orb/commands/migrate.md`

Expected: one hit, in Step 4. Read the whole paragraph before editing so the new sentences match its voice.

- [ ] **Step 2: Add the merge disclosure to that paragraph**

Append these two sentences to the very end of that paragraph, AFTER the sentence beginning "A destination collision does not". Do not place them before it. That sentence is an elliptical contrast whose antecedent is the preceding sentence, "both appear in the proposal's Declined section", and inserting anything between the two severs it. Worse, the first new sentence itself ends with "is still a destination collision that stops the run", so a reader arriving at "A destination collision does not" binds it to the wrong thing:

```
A split bucket may name a subfolder that already exists, which merges the bucket into it; the proposal lists that folder's current contents in its own "Merging into existing folders" section so the merge is approved with both halves visible, and an article that would land on a same-named file there is still a destination collision that stops the run. A bucket naming a path that holds a file rather than a folder is declined, because articles cannot be moved into a file.
```

- [ ] **Step 3: Verify no em dashes and no stale claim**

Run: `grep -c $'\xe2\x80\x94' professor-orb/commands/migrate.md && grep -n "already exists" professor-orb/commands/migrate.md`

Expected: `0` em dashes. The `already exists` hits should describe the merge, not a refusal.

- [ ] **Step 4: Run every suite once more**

Run: `for f in $(find professor-orb -name "*.test.mjs" | sort); do node "$f" || break; done`

Expected: all seven pass. Documentation does not affect them, and this confirms the tree is green before the final commit.

- [ ] **Step 5: Commit**

```bash
git add professor-orb/commands/migrate.md
git commit -m "$(cat <<'EOF'
docs(professor-orb): state that a split bucket may merge into an existing folder

Step 4 described the prechecks without mentioning that a bucket may now
name a subfolder that already exists. A DM reading it would still expect
the refusal this release removed.

Names the disclosure section the proposal grows for a merge, and the two
things that still stop a run: an article landing on a same-named file in
the destination, and a bucket naming a path that holds a file rather than
a folder.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Verification

After Task 4, the whole feature is in. Confirm:

```
for f in $(find professor-orb -name "*.test.mjs" | sort); do node "$f" || break; done
```

All seven suites pass. Then confirm the feature end to end against a scratch repository: create a folder holding loose articles and a subfolder holding organized ones, build a scope naming that subfolder as a bucket, and check that the plan carries `split-folder` plus a `rebuild-index` for the subfolder's existing index, that `prechecks.ok` is true, and that the rendered proposal names the subfolder under "Merging into existing folders".

## Spec coverage

| Spec section | Task |
| --- | --- |
| 1. The existence check becomes a kind check | Task 1 |
| 2. A merged bucket rebuilds its index rather than creating one | Task 2 |
| Bucket rebuilds dedupe on the index path | Task 2, extended to create-index as well, which the spec did not anticipate and Task 1 makes necessary |
| 3. The proposal discloses what is already there | Task 3 |
| What stays refused | Task 1 Step 6 (on-disk collision), Task 1 Step 5 (file at destination) |
| Files touched: `migrate.mjs` | Tasks 1, 2, 3 |
| Files touched: `migrate.plan.test.mjs` | Tasks 1, 2, 3 |
| Files touched: `commands/migrate.md` | Task 4 |
| Files touched: `CONTEXT.md` | Not needed. Checked: `CONTEXT.md` does not record the split guard, so there is nothing there to correct |
| Tests 1 through 8 | Task 1 Steps 1, 5, 6; Task 2 Step 1; Task 3 Steps 1, 6 |
