#!/usr/bin/env node
// Migration executor for professor-orb.
//
// Two phases, the same covenant validation-sweep.mjs documents: a plan phase
// that mutates nothing and returns an ordered operation list, then an apply
// phase that applies ONLY what the plan carries and never invents an operation.
//
// Importable: buildPlan and runPrechecks are pure and exported so
// migrate.plan.test.mjs can exercise them without starting a workflow run.
//
// WRITE APIs live in the apply half only. mkdirSync, writeFileSync, and rmdirSync
// below are reached from applyPlan and from nothing the plan phase calls; the
// plan phase's own functions call readdirSync, readFileSync, statSync, and
// existsSync and nothing else. The git command set is likewise split: the plan
// phase issues only `rev-parse --show-toplevel` and `status --ignored
// --porcelain -z`, and every mutating git argv (mv, rm, add, commit) is built
// inside the apply half.
//
// rmdirSync is the module's only raw filesystem removal, and it is non-recursive
// by choice rather than by default: see removeAbsorbedFolder.
//
// Node built-ins only.

import { readdirSync, readFileSync, statSync, existsSync, mkdirSync, writeFileSync, rmdirSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

// Normative operation order. Type normalization precedes renames because a
// file's required suffix derives from its type, so renaming first would compute
// suffixes from stale values and leave the corrected files mis-suffixed.
export const OPERATION_ORDER = [
  "relocate-prong",
  "normalize-type",
  "rename-with-link-rewrite",
  "create-index",
  "merge-index",
  "repair-frontmatter",
  "vault",
  "tag-registry",
];

// Never executed on the first run. Crossing a threshold says a folder should
// divide or dissolve; it does not say how to partition it or where its contents
// belong. That is a judgment about the DM's own material, and it belongs to
// /migrate once the DM has scoped it.
export const DEFERRED_OPERATIONS = ["split", "absorb"];

// The single dependency order EVERY plan is ranked against, setup's and
// /migrate's alike. OPERATION_ORDER above stays the setup subset, because
// buildPlan loops over it to decide which planners to run and a scoped-only
// kind has no setup planner to call. This constant is a superset of it that
// preserves its relative order, and migrate.plan.test.mjs pins that property:
// reordering the setup kinds here would make every setup plan refuse as out of
// order, and no setup-side test would notice.
//
// Placement reasoning for the six kinds this release adds:
//   relocate-path   beside relocate-prong: same mechanics, different meaning.
//   absorb-folder   before every index kind, because it changes which folder a
//   split-folder    file lives in, and an index built first would list the old
//                   membership.
//   rename-entity   beside rename-with-link-rewrite, and after normalize-type
//                   for the same reason that one is: a required suffix derives
//                   from a type, so renaming first computes it from a stale
//                   value.
//   rebuild-index   after create-index and merge-index, because it reads a
//                   folder's actual contents and both of those change them.
//   update-prose-paths last of the content kinds: it rewrites references TO
//                   paths, so every path it names has to have reached its
//                   destination first.
export const APPLY_ORDER = [
  "relocate-prong",
  "relocate-path",
  "absorb-folder",
  "split-folder",
  "normalize-type",
  "rename-with-link-rewrite",
  "rename-entity",
  "create-index",
  "merge-index",
  "rebuild-index",
  "repair-frontmatter",
  "update-prose-paths",
  "vault",
  "tag-registry",
];

/**
 * @param {{projectRoot: string, settings: Array, baseRules: object, discovered: object}} input
 * @returns {{operations: Array<{op: string, from?: string, to?: string, reason: string}>,
 *            declined: Array<{op: string, target: string, reason: string}>,
 *            prechecks: object}}
 */
export function buildPlan({ projectRoot, settings, baseRules, discovered }) {
  const operations = [];
  const declined = [];

  for (const opKind of OPERATION_ORDER) {
    operations.push(...planOperation(opKind, { projectRoot, settings, baseRules, discovered }));
  }
  for (const opKind of DEFERRED_OPERATIONS) {
    declined.push(...proposeDeferred(opKind, { projectRoot, settings, baseRules, discovered }));
  }

  // publish is never inserted by any unattended process: the guard that forces
  // publish false on DM-only content is a project-scope check kind, so writing a
  // default here would publish unmarked secret lore in bulk.
  declined.push(...reportMissingPublish({ projectRoot, settings }));

  return { operations, declined, prechecks: runPrechecks({ operations, projectRoot }) };
}

/**
 * THREE ignore-related fields, each Array OR null, and null always means the
 * question could not be answered rather than that the answer was "none":
 *
 *   ignored           operations whose own SOURCE is git-ignored. The apply
 *                     phase skips these. See findIgnoredSources.
 *   ignoredBeneath    directory moves that carry git-ignored files along with
 *                     them. Applied, reported, not skipped. See
 *                     findIgnoredWithinSources.
 *   ignoredReferrers  git-ignored files the plan names as referrers, whose
 *                     wikilinks are rewritten in place. See
 *                     findIgnoredReferrers.
 *
 * Only `ignored` drives skipping. The other two exist so the apply phase can
 * disclose the edits and moves that the snapshot will not undo.
 *
 * @returns {{ok: boolean, collisions: Array, caseRenames: Array,
 *            ignored: Array|null, ignoredBeneath: Array|null,
 *            ignoredReferrers: Array|null}}
 */
export function runPrechecks({ operations, projectRoot }) {
  const oracle = ignoreOracle(projectRoot);
  // ignored has to be computed FIRST. findDestinationCollisions needs to know
  // which operations the apply phase will skip, because a skipped operation
  // does not vacate its source; see the vacated comment inside that function
  // for what goes wrong when the order is the other way around.
  const ignored = findIgnoredSources(operations, oracle);
  const ignoredBeneath = findIgnoredWithinSources(operations, oracle, projectRoot);
  const ignoredReferrers = findIgnoredReferrers(operations, oracle);
  const collisions = findDestinationCollisions(operations, projectRoot, ignored);
  // A rename that changes only letter case. NOT a collision and never an abort:
  // gitMove takes it directly and falls back to a two-step through a temporary
  // neighbour when the direct move reports an error, so it executes. It is
  // reported because on the case-insensitive filesystem this module documents it
  // is the one move whose before and after name the same file, so a DM reading a
  // proposal row of "Tavern.md to tavern.md" has no way to tell an intended
  // correction from a typo in their own scope, and the operating system will not
  // tell them either. renderProposal prints the list; nothing else consumes it.
  const caseRenames = list(operations).filter(
    (o) => o.from && o.to && o.from.toLowerCase() === o.to.toLowerCase() && o.from !== o.to
  );
  // Only collisions abort. An ignored file is skipped and reported, never moved,
  // so it must not fail the run: one ignored file inside a prong would otherwise
  // stop the whole migration. ignored still rides along because the after-action
  // report has to name every file the run declined to touch.
  return { ok: collisions.length === 0, collisions, caseRenames, ignored, ignoredBeneath, ignoredReferrers };
}

// Operation kinds whose destination is SUPPOSED to be there already, so finding
// it on disk is not a collision. merge-index targets the surviving index it
// folds the others into, tag-registry regenerates a registry an earlier run
// wrote, and rebuild-index edits an existing index's link list in place rather
// than creating one. Every other kind is checked, including one added later: a
// new kind that aborts on a destination it meant to create is a louder failure
// than one that silently overwrites the DM's file.
//
// absorb-folder is NOT here, and was: its folder-level `to` is the parent folder
// and used to need the exemption. It no longer contributes a destination entry
// at all, so there is nothing left to exempt; see destinationEntriesOf for why
// the entry went away.
const DESTINATION_MAY_EXIST = new Set(["merge-index", "tag-registry", "rebuild-index"]);

// vault joins them for the CREATE shape ONLY, which is why this is a predicate
// rather than a third entry in the set above.
//
// The create shape is the one that false-aborted. A resync against a project
// that already carries its .obsidian/ is the ordinary second run, and applyVault
// is idempotent about it: mkdirSync is recursive, and the app.json marker is
// written only when it is absent, so nothing of the DM's is overwritten. Without
// the exemption that ordinary rerun aborts in the plan phase over a destination
// that legitimately exists.
//
// The MOVE shape stays checked, and adding the kind wholesale would have exempted
// it too. There, a destination already on disk is a real hazard rather than a
// normal state, and a quiet one: measured in the vault fixture in
// migrate.apply.test.mjs, `git mv old/.obsidian new/.obsidian` with the
// destination already a directory does NOT fail. It reports success and moves the
// source INSIDE the destination, leaving new/.obsidian/.obsidian and a setting
// with no vault where Obsidian looks for one.
//
// Narrow in the other direction too: this suppresses only the ON-DISK half. The
// in-plan half runs before it, so two operations targeting one path still abort
// whatever their kinds, and a rename targeting an existing .obsidian is a rename,
// not a vault, so it still aborts as well.
function destinationMayExist(op) {
  if (DESTINATION_MAY_EXIST.has(op.op)) return true;
  return op.op === "vault" && !op.from;
}

// Every per-file move an operation carries, from BOTH shapes that carry one.
//
// absorb-folder enumerates its files flat in `articles`. split-folder nests them
// one level deeper, in `buckets[].articles`, because the bucket is the unit the
// DM approved and which article goes where is the whole content of that
// decision; flattening it away in the operation itself would lose it.
//
// FOUR places need per-file moves, and they all read them through here so that a
// kind carrying a new shape is taught to all four at once rather than to three:
// destinationEntriesOf below, findIgnoredSources, applyPlan's skip list, and
// applySplitFolder. Teaching only some of them is a measured hazard rather than
// a hypothetical one. An earlier change made absorb-folder's per-file destinations real
// without teaching findIgnoredSources about them, and the result was that a
// rename onto a git-ignored, unsnapshotted file went from correctly refused to
// silently permitted, because the ignored file was credited with vacating a path
// it will never leave.
//
// No kind but absorb-folder carries `articles` and none but split-folder carries
// `buckets`, so this reads exactly as before for every other kind.
function articleMovesOf(o) {
  if (!o || typeof o !== "object") return [];
  const out = [];
  for (const a of list(o.articles)) if (a && typeof a === "object") out.push(a);
  for (const b of list(o.buckets)) {
    for (const a of list(b && b.articles)) if (a && typeof a === "object") out.push(a);
  }
  return out;
}

// The scope entries an operation came from, as plain JSON data on the operation.
//
// ONE scope entry can emit SEVERAL operations. A split emits the partition, one
// create-index per bucket, and a rebuild of the folder's own index; an absorb
// emits the dissolution and a rebuild of the parent's. Those are not independent
// operations, and applying some without the others produces a tree that matches
// neither the old shape nor the one the DM approved. Measured twice, both from
// this module's own skip path:
//
//   A split skipped for a git-ignored article left its paired create-index
//   operations to run anyway. applyCreateIndex writes through writeText, whose
//   recursive mkdirSync CREATED the two bucket folders the skipped split never
//   populated; the run reported ok true and committed them; and the planner then
//   declined the documented "unignore it and re-run the same scope" retry,
//   because existsSync on those bucket folders is now true. The remedy the skip
//   message names stopped working.
//
//   A skipped absorb left its paired parent rebuild to run, which dropped
//   [[Misc-INDEX]] out of the parent index while settings/rolara/misc was still
//   on disk holding that very index, with a reason claiming the folder "was
//   absorbed into it".
//
// So the SKIP UNIT is the scope entry rather than the single operation, and this
// id is what applyPlan's skip pass groups on. Three properties it has to have:
//
//   PLAIN JSON, never a closure and never a symbol. The DM may hand-edit the plan
//   file between the two phases and a later task renders and re-parses it, so the
//   id has to survive that round trip unchanged.
//
//   AN ARRAY, because one operation can belong to more than one entry. Two
//   sibling absorbs into one parent share a single deduped rebuild-index (see the
//   rebuilds Map in planAbsorbFolders), and it genuinely belongs to both. So
//   applyPlan skips a multi-group operation only when EVERY group it belongs to is
//   skipped. Dropping it because ONE of them was would leave the absorb that DID
//   run with a parent index still linking the index it just removed, which is a
//   dead wikilink, and the link-integrity rail then blocks the whole commit. The
//   asymmetry decides it: a rebuild that runs when one contributing entry was
//   skipped leaves the surviving folder unlisted in its parent index, which is a
//   documentation gap; a rebuild that does not run when its absorb did is a dead
//   link that fails the run. The gap is REPORTED rather than silent, and it took a
//   report of its own to become so: the skip item cannot mention it, because the
//   operation it would have to name is one that ran. See the partiallySkipped note
//   in applyPlan, which names every operation in that position and what it cost.
//
//   TOLERANT of what a hand-edit does to it. A missing, empty, or unreadable
//   value yields no group at all, and an operation with no group is skipped ALONE,
//   exactly as it was before grouping existed: a LOST id must never widen a skip.
//   A DUPLICATED id does widen one, because nothing here can tell a deliberate
//   group from a pasted duplicate, so the widening is disclosed rather than
//   silent: the single report item names every operation it took with it.
//
// Setup's unattended plan carries no groups at all. Not one planner buildPlan
// reaches stamps the field, so every grouping decision below is inert for those
// kinds and each of their operations is skipped on its own terms, byte for byte as
// before.
function groupsOf(o) {
  if (!o || typeof o !== "object") return [];
  const raw = typeof o.groups === "string" ? [o.groups] : list(o.groups);
  const out = [];
  for (const g of raw) {
    if (typeof g !== "string") continue;
    const id = g.trim();
    if (id === "" || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

// Every path an operation names as a SOURCE, which is a wider set than `from`.
//
// merge-index has no `from` at all and carries its sources in `sources`; absorb
// and split never move their own `from` and carry theirs as the per-file moves
// articleMovesOf reaches. Keyed on `from` alone, a skipped merge produced the
// degenerate key "merge-index::" that no disclosure row can equal, and a
// git-ignored file inside an absorbed folder was invisible to the skip pass.
//
// absorb-folder's `index` is a source too, and the one this list reached last. It
// is the folder's own index, and the executor does not move it: it `git rm`s it,
// which is a mutation of a tracked file exactly as a move is. An index the planner
// picked that happens to be git-ignored was therefore invisible here, the absorb
// was not skipped, `git rm` hard-failed on an untracked file, and the entry
// reported applied false having already moved every article: a half-applied absorb
// from a plan the prechecks approved. findIgnoredSources names it on the same
// terms, because this list decides the skip UNIT and that one decides what is
// ignored at all; either alone leaves the hole open.
function sourcePathsOf(o) {
  if (!o || typeof o !== "object") return [];
  return [o.from, o.index, ...list(o.sources), ...articleMovesOf(o).map((a) => a.from)]
    .map((p) => toPosix(p || ""))
    .filter(Boolean);
}

// THE UNIT A GIT-IGNORED SOURCE TAKES WITH IT, decided once for a whole operation
// list. BOTH halves of this module read it from here, and that is the point rather
// than a tidying: the plan phase declines an ignored source so it reaches the DM's
// proposal, the apply phase skips one so it is never moved, and the two have to
// agree on WHICH operations go with it or the plan half reintroduces, one phase
// earlier, the defect the apply half spent a fix round closing. A split declined
// for its ignored article while its paired create-index stayed in the plan would
// create and commit the empty bucket folders the split never populated, which then
// makes the planner decline the documented "un-ignore it and run again" retry.
//
// The rule, in one place:
//
//   An operation whose OWN source is ignored is always taken.
//   An operation carrying groups is taken when EVERY group it belongs to is,
//   which is the multi-group asymmetry argued at groupsOf: a rebuild two entries
//   share and only one of which was taken still runs, because dropping it would
//   leave the entry that DID run holding a dead wikilink.
//   An operation carrying no group at all is taken ALONE, exactly as it was
//   before grouping existed.
//
// `ignored` is the prechecks' own `ignored` array. It is never null here: both
// callers decide what an undetermined verdict means before asking, because
// "the question could not be answered" is not "nothing is ignored" and this
// function has no way to say the difference.
//
// Returns the group ids that were taken, each operation's own ignored sources,
// and a per-operation verdict carrying the report key the apply half groups its
// skip items under.
function ignoredSkipDecision(operations, ignored) {
  const ignoredSources = new Set(list(ignored).map((i) => toPosix(i && i.source)).filter(Boolean));
  const ignoredByOp = new Map();
  const skippedGroups = new Set();
  for (const op of list(operations)) {
    const here = sourcePathsOf(op).filter((s) => ignoredSources.has(s));
    ignoredByOp.set(op, here);
    if (here.length === 0) continue;
    for (const g of groupsOf(op)) skippedGroups.add(g);
  }
  return {
    skippedGroups,
    ignoredOf: (op) => ignoredByOp.get(op) || [],
    // null when the operation is not taken. Otherwise the group it is reported
    // under, keyed by the FIRST of its taken groups so every operation one entry
    // emitted lands in ONE item, and by the operation object itself when it
    // carries no group, which reproduces the ungrouped one-item-per-operation
    // shape exactly.
    skipOf: (op) => {
      const groups = groupsOf(op);
      const own = (ignoredByOp.get(op) || []).length > 0;
      if (!own && !(groups.length > 0 && groups.every((g) => skippedGroups.has(g)))) return null;
      const group = groups.find((g) => skippedGroups.has(g));
      return group === undefined ? { group: null, key: op } : { group, key: group };
    },
  };
}

// Collisions are scoped to each DESTINATION DIRECTORY, which is what a move can
// actually overwrite. Two settings legitimately holding a Tavern.md is not a
// collision, and aborting on it would abort for the exact duplication the
// per-setting layout exists to permit.
//
// A destination collides two ways, and both abort. Two operations can target
// the same path, and ONE operation can target a path that is already occupied
// on disk. The second is the likelier shape: the first needs two files to both
// violate the filename schema, while the second needs only one, say
// "The Tavern.md", whose corrected name Tavern.md is already taken precisely
// because that file already conforms and so generates no operation of its own.
//
// The on-disk half belongs here rather than in the apply phase because the rail
// reads "aborts before any mutation": an apply-time discovery lands after the
// snapshot and possibly mid-run, with earlier operations already applied.
//
// The whole key is case-folded, directory included. The basename was already
// folded because the filesystem is case-insensitive; settings/Rolara/items and
// settings/rolara/items are one directory on that same filesystem, so folding
// half the key let through a pair that is one file.
//
// A "destination entry" is one from/to pair this check considers. Most
// operations contribute exactly one: their own from and to.
//
// absorb-folder is the exception, and contributes one entry PER FILE in
// `articles` and NONE of its own. `articles` is the field the DM's approved
// proposal names, and for this kind those files ARE the destinations: the
// executor moves them one `git mv` at a time and never writes the folder-level
// `to` as a unit. So a file's `to` is never exempt, because a basename collision
// in the parent is exactly the hazard this check exists to catch before anything
// moves, and the folder-level `to` is not a destination to check at all.
//
// It used to contribute both, with the folder-level entry exempted by
// destinationMayExist. That entry made the feature's ORDINARY case refuse:
// absorbing two sibling stub folders into one parent gives two operations the
// same folder-level `to`, and the generic in-plan rule below reads two entries
// with one destination as a collision whatever their kinds, exemption or not.
// Measured: two absorbs into settings/rolara reported ok false with an in-plan
// collision of settings/rolara against itself, and applyPlan then refused the
// run over a file that would not have been overwritten.
//
// Dropping the entry gives up TWO things, not one. The first is the in-plan
// duplicate check on the parent path, and that is the POINT rather than a cost:
// two absorbs into one parent legitimately share that destination, the parent is
// never written as a unit, and every basename collision inside it is still caught
// by the per-file entries below. The second is vacate credit on the dissolved
// folder path itself, which nothing needs: no operation moves anything ONTO a
// folder another operation is dissolving, and if one ever did, withheld credit
// costs a false collision and a rerun rather than an overwrite.
//
// split-folder lands in the same place by a different route, and is NOT in the
// exclusion above because it does not need to be: a split has no single
// destination, so its `to` is absent, and an entry with no `to` is skipped by
// both halves of the check below. Its real destinations are the per-article paths
// inside its buckets, which articleMovesOf reaches. It grants no vacate credit on
// the folder either, which is correct: a split empties nothing, and the articles
// it does move each vacate their own path through their own entry.
function destinationEntriesOf(o) {
  const entries = [];
  if (o.op !== "absorb-folder") {
    entries.push({ op: o.op, from: o.from, to: o.to, mayExist: destinationMayExist(o) });
  }
  for (const a of articleMovesOf(o)) {
    if (!a.to) continue;
    entries.push({ op: o.op, from: a.from, to: a.to, mayExist: false });
  }
  return entries;
}

function findDestinationCollisions(operations, projectRoot, ignored) {
  const ops = list(operations).filter((o) => o && typeof o === "object");
  const entries = ops.flatMap(destinationEntriesOf);
  const foldKey = (p) => `${path.dirname(p)}::${path.basename(p)}`.toLowerCase();
  const rootUsable = Boolean(projectRoot) && existsSync(projectRoot);

  // A move vacates its own source, so a path some operation renames away from
  // is free by the time the plan reaches it, and A -> B, B -> C is legal.
  // Only an operation carrying BOTH from and to vacates anything: an in-place
  // edit carries from and no to exactly because it leaves the file where it is,
  // so its source must not count as freed.
  //
  // A vacating operation only frees its source if the apply phase actually
  // runs it. prechecks.ignored names every operation whose source is
  // git-ignored, and the apply phase's own contract is to SKIP those (see
  // findIgnoredSources): the source stays exactly where it is. Crediting a
  // skipped operation with vacating its destination is the hole this fix
  // closes: an ignored op1 (from Ignored.md, to Moved.md) would otherwise mark
  // Ignored.md free, and an unrelated op2 targeting that same path would then
  // overwrite the file op1 left behind, unrecoverably, since a git-ignored
  // file has no pre-migration snapshot either.
  //
  // ignored is Array OR null. null means the question could not be answered
  // (no projectRoot, no repository, or a failed git call; see
  // findIgnoredSources). Undetermined is not "nothing is ignored", so it
  // needs its own decision, not a silent fallback to either array behavior.
  // Chosen: while undetermined, NO operation is credited with vacating its
  // source. The two ways this can be wrong are not symmetric. Crediting an
  // operation that turns out to have been ignored reproduces the exact
  // silent, unrecoverable overwrite above. Withholding credit from one that
  // turns out NOT to have been ignored only produces a false-positive
  // collision abort, which costs a rerun and nothing else. Given that
  // asymmetry, undetermined takes the conservative reading rather than
  // today's permissive one.
  //
  // Both sides of the lookup are posix-normalized, the same way the vacated key
  // one line below already is. Plan paths are posix by contract, so this changes
  // nothing for a planned plan; it keeps the comparison honest for a hand-edited
  // one, where a Windows DM's backslash would otherwise miss the match and hand
  // back the credit this is withholding.
  const ignoredFroms =
    ignored === null ? null : new Set(list(ignored).map((i) => toPosix(i.from)).filter(Boolean));
  const vacated = new Set();
  for (const e of entries) {
    if (!e.from || !e.to) continue;
    const from = toPosix(e.from);
    if (ignoredFroms === null || ignoredFroms.has(from)) continue;
    vacated.add(foldKey(from));
  }

  const byDir = new Map();
  const hits = [];
  for (const e of entries) {
    if (!e.to) continue;
    const to = toPosix(e.to);
    const key = foldKey(to);

    if (byDir.has(key)) {
      hits.push({
        kind: "in-plan",
        a: byDir.get(key),
        b: to,
        reason: "Two operations target the same destination, so applying both would overwrite one.",
      });
    } else {
      byDir.set(key, to);
    }

    if (!rootUsable || e.mayExist) continue;
    if (vacated.has(key)) continue;
    if (!existsSync(path.resolve(projectRoot, to))) continue;
    hits.push({
      kind: "on-disk",
      op: e.op,
      from: e.from,
      to,
      reason:
        "Destination already exists and no operation in this plan moves it away, so applying this one would overwrite it.",
    });
  }
  return hits;
}

// ---------------------------------------------------------------------------
// The survey buildPlan consumes
// ---------------------------------------------------------------------------
//
// buildPlan does not survey for OPERATIONS. Discovery runs upstream, in the
// workflow's scout, and arrives here as `discovered`. Keeping the two apart is
// what lets the operation half be exercised against fixtures with no project on
// disk.
//
// It does walk the tree, though, and the apply phase should not read the
// paragraph above as saying otherwise: reportMissingPublish recurses every prong
// root of every setting and reads the frontmatter of every markdown file it
// finds, and findDestinationCollisions and findIgnoredSources both stat the
// project. The read-only property is not an absence of walking. It is that
// every fs call the plan phase makes is readdirSync, readFileSync, statSync, or
// existsSync, none of which can write, plus two git argv literals that take
// nothing from the caller or the project. The module also imports mkdirSync,
// writeFileSync, and rmdirSync and builds mutating git argv, but only inside the
// apply half below, which no plan-phase function reaches.
//
// Every field is optional; a survey that found nothing of a kind may omit it.
//
//   prongMoves         [{ settingIndex, setting, kind, from, to }]
//   typeMismatches     [{ file, typeFrom, typeTo }]
//   renames            [{ file, to, ruleId, links }]
//   missingIndexes     [{ folder, settingIndex, basename }]
//   multiIndexFolders  [{ folder, survivor, sources, sourceLinks }]
//   frontmatterRepairs [{ file, insert, reorder }]
//   vaults             [{ settingIndex, setting, from, to }]
//   tagRegistries      [{ settingIndex, setting, to }]
//   splitCandidates    [{ folder, entryCount, proposal }]
//   absorbCandidates   [{ folder, entryCount }]
//
// A setting is identified by `settingIndex`, its declared position in
// conventions.json's settings array, never by its name. Two settings are
// allowed to share a name or omit one, and resolving by name would collapse
// them, which is the same rule the sweep and the write-time hook already
// follow for ownership keys.
//
// FOUR operation kinds carry fields beyond the {op, from, to, reason} shape the
// JSDoc above buildPlan documents, because the shape cannot express them. In
// OPERATION_ORDER order:
//
//   normalize-type carries `typeFrom` and `typeTo`, the base-type value being
//   corrected and what it becomes. Both, because the reason line names the old
//   value and the apply phase has to match on it.
//
//   rename-with-link-rewrite carries `links`, the files whose wikilinks point
//   at the old name, and carries it only when there are any. The rename and its
//   rewrite are one unit of work, so the plan has to carry both halves:
//   re-deriving the link set at apply time would be the apply phase inventing
//   an operation.
//
//   merge-index carries `sources`, the indexes being merged away, and
//   `sourceLinks`, the files whose wikilinks point at each of them. It is ONE
//   operation per folder, not one per source. Emitting one per source would
//   give every source the same `to`, and findDestinationCollisions would then
//   read a six-sub-index folder (the reference consumer's items/ is exactly
//   that) as five collisions and abort a migration that has nothing wrong
//   with it.
//
//   `sourceLinks` is to a merge what `links` is to a rename, and is carried on
//   the same terms: only when there are any, and named by the plan rather than
//   re-derived at apply time, because re-deriving it there would be the apply
//   phase inventing an operation. It is a MAP from source path to referring
//   files rather than a flat list, because each source has its own filename and
//   so its own wikilink stem to rewrite onto the survivor.
//
//   Without it a merge is not link-safe. A merge REMOVES its sources, so every
//   wikilink that named one dies the moment the merge lands, which is the same
//   class of dead reference a rename carries `links` to prevent. The reference
//   consumer's items/ folds six sub-indexes and orphans six wikilinks doing it,
//   so the migration this release exists to perform cannot reach its commit
//   without this field.
//
//   repair-frontmatter carries `insert`, the defaulted fields to add, and
//   `reorder`, whether the canonical-order pass runs. Always both, even when
//   `insert` is empty. `insert` is decided here rather than at apply time
//   because here is where publish is stripped out of it.
//
// normalize-type and repair-frontmatter edit a file in place, so they carry
// `from` and no `to`. That is not a shortcut: `to` means a destination a move
// could overwrite, and giving an in-place edit a `to` equal to its own path
// would make two edits to one file read as a collision with itself, and would
// now also read as a collision with the file on disk.

// Paths in a plan are project-relative and posix-separated, so that the
// collision key built from path.dirname and path.basename is stable no matter
// which separator the survey happened to use.
//
// slash only changes separators. toPosix also drops a trailing slash, which is
// right for a plan path and wrong for git's ignore output, where the trailing
// slash is the whole signal that an entry is a directory rather than a file.
//
// NEITHER is applied to a path git printed. git's own output is already
// posix-separated on every platform, so a backslash in it is a character in a
// filename, not a separator, and rewriting it corrupts the name.
const slash = (p) => String(p == null ? "" : p).replace(/\\/g, "/");
const toPosix = (p) => slash(p).replace(/(.)\/+$/, "$1");

function planOperation(opKind, ctx) {
  switch (opKind) {
    case "relocate-prong":
      return planRelocations(ctx);
    case "normalize-type":
      return planTypeNormalizations(ctx);
    case "rename-with-link-rewrite":
      return planRenames(ctx);
    case "create-index":
      return planIndexCreations(ctx);
    case "merge-index":
      return planIndexMerges(ctx);
    case "repair-frontmatter":
      return planFrontmatterRepairs(ctx);
    case "vault":
      return planVaultOperations(ctx);
    case "tag-registry":
      return planTagRegistries(ctx);
    default:
      // A kind added to OPERATION_ORDER with no planner would plan silently
      // nothing, and a migration that quietly skips a whole class of work is
      // worse than one that refuses to start. Nothing has been mutated at this
      // point, so throwing costs nothing.
      throw new Error(`migrate: no planner for operation kind "${opKind}"`);
  }
}

const list = (v) => (Array.isArray(v) ? v : []);

// 1. Relocate prongs to the canonical layout. Pure moves, link-safe, because
//    Obsidian resolves wikilinks by basename rather than by path.
function planRelocations({ discovered }) {
  return list(discovered && discovered.prongMoves)
    .filter((m) => m && m.from && m.to)
    .map((m) => ({
      op: "relocate-prong",
      from: toPosix(m.from),
      to: toPosix(m.to),
      reason:
        `Relocate the ${m.kind || "prong"} root` +
        (m.setting ? ` for setting ${m.setting}` : "") +
        " to the canonical layout, as confirmed in the prong mapping.",
    }));
}

// 2. Normalize known base-type value mismatches. Before the rename pass: a
//    file's required suffix derives from its type, so renaming first computes
//    suffixes from stale values.
function planTypeNormalizations({ discovered, baseRules }) {
  const enumValues = ruleParam(baseRules, "frontmatterTypeEnum", "values", null);
  return list(discovered && discovered.typeMismatches)
    .filter((t) => t && t.file && t.typeTo)
    .map((t) => ({
      op: "normalize-type",
      from: toPosix(t.file),
      typeFrom: t.typeFrom,
      typeTo: t.typeTo,
      reason:
        `Normalize type ${JSON.stringify(t.typeFrom)} to ${JSON.stringify(t.typeTo)}` +
        (Array.isArray(enumValues) && !enumValues.includes(t.typeTo)
          ? ", which the base type enum does not list: confirm it before applying."
          : ", a recognized base type value.") +
        " Runs before the rename pass so the suffix rules see the corrected value.",
    }));
}

// 3. Each rename travels with the link rewrite it requires, as one unit of
//    work with one accounting entry. A dead wikilink is valid markdown and
//    fails silently, so the two halves must not become two batched passes.
function planRenames({ discovered, baseRules }) {
  return list(discovered && discovered.renames)
    .filter((r) => r && r.file && r.to)
    .map((r) => {
      const op = {
        op: "rename-with-link-rewrite",
        from: toPosix(r.file),
        to: toPosix(r.to),
        reason:
          (ruleDescription(baseRules, r.ruleId) || "Filename does not match the schema.") +
          ` Rewrites ${list(r.links).length} referring file(s) in the same unit of work.`,
      };
      if (list(r.links).length > 0) op.links = list(r.links).map(toPosix);
      return op;
    });
}

// 4. Create missing indexes for content-bearing KB folders. The suffix comes
//    from the owning setting's own indexParity rule when it has one, because
//    under v3 the rules live per setting and a second world may spell its
//    indexes differently.
function planIndexCreations({ discovered, settings, baseRules }) {
  return list(discovered && discovered.missingIndexes)
    .filter((f) => f && f.folder)
    .map((f) => {
      const folder = toPosix(f.folder);
      const suffix = indexSuffixFor(settingAt(settings, f.settingIndex), baseRules);
      const stem = f.basename || defaultIndexStem(folder);
      return {
        op: "create-index",
        to: `${folder}/${stem}${suffix}.md`,
        reason: `Folder holds content but no ${suffix} file, so nothing owns its articles.`,
      };
    });
}

// 5. Merge multi-index folders losslessly. One operation per folder: see the
//    survey note above for why one per source would abort the run. Each merge
//    travels with the link rewrites it requires, the same way a rename does,
//    because a merge removes its sources and every wikilink naming one dies with
//    them.
function planIndexMerges({ discovered }) {
  return list(discovered && discovered.multiIndexFolders)
    .filter((f) => f && f.survivor && list(f.sources).length > 0)
    .map((f) => {
      const sources = list(f.sources).map(toPosix);
      const sourceLinks = normalizeSourceLinks(f.sourceLinks, sources);
      const pairs = Object.keys(sourceLinks).reduce((n, k) => n + sourceLinks[k].length, 0);
      const op = {
        op: "merge-index",
        to: toPosix(f.survivor),
        sources,
        reason:
          `Folder ${toPosix(f.folder)} carries ${sources.length + 1} indexes. ` +
          "Merge concatenates each source's full content under a provenance heading, " +
          "so headings, grouping, ordering, and prose all survive. " +
          `Rewrites ${pairs} referring file/source pair(s) onto the survivor in the same unit of work.`,
      };
      if (pairs > 0) op.sourceLinks = sourceLinks;
      return op;
    });
}

// The referring files a merge carries, keyed by the source they point at.
//
// Keys are matched against the operation's OWN sources after normalization, so a
// key naming a file this merge does not consume is dropped rather than smuggling
// an unrelated rewrite into the unit of work. That matters because the rewrite
// half edits article content: the only files it may touch are the ones named
// against a source this operation is actually removing.
function normalizeSourceLinks(raw, sources) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  const known = new Set(sources);
  for (const key of Object.keys(raw)) {
    const source = toPosix(key);
    if (!known.has(source)) continue;
    const refs = [];
    for (const ref of list(raw[key])) {
      const r = toPosix(ref);
      if (r && !refs.includes(r)) refs.push(r);
    }
    if (refs.length > 0) out[source] = refs;
  }
  return out;
}

// 6. Repair frontmatter: insert missing defaulted fields EXCEPT publish, and
//    reorder to canonical order.
function planFrontmatterRepairs({ discovered }) {
  return list(discovered && discovered.frontmatterRepairs)
    .filter((f) => f && f.file)
    .map((f) => {
      // publish is stripped here rather than trusted to be absent upstream.
      // Setting a disclosure flag is the DM's call, and guessing it wrong
      // leaks unmarked secret lore into a public wiki, so the one place that
      // could write it is the one place that refuses to.
      const insert = list(f.insert).filter((field) => field !== "publish");
      const op = {
        op: "repair-frontmatter",
        from: toPosix(f.file),
        insert,
        reorder: f.reorder === true,
        reason:
          (insert.length > 0 ? `Insert ${insert.join(", ")}. ` : "") +
          (f.reorder === true ? "Reorder to canonical field order. " : "") +
          "Applied as a line move on the raw text, never parse-and-regenerate.",
      };
      return op;
    })
    .filter((o) => o.insert.length > 0 || o.reorder);
}

// 7. Create or move .obsidian/ per setting. The vault boundary is what keeps
//    two worlds' basename namespaces separate.
function planVaultOperations({ discovered }) {
  return list(discovered && discovered.vaults)
    .filter((v) => v && v.to)
    .map((v) => {
      const op = {
        op: "vault",
        to: toPosix(v.to),
        reason:
          (v.from ? "Move" : "Create") +
          ` the Obsidian vault for setting ${v.setting || "(unnamed)"}. ` +
          "Wikilink resolution is basename-only, so one vault per setting is what keeps two worlds from colliding.",
      };
      if (v.from) op.from = toPosix(v.from);
      return op;
    });
}

// 8. Regenerate the per-setting tag registries.
function planTagRegistries({ discovered }) {
  return list(discovered && discovered.tagRegistries)
    .filter((t) => t && t.to)
    .map((t) => ({
      op: "tag-registry",
      to: toPosix(t.to),
      reason: `Regenerate the tag registry for setting ${t.setting || "(unnamed)"} from its post-migration KB.`,
    }));
}

// ---------------------------------------------------------------------------
// Deferred work
// ---------------------------------------------------------------------------

// Split and absorb are reported, never executed, on this run. Both are
// structural judgments rather than structural facts: the threshold detects
// that a folder should divide or dissolve without determining how to partition
// it or where its contents belong.
function proposeDeferred(opKind, { discovered, baseRules }) {
  if (opKind === "split") {
    const minEntries = ruleParam(baseRules, "structuralSplitThreshold", "minEntries", null);
    return list(discovered && discovered.splitCandidates)
      .filter((c) => c && c.folder)
      .map((c) => ({
        op: "split",
        target: toPosix(c.folder),
        reason:
          `Holds ${c.entryCount} articles` +
          (minEntries == null ? "" : `, at or past the split threshold of ${minEntries}`) +
          ". " +
          (c.proposal ? `Proposed partition: ${c.proposal}. ` : "") +
          "Not executed: crossing the threshold says the folder should divide, not how to partition it. Run /migrate to split it once you have decided how.",
      }));
  }
  if (opKind === "absorb") {
    const maxEntries = ruleParam(baseRules, "structuralAbsorbThreshold", "maxEntries", null);
    return list(discovered && discovered.absorbCandidates)
      .filter((c) => c && c.folder)
      .map((c) => ({
        op: "absorb",
        target: toPosix(c.folder),
        reason:
          `Holds ${c.entryCount} articles` +
          (maxEntries == null ? "" : `, under the absorb threshold of ${maxEntries}`) +
          ". Not executed: dissolving a folder that holds subfolders is undefined, and prong, setting, and campaign folders are exempt permanently. Run /migrate to dissolve it into its parent once you have decided that is what you want.",
      }));
  }
  // Same reasoning as planOperation's default: silence about a whole class of
  // deferred work reads as "there was none".
  throw new Error(`migrate: no proposer for deferred operation "${opKind}"`);
}

// Articles with no publish field are reported and left alone. This walks the
// tree read-only; nothing in the plan phase writes.
export function reportMissingPublish({ projectRoot, settings }) {
  if (!projectRoot || !existsSync(projectRoot)) return [];
  const out = [];
  const seen = new Set();
  for (const setting of list(settings)) {
    for (const root of prongRootsOf(setting)) {
      const abs = path.resolve(projectRoot, root);
      if (!existsSync(abs)) continue;
      for (const file of walkMarkdown(abs)) {
        const rel = toPosix(path.relative(projectRoot, file));
        if (seen.has(rel)) continue;
        seen.add(rel);
        if (frontmatterHasPublish(file)) continue;
        out.push({
          op: "publish",
          target: rel,
          reason:
            "No publish field. Not inserted: setting a disclosure flag is the DM's call, and defaulting it would either hide finished lore or leak secret lore into a public wiki.",
        });
      }
    }
  }
  return out;
}

function prongRootsOf(setting) {
  if (!setting || typeof setting !== "object") return [];
  return [setting.kbRoot, setting.homebrewRoot, setting.sessionReportsRoot].filter(
    (r) => typeof r === "string" && r.trim() !== ""
  );
}

function* walkMarkdown(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === ".git" || name === ".obsidian" || name === "node_modules") continue;
    const full = path.join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) yield* walkMarkdown(full);
    else if (st.isFile() && name.toLowerCase().endsWith(".md")) yield full;
  }
}

// Raw-text frontmatter read. Deliberately not a YAML parse: the hook's parser
// is a documented subset that drops comments and nested maps and strips
// quoting, and this only needs to know whether the key is there at all.
function frontmatterHasPublish(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return true; // Unreadable: do not accuse a file this phase could not open.
  }
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") return false;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---" || lines[i] === "...") return false;
    if (/^publish\s*:/.test(lines[i])) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Scope-derived plans (/migrate)
// ---------------------------------------------------------------------------
//
// buildPlan surveys the project against professor-orb's own schema, which is
// known and derivable, so its plan is not news to anyone. buildScopedPlan takes
// a scope the DM negotiated with the command and turns it into the same
// operation list. The difference that matters is the gate, not the machinery:
// the schema-derived plan runs unattended at setup, and this one is written to a
// proposal file the DM reads, may edit, and approves before anything runs.
//
// Every planner here is pure and read-only, exactly like the setup planners.

// Scope keys, their planners, and the APPLY_ORDER kind that GOVERNS when each
// planner runs. Each entry names the scope key the DM's negotiated scope carries,
// the planner that turns it into operations, and that kind.
//
// The third member is the point. The order these planners run in is load-bearing for
// correctness: precedingOperations answers "everything already planned that runs
// before one of `kind`" out of the operations produced SO FAR, so a planner that runs
// before one whose operations it needs to see reasons about an incomplete list and
// declines a legitimate path as a typo. Left to source position, that correctness
// property was a property of wherever the next append happened to land, and this
// release's own plan document instructs three later tasks to append planners whose
// kinds rank 4, 10, and 5 AFTER one that ranks 9. So position decides nothing here:
// scopedPlannerSequence orders the run by these declarations.
//
// THE GOVERNING KIND OF A PLANNER THAT EMITS SEVERAL IS THE LOWEST-RANKED ONE IT
// EMITS, because both duties of the position force that same answer:
//
//   emit side   A later planner checking at rank r needs every operation ranked at or
//               below r to be in the list already, so the LOWEST rank this planner
//               emits is the latest position it may occupy.
//   check side  This planner's own checks need exactly that of the planners before it,
//               so it may not ask about a rank ABOVE its own position.
//
// splitFolders emits split-folder (3), create-index (7), and rebuild-index (9), so
// split-folder governs, and its four checks all ask with split-folder. absorbFolders
// emits absorb-folder (2) and rebuild-index (9), so absorb-folder governs, and its two
// checks (the folder it dissolves and the parent index it rebuilds) both ask with
// absorb-folder, which is the lower of the two and therefore the one this position
// answers completely. Neither planner's higher-ranked operations lose
// anything by being produced early: buildScopedPlan sorts the finished plan, and a
// later planner reading them at their own rank finds them already in ctx.planned.
//
// Both duties are VERIFIED against what the planners do rather than left to this
// comment. buildScopedPlan checks the emit side against the operations a planner
// actually returned; precedingOperations checks the check side against the kind
// actually asked about. Exported so the plan suite can walk the declarations and
// permute the array: a permuted registry producing an identical plan is the property
// that makes a future append harmless rather than merely conventional.
export const SCOPED_PLANNERS = [
  ["pathMoves", planPathMoves, "relocate-path"],
  ["absorbFolders", planAbsorbFolders, "absorb-folder"],
  ["splitFolders", planSplitFolders, "split-folder"],
  ["entityRenames", planEntityRenames, "rename-entity"],
  ["rebuildIndexes", planRebuildIndexes, "rebuild-index"],
  // Appended, not inserted in rank order: scopedPlannerSequence is what runs
  // these in rank order, and this array's own order is source history rather
  // than a dependency the run depends on. See the comment above this constant.
  //
  // retypes emits BOTH normalize-type (rank 4) and rename-with-link-rewrite
  // (rank 5), so it governs as normalize-type, the lower of the two: a later
  // planner checking at rank r needs every operation ranked at or below r
  // already in the list, so the LOWEST rank a planner emits is the latest
  // position it may run at.
  ["retypes", planRetypes, "normalize-type"],
  ["frontmatterRepairs", planScopedRepairs, "repair-frontmatter"],
  ["suffixRenames", planSuffixRenames, "rename-with-link-rewrite"],
  // prosePathUpdates emits update-prose-paths and nothing else, so that kind
  // governs. It ranks 11, last of the content kinds, which is where the append
  // lands it anyway; scopedPlannerSequence is still what decides that, not this
  // position.
  ["prosePathUpdates", planProsePathUpdates, "update-prose-paths"],
  // The three setting-lifecycle planners, each emitting exactly ONE kind, so the
  // lowest-ranked kind each emits is the only kind each emits. settingRenames and
  // settingRetirements both move prong roots, which is relocate-prong (rank 0);
  // campaignRetirements moves one campaign folder, which is relocate-path (rank 1),
  // the same mechanics with a different meaning.
  //
  // Appended, and rank 0 is the FRONT of the run order, which is exactly the case
  // the declarations exist for: read off source position these three would run
  // last, after every planner whose checks need to see a prong move.
  //
  // The two rank-0 entries TIE, and scopedPlannerSequence's sort is stable, so
  // settingRenames runs first. Nothing depends on which way the tie falls: a scope
  // that both renames and retires one setting has the second planner find its
  // roots already carried away and decline, whichever of the two that is.
  ["settingRenames", planSettingRenames, "relocate-prong"],
  ["settingRetirements", planSettingRetirements, "relocate-prong"],
  ["campaignRetirements", planCampaignRetirements, "relocate-path"],
  // settingSplits emits relocate-path (rank 1) and nothing else, so that kind
  // governs: the crossings it also produces are DECLINED items rather than
  // operations, and declined items carry no rank because nothing applies them.
  // A third entry at rank 1, tying with pathMoves and campaignRetirements, and
  // sound for the reason the two rank-0 entries above are: same-rank operations
  // run in the order they were produced, so whichever planner runs first is also
  // the one whose operations run first.
  ["settingSplits", planSettingSplits, "relocate-path"],
  // settingMerges emits relocate-path (rank 1) and nothing else, so that kind
  // governs, on the same reading as settingSplits above: the collisions it also
  // produces are DECLINED items rather than operations, and a declined item carries
  // no rank because nothing applies it. Every move it emits is a direct child of a
  // prong root rather than a root itself, which is why it is relocate-path and not
  // relocate-prong: a whole knowledge base is not moving, its contents are.
  //
  // A fourth entry at rank 1, tying with pathMoves, campaignRetirements and
  // settingSplits, and sound for the same reason those three are: same-rank
  // operations run in the order they were produced, so whichever planner runs first
  // is also the one whose operations run first.
  ["settingMerges", planSettingMerges, "relocate-path"],
];

const applyRank = (kind) => APPLY_ORDER.indexOf(kind);

// Every entry above is well formed and names a kind APPLY_ORDER can rank. An
// unrankable kind sorts to -1, which is silently FIRST, so the single mistake this
// catches is the one that would otherwise reproduce the exact failure the declaration
// exists to prevent, with no symptom but a false decline.
//
// Safe on import, which this module's contract requires: it reads two module
// constants and nothing else. No disk, no git, no scope, no await. It throws only for
// a registry that cannot be ordered at all, which is a broken build rather than a
// state any /migrate run can reach, and failing at import is the loudest available way
// to say so before a plan is built on it. Exported separately from the load-time call
// below so the suite can drive it with a deliberately malformed registry.
export function assertScopedPlannerDeclarations(entries = SCOPED_PLANNERS) {
  for (const entry of list(entries)) {
    const [key, planner, kind] = list(entry);
    if (!key || typeof planner !== "function" || applyRank(kind) < 0) {
      throw new Error(
        `SCOPED_PLANNERS entry ${JSON.stringify(key === undefined ? null : key)} is malformed. Each entry is ` +
          "[scopeKey, plannerFunction, governingKind], where the governing kind is the lowest-ranked kind the " +
          `planner emits and APPLY_ORDER ranks it. Got ${JSON.stringify(kind === undefined ? null : kind)}.`
      );
    }
  }
  return list(entries);
}
assertScopedPlannerDeclarations();

// The order the planners RUN in: ascending declared rank, read at runtime, rather
// than the order someone typed them in.
//
// Ties keep source order, because Array.prototype.sort is stable, and a tie is sound
// either way round: two planners declaring one kind emit operations of one rank, and
// same-rank operations run in the order they were produced, so whichever planner runs
// first is also the one whose operations run first. Each therefore sees exactly the
// operations that precede its own, which is what precedingOperations claims.
//
// Copies before sorting: sorting SCOPED_PLANNERS in place would be a module-level
// mutation, and the suite permutes that array deliberately to prove the permutation
// changes nothing.
export function scopedPlannerSequence(entries = SCOPED_PLANNERS) {
  return [...list(entries)].sort((a, b) => applyRank(list(a)[2]) - applyRank(list(b)[2]));
}

// The id every operation one scope entry emits carries; see groupsOf for what
// applyPlan does with it. It names the scope key and the entry's own position
// inside it, so a DM reading a skip report knows which entry to look at, and two
// entries naming the SAME folder stay distinct from each other.
const groupIdFor = (key, index) => `${key}[${index}]`;

// Every operation ALREADY in the plan that runs before one of `kind` will.
//
// `ctx.planned` is the live accumulating list buildScopedPlan shares with each
// planner, so it holds everything the planners before this one produced; `pending`
// is the calling planner's own list so far. Both are needed, because a scope entry
// can depend on an earlier entry under the SAME key as well as under an earlier one.
//
// Ranked by APPLY_ORDER, which is the order buildScopedPlan sorts the finished plan
// into, and <= rather than < on purpose: that sort is stable and applyPlan applies in
// plan-array order, so two operations of one rank run in the order they were produced,
// which means a same-rank operation already in these lists is an EARLIER scope entry
// and does run first. Anything ranked higher runs later and must not count, which is
// what keeps the absorb rebuilds (rank 9) already in the list from being read as
// preceding a split (rank 3).
//
// COMPLETENESS, which is the whole value of this list, rests on the two halves of the
// SCOPED_PLANNERS contract and on nothing about source position. Take any operation o
// in the finished plan with rank(o) <= rank(kind). The planner Q that emitted it
// declared a governing rank no higher than rank(o) (the emit-side half), and the
// planner P asking here declared one no lower than rank(kind) (the check-side half),
// so rank(Q) <= rank(o) <= rank(kind) <= rank(P). Three cases, and each one lands:
//
//   rank(Q) < rank(P)   Q ran earlier, so o is in ctx.planned.
//   Q is P              o is in `pending`, unless it belongs to a LATER item of P, in
//                       which case it runs after the operation being checked and is
//                       correctly absent. No planner pushes its own item's operations
//                       before checking them, so a check never sees its own.
//   rank(Q) == rank(P), Q ran either before P, so o is in ctx.planned and does run
//   Q is not P          first, or after P, in which case o runs after P's operations
//                       and is correctly absent.
//
// The last two cases are the ones the <= above is for; both come out right for the
// same stability reason.
function precedingOperations(ctx, kind, pending) {
  const limit = APPLY_ORDER.indexOf(kind);
  // The check-side half of the contract, asserted where it is actually relied on and
  // against the kind actually asked about. A planner asking about a rank ABOVE its own
  // declared one is asking a question this list cannot answer: the planners that emit
  // those ranks have not run yet, so the answer comes back "nothing is there" for a
  // path a later operation puts in place, which is the false typo decline in its
  // original form. Silent when ctx carries no running planner, which is the
  // undetermined case rather than a violation: buildScopedPlan sets it for every
  // planner it calls, and a direct call from a test has no position to check against.
  if (ctx && typeof ctx.plannerRank === "number" && limit > ctx.plannerRank) {
    throw new Error(
      `The ${ctx.plannerKey} planner asked about operations preceding ${JSON.stringify(kind)} ` +
        `(rank ${limit}), but it is declared in SCOPED_PLANNERS at rank ${ctx.plannerRank}, so the planners ` +
        "that emit the ranks between the two have not run yet and this answer would be incomplete. Either ask " +
        "with a kind at or below the declared one, or declare the planner at the rank it reasons about."
    );
  }
  return [...list(ctx && ctx.planned), ...list(pending)]
    .filter((o) => o && typeof o === "object" && APPLY_ORDER.indexOf(o.op) <= limit)
    .sort((a, b) => APPLY_ORDER.indexOf(a.op) - APPLY_ORDER.indexOf(b.op));
}

// Whether an operation puts something at a path without moving it there from
// somewhere else, so there is no earlier path to ask the disk about. Returns what
// kind of thing it makes, because the callers below care: a bucket folder is a
// directory and a fresh index is a file.
function planCreatesOutright(o, target) {
  if (o.op === "create-index" && toPosix(o.to) === target) return "file";
  for (const b of list(o.buckets)) {
    if (b && typeof b === "object" && toPosix(b.folder) === target) return "directory";
  }
  return null;
}

// The path an operation moves TO `target`, or null when it puts nothing there.
//
// The prefix branch is what makes a directory move count: `git mv` on a folder
// carries every path beneath it, so a rebuild naming an index inside the moved
// folder is naming a file that exists today under the old prefix.
//
// A parent directory an operation IMPLIES is deliberately not counted. Moving a
// file to settings/rolara/notes/A.md does create settings/rolara/notes on the way,
// but reading that as "the folder will be there" would license a split into a folder
// whose only content is a file the same plan is putting there, and two operations
// targeting one path is findDestinationCollisions' question, which it already
// answers with a refusal naming both.
function planMovedOnto(o, target) {
  for (const a of articleMovesOf(o)) {
    if (a.to && toPosix(a.to) === target) return toPosix(a.from);
  }
  // absorb-folder carries a from and a to and never moves that pair as a unit: it
  // moves each enumerated file, which the loop above already covered. Same
  // exclusion, for the same reason, as destinationEntriesOf.
  if (o.op === "absorb-folder" || !o.from || !o.to) return null;
  const from = toPosix(o.from);
  const to = toPosix(o.to);
  if (target === to) return from;
  if (target.startsWith(`${to}/`)) return `${from}${target.slice(to.length)}`;
  return null;
}

// Whether an operation takes whatever is at `target` AWAY, leaving the path empty.
//
// The frees half of the model, and the same rule findDestinationCollisions' `vacated`
// applies: only an operation carrying BOTH a from and a to vacates anything, because
// an in-place edit carries a from and no to exactly to say it leaves the file where it
// is. So split-folder, which carries `from: folder` and no `to`, does not vacate its
// own folder, which is correct: the folder survives the split and now holds the
// buckets. absorb-folder's folder-level pair is excluded for the same reason it is
// excluded from destinationEntriesOf and from planMovedOnto: it never moves that pair
// as a unit, it moves each enumerated file, which the loop below covers.
//
// The prefix branch mirrors planMovedOnto's, and for the same mechanical reason: `git
// mv` on a folder takes every path beneath it away. The per-file loop matches exactly
// rather than by prefix, symmetrically with planMovedOnto, so a bucket article that is
// itself a directory is not credited with freeing the paths inside it.
function planVacates(o, target) {
  for (const a of articleMovesOf(o)) {
    if (a.from && a.to && toPosix(a.from) === target) return true;
  }
  if (o.op === "absorb-folder" || !o.from || !o.to) return false;
  const from = toPosix(o.from);
  return target === from || target.startsWith(`${from}/`);
}

// Where a path a scope names will have come FROM by the time the operation naming
// it runs: `{path}` to ask the disk about, `{creates}` when an earlier operation in
// the same plan makes it out of nothing, or `{vacated}` when one takes away whatever
// is there now and nothing puts anything back.
//
// existsSync alone reasons about the tree as it is, not as it will be when the
// operation runs, and APPLY_ORDER is a dependency order, so a scope combining a
// pathMoves entry with a rebuildIndexes or splitFolders entry that names a path
// AFTER the move is legitimate. Measured with the raw question: that scope was
// declined with "No index exists at settings/rolara/notes/Misc-INDEX.md ... Check
// that path for a typo", for an index the relocate-path creates eight ranks earlier,
// and the remedy that message implies is editing a scope which was already correct.
//
// BOTH DIRECTIONS, because the callers ask in both. findDestinationCollisions' own
// plan-aware half asks which paths an operation FREES before a later one writes them;
// the fills half here asks which paths an operation puts something at before a later
// one reads them. Modelling fills alone was measurably wrong in the other direction:
// namedPathPresent is the one check that wants a path ABSENT, and with frees unmodelled
// it refused a bucket name an earlier operation vacates. Reachable, and a false refusal
// the fills half introduced: `pathMoves [{A -> B}, {B/x -> D}]` plus `splitFolders
// {folder: B, buckets: [{name: x}]}` had the rewind map B/x back to A/x, which exists,
// and declined the entry with "That subfolder already exists" about a path that will be
// free by the time the rank-3 split runs. See planVacates.
//
// NEITHER DIRECTION MODELS THE SKIP, and that is a limit rather than an oversight.
// findDestinationCollisions withholds vacate credit from an operation whose source is
// git-ignored, because the apply phase will skip it and the source will never move;
// this function cannot ask that question at all, since prechecks.ignored is computed
// from the finished plan, after every planner has run. So a path freed only by an
// operation that turns out to be skipped reads as free here, and a path filled only by
// one that turns out to be skipped reads as filled. What each costs is not symmetric.
// In the present direction the answer is a decline, which is a plan nobody applies. In
// the absent direction a bucket folder left in place by a skipped move is planned into,
// and the collision half catches that only if one of the names moving in is already
// inside it. Reaching it takes a git-ignored source at the exact path a bucket names,
// which is why this is disclosed rather than guarded: the input that would settle it
// does not exist yet at plan time.
//
// REWINDING rather than collecting the set of paths the plan will have created,
// because the two differ exactly where the check earns its keep. A directory move
// creates every path beneath its destination, so a set would have to hold either the
// prefix alone, which misses the index inside the moved folder, or the prefix and
// anything under it, which accepts Msic-INDEX.md and is the typo the check exists to
// name. Mapping the named path back through the move and asking the disk about ITS
// pre-move path finds the real file and still declines the typo.
//
// Walked in reverse rank order so a chain rewinds: misc -> notes in one entry and
// notes/Odds.md -> somewhere else in another leaves each path resolving to where it
// sits today.
//
// That direction is also what makes the frees answer right without a second pass. A
// free is only the final word if no LATER operation put something back, and by the time
// the walk reaches an operation, every later one has already been considered: had one
// filled this path, the target would have been rewound to a different path and this
// operation would no longer be asked about it. So a free found here is a path that is
// still empty when the checked operation runs. For the same reason a fill wins over a
// free within one operation and the walk moves on rather than asking: what the path
// holds after the operation is what was moved onto it. No operation shape can do both
// to one path anyway, since a from and a to are never equal and the per-file lists of
// an absorb or a split draw their sources and destinations from different folders.
function planResolve(ctx, rel, kind, pending) {
  let target = toPosix(rel);
  const preceding = precedingOperations(ctx, kind, pending);
  for (let i = preceding.length - 1; i >= 0; i--) {
    const creates = planCreatesOutright(preceding[i], target);
    if (creates) return { creates };
    const moved = planMovedOnto(preceding[i], target);
    if (moved) {
      target = moved;
      continue;
    }
    if (planVacates(preceding[i], target)) return { vacated: true };
  }
  return { path: target };
}

// Whether the thing a scope named will be there, and be the KIND of thing the
// operation needs. `wants` is "file", "directory", or "any".
//
// This is the plan phase's own stated posture, twice over: the prechecks run
// before the plan is shown rather than after, and a plan that cannot execute is
// worse than no plan. The scoped planners did not honour it. No planner checked
// any per-article path, so a DM typo in a filename passed every precheck, produced
// a clean-looking proposal, and then half-applied the operation before failing on
// the missing file, with the paired index operations running on top of the
// half-applied tree.
//
// The KIND matters and existence does not answer it: rebuild-index edits an index
// FILE's link list in place and lists a FOLDER's contents, so a directory at the one
// path or a file at the other passed an existsSync check and still reached
// applyRebuildIndex after the snapshot. statSync answers both questions in one
// read-only call. "any" is for the two paths where either kind is legitimate: a
// relocate-path source can be a file or a whole folder, and a bucket article that is
// a directory still moves correctly through `git mv`.
function namedPathSatisfies(ctx, rel, kind, pending, wants) {
  const at = planResolve(ctx, rel, kind, pending);
  // Nothing of any kind is there, so no `wants` is satisfied, and every caller reads
  // that correctly: the absent-direction check plans the bucket whose name is now free,
  // and the three present-direction ones decline a path an earlier operation carried
  // away rather than planning an operation that fails after the snapshot.
  if (at.vacated) return false;
  if (at.creates) return wants === "any" || at.creates === wants;
  let st;
  try {
    st = statSync(path.resolve(ctx.projectRoot, at.path));
  } catch {
    return false;
  }
  if (wants === "file") return st.isFile();
  if (wants === "directory") return st.isDirectory();
  return true;
}

// UNDETERMINED IS NOT MISSING. With no usable project root these answer false and
// the planner plans, which is the same guard findDestinationCollisions puts on its
// own on-disk half: re-running a planner against a bare scope with no root on disk
// cannot answer the question, and answering "missing" there would decline every
// legitimate scope.
const namedPathMissing = (ctx, rel, kind, pending) =>
  Boolean(ctx.rootUsable) && Boolean(rel) && !namedPathSatisfies(ctx, rel, kind, pending, "any");
const namedPathNotAFile = (ctx, rel, kind, pending) =>
  Boolean(ctx.rootUsable) && Boolean(rel) && !namedPathSatisfies(ctx, rel, kind, pending, "file");
const namedPathNotAFolder = (ctx, rel, kind, pending) =>
  Boolean(ctx.rootUsable) && Boolean(rel) && !namedPathSatisfies(ctx, rel, kind, pending, "directory");

// The other direction, for the one check that wants a path to be ABSENT: a
// bucket folder a split is about to create. Not the negation of the predicates
// above, because all of them answer false when the root is unusable, which is the
// undetermined verdict rather than either yes or no. It also routes the raw
// path.resolve through the same guard: with no projectRoot that call throws a
// TypeError, and the planner has no business crashing on a scope it could simply
// decline to check. Plan-aware in both directions: a bucket folder an earlier
// operation moves something onto is occupied by the time the split runs, and one an
// earlier operation carries away is free by then, whatever the disk says now.
const namedPathPresent = (ctx, rel, kind, pending) =>
  Boolean(ctx.rootUsable) && Boolean(rel) && namedPathSatisfies(ctx, rel, kind, pending, "any");

/**
 * @param {{projectRoot: string, settings: Array, baseRules: object, scope: object}} input
 * @returns {{operations: Array, declined: Array, prechecks: object}}
 */
export function buildScopedPlan({ projectRoot, settings, baseRules, scope }) {
  const operations = [];
  const declined = [];
  const ctx = {
    projectRoot,
    settings: list(settings),
    baseRules,
    scope: scope || {},
    // Decided once for the whole plan: whether the on-disk existence checks can
    // be answered at all. See namedPathMissing.
    rootUsable: Boolean(projectRoot) && existsSync(projectRoot),
    // The SAME array as `operations` above, deliberately shared rather than copied
    // per planner: each planner's existence checks have to see what the planners
    // before it produced, because an operation earlier in the plan can be what puts
    // a later operation's path there. See precedingOperations. Read-only from the
    // planners' side; only the push below adds to it.
    planned: operations,
  };

  // In declared rank order, NOT in the order the entries are written. See
  // SCOPED_PLANNERS for why the order is load-bearing and scopedPlannerSequence for
  // how it is derived.
  //
  // The scope KEY is handed to the planner as well as its items, because every
  // operation an entry emits is stamped with an id built from that key and the
  // entry's index. See groupIdFor and groupsOf.
  for (const [key, planner, kind] of scopedPlannerSequence()) {
    const items = list(ctx.scope[key]);
    if (items.length === 0) continue;
    // The running planner's declared position, so precedingOperations can check the
    // check-side half of the contract at the moment of the check. On ctx rather than a
    // fifth argument threaded through five predicates, because every one of them
    // already carries ctx and none of them should have to grow a parameter to reach a
    // fact about which planner is running.
    ctx.plannerKey = key;
    ctx.plannerRank = applyRank(kind);
    const out = planner(items, ctx, key);
    const emitted = list(out.operations);
    // The emit-side half, verified against what the planner ACTUALLY emitted rather
    // than trusted from its declaration. A declaration that disagrees with the kinds
    // its planner emits is the same hazard as a mis-ordered array: an operation ranked
    // BELOW where this planner ran was produced after every planner that could have
    // needed to see it, and there is no symptom, because the sort below still hands
    // applyPlan a plan in dependency order. The only trace is the checks that already
    // ran against a list this operation was missing from.
    for (const o of emitted) {
      if (o && typeof o === "object" && applyRank(o.op) < ctx.plannerRank) {
        throw new Error(
          `The ${key} planner emitted a ${JSON.stringify(o.op)} operation (rank ${applyRank(o.op)}), but it is ` +
            `declared in SCOPED_PLANNERS as ${JSON.stringify(kind)} (rank ${ctx.plannerRank}). A planner runs at its ` +
            "declared rank, so every planner that reasons about the lower rank has already run and cannot see this " +
            "operation. Declare the planner as the LOWEST-ranked kind it emits."
        );
      }
    }
    operations.push(...emitted);
    declined.push(...list(out.declined));
  }

  // The result is sorted into APPLY_ORDER rather than trusted to arrive that way,
  // because a planner emits several kinds: absorbFolders runs at rank 2 and produces a
  // rank-9 rebuild, splitFolders runs at rank 3 and produces a rank-7 create-index, so
  // the accumulated list is in no single order even when every planner ran in the right
  // place. Without this, applyPlan would refuse the plan with a message about
  // dependency order that would read as a bug in the DM's scope.
  operations.sort((a, b) => APPLY_ORDER.indexOf(a.op) - APPLY_ORDER.indexOf(b.op));

  // An ignored source is outside the snapshot, so moving it is unrecoverable, and
  // the apply half skips it by contract. Declining it HERE is what puts it in the
  // proposal the DM reads and approves, rather than in a skipped list they see only
  // after the run, and the decline carries the one action that makes the file
  // movable: un-ignore it and commit, which puts it in the snapshot.
  //
  // The prechecks that SHIP with the plan are computed against what survived. A
  // plan whose prechecks name an operation it no longer carries is describing work
  // nobody can approve, and findDestinationCollisions would go on ranking
  // destinations against an operation that will never run.
  const prechecks = runPrechecks({ operations, projectRoot });
  const ignoredDeclines = declineIgnoredSources(operations, prechecks.ignored);
  if (ignoredDeclines.declined.length === 0) return { operations, declined, prechecks };
  declined.push(...ignoredDeclines.declined);
  const kept = ignoredDeclines.kept;
  return { operations: kept, declined, prechecks: runPrechecks({ operations: kept, projectRoot }) };
}

// The operations a scoped plan drops for a git-ignored source, and the declined
// items that put them in front of the DM.
//
// ON THE SAME UNIT THE APPLY HALF SKIPS ON, through the same ignoredSkipDecision,
// which is where that unit is defined and argued. Dropping only the operation that
// names the ignored file and leaving its group siblings in the plan would move the
// measured defect recorded at groupsOf from the apply half into this one, one phase
// earlier and with the siblings still running.
//
// ONE DECLINED ITEM PER OPERATION, sharing one reason per scope entry. `declined`
// is a flat list of {op, target, reason} that the proposal renders row by row, so a
// grouped item would need a shape it does not have; the shared reason is what keeps
// a sibling naming no ignored source of its own from reading as an unexplained
// refusal.
//
// `ignored` is Array OR null, and null means the question could not be answered,
// which is not the same as nothing being ignored. On null NOTHING is declined: the
// conservative move here is to leave the plan whole and let applyPlan's own
// ignored-undetermined refusal stop the run, because declining every operation on
// an unanswered question would refuse the whole scope for a missing repository.
function declineIgnoredSources(operations, ignored) {
  const ops = list(operations);
  if (!Array.isArray(ignored) || ignored.length === 0) return { kept: ops, declined: [] };
  const skips = ignoredSkipDecision(ops, ignored);

  const items = new Map();
  const dropped = new Set();
  for (const op of ops) {
    const skip = skips.skipOf(op);
    if (!skip) continue;
    dropped.add(op);
    if (!items.has(skip.key)) items.set(skip.key, { group: skip.group, ops: [], ignored: [] });
    const item = items.get(skip.key);
    item.ops.push(op);
    for (const s of skips.ignoredOf(op)) if (!item.ignored.includes(s)) item.ignored.push(s);
  }
  if (dropped.size === 0) return { kept: ops, declined: [] };

  // The multi-group cost, disclosed HERE because this is now the only place it can
  // be. An operation belonging to both a declined entry and one that survives is
  // KEPT, on the asymmetry argued at groupsOf, and applyPlan carries a note saying
  // so. That note can no longer fire for a scoped plan: the operations it would
  // name against are declined here and never reach the apply half at all, so the
  // ONLY operation left carrying the group is the one that ran, and the run has
  // nothing to compare it with. Without this the DM is told the folder was left
  // where it is and nothing else, while the shared rebuild quietly unlinks it.
  const survivingShared = ops.filter(
    (o) => !dropped.has(o) && groupsOf(o).some((g) => skips.skippedGroups.has(g))
  );

  const declined = [];
  for (const item of items.values()) {
    const named = item.ops.map((o) => `${o.op} ${o.from || o.to || "(unnamed)"}`).join(", ");
    let reason =
      `${item.ignored.join(", ")} is git-ignored, so the pre-migration snapshot does not contain it and moving it ` +
      "could not be undone. Un-ignore it in .gitignore and commit, which puts it in the snapshot, then re-run " +
      "/migrate with the same scope.";
    if (item.ops.length > 1) {
      reason +=
        ` All ${item.ops.length} operations from scope entry ${item.group === null ? "(no group id)" : item.group} are ` +
        "declined together, because applying the rest would leave the project matching neither its old shape nor the " +
        `one that was approved: ${named}.`;
    }
    const shared =
      item.group === null ? [] : survivingShared.filter((o) => groupsOf(o).includes(item.group));
    if (shared.length > 0) {
      reason +=
        ` ${shared.length} operation(s) this entry shares with another entry still run rather than being declined with ` +
        "it, because the entry sharing them is going ahead and dropping them would leave THAT entry holding a dead " +
        `wikilink: ${shared.map((o) => `${o.op} ${o.to || o.from || "(unnamed)"}`).join(", ")}.`;
      if (shared.some((o) => o.op === "rebuild-index")) {
        reason +=
          " An index is rebuilt from what its folder holds at the time, so the folder this entry names stays on disk" +
          " and is no longer linked from that index. Re-run this entry once its git-ignored file is dealt with, or add" +
          " the link back by hand.";
      }
    }
    for (const op of item.ops) {
      declined.push({ op: op.op, target: op.from || op.to || "(unnamed)", reason });
    }
  }
  return { kept: ops.filter((o) => !dropped.has(o)), declined };
}

function planPathMoves(items, ctx, key) {
  const operations = [];
  const declined = [];
  for (const [i, item] of items.entries()) {
    const from = toPosix(item && item.from);
    const to = toPosix(item && item.to);
    if (!from || !to) {
      declined.push({
        op: "relocate-path",
        target: from || to || "(unnamed)",
        reason: "The scope entry is missing a source or a destination, so there is nothing to move.",
      });
      continue;
    }
    if (from === to) {
      declined.push({
        op: "relocate-path",
        target: from,
        reason: "Source and destination are the same path.",
      });
      continue;
    }
    // The source is a path the DM typed, and this planner never enumerates it, so
    // nothing else proves it is there. `to` is deliberately NOT checked: a
    // destination that already exists is findDestinationCollisions's question, and
    // the answer there is the opposite one.
    //
    // `operations` is handed over so an entry whose source an EARLIER entry moves
    // into place is not read as a typo. Same-kind operations run in the order this
    // loop emits them, so entry 2 may depend on entry 1 and never the reverse.
    if (namedPathMissing(ctx, from, "relocate-path", operations)) {
      declined.push({
        op: "relocate-path",
        target: from,
        reason: `Nothing exists at ${from}, so there is nothing to move. Check that path for a typo: a scope naming a file that is not there plans cleanly and then fails after the snapshot.`,
      });
      continue;
    }
    operations.push({
      op: "relocate-path",
      from,
      to,
      groups: [groupIdFor(key, i)],
      reason: String((item && item.reason) || "Moved by a DM-approved /migrate scope."),
    });
  }
  return { operations, declined };
}

function planRebuildIndexes(items, ctx, key) {
  const operations = [];
  const declined = [];
  for (const [i, item] of items.entries()) {
    const index = toPosix(item && item.index);
    if (!index) {
      declined.push({
        op: "rebuild-index",
        target: "(unnamed)",
        reason: "The scope entry names no index file.",
      });
      continue;
    }
    // rebuild-index is in DESTINATION_MAY_EXIST precisely because its `to` is
    // supposed to be there already, which means the collision half never looks at
    // it and a typo here reaches applyRebuildIndex, after the snapshot. This is
    // the one planner whose named path has to exist rather than not.
    //
    // A FILE rather than merely a path: this executor edits an existing index's link
    // list in place, so a directory sitting at that path cannot execute either, and
    // existsSync answered yes for it. Both checks are handed the plan so far, because
    // an earlier entry can be what puts the index and its folder where this entry
    // names them; the rebuild kind ranks last of the four, so every operation a
    // scoped plan can already hold does run before it.
    if (namedPathNotAFile(ctx, index, "rebuild-index", operations)) {
      declined.push({
        op: "rebuild-index",
        target: index,
        reason: `No index file exists at ${index}. rebuild-index edits an existing index's link list in place and create-index is the operation that creates one, so this cannot execute as written. Check that path for a typo.`,
      });
      continue;
    }
    const folder = toPosix(item.folder) || path.posix.dirname(index);
    if (namedPathNotAFolder(ctx, folder, "rebuild-index", operations)) {
      declined.push({
        op: "rebuild-index",
        target: index,
        reason: `The folder to rebuild the list from, ${folder}, is not a folder that is there to be read, so there is nothing to list.`,
      });
      continue;
    }
    operations.push({
      op: "rebuild-index",
      to: index,
      folder,
      groups: [groupIdFor(key, i)],
      reason: String((item && item.reason) || "Rebuilt by a DM-approved /migrate scope."),
    });
  }
  return { operations, declined };
}

// Every prong root of every setting, plus every campaign folder, as a Set of
// posix paths. These are the folders absorb and split may never touch: a prong
// root holds a whole knowledge base, and a campaign folder is a lane boundary
// /log commits against.
function protectedFolders(settings) {
  const out = new Set();
  for (const setting of list(settings)) {
    for (const root of prongRootsOf(setting)) {
      if (root) out.add(toPosix(root));
    }
    for (const campaign of list(setting && setting.campaigns)) {
      const name = typeof campaign === "string" ? campaign : campaign && campaign.name;
      const reports = toPosix(setting && setting.sessionReportsRoot);
      if (name && reports) out.add(`${reports}/${name}`);
    }
  }
  return out;
}

// Every file this planner names comes out of readdirSync plus statSync, so the
// enumeration itself is the proof that those files exist and namedPathMissing has
// nothing to add per file: a redundant existsSync on each would be noise.
//
// THE FOLDER IS A DIFFERENT QUESTION, and the enumeration proves nothing about it.
// It is the one path the DM supplies, and reading it off the raw disk was the last
// place in the plan half that reasoned about the tree as it is rather than as the
// plan will leave it. absorb-folder ranks 2 and pathMoves ranks 1, so a pathMoves
// entry in the same scope runs first and both directions went wrong. Measured:
//
//   FALSE DECLINE. pathMoves misc to notes/misc plus absorbFolders notes/misc was
//   declined with a raw "Could not read the folder: ENOENT ... scandir", for a
//   folder the same plan puts there eight ranks earlier, and the remedy that
//   message implies is editing a scope that was already correct.
//
//   A PLAN THAT CANNOT EXECUTE. The same pathMoves plus absorbFolders naming the
//   PRE-move path planned three operations with prechecks.ok true, which
//   findDestinationCollisions cannot see (the move vacates the folder while the
//   absorb's entries name files inside it, a different fold key), and then failed
//   after the snapshot on "git mv ... fatal: bad source".
//
// So the folder goes through planResolve, exactly as every other scoped planner's
// named paths do, and the readdirSync asks about the path the folder's contents
// actually sit at TODAY. The operation still names the post-plan path, because that
// is where the folder will be when rank 2 runs.
function planAbsorbFolders(items, ctx, key) {
  const operations = [];
  const declined = [];
  const protectedSet = protectedFolders(ctx.settings);
  // Parent index path -> the folders absorbed into it. A Map rather than an
  // emission inside the loop, because two absorbs sharing a parent would
  // otherwise append the same rebuild-index twice from two perfectly valid
  // scope entries, and two operations with one destination is an in-plan
  // collision that refuses the whole run. Keyed by `to`, which is the field
  // findDestinationCollisions compares. Collecting the folders as well as
  // deduping the path keeps the surviving operation's reason truthful: it names
  // every folder that made the rebuild necessary, not just the first.
  //
  // It also collects the GROUPS, because a rebuild two entries share belongs to
  // both of them; see groupsOf for why that decides when applyPlan skips it.
  const rebuilds = new Map();

  for (const [i, item] of items.entries()) {
    const group = groupIdFor(key, i);
    const folder = toPosix(item && item.folder);
    if (!folder) {
      declined.push({ op: "absorb-folder", target: "(unnamed)", reason: "The scope entry names no folder." });
      continue;
    }
    if (protectedSet.has(folder)) {
      declined.push({
        op: "absorb-folder",
        target: folder,
        reason:
          "This is a prong root or a campaign folder. Dissolving it would move a whole knowledge base, homebrew catalog, or campaign into whatever sits above it, so it is permanently exempt rather than a judgment call.",
      });
      continue;
    }

    // Where this folder's contents sit at the moment the enumeration runs, which
    // is not the path the operation will name if an earlier entry moves it there.
    const at = planResolve(ctx, folder, "absorb-folder", operations);
    if (at.vacated) {
      declined.push({
        op: "absorb-folder",
        target: folder,
        reason: `An earlier operation in this same plan carries ${folder} away, so nothing is there to dissolve by the time this one would run. Absorb the folder at the path it ends up at, or drop the move.`,
      });
      continue;
    }
    if (at.creates) {
      declined.push({
        op: "absorb-folder",
        target: folder,
        reason: `${folder} is created by this same plan rather than moved into place, so it holds nothing to dissolve and there is no folder on disk to enumerate.`,
      });
      continue;
    }
    const abs = path.resolve(ctx.projectRoot, at.path);
    let names;
    try {
      names = readdirSync(abs).sort();
    } catch (err) {
      declined.push({
        op: "absorb-folder",
        target: folder,
        reason:
          `Could not read the folder: ${err.message}` +
          (at.path === folder ? "" : ` (read at ${at.path}, where an earlier operation in this plan moves it from)`),
      });
      continue;
    }

    const suffix = indexSuffixFor(settingForFolder(ctx.settings, folder), ctx.baseRules);
    const parent = path.posix.dirname(folder);
    // EVERY file moves, markdown and otherwise, and every one is enumerated so
    // it appears in the proposal the DM approves. Enumerating only the markdown
    // left the rest stranded: measured, a folder holding Odds.md, Map.png, and
    // notes.txt planned one absorb naming Odds.md alone, and applying it left
    // the folder holding two orphaned files and no index, which the validation
    // sweep then flags as content with no index on every later run. It also
    // contradicted the proposal contract, which is that the DM approves a
    // proposal naming every file the operation moves.
    //
    // Moving them keeps an image beside the article that embeds it, and does not
    // break the embed: Obsidian resolves ![[Map.png]] by filename, so a move
    // within one vault leaves it resolving.
    const files = [];
    let index = null;
    let hasSubfolder = false;
    for (const name of names) {
      let st;
      try {
        st = statSync(path.join(abs, name));
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        hasSubfolder = true;
        continue;
      }
      // The folder's own index is the one file removed rather than moved, and it
      // is identified exactly as before: a markdown file whose stem ends with
      // the owning setting's index suffix.
      if (name.toLowerCase().endsWith(".md") && suffix && name.slice(0, -3).endsWith(suffix)) {
        index = `${folder}/${name}`;
        continue;
      }
      files.push({ from: `${folder}/${name}`, to: `${parent}/${name}` });
    }

    if (hasSubfolder) {
      declined.push({
        op: "absorb-folder",
        target: folder,
        reason:
          "Only a leaf folder is absorbed. This one holds a subfolder, and where that subfolder's contents belong is a separate judgment rather than something dissolving the parent answers.",
      });
      continue;
    }

    operations.push({
      op: "absorb-folder",
      from: folder,
      to: parent,
      // `articles` is the field name the operation shape declares, and it now
      // carries every file rather than only the markdown ones. Kept as the name
      // because it is what the plan, the proposal, and destinationEntriesOf all
      // read; the executor's own messages say "file" so the DM is not told an
      // image is an article.
      articles: files,
      index,
      groups: [group],
      reason: String((item && item.reason) || "Absorbed by a DM-approved /migrate scope."),
    });

    // The parent index still lists the dissolved folder's index. rebuild-index
    // lists articles only, so rebuilding the parent is what clears that link.
    const parentIndex = existingIndexIn(ctx, parent, suffix, "absorb-folder", operations);
    if (parentIndex) {
      if (!rebuilds.has(parentIndex)) rebuilds.set(parentIndex, { folder: parent, absorbed: [], groups: [] });
      rebuilds.get(parentIndex).absorbed.push(folder);
      rebuilds.get(parentIndex).groups.push(group);
    }
  }

  for (const [to, { folder, absorbed, groups }] of rebuilds) {
    operations.push({
      op: "rebuild-index",
      to,
      folder,
      groups,
      reason:
        `Rebuilt because ${absorbed.join(", ")} ${absorbed.length === 1 ? "was" : "were"} absorbed into it.`,
    });
  }
  return { operations, declined };
}

// Title Case for a bucket's index stem: "north" becomes "North-INDEX".
const indexStemFor = (name, suffix) =>
  `${String(name).charAt(0).toUpperCase()}${String(name).slice(1)}${suffix}`;

// Divide a folder into DM-named buckets.
//
// The partition arrives in the scope as explicit buckets and is never derived
// here. Crossing the split threshold says a folder should divide and says
// nothing about how to partition it, which is why setup defers `split`
// permanently; the judgment is the DM's, and by the time it reaches this
// planner it has already been made.
//
// The bucket is the unit the DM approved, so it survives into the operation
// rather than being flattened into one article list: which article goes where is
// the whole content of the decision. destinationEntriesOf, findIgnoredSources,
// and applyPlan's skip list all read those nested articles through
// articleMovesOf, so a bucket's per-file destinations and sources are checked on
// exactly the same terms as absorb-folder's flat ones.
function planSplitFolders(items, ctx, key) {
  const operations = [];
  const declined = [];
  const protectedSet = protectedFolders(ctx.settings);
  // Source path -> the bucket folder that claimed it, across EVERY scope entry
  // rather than within one. An article has one home, and a per-entry ledger let
  // that rail be defeated by writing the same folder twice: measured, two
  // entries each claiming Ashfall.md planned two moves of one file with the
  // prechecks reporting ok, and applying it moved the file into the first bucket
  // and then failed the second split outright, which is the half-applied
  // partition the one-entry-per-split accounting exists to prevent.
  const claimed = new Map();
  // Split folder's own index path -> the rebuild of it, deduped across entries
  // exactly as planAbsorbFolders dedupes its parent rebuild and for the same
  // reason: two entries naming one folder emitted the same rebuild-index twice,
  // which is an in-plan collision by the generic rule, so the run refused with a
  // message about an index path rather than about the scope the DM wrote. One
  // entry per folder is the ordinary case for a split, which is why this arrived
  // later here than there.
  const rebuilds = new Map();

  for (const [i, item] of items.entries()) {
    const group = groupIdFor(key, i);
    const folder = toPosix(item && item.folder);
    if (!folder) {
      declined.push({ op: "split-folder", target: "(unnamed)", reason: "The scope entry names no folder." });
      continue;
    }
    if (protectedSet.has(folder)) {
      declined.push({
        op: "split-folder",
        target: folder,
        reason:
          "This is a prong root or a campaign folder. Splitting it would divide a whole knowledge base, homebrew catalog, or campaign, which is a setting-lifecycle operation rather than a folder split.",
      });
      continue;
    }
    // Checked before the buckets, so a mistyped folder produces one clear decline
    // naming it rather than one decline per article inside it. Handed the plan so
    // far, because a pathMoves entry (rank 1) can be what puts this folder where the
    // split (rank 3) names it.
    if (namedPathMissing(ctx, folder, "split-folder", operations)) {
      declined.push({
        op: "split-folder",
        target: folder,
        reason: `Nothing exists at ${folder}, so there is no folder to divide. Check that path for a typo.`,
      });
      continue;
    }

    const suffix = indexSuffixFor(settingForFolder(ctx.settings, folder), ctx.baseRules);
    const buckets = [];
    // This entry's own claims, staged rather than written straight into the
    // ledger above, so that a REFUSED entry leaves no claim behind. A stale
    // claim from an entry that planned nothing would decline a later entry over
    // a bucket that is not happening.
    const mine = new Map();
    let refused = false;

    for (const bucket of list(item.buckets)) {
      const name = String((bucket && bucket.name) || "").trim();
      if (!name) {
        declined.push({ op: "split-folder", target: folder, reason: "A bucket carries no name." });
        refused = true;
        break;
      }
      const dest = `${folder}/${name}`;
      if (namedPathPresent(ctx, dest, "split-folder", operations)) {
        declined.push({
          op: "split-folder",
          target: dest,
          reason:
            "That subfolder already exists. Moving articles into it would merge the split into an existing folder whose contents the proposal never listed.",
        });
        refused = true;
        break;
      }

      const articles = [];
      for (const raw of list(bucket.articles)) {
        const base = path.posix.basename(toPosix(raw));
        if (!base) continue;
        const source = `${folder}/${base}`;
        const owner = mine.get(source) || claimed.get(source);
        if (owner) {
          declined.push({
            op: "split-folder",
            target: folder,
            // The two-bucket wording is false when `owner` and `dest` are the same
            // string, which is what a bucket listing one article twice produces:
            // the message then read "claimed by two buckets (locations/north and
            // locations/north)" and described a situation that did not happen.
            reason:
              owner === dest
                ? `${base} is claimed twice by the same bucket (${dest}). An article has one home; list it once.`
                : `${base} is claimed by two buckets (${owner} and ${dest}). An article has one home; pick which bucket owns it.`,
          });
          refused = true;
          break;
        }
        // Every article is a path the DM typed and this planner never enumerates
        // the folder, so nothing else proves the file is there. Refusing the whole
        // ENTRY rather than dropping the one article: a typo means the DM meant a
        // file, and quietly planning the partition without it would apply a
        // partition nobody approved. Existence rather than file-ness, because a
        // directory named as a bucket article still moves correctly through `git mv`
        // and declining it would be a new false refusal.
        if (namedPathMissing(ctx, source, "split-folder", operations)) {
          declined.push({
            op: "split-folder",
            target: folder,
            reason: `${source} is not there, so it cannot be moved into ${dest}. Check that name for a typo: a bucket naming a file that is not on disk plans cleanly and then fails partway through the partition, after the snapshot.`,
          });
          refused = true;
          break;
        }
        mine.set(source, dest);
        articles.push({ from: source, to: `${dest}/${base}` });
      }
      if (refused) break;
      buckets.push({ folder: dest, name, articles });
    }
    if (refused) continue;
    if (buckets.length === 0) {
      declined.push({ op: "split-folder", target: folder, reason: "The scope entry carries no buckets." });
      continue;
    }
    for (const [source, dest] of mine) claimed.set(source, dest);

    operations.push({
      op: "split-folder",
      from: folder,
      buckets,
      groups: [group],
      reason: String((item && item.reason) || "Split by a DM-approved /migrate scope."),
    });

    for (const bucket of buckets) {
      operations.push({
        op: "create-index",
        to: `${bucket.folder}/${indexStemFor(bucket.name, suffix)}.md`,
        groups: [group],
        reason: `Created for the ${bucket.name} bucket of the ${folder} split.`,
      });
    }

    const parentIndex = existingIndexIn(ctx, folder, suffix, "split-folder", operations);
    if (parentIndex) {
      if (!rebuilds.has(parentIndex)) rebuilds.set(parentIndex, { folder, bucketCount: 0, groups: [] });
      rebuilds.get(parentIndex).bucketCount += buckets.length;
      rebuilds.get(parentIndex).groups.push(group);
    }
  }

  for (const [to, { folder, bucketCount, groups }] of rebuilds) {
    operations.push({
      op: "rebuild-index",
      to,
      folder,
      groups,
      reason: `Rebuilt because ${folder} was split into ${bucketCount} subfolder(s).`,
    });
  }
  return { operations, declined };
}

// Rename an entity across the knowledge base: its filename, its frontmatter
// `name`, and every wikilink naming it, as ONE operation with one group so that
// all three travel together. The DM negotiated all three halves with the command,
// so the plan carries all three: re-deriving the referrer set at apply time would
// be the apply phase inventing an operation, which is the same rule
// rename-with-link-rewrite's `links` and merge-index's `sourceLinks` already live
// under.
//
// Body prose is not in the operation and not in this planner. See
// applyRenameEntity for why, and for the test that pins it.
//
// The frontmatter name is carried as an explicit null when the scope names
// neither half, rather than as an absent field, because the executor tests for
// null to decide whether it has a value to match on. An entity with no `name` is
// the ordinary case: the base schema does not require the field, and nothing is
// ever inserted.
//
// EVERY path here is one the DM typed and this planner enumerates nothing, so
// nothing else proves any of them exist. Both the article and each referrer are
// checked, and a bad referrer declines the whole ENTRY rather than dropping the one
// path: dropping it would rename the file and leave a wikilink the DM named
// pointing at a filename that is gone, which is the dead link the coupling exists
// to prevent. The checks are handed the plan so far for the usual reason, since
// rename-entity ranks above relocate-path and an earlier entry can be what puts
// either path where this one names it.
function planEntityRenames(items, ctx, key) {
  const operations = [];
  const declined = [];
  for (const [i, item] of items.entries()) {
    const from = toPosix(item && item.file);
    const to = toPosix(item && item.to);
    if (!from || !to) {
      declined.push({
        op: "rename-entity",
        target: from || to || "(unnamed)",
        reason: "The scope entry is missing a source or a destination, so there is nothing to rename.",
      });
      continue;
    }
    if (from === to) {
      declined.push({
        op: "rename-entity",
        target: from,
        reason: "Source and destination are the same path.",
      });
      continue;
    }
    // A FILE rather than merely a path: this executor edits the article's own
    // frontmatter, so a directory sitting there cannot execute either. `to` is
    // deliberately not checked, because a destination that already exists is
    // findDestinationCollisions's question and its answer is the opposite one.
    if (namedPathNotAFile(ctx, from, "rename-entity", operations)) {
      declined.push({
        op: "rename-entity",
        target: from,
        reason: `No file exists at ${from}, so there is no entity to rename. Check that path for a typo: a scope naming a file that is not there plans cleanly and then fails after the snapshot.`,
      });
      continue;
    }
    const links = list(item.links).map(toPosix).filter(Boolean);
    const missing = links.filter((rel) => namedPathNotAFile(ctx, rel, "rename-entity", operations));
    if (missing.length > 0) {
      declined.push({
        op: "rename-entity",
        target: from,
        reason: `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} named as referring file(s) but ${
          missing.length === 1 ? "is" : "are"
        } not there to rewrite. The rename and its wikilink rewrites are one unit of work, so the whole entry is declined rather than the rename planned without them: a rewrite that cannot happen leaves a wikilink naming a filename that is gone, and a dead wikilink is valid markdown that fails silently in Obsidian.`,
      });
      continue;
    }
    operations.push({
      op: "rename-entity",
      from,
      to,
      nameFrom: item.nameFrom == null ? null : String(item.nameFrom),
      nameTo: item.nameTo == null ? null : String(item.nameTo),
      links,
      groups: [groupIdFor(key, i)],
      reason: String((item && item.reason) || "Renamed by a DM-approved /migrate scope."),
    });
  }
  return { operations, declined };
}

// Retype a file's base `type` value and, when the new type requires a filename
// suffix the file does not already carry, rename it to add that suffix. ONE
// scope entry, up to TWO operations per file, because a suffix DERIVES from a
// type: emitting the rename from a second, independent scope entry could let
// it be sequenced ahead of the retype it depends on, and it would then compute
// the suffix from the file's stale type. OPERATION_ORDER puts normalize-type
// ahead of rename-with-link-rewrite for exactly this reason on the setup side;
// emitting both from one entry, in this order, is what keeps a scoped retype
// correct without asking the DM to write two entries in the right sequence.
//
// Governs as normalize-type (rank 4), the LOWER of the two kinds it emits, per
// the rule above SCOPED_PLANNERS: a later planner checking at rank r needs
// every operation ranked at or below r already in the list, so the lowest rank
// this planner emits is the latest position it may run at.
//
// EVERY file an entry names is a path the DM typed, and this planner
// enumerates nothing, so nothing else proves any of them are there. Checked
// before anything is emitted, and a bad path declines the WHOLE entry rather
// than dropping the one file, the same posture planSplitFolders holds for a
// bad bucket article and planEntityRenames holds for a bad referrer: silently
// retyping the rest would apply a narrower change than the one the DM
// approved. The same rule covers a referring file named for a rename this
// entry will also emit: a missing one declines the whole entry rather than
// renaming the file and leaving the wikilink unrewritten.
function planRetypes(items, ctx, key) {
  const operations = [];
  const declined = [];
  for (const [i, item] of items.entries()) {
    const group = groupIdFor(key, i);
    const typeFrom = item && item.typeFrom;
    const typeTo = item && item.typeTo;
    if (typeFrom == null || typeTo == null) {
      declined.push({
        op: "normalize-type",
        target: "(unnamed)",
        reason: "The retype entry is missing typeFrom or typeTo.",
      });
      continue;
    }
    const suffix = typeof item.suffix === "string" ? item.suffix : "";
    // A MAP from file path to referring files, unlike every other planner's
    // flat `links` array, because one retype entry can name several files and
    // each needs its own referrer set for the rename it may trigger. Read per
    // file below and turned into the flat array rename-with-link-rewrite's
    // executor (applyRenameWithLinkRewrite, which reads op.links through
    // list()) actually consumes.
    const linksByFile = (item && item.links) || {};
    const files = list(item.files).map(toPosix).filter(Boolean);
    if (files.length === 0) {
      declined.push({ op: "normalize-type", target: "(unnamed)", reason: "The retype entry names no files." });
      continue;
    }

    // First pass: every file must be there to retype at all. Handed the plan
    // so far, because an earlier entry (in this scope or an earlier-ranked
    // one) can be what puts a file where this one names it.
    let refusal = null;
    for (const file of files) {
      if (namedPathNotAFile(ctx, file, "normalize-type", operations)) {
        refusal = {
          target: file,
          reason: `No file exists at ${file}, so there is nothing to retype. Check that path for a typo: a scope naming a file that is not there plans cleanly and then fails after the snapshot.`,
        };
        break;
      }
    }
    // Second pass: for whichever files will also be renamed, their referrers
    // have to be there too, before anything is emitted.
    if (!refusal && suffix) {
      for (const file of files) {
        const stem = stemOf(file);
        if (stem.endsWith(suffix)) continue;
        const links = list(linksByFile[file] || linksByFile[stem]).map(toPosix).filter(Boolean);
        const badLink = links.find((rel) => namedPathNotAFile(ctx, rel, "normalize-type", operations));
        if (badLink) {
          refusal = {
            target: file,
            reason: `${badLink} is named as a referring file for the rename type ${JSON.stringify(
              typeTo
            )} requires but is not there to rewrite. The retype and its rename are one unit of work, so the whole entry is declined rather than applied without the rewrite.`,
          };
          break;
        }
      }
    }
    if (refusal) {
      declined.push({ op: "normalize-type", target: refusal.target, reason: refusal.reason });
      continue;
    }

    for (const file of files) {
      operations.push({
        op: "normalize-type",
        from: file,
        typeFrom: String(typeFrom),
        typeTo: String(typeTo),
        groups: [group],
        reason: String(
          (item && item.reason) || `Retyped from ${typeFrom} to ${typeTo} by a DM-approved /migrate scope.`
        ),
      });

      // The new type may require a filename suffix. Emitted from the same
      // loop iteration rather than a second pass, so it always follows the
      // type change it depends on: same-kind operations run in the order this
      // planner emits them, and this entry's normalize-type is already ahead
      // of it in `operations`.
      if (!suffix) continue;
      const stem = stemOf(file);
      if (stem.endsWith(suffix)) continue;
      const links = list(linksByFile[file] || linksByFile[stem]).map(toPosix).filter(Boolean);
      operations.push({
        op: "rename-with-link-rewrite",
        from: file,
        to: `${path.posix.dirname(file)}/${stem}${suffix}.md`,
        links,
        groups: [group],
        reason: `Renamed because type ${typeTo} requires the ${suffix} suffix.`,
      });
    }
  }
  return { operations, declined };
}

// Repair frontmatter for a DM-named file: insert missing defaulted fields
// except publish, and reorder to canonical order. Modelled on
// planFrontmatterRepairs above, with one deliberate difference: `reorder`
// defaults to true here rather than false, because a scope entry is a
// decision to act on rather than a survey finding to describe, and a DM
// naming a file with no `reorder` at all is asking for the whole repair.
//
// The file is a path the DM typed, and this planner enumerates nothing, so
// nothing else proves it is there; checked the same way every other scoped
// planner checks its named paths.
function planScopedRepairs(items, ctx, key) {
  const operations = [];
  const declined = [];
  for (const [i, item] of items.entries()) {
    const group = groupIdFor(key, i);
    const file = toPosix(item && item.file);
    if (!file) {
      declined.push({ op: "repair-frontmatter", target: "(unnamed)", reason: "The repair entry names no file." });
      continue;
    }
    const insert = list(item.insert).map(String);
    // buildPlan already refuses to insert publish, for a reason a DM-supplied
    // scope does not change: the guard that forces publish false on DM-only
    // content is a project-scope check, so inserting a default across a batch
    // would publish unmarked secret lore. The DM sets publish per article,
    // deliberately, or not at all.
    if (insert.includes("publish")) {
      declined.push({
        op: "repair-frontmatter",
        target: file,
        reason:
          "publish is never inserted by an unattended process, including one a scope asked for. Set it per article; the sweep reports which articles are missing it.",
      });
      continue;
    }
    if (namedPathNotAFile(ctx, file, "repair-frontmatter", operations)) {
      declined.push({
        op: "repair-frontmatter",
        target: file,
        reason: `No file exists at ${file}, so there is nothing to repair. Check that path for a typo: a scope naming a file that is not there plans cleanly and then fails after the snapshot.`,
      });
      continue;
    }
    operations.push({
      op: "repair-frontmatter",
      from: file,
      insert,
      reorder: item.reorder !== false,
      groups: [group],
      reason: String((item && item.reason) || "Frontmatter repaired by a DM-approved /migrate scope."),
    });
  }
  return { operations, declined };
}

// Rename a file that carries a deferred suffix, such as the base schema's
// retired `-TIMELINE` and `-HISTORY`, to whatever the current scope's rules
// call for, with its link rewrite riding along. Modelled on planEntityRenames
// just above: both the file and each referring file are paths the DM typed,
// this planner enumerates neither, and a missing referrer declines the whole
// entry rather than renaming the file and leaving the wikilink the DM named
// pointing at a filename that is gone.
function planSuffixRenames(items, ctx, key) {
  const operations = [];
  const declined = [];
  for (const [i, item] of items.entries()) {
    const group = groupIdFor(key, i);
    const from = toPosix(item && item.file);
    const to = toPosix(item && item.to);
    if (!from || !to || from === to) {
      declined.push({
        op: "rename-with-link-rewrite",
        target: from || "(unnamed)",
        reason: "The rename entry is missing a source or a destination, or they are the same path.",
      });
      continue;
    }
    if (namedPathNotAFile(ctx, from, "rename-with-link-rewrite", operations)) {
      declined.push({
        op: "rename-with-link-rewrite",
        target: from,
        reason: `No file exists at ${from}, so there is nothing to rename. Check that path for a typo: a scope naming a file that is not there plans cleanly and then fails after the snapshot.`,
      });
      continue;
    }
    const links = list(item.links).map(toPosix).filter(Boolean);
    const missing = links.filter((rel) => namedPathNotAFile(ctx, rel, "rename-with-link-rewrite", operations));
    if (missing.length > 0) {
      declined.push({
        op: "rename-with-link-rewrite",
        target: from,
        reason: `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} named as referring file(s) but ${
          missing.length === 1 ? "is" : "are"
        } not there to rewrite. The rename and its rewrite are one unit of work, so the whole entry is declined rather than the rename planned without them: a rewrite that cannot happen leaves a wikilink naming a filename that is gone, and a dead wikilink is valid markdown that fails silently in Obsidian.`,
      });
      continue;
    }
    operations.push({
      op: "rename-with-link-rewrite",
      from,
      to,
      links,
      groups: [group],
      reason: String((item && item.reason) || "Renamed by a DM-approved /migrate scope."),
    });
  }
  return { operations, declined };
}

// Rewrite stale path references in a document the DM named: the consumer's own
// CLAUDE.md, its conventions document, and the DM's separate wiki-website project.
// None of them is a knowledge base article the migration would otherwise touch,
// and every one of them went stale the moment the prongs moved.
//
// The file is checked with the FILE-NESS variant rather than the bare existence
// one. This operation edits its target in place through readFileSync and
// writeFileSync, so a directory sitting at that path cannot execute either, and a
// bare existence check answers yes for it. It is plan-aware for the same reason
// every other named-path check here is: the document can be one an earlier-ranked
// operation in the same scope puts there, and update-prose-paths ranks last of the
// content kinds precisely because it rewrites references TO paths, so every path it
// names has to have reached its destination first.
//
// The file is NOT a destination this operation could overwrite, so it is carried as
// `from` with no `to`, on the same terms as normalize-type and repair-frontmatter:
// giving an in-place edit a `to` equal to its own path would make it read as a
// collision with itself and with the file already on disk.
function planProsePathUpdates(items, ctx, key) {
  const operations = [];
  const declined = [];
  for (const [i, item] of items.entries()) {
    const file = toPosix(item && item.file);
    if (!file) {
      declined.push({ op: "update-prose-paths", target: "(unnamed)", reason: "The scope entry names no file." });
      continue;
    }
    const replacements = list(item && item.replacements)
      .filter((r) => r && typeof r.from === "string" && r.from !== "" && typeof r.to === "string")
      .map((r) => ({ from: r.from, to: r.to }))
      // Longest source first. A shorter path that is a prefix of a longer one
      // would otherwise consume it, leaving the longer replacement matching
      // nothing: replace "rolara-kb/" first and "rolara-kb/sessions/" has become
      // "settings/rolara/sessions/", which the second replacement no longer names.
      // Sorted HERE rather than in the executor so the proposal the DM reads shows
      // the order that will actually be applied, and so a hand-edited proposal that
      // reorders them gets what it asked for rather than a silent re-sort.
      .sort((a, b) => b.from.length - a.from.length);
    if (replacements.length === 0) {
      declined.push({
        op: "update-prose-paths",
        target: file,
        reason:
          "The scope entry carries no usable replacements, so there is nothing to rewrite. Each replacement needs a non-empty `from` string and a `to` string.",
      });
      continue;
    }
    // The cross-replacement cascade, a DIFFERENT hazard from the prefix case the
    // sort above handles. The sort keeps a shorter `from` from eating a longer
    // one, but does nothing about a replacement's own `to` landing text that a
    // LATER replacement's `from` then matches, because the executor applies
    // replacements in sequence and each pass scans the text the previous pass
    // already rewrote. Verified corrupting:
    // [{rolara-kb/sessions/ -> session-reports/rolara/}, {reports/ -> docs/}]
    // applied to "Reports live in rolara-kb/sessions/ today." yields
    // "Reports live in session-docs/rolara/ today.", not the two independent
    // substitutions the DM wrote. Declined here rather than left to corrupt the
    // file at apply time, on the module's stated terms that a plan which cannot
    // execute is worse than no plan: the reason names both replacements so the
    // DM can fix the scope (split them into separate entries, or reword one so
    // its destination no longer contains the other's source) and re-run.
    const cascades = [];
    for (let i = 0; i < replacements.length; i++) {
      for (let j = i + 1; j < replacements.length; j++) {
        if (replacements[i].to.includes(replacements[j].from)) cascades.push([replacements[i], replacements[j]]);
      }
    }
    if (cascades.length > 0) {
      const named = cascades
        .map(
          ([a, b]) =>
            `${JSON.stringify(a.from)} -> ${JSON.stringify(a.to)} feeds ${JSON.stringify(b.from)} -> ${JSON.stringify(b.to)}`
        )
        .join("; ");
      declined.push({
        op: "update-prose-paths",
        target: file,
        reason:
          "An earlier replacement's destination contains a later replacement's source, so applying them in " +
          "sequence would let the later one consume text the earlier one just inserted, corrupting the result " +
          `rather than making the substitutions the DM wrote independently: ${named}. Split them into separate ` +
          "scope entries, or reword one so its destination no longer contains the other's source, then re-run this scope.",
      });
      continue;
    }
    if (namedPathNotAFile(ctx, file, "update-prose-paths", operations)) {
      declined.push({
        op: "update-prose-paths",
        target: file,
        reason: `No file exists at ${file}, so there is no prose to update. Check that path for a typo: a scope naming a file that is not there plans cleanly and then fails after the snapshot.`,
      });
      continue;
    }
    operations.push({
      op: "update-prose-paths",
      from: file,
      replacements,
      groups: [groupIdFor(key, i)],
      reason: String((item && item.reason) || "Stale path references updated by a DM-approved /migrate scope."),
    });
  }
  return { operations, declined };
}

// ---------------------------------------------------------------------------
// Setting lifecycle
// ---------------------------------------------------------------------------
//
// A rename, a retirement, and a campaign retirement. All three are COMPOSITIONS
// of relocate-prong and relocate-path plus a conventions update, and none of them
// adds an executor: a setting is three prong roots and a conventions entry, so
// moving a world is moving those roots and repointing that entry.
//
// This is the module's highest blast radius. A prong root holds an entire
// knowledge base, homebrew catalog, or campaign's session reports, so a wrong
// destination here moves a DM's whole world somewhere they did not ask for. Two
// rails follow from that and are argued where they are enforced below: the three
// moves of one setting are ONE skip unit, and anything conventions.json does not
// record is declined rather than executed.

// The three prong roots of a setting: the conventions field recording the root,
// and the top-level folder that prong lives under in the canonical layout.
//
// THE FOLDER NAME IS NOT THE FIELD NAME and is not derivable from it. It is what
// a retirement builds its archive destination out of, so it is taken from the
// layout skills/setup/references/conventions-schema.md records
// (settings/<name>, homebrew/<name>, session-reports/<name>) rather than from
// the camelCase field. Getting it from the field would archive a knowledge base
// under archive/<name>/kbRoot.
const PRONG_FIELDS = [
  ["kbRoot", "settings"],
  ["homebrewRoot", "homebrew"],
  ["sessionReportsRoot", "session-reports"],
];

// The canonical folder one prong lives under, so the campaign retirement below
// and the setting retirement cannot drift apart on where the archive puts a
// world's session reports.
const prongFolderFor = (field) => (PRONG_FIELDS.find((p) => p[0] === field) || [])[1] || "";

// The settings entry with this name, or null.
//
// An empty or absent name matches NOTHING, deliberately. `String(s.name)` on an
// entry with no name field is the literal "undefined", which would otherwise
// match a scope entry carrying no name at all and hand a rename the wrong world.
const settingNamed = (settings, name) => {
  const want = String(name == null ? "" : name);
  if (want === "") return null;
  return (
    list(settings).find(
      (s) => s && typeof s === "object" && String(s.name == null ? "" : s.name) === want
    ) || null
  );
};

// A campaigns[] entry's name. The field holds either a bare string or an object
// with a name, and every reader of it has to cope with both; one helper so the
// plan half and the conventions half cannot disagree about which shapes count.
const campaignName = (c) => (typeof c === "string" ? c : c && c.name);

// A prong root with its LAST component replaced by the new setting name.
//
// The dirname guard is not decorative. A v1 or v2 project can record a root at
// the project root itself, where path.posix.dirname answers ".", and joining
// that in records "./rolara-prime": a path that compares equal to nothing else
// in this module, that toPosix does not normalize away, and that every
// startsWith-based prong test would then miss.
function rootRenamedTo(root, name) {
  const parent = path.posix.dirname(toPosix(root));
  return parent === "." || parent === "" || parent === "/" ? name : `${parent}/${name}`;
}

// Why a prong root a scope names is not there to be moved, in the DM's terms.
// Two causes reach it and both read the same from here, so the message names
// both rather than guessing: planResolve answers "nothing will be at this path
// when the operation runs", not why.
const PRONG_ABSENT_REASON =
  "is not there to be moved by the time this operation would run. Either conventions.json records a root that " +
  "is not on disk, or an earlier operation in this same plan already moved it. That prong is left alone; the " +
  "others in this entry are unaffected.";

// A setting rename: move all three prong roots, keeping each one's parent.
//
// The Obsidian vault is deliberately NOT a fourth operation. It lives at
// <kbRoot>/.obsidian, inside the root that just moved, so it travels with it,
// and a second move of a path already inside the first would fail. The plan
// suite pins that so a later "also move the vault" addition cannot double-move
// it.
function planSettingRenames(items, ctx, key) {
  const operations = [];
  const declined = [];
  for (const [i, item] of items.entries()) {
    const from = String((item && item.from) || "");
    const to = String((item && item.to) || "");
    const setting = settingNamed(ctx.settings, from);
    if (!setting) {
      declined.push({
        op: "relocate-prong",
        target: from || "(unnamed)",
        reason:
          "No setting by that name in conventions.json. Renaming one that is not recorded would move folders the " +
          "file still points elsewhere, which is how a knowledge base ends up half-described.",
      });
      continue;
    }
    if (!to || to === from) {
      declined.push({
        op: "relocate-prong",
        target: from,
        reason: "The new name is missing or identical to the old one, so there is nothing to rename.",
      });
      continue;
    }
    // ONE group id for all three moves. This is the skip unit, and here it is
    // load-bearing rather than tidy: moving two of a world's three prongs and
    // leaving the third leaves the project matching neither its old shape nor
    // the approved one, and conventions.json would then point two roots at the
    // new name and one at the old.
    const group = groupIdFor(key, i);
    for (const [field] of PRONG_FIELDS) {
      const root = toPosix(setting[field]);
      if (!root) continue;
      // Handed `operations` so the roots this entry has already planned count,
      // the same way every other planner's checks do.
      if (namedPathMissing(ctx, root, "relocate-prong", operations)) {
        declined.push({ op: "relocate-prong", target: root, reason: `${root} ${PRONG_ABSENT_REASON}` });
        continue;
      }
      operations.push({
        op: "relocate-prong",
        from: root,
        to: rootRenamedTo(root, to),
        groups: [group],
        reason: `Setting ${from} renamed to ${to}: its ${field} moves with the name.`,
      });
    }
  }
  return { operations, declined };
}

// A setting retirement: move all three prong roots under an archive.
//
// The settings ENTRY is not touched here and is never deleted; see
// conventionsAfterScope, which marks it instead and argues why.
function planSettingRetirements(items, ctx, key) {
  const operations = [];
  const declined = [];
  for (const [i, item] of items.entries()) {
    const name = String((item && item.setting) || "");
    const archiveRoot = toPosix((item && item.archiveRoot) || "") || "archive";
    const setting = settingNamed(ctx.settings, name);
    if (!setting) {
      declined.push({
        op: "relocate-prong",
        target: name || "(unnamed)",
        reason:
          "No setting by that name in conventions.json. Retiring one that is not recorded would move folders the " +
          "file still points elsewhere, which is how a knowledge base ends up half-described.",
      });
      continue;
    }
    const group = groupIdFor(key, i);
    for (const [field, folder] of PRONG_FIELDS) {
      const root = toPosix(setting[field]);
      if (!root) continue;
      const to = `${archiveRoot}/${name}/${folder}`;
      if (root === to) {
        declined.push({
          op: "relocate-prong",
          target: root,
          reason: `${root} is already where this retirement would put it, so there is nothing to move.`,
        });
        continue;
      }
      if (namedPathMissing(ctx, root, "relocate-prong", operations)) {
        declined.push({ op: "relocate-prong", target: root, reason: `${root} ${PRONG_ABSENT_REASON}` });
        continue;
      }
      operations.push({
        op: "relocate-prong",
        from: root,
        to,
        groups: [group],
        reason: `Setting ${name} retired: its ${field} moves under ${archiveRoot}/.`,
      });
    }
  }
  return { operations, declined };
}

// A campaign retirement: one folder, out of the setting's session-reports root
// and into the same archive a setting retirement uses.
function planCampaignRetirements(items, ctx, key) {
  const operations = [];
  const declined = [];
  for (const [i, item] of items.entries()) {
    const name = String((item && item.setting) || "");
    const campaign = String((item && item.campaign) || "");
    const archiveRoot = toPosix((item && item.archiveRoot) || "") || "archive";
    const setting = settingNamed(ctx.settings, name);
    if (!setting) {
      declined.push({
        op: "relocate-path",
        target: `${name || "(unnamed)"}/${campaign || "(unnamed)"}`,
        reason: "No setting by that name in conventions.json.",
      });
      continue;
    }
    const campaigns = list(setting.campaigns).map(campaignName);
    if (!campaign || !campaigns.includes(campaign)) {
      declined.push({
        op: "relocate-path",
        target: `${name}/${campaign || "(unnamed)"}`,
        reason:
          `${name} does not list a campaign called ${campaign || "(unnamed)"}. Retiring a folder the conventions ` +
          "file does not record would leave the file describing a campaign that is no longer where it says.",
      });
      continue;
    }
    const reports = toPosix(setting.sessionReportsRoot);
    if (!reports) {
      declined.push({
        op: "relocate-path",
        target: `${name}/${campaign}`,
        reason: `${name} records no sessionReportsRoot, so there is no folder this campaign can be resolved from.`,
      });
      continue;
    }
    const from = `${reports}/${campaign}`;
    // settings[].campaigns is a cache rather than the authority, so a campaign it
    // lists may have no folder at all. Without this the plan reads clean and then
    // fails on `git mv` after the snapshot.
    if (namedPathMissing(ctx, from, "relocate-path", operations)) {
      declined.push({
        op: "relocate-path",
        target: from,
        reason:
          `Nothing is at ${from} by the time this operation would run, so there is nothing to move. ` +
          "settings[].campaigns is a cache rather than the authority on which campaign folders exist, so a listed " +
          "campaign with no folder is an ordinary way to reach this. Check that path for a typo.",
      });
      continue;
    }
    operations.push({
      op: "relocate-path",
      from,
      to: `${archiveRoot}/${name}/${prongFolderFor("sessionReportsRoot")}/${campaign}`,
      groups: [groupIdFor(key, i)],
      reason: `Campaign ${campaign} retired out of ${name}'s active campaigns.`,
    });
  }
  return { operations, declined };
}

// A setting split: a second world made out of part of an existing one.
//
// The operations themselves are ordinary path moves. What makes this the hard one
// is the COST, and where the cost is put. Wikilink resolution is per setting, so
// every article that moves takes its incoming and its outgoing links across a
// boundary they cannot cross, and that is the whole operation rather than a
// detail of it. It is enumerated here and pushed into `declined`, which
// renderProposal prints under its Declined section, so the DM reads it while
// deciding rather than learning it from the report once it has happened.
//
// NOTHING REPAIRS THEM. Each crossing is named and left exactly as it is. The
// article's text is the DM's, and rewriting it under a structural approval would
// be chronicler's work done without chronicler's gate.
//
// ONE group id for every move the entry emits, and here that is load-bearing
// rather than tidy. The cost the DM approved was computed from the set that
// moves, and a link between two articles that BOTH move was excluded from it;
// leave one of those two behind and that link becomes a crossing nobody was
// shown. So a split moves all of its articles or none of them.
//
// The settings ENTRY for the new world is not created here. See
// conventionsAfterScope, which creates it from what actually applied.
function planSettingSplits(items, ctx, key) {
  const operations = [];
  const declined = [];
  for (const [i, item] of items.entries()) {
    const from = String((item && item.from) || "");
    const name = String((item && item.name) || "");
    const kbRoot = toPosix(item && item.kbRoot);
    const source = settingNamed(ctx.settings, from);
    if (!source || !name || !kbRoot) {
      declined.push({
        op: "relocate-path",
        target: from || name || "(unnamed)",
        reason:
          "A split needs an existing source setting, a name for the world it creates, and the kbRoot that world's " +
          "knowledge base will live at. Splitting out of a setting conventions.json does not record would move " +
          "articles the file still points elsewhere, which is how a knowledge base ends up half-described.",
      });
      continue;
    }
    // A name already in use. conventionsAfterScope keeps ONE entry per name and
    // refuses to add a second, so planning the moves anyway would carry the
    // articles across and leave the world they landed in unrecorded: unattributed
    // to the validation sweep, unresolvable to /scribe and /log. Both halves
    // decline on the same condition rather than one planning what the other
    // cannot record.
    if (settingNamed(ctx.settings, name)) {
      declined.push({
        op: "relocate-path",
        target: name,
        reason:
          `conventions.json already records a setting called ${name}, and it records one entry per name, so no entry ` +
          "could be added for the world this split creates. Give it a name of its own, or move the articles with " +
          "pathMoves if the destination is meant to be the setting that already exists.",
      });
      continue;
    }
    const stay = toPosix(source.kbRoot);
    if (!stay) {
      declined.push({
        op: "relocate-path",
        target: from,
        reason:
          `${from} records no kbRoot, so there is no knowledge base to divide and no root the files named here could ` +
          "be checked against. The cost of a split is the links it breaks, and a split whose material cannot be " +
          "located is not one to approve.",
      });
      continue;
    }
    if (kbRoot === stay || kbRoot.startsWith(`${stay}/`) || stay.startsWith(`${kbRoot}/`)) {
      declined.push({
        op: "relocate-path",
        target: kbRoot,
        reason:
          `${kbRoot} and ${from}'s own kbRoot at ${stay} are ${kbRoot === stay ? "the same path" : "one inside the other"}. ` +
          "Two knowledge bases nested that way leave every article under the inner one claimed by both settings, and " +
          "identical roots would move each file onto itself.",
      });
      continue;
    }

    const group = groupIdFor(key, i);
    const moving = [];
    for (const file of list(item.files).map(toPosix).filter(Boolean)) {
      // Outside the knowledge base being divided. A split divides ONE prong: the
      // destination it computes is the new kbRoot, so a homebrew entry or a
      // session report named here would be flattened into a knowledge base and
      // filed under the wrong prong of the world it landed in, and a path outside
      // the setting altogether belongs to whichever setting owns it. Their links
      // are enumerated either way, since the walk below covers all three prongs;
      // what this refuses is moving them, not counting them.
      if (!file.startsWith(`${stay}/`)) {
        declined.push({
          op: "relocate-path",
          target: file,
          reason:
            `${file} is not a path inside ${from}'s knowledge base at ${stay}. A split divides a knowledge base in ` +
            "two, and the destination it moves to is the new setting's kbRoot, so a homebrew entry or a session " +
            "report sent there would be filed under the wrong prong of the world it arrived in.",
        });
        continue;
      }
      // The source is a path the DM typed and this planner never enumerates it,
      // so nothing else proves it is there. `to` is deliberately NOT checked: a
      // destination that already exists is findDestinationCollisions's question,
      // and the answer there is the opposite one.
      if (namedPathMissing(ctx, file, "relocate-path", operations)) {
        declined.push({
          op: "relocate-path",
          target: file,
          reason:
            `Nothing is at ${file} by the time this operation would run, so there is nothing to move. Check that path ` +
            "for a typo: a scope naming a file that is not there plans cleanly and then fails after the snapshot, and " +
            "every link into the article that IS at that filename would have been reported as a crossing that never " +
            "happens.",
        });
        continue;
      }
      moving.push(file);
      operations.push({
        op: "relocate-path",
        from: file,
        // FLAT, by basename, rather than keeping the subfolder the article sat in.
        // The new world's shape is the DM's to decide and this operation does not
        // guess at it; a folder they want kept is a pathMoves entry in the same
        // scope, which runs at this same rank. Two articles with one basename
        // therefore aim at one destination, which findDestinationCollisions refuses
        // as an in-plan collision, naming both, before the DM is asked to approve.
        to: `${kbRoot}/${path.posix.basename(file)}`,
        groups: [group],
        reason: `Split out of ${from} into ${name}.`,
      });
    }

    // Computed from the files that will ACTUALLY move rather than from the ones
    // the scope named. A file declined above stays exactly where it is, and
    // counting its links would report a crossing that never happens.
    //
    // ALL THREE PRONGS, which is what a setting is everywhere else in this module
    // and what assertLinkIntegrity resolves over. The knowledge base by itself
    // would leave every session report and every homebrew entry that names a
    // moving article out of the cost the DM approves the split on.
    for (const link of crossBoundaryLinks({
      projectRoot: ctx.projectRoot,
      movingFiles: moving,
      stayingRoots: prongRootsOf(source),
    })) {
      declined.push({
        op: "cross-boundary-link",
        target: `${link.file} -> [[${link.target}]]`,
        reason:
          link.direction === "outgoing"
            ? `This article is moving to ${name} and links to [[${link.target}]], which resolves in ${from} today and ` +
              "stays there. Wikilinks resolve per setting, so the link stops resolving once the boundary is between " +
              "them. Nothing here fixes it: the article's text is the DM's to change if they want it changed."
            : `This article stays in ${from} and links to [[${link.target}]], which resolves there today and is moving ` +
              `to ${name}. The link stops resolving for the same reason, and is likewise left exactly as it is.`,
      });
    }
  }
  return { operations, declined };
}

// Every wikilink that will stop resolving when movingFiles leave stayingRoots.
//
// Wikilink resolution is per setting, which is what makes this the whole cost of
// a split rather than a detail of it. TWO DIRECTIONS, both of which break and
// each of which the DM has to see:
//
//   outgoing  a moving article links to one that stays.
//   incoming  an article that stays links to one that moves.
//
// A SETTING IS ALL THREE OF ITS PRONGS, which is why this takes a LIST of roots
// rather than the knowledge base alone. prongRootsOf is the module's definition of
// what a setting contains and assertLinkIntegrity, the rail that decides whether a
// finished run may commit, resolves over exactly that list. Handed the knowledge
// base by itself, this walk would report a session report's or a homebrew entry's
// link to a moving article as no cost at all, and debrief instructs reports to
// cross-reference aggressively: a campaign accumulates one per session against the
// same locations and people a split moves. Understating the number the DM approves
// an irreversible split on is the one direction of error this operation exists to
// avoid. Roots are deduplicated and a nested prong is walked once, the way
// assertLinkIntegrity deduplicates its own file list.
//
// A CROSSING IS A LINK THAT RESOLVES TODAY AND WILL NOT RESOLVE AFTER. Both halves
// are checked. A target that resolves to nothing in this setting was dead before
// the split and is equally dead after it, so the split costs nothing there; the
// same goes for one that already pointed into another setting. Counting either
// would inflate the cost and make a clean split look expensive, which is the
// direction that talks a DM out of a migration that was fine, and is the same harm
// the both-move exclusion below prevents. A link between two articles that BOTH
// move likewise crosses nothing: it resolves today and still resolves in the world
// they land in together.
//
// RESOLVED THE WAY assertLinkIntegrity RESOLVES, through dissectTarget and against
// a set of basenames the walk itself collected, because this is that function's
// question asked one phase earlier: which links will be dead. wikilinkTargetsIn
// returns the target as WRITTEN rather than a bare stem, so [[Karsk]], [[Karsk.md]],
// [[notes/Karsk]] and [[Karsk#Trade]] all arrive different and all name one article;
// splitWikilink has already dropped the display half. A target dissecting to an
// EMPTY stem is a link into the file's own headings and a target carrying a non-.md
// extension is an attachment, and neither is a link to an article. Fenced blocks and
// code spans are not link-bearing text at all, which wikilinkTargetsIn already
// handles, on the same terms the rewriter and the rail leave a quoted example alone.
// The three folder names walkMarkdown steps around are stepped around here too, so
// this half and the rail cannot disagree about which files a setting resolves from.
//
// `target` is reported AS WRITTEN rather than as the stem it resolved to, because
// the declined row is what the DM will search their own file for.
//
// UNDETERMINED READS AS EMPTY. Unreadable or unnamed roots find nothing and return
// nothing, the same posture namedPathMissing takes when it cannot answer; every
// /migrate run has a project root on disk. Stated so that a caller reading zero
// crossings knows what else that can mean.
//
// Read-only: readdirSync, readFileSync, statSync only.
export function crossBoundaryLinks({ projectRoot, movingFiles, stayingRoots }) {
  // Empty entries are dropped and an empty list returns rather than walking:
  // path.resolve(projectRoot, "") is projectRoot itself, so one blank root would
  // enumerate every setting the DM has and report another world's links as this
  // split's cost. A setting missing a prong is the ordinary way a blank arrives.
  const roots = [];
  for (const root of list(stayingRoots).map(toPosix).filter(Boolean)) {
    if (!roots.includes(root)) roots.push(root);
  }
  if (roots.length === 0) return [];
  const moving = new Set(list(movingFiles).map(toPosix).filter(Boolean));
  const movingStems = new Set([...moving].map((f) => stemOf(f).toLowerCase()));

  // WALKED ONCE, in prong order, names sorted within each folder. The file list and
  // the set of basenames links resolve against both come out of this same pass, so
  // the scope being enumerated and the scope being resolved against cannot drift
  // apart, which is the property assertLinkIntegrity states about its own walk.
  const files = [];
  const seen = new Set();
  const walk = (rel) => {
    let names;
    try {
      names = readdirSync(path.resolve(projectRoot, rel)).sort();
    } catch {
      return;
    }
    for (const name of names) {
      if (name === ".git" || name === ".obsidian" || name === "node_modules") continue;
      const childRel = `${rel}/${name}`;
      let st;
      try {
        st = statSync(path.resolve(projectRoot, childRel));
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(childRel);
        continue;
      }
      if (!name.toLowerCase().endsWith(".md")) continue;
      if (seen.has(childRel)) continue;
      seen.add(childRel);
      files.push(childRel);
    }
  };
  for (const root of roots) walk(root);

  const known = new Set(files.map((f) => stemOf(f).toLowerCase()));
  const out = [];
  for (const rel of files) {
    let text;
    try {
      text = readFileSync(path.resolve(projectRoot, rel), "utf8");
    } catch {
      continue;
    }
    const isMoving = moving.has(rel);
    for (const target of wikilinkTargetsIn(text)) {
      const { stem, ext } = dissectTarget(target);
      const trimmed = stem.trim();
      if (trimmed === "") continue;
      if (ext !== "" && ext.toLowerCase() !== ".md") continue;
      const key = trimmed.toLowerCase();
      // Dead already, in this setting's own terms. The split neither breaks it
      // nor fixes it, so it is not part of the cost.
      if (!known.has(key)) continue;
      const targetMoves = movingStems.has(key);
      if (isMoving && !targetMoves) out.push({ file: rel, target, direction: "outgoing" });
      else if (!isMoving && targetMoves) out.push({ file: rel, target, direction: "incoming" });
      // Both moving, or neither moving: nothing crosses.
    }
  }
  return out;
}

// A setting merge: two worlds put in one vault.
//
// THE INVERSE OF A SPLIT, and the case where basename collisions stop being a
// hazard and become a certainty. Two worlds legitimately holding a Tavern.md is
// not a mistake in either of them; it becomes a collision only when they share a
// vault. Every one of them appears in the proposal with a proposed rename, which
// renderProposal prints, so the DM APPROVES the resolution rather than discovering
// it after the fact.
//
// WHAT A MERGE MOVES IS ALL THREE PRONGS, one into its counterpart: kbRoot into
// kbRoot, homebrewRoot into homebrewRoot, sessionReportsRoot into
// sessionReportsRoot. prongRootsOf is this module's definition of a setting's
// extent and assertLinkIntegrity, settingForFolder and crossBoundaryLinks all read
// it; a merge has to PAIR those roots rather than merely list them, so it walks
// PRONG_FIELDS, which is the same three roots with the field names that do the
// pairing kept. Moving the knowledge base alone would file nothing wrong: it would
// leave the source world's homebrew catalogue and every session report it ever
// produced exactly where they are, belonging to a setting conventions.json has just
// marked merged, so unattributed to the validation sweep and unresolvable to
// /scribe and /log.
//
// THE UNIT IS A DIRECT CHILD of a prong root, file or folder alike, and that one
// rule is what makes the session-reports prong work. A campaign lives at
// sessionReportsRoot/<campaign>/, so merging session reports is not a flat file
// move; treated as a direct child, a campaign folder moves whole, with every report
// inside it, and a campaign name both worlds used collides and is renamed on exactly
// the terms a colliding article is. The alternative, interleaving two campaigns'
// reports into one folder, fuses two histories into one lane silently, which is the
// one thing this operation exists to prevent. A knowledge base's own subfolders move
// whole for the same reason: the shape of the merged world is the DM's to decide and
// this operation does not guess at it.
//
// ONE group id for every move an entry emits. conventionsAfterScope marks the source
// world merged off that same entry, so half a world moved while the entry says it was
// merged would leave the rest belonging to a setting nothing points at any more.
function planSettingMerges(items, ctx, key) {
  const operations = [];
  const declined = [];
  for (const [i, item] of items.entries()) {
    const from = String((item && item.from) || "");
    const into = String((item && item.into) || "");
    const source = settingNamed(ctx.settings, from);
    const target = settingNamed(ctx.settings, into);
    if (!source || !target) {
      declined.push({
        op: "relocate-path",
        target: `${from || "(unnamed)"} into ${into || "(unnamed)"}`,
        reason:
          "Both settings must be recorded in conventions.json. Merging into or out of a world the file does not " +
          "record would move folders it still points elsewhere, which is how a knowledge base ends up " +
          "half-described.",
      });
      continue;
    }
    // Merging a setting into itself, which is every file moved onto itself. The
    // object identity check catches the second way to reach it, two entries
    // recorded under one name, where settingNamed resolves both to the same world.
    if (source === target) {
      declined.push({
        op: "relocate-path",
        target: from,
        reason:
          "A setting cannot be merged into itself: every path this would move is already where it would be moved " +
          "to. Name the world the material is meant to end up in.",
      });
      continue;
    }

    const group = groupIdFor(key, i);
    // THE PLAN AS IT WILL STAND WHEN THIS ENTRY RUNS, captured once and read by both
    // halves of the merge. The collision detection and the move loop have to agree
    // about what is under a prong root, and a list that grew between the two calls
    // would let them disagree; and neither half sees this entry's OWN operations,
    // which is the invariant precedingOperations states and relies on.
    const before = operations.slice();
    const childCache = new Map();
    const childrenAt = (rel) => {
      if (!childCache.has(rel)) childCache.set(rel, prongChildrenAfterPlan(ctx, rel, before));
      return childCache.get(rel);
    };
    // PLAN-AWARE on BOTH sides, rather than a plan-aware destination and a raw-disk
    // source. A destination an earlier operation in this same plan carries away is
    // free by the time this merge runs, and one an earlier operation fills is
    // occupied whatever the disk says now; symmetrically, a source an earlier
    // operation carries away is gone and one an earlier operation moves in is there.
    // Getting the destination wrong is expensive: the move would be planned onto an
    // occupied path, findDestinationCollisions would refuse it as an in-plan
    // collision, and the DM would be unable to apply any part of the plan. Getting
    // the SOURCE wrong is worse, because it passes the prechecks: two operations
    // reading one path apply half way, the first git mv succeeding and the second
    // failing on a source that is no longer there. See prongChildrenAfterPlan.
    const collisions = mergeCollisions({
      projectRoot: ctx.projectRoot,
      source,
      target,
      suffix: indexSuffixFor(target, ctx.baseRules),
      occupied: (rel) => namedPathPresent(ctx, rel, "relocate-path", before),
      children: childrenAt,
    });
    const collided = new Map(collisions.map((c) => [c.from, c]));

    for (const pair of mergeProngPairs(source, target)) {
      const children = childrenAt(pair.from);
      // What the disk holds here that the plan does not: a child an operation
      // earlier in this same plan carries away. Named rather than dropped, because a
      // DM reading the proposal should learn that this merge did not move it.
      const carried = prongChildren(ctx.projectRoot, pair.from).filter((n) => !children.includes(n));
      // A prong with nothing under it, which is the ORDINARY state of a world that
      // has not written a homebrew entry or run a session yet, and the state
      // planSettingRenames already declines a prong for rather than treating as an
      // error. Nothing to move and nothing to say about it.
      if (children.length === 0 && carried.length === 0) continue;
      if (pair.refusal) {
        declined.push({ op: "relocate-path", target: pair.from, reason: pair.refusal });
        continue;
      }
      for (const name of carried) {
        declined.push({
          op: "relocate-path",
          target: `${pair.from}/${name}`,
          reason:
            `An operation earlier in this plan already carries ${pair.from}/${name} away, so this merge does not ` +
            "move it a second time. Two operations reading one path is a plan whose first move succeeds and whose " +
            "second fails on a source that is no longer there, which leaves the merge half applied from a plan " +
            "the prechecks approved. Wherever that earlier operation puts it is where it ends up; if it belongs " +
            `in ${into} instead, edit that entry rather than this one.`,
        });
      }
      for (const name of children) {
        const rel = `${pair.from}/${name}`;
        const collision = collided.get(rel);
        if (collision && collision.blocked === "index") {
          declined.push({
            op: "relocate-path",
            target: rel,
            reason:
              `${into} already holds an index called ${name}, and an index colliding with an index is a merge-index ` +
              "job rather than a rename: renaming would leave two indexes claiming one folder, which is the " +
              "multi-index violation the validation sweep reports. This one stays where it is; fold the two " +
              "together with a mergeIndexes scope and re-run.",
          });
          continue;
        }
        // THE RENAME'S OWN NAME IS TAKEN TOO, so there are three files and no
        // resolution this function is entitled to pick. Declined, and every one of
        // the three named, on the same terms as the index case above: the rest of
        // the merge stays applicable and the DM resolves this one from the proposal.
        // The alternative, escalating to a machine-invented second suffix, is
        // rejected in the comment on mergeCollisions.
        if (collision && collision.blocked === "taken") {
          declined.push({
            op: "relocate-path",
            target: rel,
            reason:
              `${into} already holds ${pair.to}/${name}, and ${collision.blockedBy}, the name the incoming one ` +
              "would be renamed to, is spoken for as well, either on disk or by another move in this plan. Three " +
              `files, and only you know which of ${into}'s two this one is: a second machine-invented suffix would ` +
              `say nothing about where the article came from, which is the whole job the -${from} suffix does. ` +
              "Planning the move onto that name anyway would be a destination collision, and a plan carrying one " +
              "of those is refused whole rather than one file at a time, so this move is dropped and the rest of " +
              "the merge stands. Rename one of the two by hand, or edit this proposal, and re-run.",
          });
          continue;
        }
        operations.push({
          op: "relocate-path",
          from: rel,
          // The destination keeps the child's own name unless that name is taken, in
          // which case it is the rename the DM is shown below, and mergeCollisions
          // has already established that the rename's own name is free.
          to: collision ? collision.proposed : `${pair.to}/${name}`,
          groups: [group],
          reason: collision
            ? `Merged from ${from} into ${into}, renamed because ${pair.to}/${name} is already spoken for.`
            : `Merged from ${from} into ${into}.`,
        });
      }
    }

    // The collisions themselves, in the proposal, before approval. Each names both
    // sides and the rename that resolves them, because the DM is being asked to
    // approve a resolution rather than to notice one. The two blocked kinds are not
    // repeated here: each already has a decline of its own above, naming the move
    // that was dropped and what to do about it, and one problem gets one row.
    //
    // THE WIKILINK CONSEQUENCE IS SPELT OUT HERE rather than left implied, because
    // this row is the one the DM reads while deciding and the effect is silent
    // everywhere else. A renamed incoming article's own [[Tavern]] links resolve by
    // BASENAME, so after the merge they find the target world's Tavern.md, a
    // different world's article; assertLinkIntegrity resolves by basename too, finds
    // a live file, and reports clean. A mis-resolved link is quieter than a dead one,
    // so the proposal is the only place it can be said.
    for (const collision of collisions) {
      if (collision.proposed === null) continue;
      const targetRoot = path.posix.dirname(collision.proposed);
      const renamed = path.posix.basename(collision.proposed);
      const stem = collision.basename.toLowerCase().endsWith(".md")
        ? collision.basename.slice(0, -3)
        : collision.basename;
      declined.push({
        op: "merge-collision",
        target: `${collision.from} collides with ${targetRoot}/${collision.basename}`,
        reason:
          `${targetRoot}/${collision.basename} is already spoken for by the time this merge runs, so the incoming ` +
          `${collision.basename} is renamed to ${renamed} and the one at the destination keeps the name every ` +
          `existing wikilink uses. THE INCOMING ARTICLE'S OWN LINKS CHANGE MEANING: a [[${stem}]] written inside ` +
          `${from}'s articles resolves by basename, so after this merge it points at ${into}'s ` +
          `${collision.basename} rather than at the one that moved in beside it. The link-integrity check cannot ` +
          "see that, because both names resolve to a real file, so read the incoming world's links yourself. " +
          "Nothing is overwritten and nothing is refused: both are real, and the DM asked for both worlds in one " +
          "place. Edit this proposal if the other name should move instead, or if neither of these is the name " +
          "you want.",
      });
    }
  }
  return { operations, declined };
}

// The prong pairs a merge moves, in PRONG_FIELDS order, each carrying the reason it
// cannot be moved when there is one.
//
// PAIRED rather than listed, which is why this walks PRONG_FIELDS and not
// prongRootsOf: prongRootsOf drops the roots a setting does not record, so zipping
// two of its results would silently pair one world's homebrew against another's
// session reports the moment either was missing a prong.
//
// Pure: no disk, so the planner and mergeCollisions can both ask and cannot disagree.
function mergeProngPairs(source, target) {
  const out = [];
  for (const [field] of PRONG_FIELDS) {
    const from = toPosix(source && source[field]);
    // The SOURCE records no such prong, so there is nothing under it to move and
    // nothing to say. Not a refusal: it is the ordinary shape of a young world.
    if (!from) continue;
    const to = toPosix(target && target[field]);
    if (!to) {
      out.push({
        field,
        from,
        to: "",
        refusal:
          `${target && target.name} records no ${field}, so there is nowhere for ${from} to be merged into. A ` +
          "canonical sibling path is not guessed at here: that would file a world's material under a folder " +
          "conventions.json does not name and no lane command would resolve.",
      });
      continue;
    }
    if (from === to || from.startsWith(`${to}/`) || to.startsWith(`${from}/`)) {
      out.push({
        field,
        from,
        to,
        refusal:
          `${from} and ${to} are ${from === to ? "one folder" : "nested one inside the other"}, so there is no ` +
          "boundary at this prong for a merge to cross. Identical roots would move every path onto itself, and " +
          "nested ones leave the material under the inner root already claimed by both settings, with the move " +
          "carrying a folder into or out of its own subtree. Nothing is moved for this prong; the others in this " +
          "entry are unaffected.",
      });
      continue;
    }
    out.push({ field, from, to, refusal: null });
  }
  return out;
}

// The three names walkMarkdown steps around, stepped around by both enumerators
// below so they cannot drift apart. .obsidian is the one that earns its place here:
// the vault lives at <kbRoot>/.obsidian, the target world already has its own, and a
// world's vault configuration is not part of its lore. It stays behind with the
// entry that is being marked merged.
const PRONG_CHILDREN_SKIPPED = new Set([".git", ".obsidian", "node_modules"]);

// The direct children of a prong root, sorted, or [] when the root is not on disk.
//
// DIRECT children rather than a recursive walk, because that is the unit a merge
// moves: a file lands beside the target's own files and a folder lands beside the
// target's own folders with everything under it intact. See planSettingMerges.
//
// Read-only: readdirSync and statSync only.
function prongChildren(projectRoot, rel) {
  let names;
  try {
    names = readdirSync(path.resolve(projectRoot, rel)).sort();
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (PRONG_CHILDREN_SKIPPED.has(name)) continue;
    try {
      statSync(path.resolve(projectRoot, `${rel}/${name}`));
    } catch {
      continue;
    }
    out.push(name);
  }
  return out;
}

// The direct children a prong root will hold BY THE TIME this merge runs, rather
// than the ones the disk holds now.
//
// THE SAME QUESTION THE DESTINATION SIDE ASKS. planSettingMerges has routed its
// destination checks through namedPathPresent since it was written, which reasons
// about the tree as the plan will leave it; a source side reading the raw disk is an
// asymmetry, and both directions of it were measured:
//
//   A pathMoves entry (rank 1, registered first, so it runs first) that carries an
//   article out of the source world. The disk still shows the article, so the merge
//   plans a second move reading the same path. prechecks.ok comes back true, because
//   findDestinationCollisions ranks DESTINATIONS and these two differ, and at apply
//   the first git mv succeeds and the second fails on a source that is no longer
//   there. applyPlan records the failure and keeps going: a half-applied merge from
//   a plan the prechecks approved, which is the posture at namedPathSatisfies ("a
//   plan that cannot execute is worse than no plan") not being honoured.
//
//   Chained merges in one scope, karsk into rolara and rolara into dunn. rolara's
//   children off the disk are the ones it has today, so karsk's material lands under
//   settings/rolara and the same run marks rolara merged into dunn: stranded under a
//   world conventions.json has just stopped treating as live, which is the harm the
//   whole operation exists to prevent.
//
// BOTH DIRECTIONS, therefore, because the two cases need opposite halves. The disk
// half rewinds the ROOT through planResolve first, so a prong an earlier operation
// relocates is still enumerated, from wherever its contents actually sit today. The
// plan half adds the names earlier operations put directly under this root. Then
// every candidate, from either half, is put through namedPathPresent, which is what
// drops the ones an earlier operation carries away and what keeps a planted name
// whose own source is missing from being planned on.
//
// DIRECT children only, on the plan half as on the disk half, because that is the
// unit a merge moves. An earlier operation that moves a whole folder ONTO a prong
// root is covered by the rewind rather than by this list; one that moves a folder to
// a path DEEPER than a direct child contributes its top-level component through the
// rewind for the same reason.
//
// Read-only: readdirSync and statSync only, through prongChildren and planResolve.
function prongChildrenAfterPlan(ctx, rel, pending) {
  const names = new Set();
  const at = planResolve(ctx, rel, "relocate-path", pending);
  if (at.path) for (const name of prongChildren(ctx.projectRoot, at.path)) names.add(name);
  for (const o of precedingOperations(ctx, "relocate-path", pending)) {
    for (const e of destinationEntriesOf(o)) {
      const to = toPosix(e.to);
      if (!to || path.posix.dirname(to) !== rel) continue;
      names.add(path.posix.basename(to));
    }
  }
  const out = [];
  for (const name of [...names].sort()) {
    if (PRONG_CHILDREN_SKIPPED.has(name)) continue;
    if (!namedPathPresent(ctx, `${rel}/${name}`, "relocate-path", pending)) continue;
    out.push(name);
  }
  return out;
}

// The name an incoming child takes when the destination already holds one of that
// name. Shared by the plan half and by conventionsAfterScope's two-argument path,
// so the two cannot disagree about the form of the rename.
//
// THE EXTENSION STAYS LAST. Tavern.md becomes Tavern-karsk.md rather than
// Tavern.md-karsk, because Obsidian resolves a wikilink by basename and a file that
// does not end in .md is not an article it will resolve at all. A campaign folder
// has no extension to hold back and simply takes the suffix.
function disambiguatedName(name, label) {
  const raw = String(name);
  const ext = raw.length > 3 && raw.toLowerCase().endsWith(".md") ? raw.slice(-3) : "";
  const stem = ext ? raw.slice(0, -ext.length) : raw;
  return `${stem}-${label}${ext}`;
}

// Every direct child of the source world that the target world already has a path
// for, each with the name the incoming one is proposed to take.
//
// TWO SETTINGS RATHER THAN TWO ROOTS, deliberately, for the reason
// crossBoundaryLinks takes a list of roots rather than one: a signature that accepts
// a third of a world lets a caller measure a third of a world and be told there are
// no collisions in the other two thirds. What comes back is every collision in every
// prong, tagged with the field it was found under.
//
// THE SUFFIX IS THE SOURCE SETTING'S NAME rather than the last component of its
// kbRoot, because the name is what the DM calls the world and what conventions.json
// keys it on; a world named karsk whose knowledge base sits at worlds/k2 would
// otherwise be suffixed -k2.
//
// A COLLISION NO RENAME RESOLVES comes back with `proposed: null` and a `blocked`
// saying which of the two it is, so the caller can decline the move rather than plan
// one that cannot execute.
//
//   "index"  An index colliding with an index. That is a merge-index job, not a
//            rename: two indexes claiming one folder is the multi-index violation
//            the validation sweep reports, and suffixing the stem would push -INDEX
//            off the end of it and turn the file into an article besides.
//
//   "taken"  The proposed rename's own name is spoken for too, named in `blockedBy`.
//            DECLINED RATHER THAN ESCALATED, deliberately. A target world holding
//            both Tavern.md and Tavern-karsk.md is the ordinary shape for a DM who
//            once hand-copied one article across, or who suffixes by world already,
//            and the whole job the -karsk suffix does is say WHICH WORLD the article
//            came from. A machine-invented Tavern-karsk-2.md says nothing at all:
//            the DM cannot tell the two apart without opening both, and the file
//            already at that name is most likely this same article, copied over by
//            hand, which is a judgment only they can make. Planning the move anyway
//            is worse than either: findDestinationCollisions would refuse it, and
//            applyPlan refuses a plan with any collision OUTRIGHT, so one taken
//            rename would block every unrelated move in the migration. So this
//            follows the index case exactly, which is this function's own precedent
//            for a collision it is not entitled to resolve: drop the one move, name
//            all three files, leave the rest of the merge applicable.
//
// `occupied` is how a caller asks the destination question plan-aware, and `children`
// the source question. Both default to the raw disk, which is right for a caller with
// no plan in hand; planSettingMerges passes namedPathPresent and
// prongChildrenAfterPlan, so the two halves of one merge reason about the tree as the
// plan will leave it rather than as it is now, and cannot disagree about it.
//
// UNDETERMINED READS AS EMPTY, the same posture namedPathMissing takes: a source
// setting with no name, or roots that are not on disk, finds nothing and returns
// nothing. Stated so that a caller reading zero collisions knows what else that can
// mean.
//
// Read-only: readdirSync and statSync only.
export function mergeCollisions({ projectRoot, source, target, suffix, occupied, children }) {
  const label = String((source && source.name) || "");
  if (!label) return [];
  const taken =
    typeof occupied === "function"
      ? occupied
      : (rel) => {
          try {
            statSync(path.resolve(projectRoot, rel));
            return true;
          } catch {
            return false;
          }
        };
  const childrenAt = typeof children === "function" ? children : (rel) => prongChildren(projectRoot, rel);

  const out = [];
  // ORDER-INDEPENDENT BY CONSTRUCTION. A single left-to-right pass that records a
  // running `claimed` set cannot answer this question the same way regardless of
  // which sibling it meets first: whether a rename's own target is free depends on
  // ANOTHER child of this same source folder that the pass has not looked at yet, so
  // whichever child is visited first gets the wrong answer about the one visited
  // second, and the direction that goes wrong flips with the visiting order. There is
  // no ordering of `names` that fixes this in one pass, because the two children each
  // need to know a fact about the other before either is decided. So this asks the
  // whole sibling set the relevant question BEFORE deciding any one child's fate,
  // rather than deciding child by child and hoping the walk order cooperates (it does
  // for .md names, by an accident of ASCII sort putting the suffixed form first; it
  // does not for extensionless names, where the plain form is a sort-prefix of its
  // own suffixed form and is visited first instead).
  for (const pair of mergeProngPairs(source, target)) {
    if (pair.refusal) continue;
    const names = childrenAt(pair.from);
    // WHETHER A NAME'S OWN SPOT IS FREE, settled for every child of this pair before
    // any one of them is decided, and asked only of the target disk (through `taken`,
    // plan-aware or not), never of another child of this same source folder, because
    // readdir cannot hand back two entries sharing one name, so two children can never
    // contend for the same DIRECT destination. That is what makes this map correct
    // regardless of the order `names` is walked in.
    const nameSet = new Set(names);
    const directTaken = new Map(names.map((name) => [name, taken(`${pair.to}/${name}`)]));
    for (const name of names) {
      if (!directTaken.get(name)) continue; // free: settles here, nothing to report.
      const isIndex =
        Boolean(suffix) && name.toLowerCase().endsWith(".md") && name.slice(0, -3).endsWith(suffix);
      if (isIndex) {
        out.push({
          field: pair.field,
          from: `${pair.from}/${name}`,
          basename: name,
          proposed: null,
          blocked: "index",
          blockedBy: null,
        });
        continue;
      }
      // THE RENAME'S OWN SPOT CAN BE OCCUPIED TWO WAYS, both asked here rather than
      // discovered by which child this loop happens to reach first.
      //
      // The first is `taken(wanted)`: the target disk, or an earlier operation in the
      // plan. This name's own move could never change that answer, so no walk order
      // changes it either.
      //
      // The second is a SIBLING OF THIS SAME SOURCE FOLDER that is literally named
      // the disambiguated form and whose own spot is free (`nameSet` plus
      // `directTaken`, both already settled above, independent of this loop's
      // position). That sibling is this function's OWN move, not the target's, and it
      // never yields the spot it is headed for, whether it is visited before this
      // name or after. A rename can never collide with ANOTHER sibling's rename,
      // because two children never share a name and disambiguatedName never maps two
      // different names to the same result, so only this one lookup is needed.
      const wantedName = disambiguatedName(name, label);
      const wanted = `${pair.to}/${wantedName}`;
      const siblingClaimsIt = nameSet.has(wantedName) && !directTaken.get(wantedName);
      const blockedByTaken = taken(wanted) || siblingClaimsIt;
      out.push({
        field: pair.field,
        from: `${pair.from}/${name}`,
        basename: name,
        proposed: blockedByTaken ? null : wanted,
        blocked: blockedByTaken ? "taken" : null,
        blockedBy: blockedByTaken ? wanted : null,
      });
    }
  }
  return out;
}

// The type values a retype scope introduces, deduplicated and in first-seen
// order. conventionsAfterScope folds these into the base type enum's
// extendedBy, so an article retyped to a value the enum does not carry does not
// start failing the write-time hook the moment the migration lands.
export function retypeExtensions(scope) {
  const out = [];
  for (const item of list(scope && scope.retypes)) {
    const value = item && item.typeTo;
    if (value == null) continue;
    if (!out.includes(String(value))) out.push(String(value));
  }
  return out;
}

// The setting whose kbRoot, homebrewRoot, or sessionReportsRoot contains this
// folder, or null. Longest matching root wins, so a nested prong resolves to
// the setting that actually owns it rather than to whichever came first.
function settingForFolder(settings, folder) {
  let best = null;
  let bestLen = -1;
  for (const setting of list(settings)) {
    for (const root of prongRootsOf(setting)) {
      const r = toPosix(root);
      if (!r) continue;
      if ((folder === r || folder.startsWith(`${r}/`)) && r.length > bestLen) {
        best = setting;
        bestLen = r.length;
      }
    }
  }
  return best;
}

// The index a folder holds, or null. Used by planAbsorbFolders for the PARENT it
// dissolves into and by planSplitFolders for the folder it divides, in both cases
// to decide whether there is an index to rebuild.
//
// PLAN-AWARE, on the same terms and for the same measured reason as the folder
// enumeration in planAbsorbFolders: a folder an earlier operation in this plan
// moves into place holds its index at its pre-move path today, and a raw
// readdirSync there answered "no index" and silently dropped the rebuild. The kind
// and the pending list are passed in rather than assumed, because the two callers
// ask at different ranks and precedingOperations checks that.
//
// The path returned is the POST-plan one, under the folder as the scope names it,
// because rebuild-index ranks 9 and runs after every move that could have carried
// the file there.
function existingIndexIn(ctx, folder, suffix, kind, pending) {
  if (!suffix) return null;
  const at = planResolve(ctx, folder, kind, pending);
  // Nothing will be there to rebuild from, or nothing is there to read now.
  if (at.vacated || at.creates || !at.path) return null;
  let names;
  try {
    names = readdirSync(path.resolve(ctx.projectRoot, at.path)).sort();
  } catch {
    return null;
  }
  for (const name of names) {
    if (!name.toLowerCase().endsWith(".md")) continue;
    if (name.slice(0, -3).endsWith(suffix)) return `${folder}/${name}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Ignored sources
// ---------------------------------------------------------------------------

// Asks git, once, which paths it ignores, and hands back the predicates the
// three finders below are built from. Built once per prechecks run so that
// answering three questions still costs one pair of git calls.
//
// Returns null when the question cannot be answered at all: no projectRoot
// (re-running the prechecks against a bare plan object, which carries no root),
// a projectRoot that is not there, a project that is not a git repository, or a
// git call that failed for any reason including outrunning maxBuffer. Every
// finder propagates that null rather than inventing an empty answer.
function ignoreOracle(projectRoot) {
  if (!projectRoot || !existsSync(projectRoot)) return null;

  const git = (argv) => {
    try {
      return execFileSync("git", argv, {
        cwd: projectRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch {
      return null;
    }
  };

  // --porcelain paths are relative to the repository root, not to cwd, so the
  // operation sources have to be expressed against the same root before they
  // can be compared. A consumer project sitting inside a larger repository
  // would otherwise never match.
  const top = git(["rev-parse", "--show-toplevel"]);
  // -z, and NOT the default line-oriented format. Without it git C-quotes any
  // path holding a byte above 0x7F and escapes it in octal, so
  // "settings/rolara/éclair-notes.md" arrives as
  // "settings/rolara/\303\251clair-notes.md". That is not JSON, so it cannot be
  // decoded by parsing it as JSON, and it cannot be recovered by stripping the
  // quotes either: the backslashes survive into the path and then read as
  // separators, and the entry matches nothing. git quotes the WHOLE path when
  // any one component needs it, so a single accented directory would hide every
  // ignored file beneath it and the never-move-ignored-files rail would not
  // fire. -z emits the path raw and NUL-terminated, and still carries the
  // trailing slash on a directory entry that the prefix test below depends on.
  const status = git(["status", "--ignored", "--porcelain", "-z"]);
  // Not a repository, or git could not be asked: undetermined, not "none".
  if (top == null || status == null) return null;
  const repoRoot = top.trim();

  const ignoredFiles = new Set();
  const ignoredDirs = [];
  for (const record of status.split("\0")) {
    if (!record.startsWith("!! ")) continue;
    // Exactly the path: two status characters, one space, then the raw bytes to
    // the NUL. No trim, because a trailing space would be part of the name.
    const p = record.slice(3);
    // --ignored reports an entirely ignored directory as one entry with a
    // trailing slash rather than listing every file inside it, so the slash has
    // to survive to here.
    if (p.endsWith("/")) ignoredDirs.push(p);
    else ignoredFiles.add(p);
  }

  const repoRelative = (p) => {
    const rel = toPosix(path.relative(repoRoot, path.resolve(projectRoot, p)));
    return rel === "" || rel.startsWith("../") ? null : rel;
  };

  return {
    isIgnored(p) {
      const rel = repoRelative(p);
      if (rel == null) return false;
      if (ignoredFiles.has(rel)) return true;
      return ignoredDirs.some((d) => rel === d.slice(0, -1) || rel.startsWith(d));
    },
    // Everything git reports ignored that lives BENEATH a path, which is a
    // different question from whether that path is itself ignored.
    ignoredBeneath(p) {
      const rel = repoRelative(p);
      if (rel == null) return [];
      const prefix = `${rel}/`;
      const out = [];
      for (const f of ignoredFiles) if (f.startsWith(prefix)) out.push(f);
      for (const d of ignoredDirs) if (d.startsWith(prefix)) out.push(d);
      return out.sort();
    },
  };
}

const IGNORED_SOURCE_REASON =
  "Source is git-ignored, so the pre-migration snapshot does not contain it. Reported and left where it is; moving it would be unrecoverable.";

// The same verdict for the one source an operation REMOVES rather than moves.
const IGNORED_INDEX_REASON =
  "This folder's own index is git-ignored, so the pre-migration snapshot does not contain it. The dissolution removes that index with git rm, which on an untracked file fails outright and would leave the folder's articles already moved. Reported and left where it is.";

// An ignored file is not in the snapshot, so moving it would be unrecoverable.
// Every operation whose SOURCE is ignored is reported here and skipped by the
// apply phase. It does not fail the run: see runPrechecks.
//
// The test is per OPERATION SOURCE, and it is NOT a test of each file beneath
// that source. An operation whose source is a directory, which is every
// relocate-prong and every vault move, is skipped only when git ignores the
// DIRECTORY ITSELF; when the directory is tracked but holds ignored files, the
// operation runs and `git mv` carries those ignored files along with everything
// else. Measured: with oldprong/editor-state/ ignored, `git mv oldprong
// newprong` moves its contents too, and a later `git reset --hard` does not
// bring them back, so for those files the snapshot no longer restores the
// pre-migration state. Nothing is lost and the files arguably belong at the new
// path, but the claim this module makes about its snapshot is narrower than it
// reads, so findIgnoredWithinSources reports exactly that set and the apply
// phase names it in the run's messages.
//
// THREE states, not two, and a consumer using this as a skip list has to tell
// them apart:
//
//   []    determined, and nothing in the plan has an ignored source.
//   [...] determined, and these are the operations to skip.
//   null  NOT DETERMINED; see ignoreOracle for the four ways that happens.
//
// null and [] are not interchangeable, which is why null rather than a flag
// beside an empty array: a consumer that iterates it without handling the third
// state fails loudly instead of quietly reading "unknown" as "nothing to skip".
// The non-repo case is the sharp one. No repository means no snapshot either,
// so it is not that nothing is ignored, it is that EVERY source is outside the
// snapshot, and returning [] there would say the opposite.
function findIgnoredSources(operations, oracle) {
  if (oracle === null) return null;
  const out = [];
  for (const o of list(operations)) {
    if (!o || typeof o !== "object") continue;
    for (const source of [o.from, ...list(o.sources)]) {
      if (!source || !oracle.isIgnored(source)) continue;
      out.push({ op: o.op, source: toPosix(source), from: o.from, to: o.to, reason: IGNORED_SOURCE_REASON });
    }
    // absorb-folder and split-folder never move their own `from`. Each moves the
    // files it enumerates, one `git mv` at a time, so the source that can be
    // git-ignored is one of those FILES rather than the folder, and enumerating
    // only o.from left a git-ignored file invisible here. Two things then went
    // wrong, both measured: findDestinationCollisions credited the file with
    // vacating a path it will never leave, permitting a rename onto a git-ignored
    // file that has no snapshot; and applyPlan's skip list, which reads this same
    // set, moved every preceding file and then failed mid-operation, because
    // `git mv` on an ignored file hard-fails with "not under version control",
    // exit 128.
    //
    // Measured again for split-folder, whose articles are nested inside
    // `buckets`: with the destination half of the enumeration fixed and this one
    // left reading `articles` alone, a relocate-path onto a git-ignored article
    // went from correctly refused to reported ok with zero collisions, which is
    // the same silent overwrite of an unsnapshotted file. articleMovesOf is why
    // both halves see the same set.
    //
    // Reported with the FILE's own from and to rather than the folder's. That is
    // what the report should read as (the move that will not happen), and it is
    // what findDestinationCollisions needs: it withholds vacate credit by
    // matching this `from` against each destination entry's `from`, which for an
    // enumerated file is the file's own path. Naming the folder there would
    // leave the hole open.
    for (const a of articleMovesOf(o)) {
      if (!a.from || !oracle.isIgnored(a.from)) continue;
      out.push({ op: o.op, source: toPosix(a.from), from: toPosix(a.from), to: toPosix(a.to), reason: IGNORED_SOURCE_REASON });
    }
    // absorb-folder's own index, the one file the kind REMOVES rather than moves.
    // It is a source on the same terms as the files above: `git rm` on a tracked
    // file is undone by the snapshot and on an untracked one hard-fails, so an
    // ignored index left invisible here meant the absorb was not skipped, every
    // article moved, and only then did the removal fail. Reported with no `to`,
    // because nothing is its destination, which is also why it grants no vacate
    // credit in findDestinationCollisions.
    if (o.index && oracle.isIgnored(o.index)) {
      out.push({ op: o.op, source: toPosix(o.index), from: toPosix(o.index), to: null, reason: IGNORED_INDEX_REASON });
    }
  }
  return out;
}

// The ignored files a directory move carries along with it. Reported, never
// skipped: the operation itself is legitimate, its source is tracked, and
// refusing to relocate a whole prong because one editor-state file sits inside
// it would abort the migration this release exists to perform. What the report
// buys is that the DM learns which files `git reset --hard` will not put back.
//
// Array OR null, on the same terms as findIgnoredSources.
//
// absorb-folder's FOLDER-LEVEL pair is excluded, keyed on the kind, because the
// kind is exactly what decides whether the directory itself is what moves. This
// one's `from` IS a directory, so it reached this report, but it is never handed
// to `git mv`: the executor moves each file in `articles` individually. So the
// reason below, "git mv carries them to the new path", is false for it, and the
// disclosure the DM most needs is the opposite one. Every file in the folder is
// enumerated, so a git-ignored file beneath it is an ignored SOURCE, which
// findIgnoredSources reports and the apply phase skips the whole dissolution over.
//
// THE PER-FILE MOVES ARE INCLUDED, and reading `from`/`to` alone left them out.
// Each of them IS handed to `git mv`, one at a time, so the reason below is true
// of them word for word. It costs nothing for absorb-folder, whose articles are
// always files (a folder holding a subfolder is declined outright), and it closes
// the gap for split-folder, which deliberately permits a bucket article that is a
// DIRECTORY ("a directory named as a bucket article still moves correctly through
// git mv") and carries no folder-level `to` at all, so not one of its moves could
// reach this report. A bucket article that is a directory holding a git-ignored
// draft moved that draft out of the snapshot's reach with no disclosure, which is
// the one out-of-snapshot shape the apply header claims is always disclosed.
function findIgnoredWithinSources(operations, oracle, projectRoot) {
  if (oracle === null) return null;
  const out = [];
  for (const o of list(operations)) {
    if (!o || typeof o !== "object") continue;
    const pairs = [];
    if (o.from && o.to && o.op !== "absorb-folder") pairs.push({ from: o.from, to: o.to });
    for (const a of articleMovesOf(o)) if (a.from && a.to) pairs.push({ from: a.from, to: a.to });
    for (const pair of pairs) {
      let st;
      try {
        st = statSync(path.resolve(projectRoot, pair.from));
      } catch {
        continue;
      }
      if (!st.isDirectory()) continue;
      const entries = oracle.ignoredBeneath(pair.from);
      if (entries.length === 0) continue;
      out.push({
        op: o.op,
        from: toPosix(pair.from),
        to: toPosix(pair.to),
        entries,
        reason:
          "These git-ignored paths live inside a directory this operation moves, so git mv carries them to the new path. They are outside the snapshot, so restoring it does not put them back.",
      });
    }
  }
  return out;
}

// The git-ignored files a plan names as REFERRERS, whose wikilinks the rewrite
// half edits in place.
//
// Decided deliberately, because the module's stated reason for skipping an
// ignored SOURCE ("outside the snapshot, so moving it would be unrecoverable")
// applies word for word to editing one. Chosen: EDIT the ignored referrer, and
// report it here so the DM can find out. The reasoning is that the rename breaks
// that file's wikilink whether or not the rewrite runs. Skipping does not leave
// the ignored file untouched, it leaves it holding a dead link, and a dead
// wikilink is valid markdown that fails silently in Obsidian. So the real choice
// is between an ignored file that is repaired and an ignored file that is
// broken, with neither outcome recoverable from the snapshot. Repair wins.
//
// The two things that keep that defensible are the same two limits the rename
// path already lives under: only the files the plan NAMES are touched, and only
// the wikilink TARGET is changed, leaving display text, anchors, path prefixes,
// and every other byte alone. The third is this report, which is what turns an
// unrecoverable edit into a disclosed one.
//
// Skipping was the alternative, and it was rejected on more than the dead link
// it leaves: a rename whose referrer set includes an ignored file would then
// report applied false under the one-unit-of-work rule, so a single ignored
// drafts/ file linking to a renamed article would block the whole migration with
// no way through except deleting the DM's draft.
//
// Array OR null, on the same terms as findIgnoredSources.
function findIgnoredReferrers(operations, oracle) {
  if (oracle === null) return null;
  const out = [];
  const seen = new Set();
  for (const o of list(operations)) {
    if (!o || typeof o !== "object") continue;
    const pairs = list(o.links).map((ref) => ({ source: toPosix(o.from || ""), referrer: toPosix(ref) }));
    const named = o.sourceLinks && typeof o.sourceLinks === "object" ? o.sourceLinks : {};
    for (const key of Object.keys(named)) {
      for (const ref of list(named[key])) pairs.push({ source: toPosix(key), referrer: toPosix(ref) });
    }
    for (const pair of pairs) {
      if (!pair.referrer || !oracle.isIgnored(pair.referrer)) continue;
      const key = `${o.op}::${pair.source}::${pair.referrer}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        op: o.op,
        source: pair.source,
        referrer: pair.referrer,
        reason:
          "This referring file is git-ignored, so it is outside the snapshot. Its wikilink IS rewritten, because the rename would otherwise leave it holding a dead link, but restoring the snapshot will not undo that edit.",
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rule lookups
// ---------------------------------------------------------------------------

// Accepts either a rules map or the whole base-rules.json shape.
function rulesOf(source) {
  if (!source || typeof source !== "object") return {};
  if (source.rules && typeof source.rules === "object") return source.rules;
  return source;
}

function ruleDescription(source, ruleId) {
  const rule = rulesOf(source)[ruleId];
  return rule && typeof rule.description === "string" ? rule.description : "";
}

function ruleParam(source, ruleId, key, fallback) {
  const rule = rulesOf(source)[ruleId];
  if (!rule || !rule.params || !(key in rule.params)) return fallback;
  return rule.params[key];
}

function settingAt(settings, settingIndex) {
  if (!Number.isInteger(settingIndex)) return null;
  const all = list(settings);
  return settingIndex >= 0 && settingIndex < all.length ? all[settingIndex] : null;
}

// The owning setting's rules win over the base layer, because under v3 rules
// live per setting: the base layer is identical in every setting, and only the
// extras differ.
function indexSuffixFor(setting, baseRules) {
  const own = setting && setting.rules
    ? ruleParam(setting.rules, "structuralIndexParity", "indexSuffix", null)
    : null;
  if (typeof own === "string" && own !== "") return own;
  const base = ruleParam(baseRules, "structuralIndexParity", "indexSuffix", null);
  if (typeof base === "string" && base !== "") return base;
  return "-INDEX";
}

// items/ takes Items-INDEX.md. Only a fallback: a survey that knows the
// consumer's naming passes `basename` and this is never consulted.
function defaultIndexStem(folder) {
  const name = folder.slice(folder.lastIndexOf("/") + 1);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// ---------------------------------------------------------------------------
// The proposal file
// ---------------------------------------------------------------------------
//
// /migrate's plan is a written artifact the DM reads, may edit, and approves,
// following the proposal-file convention CONTEXT.md establishes for chronicler.
// It is one file serving two readers: prose and a table for the DM, and one
// fenced block carrying the operations for the executor.
//
// Execution follows the FILE. The DM may strike an operation, change a
// destination, or reorder the list, and what runs is what the file says, never
// what the conversation that produced it said. applyPlan re-runs the prechecks
// against whatever arrives for exactly this reason, so a hand-edited plan is a
// designed path rather than a tolerated one.

const PLAN_FENCE_OPEN = "```json professor-orb:plan";
const PLAN_FENCE_CLOSE = "```";

// A scoped plan's operations carry different fields by kind: relocate-path and
// rename-with-link-rewrite have both `from` and `to`, rebuild-index and
// create-index have only `to`, and split-folder, normalize-type,
// repair-frontmatter, and update-prose-paths have only `from`. Every kind is
// checked against SCOPED_PLANNERS above and against buildScopedPlan's planners
// directly (planPathMoves, planAbsorbFolders, planSplitFolders,
// planEntityRenames, planRebuildIndexes, planRetypes, planScopedRepairs,
// planSuffixRenames, planProsePathUpdates), which is the authority on what a
// real plan contains. rebuild-index falls back to `folder` for its location so
// the row is not blank on the from side, and split-folder falls back to its
// bucket folders so the row is not blank on the to side.
function proposalFrom(op) {
  if (typeof op.from === "string" && op.from) return op.from;
  if (op.op === "rebuild-index" && typeof op.folder === "string" && op.folder) return op.folder;
  return "";
}

function proposalTo(op) {
  if (typeof op.to === "string" && op.to) return op.to;
  if (op.op === "split-folder") {
    return list(op.buckets)
      .map((b) => b && b.folder)
      .filter(Boolean)
      .join(", ");
  }
  return "";
}

// A one-line, kind-specific summary of what an operation carries beyond
// `from`/`to`, so a kind like normalize-type or repair-frontmatter (neither of
// which has a `to`) still tells the DM something concrete rather than leaving
// a blank cell. This column never changes what executes: it is read from the
// SAME operation object the fenced block below serializes whole, so nothing it
// summarizes can drift from what the executor actually sees.
function proposalDetail(op) {
  switch (op.op) {
    case "absorb-folder": {
      const n = list(op.articles).length;
      const removed = op.index ? `, folder index ${op.index} removed` : "";
      return `${n} file${n === 1 ? "" : "s"} moved${removed}`;
    }
    case "split-folder": {
      const buckets = list(op.buckets);
      const names = buckets.map((b) => b && b.name).filter(Boolean);
      return `${buckets.length} bucket${buckets.length === 1 ? "" : "s"}: ${names.join(", ") || "(unnamed)"}`;
    }
    case "create-index":
      return "new index file";
    case "rebuild-index":
      return `link list rebuilt from ${op.folder || "(unknown folder)"}`;
    case "normalize-type":
      return `type ${op.typeFrom} -> ${op.typeTo}`;
    case "rename-entity": {
      const n = list(op.links).length;
      const nameChange = op.nameTo ? `, frontmatter name -> ${op.nameTo}` : "";
      return `${n} referring link${n === 1 ? "" : "s"} rewritten${nameChange}`;
    }
    case "rename-with-link-rewrite": {
      const n = list(op.links).length;
      return `${n} referring link${n === 1 ? "" : "s"} rewritten`;
    }
    case "repair-frontmatter": {
      const fields = list(op.insert);
      return `insert: ${fields.length ? fields.join(", ") : "(none)"}; reorder: ${op.reorder ? "yes" : "no"}`;
    }
    case "update-prose-paths": {
      const n = list(op.replacements).length;
      return `${n} path replacement${n === 1 ? "" : "s"}`;
    }
    default:
      return "";
  }
}

export function renderProposal({ scope, plan, projectRoot, settings }) {
  const operations = list(plan && plan.operations);
  const declined = list(plan && plan.declined);
  const prechecks = (plan && plan.prechecks) || {};
  const summary = (scope && scope.summary) || "(no summary recorded)";

  const counts = new Map();
  for (const op of operations) counts.set(op.op, (counts.get(op.op) || 0) + 1);

  const lines = [];
  lines.push("# /migrate proposal");
  lines.push("");
  lines.push(`**Project:** ${projectRoot || "(unknown)"}`);
  lines.push(`**Settings:** ${list(settings).map((s) => (s && s.name) || "(unnamed)").join(", ") || "(none)"}`);
  lines.push("");
  lines.push("## Scope, as understood");
  lines.push("");
  lines.push(summary);
  lines.push("");
  lines.push("## What will happen");
  lines.push("");
  if (operations.length === 0) {
    lines.push("Nothing. No operation resolved from this scope.");
  } else {
    for (const [kind, n] of counts) lines.push(`- ${kind}: ${n}`);
    lines.push("");
    lines.push("| # | Operation | From | To | Detail | Why |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    operations.forEach((op, i) => {
      const from = proposalFrom(op);
      const to = proposalTo(op);
      let detail = proposalDetail(op);
      // Only reachable for a shape none of the ten scoped kinds produces today
      // (see the comment above proposalFrom): a future or hand-edited kind with
      // no from, no to, and no detail this switch recognizes. The row still
      // names the operation and its reason rather than going blank, and the
      // fenced block below carries the object whole regardless.
      if (!from && !to && !detail) detail = "(see the plan block below for full detail)";
      const cell = (s) => String(s || "").replace(/\|/g, "/");
      lines.push(`| ${i + 1} | ${op.op} | ${cell(from)} | ${cell(to)} | ${cell(detail)} | ${cell(op.reason)} |`);
    });
  }
  lines.push("");
  lines.push("## Declined");
  lines.push("");
  if (declined.length === 0) {
    lines.push("Nothing was declined.");
  } else {
    for (const d of declined) lines.push(`- **${d.target}** (${d.op}): ${d.reason}`);
  }
  lines.push("");
  lines.push("## Prechecks");
  lines.push("");
  if (prechecks.ok === false) {
    lines.push(
      "**These prechecks did not pass, so this plan cannot execute as written.** Resolve the items below and re-run /migrate."
    );
    const collisions = list(prechecks.collisions);
    if (collisions.length > 0) {
      lines.push("");
      for (const c of collisions) {
        lines.push(
          c.kind === "in-plan"
            ? `- Two operations in this plan both target ${c.b}. ${c.reason}`
            : `- ${c.op || "(operation)"} would write to ${c.to}, which already exists. ${c.reason}`
        );
      }
    }
  } else {
    lines.push(
      "Prechecks passed. Destination collisions, unresolvable link targets, and ignored sources were all checked while this plan was built, not after approval."
    );
  }
  // Printed whether or not the prechecks passed, because it is not a precheck
  // verdict: a case-only rename executes fine. It is the one row in the table
  // above whose From and To name the same file on a case-insensitive filesystem,
  // so a DM skimming it cannot tell a deliberate correction from a typo in their
  // own scope. Named here so the approval is an informed one.
  const caseRenames = list(prechecks.caseRenames);
  if (caseRenames.length > 0) {
    lines.push("");
    lines.push(
      `${caseRenames.length} operation(s) change only letter case. On a case-insensitive filesystem the old and ` +
        "new names are the same file, so check each of these is the correction you meant rather than a typo:"
    );
    for (const o of caseRenames) lines.push(`- ${o.op}: ${o.from} to ${o.to}`);
  }
  lines.push("");
  lines.push("## Approval");
  lines.push("");
  lines.push(
    "Edit this file freely: strike an operation, change a destination, reorder the list. What runs is what this file says. Then tell /migrate to proceed."
  );
  lines.push("");
  lines.push(PLAN_FENCE_OPEN);
  lines.push(JSON.stringify({ operations, declined }, null, 2));
  lines.push(PLAN_FENCE_CLOSE);
  lines.push("");
  return lines.join("\n");
}

// A fence marker only opens or closes a fence when it starts a line: that is
// how markdown fences work, and it is what tells a real fence apart from
// prose that merely quotes the marker mid-sentence (something the DM is
// explicitly invited to do when leaving a note about an edit). Returns the
// index of the true start of index's line (walking back over indentation),
// or -1 if something other than whitespace sits between the previous newline
// and index.
function lineStart(src, index) {
  let i = index;
  while (i > 0 && (src[i - 1] === " " || src[i - 1] === "\t")) i--;
  if (i === 0 || src[i - 1] === "\n") return i;
  return -1;
}

// A closing fence carries no info string: nothing but whitespace may follow
// the fence characters on that line. This is what tells a genuine close apart
// from the same three backticks turning up inside a JSON string value later
// in the block, which would otherwise truncate the block early.
function isBareFenceLine(src, index, markerLength) {
  let i = index + markerLength;
  while (i < src.length && src[i] !== "\n") {
    if (src[i] !== " " && src[i] !== "\t" && src[i] !== "\r") return false;
    i++;
  }
  return true;
}

export function parseProposal(text) {
  const src = String(text == null ? "" : text);
  const starts = [];
  let at = src.indexOf(PLAN_FENCE_OPEN);
  while (at !== -1) {
    if (lineStart(src, at) !== -1) starts.push(at);
    at = src.indexOf(PLAN_FENCE_OPEN, at + PLAN_FENCE_OPEN.length);
  }
  if (starts.length === 0) {
    return { ok: false, reason: "No professor-orb:plan block in this file, so there is nothing to execute." };
  }
  if (starts.length > 1) {
    // Two blocks are two answers to "what did the DM approve". Picking one
    // silently executes something they may have struck by pasting a replacement
    // above the original.
    return {
      ok: false,
      reason: `${starts.length} professor-orb:plan blocks in this file. Leave exactly one; which of them is the approved plan is not something to guess at.`,
    };
  }

  const bodyStart = starts[0] + PLAN_FENCE_OPEN.length;
  let end = -1;
  let closeAt = src.indexOf(PLAN_FENCE_CLOSE, bodyStart);
  while (closeAt !== -1) {
    const ls = lineStart(src, closeAt);
    if (ls !== -1 && isBareFenceLine(src, closeAt, PLAN_FENCE_CLOSE.length)) {
      // ls is the start of the closing fence's own line; the body stops one
      // character earlier, at the newline that precedes it.
      end = ls > 0 ? ls - 1 : bodyStart;
      break;
    }
    closeAt = src.indexOf(PLAN_FENCE_CLOSE, closeAt + PLAN_FENCE_CLOSE.length);
  }
  if (end === -1) {
    return { ok: false, reason: "The professor-orb:plan block is never closed." };
  }

  let parsed;
  try {
    parsed = JSON.parse(src.slice(bodyStart, end));
  } catch (err) {
    return { ok: false, reason: `Could not parse the professor-orb:plan block as JSON: ${firstLine(err.message)}` };
  }
  if (!parsed || !Array.isArray(parsed.operations)) {
    return { ok: false, reason: "The professor-orb:plan block carries no operations array." };
  }
  return { ok: true, plan: { operations: parsed.operations, declined: list(parsed.declined) } };
}

// The conventions file as it should stand AFTER a scope has been applied.
//
// Three things a scope can change are recorded in conventions.json: the type
// values in use, the prong roots, and the campaign list. Leaving any of them
// stale is quiet and expensive. A kbRoot that no longer exists makes /scribe
// refuse to resolve its lane, leaves the write-time hook silent because no rule
// resolves, and makes the sweep report every article as unattributed. None of
// those announces itself as a conventions problem.
//
// Pure: the argument is never mutated, because the caller holds the file it
// moved aside and must be able to fall back to it unchanged if this returns
// something it does not like.
//
// `applied` is OPTIONAL and is the operations that actually ran: applyPlan's
// `result.applied`. Omitted, this function has to assume the whole scope ran,
// which is what it did before the argument existed and what every two-argument
// caller still gets, byte for byte. Handed the applied operations, the
// setting-lifecycle cases below record only what those operations demonstrate.
// See appliedGate for the rule and for why the scope alone is not enough.
export function conventionsAfterScope(conventions, scope, applied) {
  const changes = [];
  const next = JSON.parse(JSON.stringify(conventions || {}));
  const s = scope || {};
  const gate = appliedGate(applied);

  // Retypes extend the type enum. frontmatterTypeEnum ships at enforcement
  // block, so an article retyped to a value the enum does not carry fails the
  // write-time hook on its next edit, on output the migration itself produced.
  const introduced = retypeExtensions(s);
  if (introduced.length > 0) {
    for (const setting of list(next.settings)) {
      const rule = setting && setting.rules && setting.rules.frontmatterTypeEnum;
      if (!rule) continue;
      const base = list(rule.params && rule.params.values).map(String);
      const existing = list(rule.extendedBy).map(String);
      const added = [];
      for (const value of introduced) {
        // A base value needs no extension. Adding it would be noise in a file
        // the DM reads and would imply the project contributed something it did
        // not.
        if (base.includes(value) || existing.includes(value)) continue;
        existing.push(value);
        added.push(value);
      }
      if (added.length === 0) continue;
      rule.extendedBy = existing;
      changes.push(
        `Extended ${setting.name || "(unnamed setting)"}'s type enum with ${added.join(", ")}, so the retyped articles do not start failing the write-time hook.`
      );
    }
  }

  // A rename repoints the name, the prong roots that moved, and the tag registry.
  for (const [i, item] of list(s.settingRenames).entries()) {
    const from = String((item && item.from) || "");
    const to = String((item && item.to) || "");
    const setting = settingNamed(next.settings, from);
    // The same three conditions planSettingRenames declines on, so this half
    // cannot record a rename the plan half refused to plan.
    if (!setting || !to || to === from) continue;
    // Nothing this entry asked for ran, so nothing about it is recorded.
    if (gate && !gate.ran(groupIdFor("settingRenames", i))) continue;
    const moved = repointProngs(setting, groupIdFor("settingRenames", i), gate, (root) =>
      rootRenamedTo(root, to)
    );
    // The tag registry follows the NAME rather than an applied operation, and it
    // is the one path here that does. No operation moves it: it is a derived
    // inventory the validation sweep regenerates at whatever path this file names,
    // and the write-time hook's tag check returns undetermined rather than a
    // violation while the file is absent, so pointing it at the new name costs a
    // quiet check until the sweep /migrate's report recommends runs again.
    const registryBefore = typeof setting.tagRegistryPath === "string" ? setting.tagRegistryPath : null;
    if (registryBefore !== null) {
      setting.tagRegistryPath = renamePathComponents(registryBefore, from, to);
    }
    setting.name = to;
    changes.push(
      `Renamed setting ${from} to ${to} and ${repointedPhrase(moved)}.` +
        (registryBefore === null
          ? " This setting records no tag registry path, so there was none to repoint."
          : setting.tagRegistryPath === registryBefore
            ? ` The tag registry path does not contain the name, so it is unchanged: ${registryBefore}.`
            : ` The tag registry path follows the name: ${setting.tagRegistryPath}.`)
    );
  }

  for (const [i, item] of list(s.settingRetirements).entries()) {
    const name = String((item && item.setting) || "");
    const setting = settingNamed(next.settings, name);
    if (!setting) continue;
    if (gate && !gate.ran(groupIdFor("settingRetirements", i))) continue;
    const archiveRoot = toPosix((item && item.archiveRoot) || "") || "archive";
    // The name as the SCOPE gave it. It equals setting.name here by construction,
    // since that is what settingNamed matched on, and it is written this way
    // because it is also the name planSettingRetirements built its destinations
    // from: both halves read one source for the archive path.
    const moved = repointProngs(
      setting,
      groupIdFor("settingRetirements", i),
      gate,
      (root, field) => `${archiveRoot}/${name}/${prongFolderFor(field)}`
    );
    // MARKED, never deleted. Deleting the entry destroys the record that this
    // world existed, and every session report, article, and homebrew entry under
    // the archive would then belong to no setting at all: unattributed to the
    // validation sweep, unresolvable to /scribe and /log.
    setting.retired = true;
    changes.push(
      `Marked setting ${name} retired and ${repointedPhrase(moved, `into ${archiveRoot}/`)}. The entry is kept, ` +
        "not deleted: everything under the archive would otherwise belong to no setting at all."
    );
  }

  // A retired campaign leaves the active list and is RECORDED, for the same
  // reason a retired setting's entry is kept rather than deleted.
  for (const [i, item] of list(s.campaignRetirements).entries()) {
    const setting = settingNamed(next.settings, item && item.setting);
    const campaign = String((item && item.campaign) || "");
    if (!setting || !campaign) continue;
    if (gate && !gate.ran(groupIdFor("campaignRetirements", i))) continue;
    const before = list(setting.campaigns);
    // Only a campaign the setting ACTUALLY lists, which is the same condition
    // planCampaignRetirements declines on. Without it, a scope naming a campaign
    // that was never there grows a retiredCampaigns entry for a folder nothing
    // moved, and a second run of the same scope would grow a duplicate.
    if (!before.some((c) => campaignName(c) === campaign)) continue;
    setting.campaigns = before.filter((c) => campaignName(c) !== campaign);
    setting.retiredCampaigns = [...list(setting.retiredCampaigns), campaign];
    changes.push(
      `Moved campaign ${campaign} out of ${setting.name}'s campaigns and into retiredCampaigns, so the lane ` +
        "commands stop offering it while the record that it happened survives."
    );
  }

  // A split ADDS an entry, for the world it made out of part of another one.
  for (const [i, item] of list(s.settingSplits).entries()) {
    const source = settingNamed(next.settings, item && item.from);
    const name = String((item && item.name) || "");
    const kbRoot = toPosix(item && item.kbRoot);
    // The same conditions planSettingSplits declines on, so this half cannot
    // record a split the plan half refused to plan. The two per-file declines are
    // not mirrored, because they drop one move rather than the entry; the four
    // that drop the whole entry are all here.
    if (!source || !name || !kbRoot) continue;
    // A source with no kbRoot, and a new kbRoot equal to or nested with the
    // source's. planSettingSplits declines both unconditionally, so no such split
    // can produce an operation and the three-argument gate below never lets one
    // through. What these two lines are for is the TWO-ARGUMENT call, which has no
    // applied list to consult and therefore records the world the scope asked for:
    // without them it would write down a second knowledge base nested inside the
    // first, leaving every article under the inner root claimed by both settings.
    // Silent, unlike the duplicate-name case below, because these two sit BEFORE
    // the gate and so are reached mostly by scopes where nothing moved, where a
    // changes line would report on work that never happened; the plan half's own
    // declined row is what tells the DM.
    const sourceRoot = toPosix(source.kbRoot);
    if (!sourceRoot) continue;
    if (kbRoot === sourceRoot || kbRoot.startsWith(`${sourceRoot}/`) || sourceRoot.startsWith(`${kbRoot}/`)) {
      continue;
    }
    // NOTHING LANDED IN THE FOLDER THIS ENTRY WOULD RECORD, so nothing about it
    // is recorded. repointProngs is no help here: it repoints roots a setting
    // ALREADY records, and this case has no such root to key on. What backs the
    // new entry instead is an applied operation of this entry's own group whose
    // destination is inside the kbRoot about to be written down, which satisfies
    // both halves of the rule at appliedGate: at least one operation carrying the
    // group applied, and the one path recorded here is a path an applied
    // operation demonstrably put something at. An entry recorded for a kbRoot
    // nothing reached names a folder that is not there, which makes /scribe
    // refuse to resolve its lane and the sweep report every article under it as
    // unattributed, and none of that announces itself as a conventions problem.
    if (gate && !gate.placedUnder(groupIdFor("settingSplits", i), kbRoot)) continue;
    // ONE ENTRY PER NAME. planSettingSplits declines this scope, so the ordinary
    // path never reaches here; what does reach it is a proposal file the DM edited
    // to add the moves back, which is exactly the case that must not end with two
    // entries under one name and settingNamed resolving to whichever came first.
    // Reported rather than silent, because the articles did move.
    if (settingNamed(next.settings, name)) {
      changes.push(
        `conventions.json already records a setting called ${name}, so no entry was added for the world this split ` +
          "creates. The articles it moved belong to no setting until one is added: give the new setting a name of " +
          "its own and re-run."
      );
      continue;
    }
    next.settings.push({
      name,
      kbRoot,
      // The two prongs no operation touches. A world with no homebrew folder and
      // no session reports yet is the ordinary state of a setting that has just
      // been created, and it is the state planSettingRenames already declines a
      // prong for rather than treating as an error; recording the canonical
      // sibling paths is what lets /log and /homebrew resolve a lane the first
      // time the DM writes into one. Taken through prongFolderFor so this cannot
      // drift from the layout the retirements build their archive paths out of.
      homebrewRoot: toPosix(item && item.homebrewRoot) || `${prongFolderFor("homebrewRoot")}/${name}`,
      sessionReportsRoot:
        toPosix(item && item.sessionReportsRoot) || `${prongFolderFor("sessionReportsRoot")}/${name}`,
      // Empty rather than inherited. A campaign is a lane /log commits against,
      // and it lives in exactly one world; copying the source's list would offer
      // the DM lanes whose session reports are in the other setting entirely.
      campaigns: [],
      // A derived inventory the validation sweep regenerates at whatever path
      // this file names, so the canonical name for a new setting is the whole of
      // what is needed here. Not derived from the source's path: that one may sit
      // anywhere, and a rewrite that failed to change it would hand two settings
      // one registry.
      tagRegistryPath: `.professor-orb/tag-registry.${name}.json`,
      // THE SOURCE SETTING'S RULES, not an empty set. A split divides ONE world's
      // material, and the extras layer that world accumulated describes the
      // articles on both sides of the division; an empty set would leave every
      // article that moved unchecked by the rules it was written under. Deep
      // copied, so a later edit to either setting does not silently change the
      // other.
      rules: JSON.parse(JSON.stringify(source.rules || {})),
    });
    changes.push(
      `Added a settings entry for ${name} at ${kbRoot}, carrying ${source.name}'s rules, with an empty campaign ` +
        `list. ${source.name} keeps its own entry unchanged: a split divides a world's material, it does not ` +
        "retire the world."
    );
  }

  // A merge FOLDS one world's entry into another's and MARKS the source. It does
  // not remove it, for the reason a retirement does not: deleting the entry destroys
  // the record that the world existed, and everything that moved would belong to no
  // setting at all for auditing purposes. Inside the gate, like the two lifecycle
  // cases above and unlike retypes, because everything it records describes folders
  // that moved.
  for (const [i, item] of list(s.settingMerges).entries()) {
    const source = settingNamed(next.settings, item && item.from);
    const target = settingNamed(next.settings, item && item.into);
    // The two conditions planSettingMerges declines on, so this half cannot record a
    // merge the plan half refused to plan. The per-prong and per-child declines are
    // not mirrored, because they drop one move rather than the entry, and because
    // both turn on what is on disk, which this function does not read.
    if (!source || !target || source === target) continue;
    const group = groupIdFor("settingMerges", i);
    // Nothing this entry asked for ran, so nothing about it is recorded. Rule 1 at
    // appliedGate, and this is the case with the highest stakes for it: a world
    // marked merged whose material never moved is a world whose articles are still
    // under roots the file has just stopped treating as live.
    if (gate && !gate.ran(group)) continue;

    // THE CAMPAIGNS, one at a time, because a campaign is a recorded PATH as much as
    // a prong root is: settings[].campaigns plus sessionReportsRoot resolves to the
    // folder /log commits into. So rule 2 governs it. With a gate, a campaign is
    // folded in only when an applied operation of this entry moved exactly that
    // folder, and it is recorded under the name that operation actually gave it,
    // which is what makes a proposal file the DM edited come out right. Without one,
    // "the whole scope ran" is the contract, and the name is computed the same way
    // the plan half computes it, through disambiguatedName.
    //
    // A NAME BOTH WORLDS USED IS RENAMED, not fused. Two campaigns sharing one lane
    // would interleave two histories the DM never agreed to join, and the lane
    // commands would offer one entry for two worlds' worth of sessions. The suffix
    // goes on the incoming one, exactly as it does for an article.
    const reports = toPosix(source.sessionReportsRoot);
    const campaigns = list(target.campaigns);
    const folded = [];
    for (const entry of list(source.campaigns)) {
      const name = campaignName(entry);
      if (!name) continue;
      const landed = gate
        ? gate.movedFrom(group, `${reports}/${name}`)
        : campaigns.some((c) => campaignName(c) === name)
          ? `${reports}/${disambiguatedName(name, source.name)}`
          : `${reports}/${name}`;
      if (!landed) continue;
      const under = path.posix.basename(landed);
      if (campaigns.some((c) => campaignName(c) === under)) continue;
      campaigns.push(under);
      folded.push(under);
    }
    if (folded.length > 0) target.campaigns = campaigns;

    // THE SOURCE'S TYPE EXTENSIONS. They describe articles that now live in the
    // target, and frontmatterTypeEnum ships at enforcement block, so dropping them
    // would make every merged article of an extended type fail the write-time hook
    // on its next edit, on output this migration itself produced.
    const targetRule = target.rules && target.rules.frontmatterTypeEnum;
    const sourceRule = source.rules && source.rules.frontmatterTypeEnum;
    const extended = [];
    if (targetRule && sourceRule) {
      const base = list(targetRule.params && targetRule.params.values).map(String);
      const existing = list(targetRule.extendedBy).map(String);
      for (const value of list(sourceRule.extendedBy).map(String)) {
        // A value the target's own enum already carries needs no extension, on the
        // same reasoning the retype case above gives.
        if (base.includes(value) || existing.includes(value)) continue;
        existing.push(value);
        extended.push(value);
      }
      if (extended.length > 0) targetRule.extendedBy = existing;
    }

    // MARKED, never deleted, and its own roots left exactly where they are. Pointing
    // them at the target's would put two entries on one folder, and settingForFolder
    // resolves an article to the longest matching root: a tie would hand every
    // article in the merged vault to whichever entry came first, which is how one
    // world's articles start being checked against another world's rules.
    source.mergedInto = target.name;
    source.retired = true;
    changes.push(
      `Merged ${source.name} into ${target.name}: ` +
        (folded.length > 0
          ? `campaigns ${folded.join(", ")} folded into ${target.name}'s lane list`
          : `no campaign folder of ${source.name}'s moved, so none was folded into ${target.name}'s lane list`) +
        ", " +
        (extended.length > 0
          ? `type extensions ${extended.join(", ")} folded in`
          : `no type extension of its own that ${target.name}'s enum did not already carry`) +
        `. The ${source.name} entry is kept and marked merged rather than deleted, with its own roots left where ` +
        "they are: deleting it would destroy the record that the world existed, and repointing its roots at " +
        `${target.name}'s would leave two entries claiming one folder.`
    );
  }

  return { conventions: next, changes };
}

// What the applied operations say about a scope entry, or null when the caller
// did not pass any.
//
// WHY THE SCOPE IS NOT ENOUGH. The scope is what the DM asked for. Between it and
// the disk sit two filters that remove work without refusing the run: a plan-time
// decline (a git-ignored prong root declines its whole scope entry, a recorded root
// that is not on disk declines that prong) and an apply-time skip or failure. A plan
// that resolved to no operations at all is not refused either, so a scope handed
// here unfiltered can rewrite every prong root of a setting nothing touched. What
// that costs is at the top of conventionsAfterScope: none of it announces itself as
// a conventions problem.
//
// WHAT "SURVIVED" MEANS, and it is decided per OPERATION rather than per entry:
//
//   1. An entry counts as having happened at all when at least ONE operation
//      carrying its group id applied. Zero means nothing moved, so nothing about
//      that entry is recorded, not the name, not the retirement mark, not one root:
//      the file the caller moved aside already describes the tree correctly.
//   2. A recorded path is repointed only when an applied operation of that entry
//      moved exactly that path, and it is repointed to where that operation
//      actually put it rather than to where the scope said it would go.
//
// WHY NOT ALL-OR-NOTHING PER ENTRY, which is the tempting reading of "two of three
// prongs moved is not a rename that happened". Because applyPlan does not roll back:
// when the third `git mv` fails, the first two folders ARE at the new name. Skipping
// the whole entry then leaves conventions.json pointing at two paths that no longer
// exist, which is the exact failure this argument was added to prevent, only pointed
// the other way. And it cannot be told apart from the ordinary case: a setting whose
// homebrew folder does not exist yet has that prong declined at plan time, so two
// operations are all the entry ever emitted, and an all-or-nothing rule would refuse
// to record a rename that fully succeeded. Rule 2 is the only one that keeps every
// recorded path a path an applied operation demonstrates. It cannot leave the file
// describing a tree that does not exist, because it never writes a path no operation
// reported reaching.
//
// The cost is disclosed rather than silent: repointedPhrase names every root that
// did not move, and those lines are what Step 10 of /migrate reports to the DM.
//
// SCOPE OF THE RULE: paths an operation moves, which is every prong root and every
// campaign folder. tagRegistryPath is not one of them and is argued where it is
// written, in the rename case above.
//
// A CREATED root is the one shape rule 2 cannot be read off literally, because there
// is no recorded path to repoint: the split records a kbRoot for the first time. The
// rule still decides it, in the same terms. What an applied operation demonstrates
// there is not that a path moved but that a path was FILLED, so the entry is created
// only when an applied operation of its group landed a file inside the root about to
// be recorded. That is placedUnder below.
//
// TOLERANT of a shape it did not produce, on the same asymmetry the rest of this
// module runs on. A non-array (omitted, null, a caller that has no applied list)
// yields null and every case records what the scope asked for, which is what this
// function did before the argument existed. An entry with no group id licenses
// nothing, which is the safe direction: a lost id costs a conventions update the DM
// can re-run, while an invented one costs a file describing folders that are not there.
function appliedGate(applied) {
  if (!Array.isArray(applied)) return null;
  const ran = new Set();
  const moved = new Map();
  const into = new Map();
  for (const entry of applied) {
    // `result.applied` holds only operations that applied, but a caller handing
    // over a wider list must not have its failures read as successes.
    if (!entry || typeof entry !== "object" || entry.applied === false) continue;
    const from = toPosix(entry.from || "");
    const to = toPosix(entry.to || "");
    for (const id of groupsOf(entry)) {
      ran.add(id);
      // Keyed on the group AND the source path: two entries can move two roots,
      // and a rename that moved one setting's kbRoot says nothing about another's.
      if (from && to) moved.set(`${id}\n${from}`, to);
      if (to) into.set(id, [...list(into.get(id)), to]);
    }
  }
  return {
    ran: (id) => ran.has(id),
    movedFrom: (id, from) => moved.get(`${id}\n${toPosix(from || "")}`) || null,
    // Whether this entry actually put something INSIDE a folder, which is the
    // question a case that CREATES a recorded root has to ask. The two accessors
    // above both start from a path the file already records; a split records a
    // root for the first time and has no such path, so what backs it is that an
    // applied operation of its own group landed a file under that root. See the
    // split case in conventionsAfterScope.
    placedUnder: (id, root) => {
      const prefix = toPosix(root);
      if (!prefix) return false;
      return list(into.get(id)).some((to) => to.startsWith(`${prefix}/`));
    },
  };
}

// Repoint the prong roots one lifecycle entry moves, and report what it did.
//
// Shared by the rename, the retirement, and the merge, so all of
// them read the applied set the same way rather than each inventing a rule.
// `destinationFor` is consulted only when there is no gate, which is the "assume
// the whole scope ran" path; with a gate the destination comes from the operation
// that actually ran.
//
// NOT BY THE SPLIT, which has nothing here to key on: every root this walks is one
// the setting ALREADY records, and a split creates its entry rather than repointing
// one. It gates on gate.placedUnder instead, which asks the same question of an
// applied operation's destination; see the split case above.
//
// Mutates the `setting` it is handed, which is already a deep clone of the caller's
// file. conventionsAfterScope's purity rests on that clone and not on this.
function repointProngs(setting, group, gate, destinationFor) {
  const repointed = [];
  const left = [];
  for (const [field] of PRONG_FIELDS) {
    const root = setting[field];
    if (!root) continue;
    const landed = gate ? gate.movedFrom(group, root) : destinationFor(toPosix(root), field);
    if (!landed) {
      left.push(`${field} (${toPosix(root)})`);
      continue;
    }
    setting[field] = landed;
    repointed.push(field);
  }
  return { repointed, left };
}

// What repointProngs did, in the DM's terms, for the `changes` array /migrate
// reports in full.
//
// It counts rather than asserts. The line it replaced said "repointed all three
// prong roots" whatever happened, so a setting recording one root was told about
// three, and once the gate can leave a root behind that sentence would have been
// reporting a move that failed as one that landed.
function repointedPhrase(moved, into) {
  const where = into ? ` ${into}` : "";
  const names = moved.repointed.join(", ");
  const total = moved.repointed.length + moved.left.length;
  const head =
    moved.repointed.length === 0
      ? "repointed none of its prong roots"
      : moved.left.length === 0
        ? `repointed every prong root it records (${names})${where}`
        : `repointed ${moved.repointed.length} of the ${total} prong roots it records (${names})${where}`;
  if (moved.left.length === 0) return head;
  const one = moved.left.length === 1;
  return `${head}; ${moved.left.join(", ")} did not move and ${one ? "is" : "are"} left recorded where ${
    one ? "it is" : "they are"
  }`;
}

// The old setting name replaced inside a recorded path, by path COMPONENT rather
// than by substring.
//
// The obvious `path.split(old).join(new)` corrupts two shapes this file really
// holds. A name that is a SUBSTRING of another component rewrites that component
// too: with a setting called "orb", the canonical
// ".professor-orb/tag-registry.orb.json" becomes ".professor-<new>/...", moving
// the plugin's own install directory out from under the write-time hook that
// reads this path. And a name appearing MORE THAN ONCE is not always meant twice;
// only the parts that ARE the name should move.
//
// Directory components match whole. The basename matches on its dot-delimited
// parts, which is what makes ".professor-orb/tag-registry.rolara.json" follow a
// rename of "rolara" while ".professor-orb" stays exactly where it is, and what
// makes "settings/rolara/tags.json" follow the kbRoot it sits inside.
//
// THE EXTENSION IS NOT ONE OF THOSE PARTS. A setting may legitimately be named
// after a file extension, and matching the basename's last piece rewrote
// ".professor-orb/tag-registry.json.json" into ".professor-orb/tag-registry.j2.j2"
// for a setting called "json": a path with no extension left, naming a file that
// is not there. A name with no extension to hold back keeps every piece eligible,
// which covers both a dotless basename and a leading-dot one like ".rolara".
//
// An empty old name replaces nothing. `"".split("")` is every character, and
// joining those with the new name would rewrite the path into gibberish.
function renamePathComponents(rel, from, to) {
  const source = toPosix(rel);
  if (!from) return source;
  const parts = source.split("/");
  const last = parts.length - 1;
  return parts
    .map((part, i) => {
      if (i < last) return part === from ? to : part;
      const pieces = part.split(".");
      // A leading dot opens the basename rather than separating an extension, so
      // ".rolara" is one piece with no extension while ".tags.json" has one.
      const least = pieces[0] === "" ? 3 : 2;
      const extensionAt = pieces.length >= least ? pieces.length - 1 : -1;
      return pieces.map((piece, j) => (j !== extensionAt && piece === from ? to : piece)).join(".");
    })
    .join("/");
}

// ---------------------------------------------------------------------------
// Apply phase
// ---------------------------------------------------------------------------
//
// This is the only half of professor-orb that relocates a knowledge base.
// Everything else either reads, or writes one article after an explicit
// approval. Three properties hold that down, and none of them is optional:
//
//   1. THE SNAPSHOT PRECEDES EVERY MUTATION. applyPlan does not take the
//      snapshot itself; it REQUIRES one and verifies it, refusing to touch
//      anything unless HEAD exists and the working tree is clean. A dirty tree
//      means the commit at HEAD does not contain the current state, so there is
//      nothing to restore to, which is exactly the state in which a bulk move
//      must not start.
//
//   2. AN OPERATION WHOSE SOURCE IS GIT-IGNORED IS SKIPPED. Not failed, not
//      applied: skipped and reported. An ignored file is outside the snapshot,
//      so moving it would be unrecoverable. findDestinationCollisions is now
//      written against this contract too, deliberately declining to credit an
//      ignored-source operation with vacating its destination precisely because
//      this phase will not run it. Applying them anyway would break the
//      assumption the collision check was corrected to make.
//
//      READ THAT NARROWLY. The test is on the operation's own SOURCE, and it is
//      not a test of every file beneath that source, so the property is weaker
//      than "this run never touches anything outside the snapshot". Two shapes
//      fall outside it, both measured, and both are DISCLOSED in the run's
//      messages rather than silently allowed:
//
//        A directory move carries the ignored files inside it. `git mv oldprong
//        newprong` moves ignored contents too, and a later `git reset --hard`
//        does not bring them back. Reported as result.ignoredMoved.
//
//        A git-ignored REFERRING file named by the plan has its wikilink
//        rewritten in place. Reported as result.ignoredEdits. That is a
//        deliberate choice rather than an oversight; findIgnoredReferrers
//        carries the reasoning and the alternative that was rejected.
//
//   3. A RENAME AND ITS LINK REWRITE ARE ONE UNIT OF WORK with one applied
//      true/false entry. Not two batched passes. A dead wikilink is valid
//      markdown that fails silently in Obsidian, so a dropped rewrite is
//      invisible without this, and a move reported as done while its rewrite
//      was dropped is the failure the accounting exists to prevent.
//
//      A MERGE AND ITS LINK REWRITES ARE ONE UNIT on the same terms, and for
//      the same reason. A merge REMOVES its sources, so every wikilink that
//      named one dies with them, which is the same class of dead reference a
//      rename carries `links` to prevent. Both take their referring files from
//      the plan rather than re-deriving them here.
//
// EVERY RELOCATION GOES THROUGH git mv. Measured in
// docs/superpowers/specs/2026-07-28-mechanism-prototypes.mjs: a worker that can
// only Write copies content to the new path and cannot delete the original,
// which for a suffix rename leaves two files claiming one article and a
// guaranteed basename collision. A plain filesystem rename leaves a delete plus
// an untracked file, coherent only if both sides are staged. git mv records one
// staged rename. That is why a host dispatching per-operation workers has to
// grant them Bash, unlike validation-sweep.mjs's Read/Edit/Write fixers.
//
// The default worker is in-process rather than a subagent: every operation here
// is a deterministic mechanical edit with no judgment in it, and running them
// in-process is what makes this half testable against a disposable repository.
// A host that does want per-operation subagents passes them as `worker`; the
// dropped-worker accounting below is reused from validation-sweep.mjs's fix
// phase for exactly that case.

// Module-local. It was exported, and nothing in the plugin ever imported it: a
// caller that wants a different message passes options.commitMessage, which is
// the seam, and an export nobody reads is a second one to keep in step with it.
const DEFAULT_MIGRATION_COMMIT_MESSAGE = "Apply the professor-orb schema migration";

// Canonical frontmatter field order, and the fallback when no rule supplies one.
const FALLBACK_FIELD_ORDER = ["publish", "type", "tags"];

// Never throws. Every caller checks .ok, because a git failure mid-migration has
// to be reported against the operation that caused it rather than unwinding the
// whole run through an exception after other operations have already landed.
function makeGit(cwd) {
  return function git(argv) {
    try {
      const stdout = execFileSync("git", argv, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 64 * 1024 * 1024,
      });
      return { ok: true, stdout: stdout == null ? "" : String(stdout), stderr: "" };
    } catch (err) {
      return {
        ok: false,
        stdout: err && err.stdout != null ? String(err.stdout) : "",
        stderr:
          err && err.stderr != null && String(err.stderr).trim() !== ""
            ? String(err.stderr)
            : String((err && err.message) || err),
      };
    }
  };
}

const firstLine = (s) => String(s == null ? "" : s).split("\n")[0].trim();

const stemOf = (p) => {
  const base = path.posix.basename(toPosix(p));
  return base.toLowerCase().endsWith(".md") ? base.slice(0, -3) : base;
};

// A staging name beside the destination. Deterministic, and probed rather than
// assumed free: a leftover from an interrupted run must not be moved onto.
function temporaryNeighbour(cwd, target) {
  const posix = toPosix(target);
  const dir = path.posix.dirname(posix);
  const base = path.posix.basename(posix);
  const prefix = dir === "." || dir === "" ? "" : `${dir}/`;
  for (let i = 0; i < 1000; i++) {
    const candidate = `${prefix}__orb-migrate-tmp${i === 0 ? "" : `-${i}`}__${base}`;
    if (!existsSync(path.resolve(cwd, candidate))) return candidate;
  }
  return null;
}

/**
 * The single move primitive. Case-only renames go through `git mv` directly,
 * because on this platform (core.ignorecase true) that succeeds in one step;
 * the two-step through a temporary name is a FALLBACK taken only when git mv
 * reports an error, not a requirement. Measured in the mechanism prototypes.
 *
 * ctx.git is injectable so the fallback path can be exercised on a filesystem
 * where the direct move happens to work.
 *
 * @returns {{ok: boolean, mode: "direct"|"two-step", error?: string}}
 */
export function gitMove(ctx, from, to) {
  const destParent = path.dirname(path.resolve(ctx.cwd, to));
  try {
    mkdirSync(destParent, { recursive: true });
  } catch (err) {
    return { ok: false, mode: "direct", error: `could not create the destination directory: ${err.message}` };
  }

  // No `:(literal)` here, deliberately, and it is not an oversight. `git mv`
  // takes a source PATH and a destination PATH, not pathspecs: measured against
  // real git, `git mv -- "items/Weapons [OS]-INDEX.md" items/Renamed-INDEX.md`
  // moved only the bracketed file and left the neighbouring `Weapons O-INDEX.md`
  // that a glob would have matched exactly where it was. Prefixing these would
  // instead create a file whose name literally begins `:(literal)`. The one
  // pathspec-consuming git call in this module is the `git rm` in gitRemove just
  // below, which every caller goes through, and it carries the prefix.
  const direct = ctx.git(["mv", "--", from, to]);
  if (direct.ok) return { ok: true, mode: "direct" };

  const caseOnly = from !== to && from.toLowerCase() === to.toLowerCase();
  if (!caseOnly) return { ok: false, mode: "direct", error: firstLine(direct.stderr) };

  const staging = temporaryNeighbour(ctx.cwd, to);
  if (staging == null) {
    return { ok: false, mode: "two-step", error: "no free temporary staging name beside the destination" };
  }
  const step1 = ctx.git(["mv", "--", from, staging]);
  if (!step1.ok) {
    return {
      ok: false,
      mode: "two-step",
      error: `git mv: ${firstLine(direct.stderr)}; staging step: ${firstLine(step1.stderr)}`,
    };
  }
  const step2 = ctx.git(["mv", "--", staging, to]);
  if (!step2.ok) {
    // Put it back rather than leaving the article parked under a staging name.
    ctx.git(["mv", "--", staging, from]);
    return {
      ok: false,
      mode: "two-step",
      error: `git mv: ${firstLine(direct.stderr)}; final step: ${firstLine(step2.stderr)}`,
    };
  }
  return { ok: true, mode: "two-step" };
}

// EVERY `git rm` in this module goes through here, so the pathspec guard is
// written once. Both callers hand it a filename that arrived from the DM's own
// filesystem by way of the scout, with no sanitization in between.
//
// `git rm` takes a PATHSPEC, not a path, so `*`, `?`, `[`, and `]` in a DM-chosen
// filename are read as wildcards. Measured against real git, with an unrelated
// `items/Weapons O-INDEX.md` sitting beside a merge's `items/Weapons [OS]-INDEX.md`:
// the bare pathspec removed BOTH, and the run reported ok, committed, zero
// failures, zero drops, and clean link integrity, because the unnamed file's
// content had never been merged anywhere and no rail was looking at it.
// `:(literal)` disables wildcard interpretation for that pathspec element; `--`
// stops option parsing. Keep both: they fix different halves of the same line and
// neither substitutes for the other. Same fix and same reasoning as the lane
// pathspecs in `commands/`.
//
// `-f` is REQUIRED here, and it is not a way of forcing past a check that was
// protecting something. Without it this helper half-applies both of its callers,
// measured on a disposable repository against three different git refusals, each
// of which arrives AFTER the caller has already written its side of the work:
//
//   "has changes staged in the index"  A `git mv` earlier in the SAME plan
//   staged the rename of this path, so HEAD does not carry it at this name.
//   APPLY_ORDER puts relocate-prong and relocate-path ahead of both callers, and
//   OPERATION_ORDER puts relocate-prong ahead of merge-index, so setup's own
//   unattended migration emits this pairing whenever a prong moves and a folder
//   folds sub-indexes. The reference consumer's items/ folds six.
//
//   "has local modifications"  An earlier operation rewrote a wikilink inside
//   this file on disk. rename-with-link-rewrite and rename-entity both precede
//   merge-index in APPLY_ORDER, and a sub-index is exactly the kind of file that
//   links to the article being renamed. This one needs no move at all to reach.
//
//   "has staged content different from both the file and the HEAD"  Both of the
//   above at once, which is the ordinary shape once a prong move and a rename
//   land on the same sub-index.
//
// In each case the caller had already merged the source into the survivor, or
// already moved every article out of the folder, so the refusal left the tree
// holding the content TWICE with the run reporting failed. `git rm --cached`
// plus a filesystem delete was measured as the alternative and rejected: it
// clears the first two states but still refuses on the third, so it would leave
// the same half-apply reachable by the longer route, and it needs a second,
// separately failable step to do what one call does here.
//
// What `-f` costs is bounded by what each caller has already decided. It skips
// git's local-modification check, which exists to stop `git rm` discarding
// content that survives nowhere else. Neither caller is in that position:
// applyMergeIndex reads each source's current on-disk bytes and folds them into
// the survivor immediately before this call, so a local modification is already
// preserved there, and applyAbsorbFolder's `op.index` is the one file a
// dissolution DISCARDS by definition, so a modification to it goes either way.
// The snapshot is the backstop for both, and it still is: measured, in every
// state above, `git reset --hard <snapshot>` restored both the survivor's
// original content and the removed file, with an empty `git status --porcelain`.
//
// `-f` does NOT widen what the pathspec matches, and it does not make an
// UNTRACKED path removable: measured, `git rm -f` on one still fails with
// "pathspec did not match any files", exactly as the bare form does. That is
// load-bearing, because the git-ignored-index precheck declines an absorb on
// the stated grounds that this removal "on an untracked file fails outright".
//
// ctx.git never throws (see makeGit); it reports failure through `.ok`. Checked
// that way here too, on the same terms as gitMove, rather than a try/catch that a
// non-throwing call would never trip. `error` carries firstLine(stderr), which is
// the shape both callers report to the DM.
export function gitRemove(ctx, target) {
  const removed = ctx.git(["rm", "-q", "-f", "--", `:(literal)${target}`]);
  if (!removed.ok) return { ok: false, error: firstLine(removed.stderr) };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Wikilinks
// ---------------------------------------------------------------------------
//
// Obsidian resolves wikilinks by FILENAME, not by path. That is the property
// that makes the folder moves link-safe, and it is the same property the
// link-integrity assertion resolves against.
//
// The forms handled: [[Target]], [[Target|Display]], [[Target\|Display]] (the
// table-escaped separator, which is required table syntax rather than a
// malformed link), [[Target#Anchor]], [[folder/Target]], [[Target.md]], and the
// embed form ![[Target]].
const WIKILINK = /!?\[\[([^\[\]\n]+)\]\]/g;

// A trailing dot group is only an extension if it looks like one. "Mr. Smith"
// must not lose " Smith".
const EXTENSION = /\.[A-Za-z0-9]{1,8}$/;

function splitWikilink(inner) {
  const bar = inner.indexOf("|");
  if (bar === -1) return { target: inner, sep: "", display: "" };
  const escaped = bar > 0 && inner[bar - 1] === "\\";
  return {
    target: inner.slice(0, escaped ? bar - 1 : bar),
    sep: escaped ? "\\|" : "|",
    display: inner.slice(bar + 1),
  };
}

function dissectTarget(target) {
  const hash = target.indexOf("#");
  const anchor = hash === -1 ? "" : target.slice(hash);
  const head = hash === -1 ? target : target.slice(0, hash);
  const slash = head.lastIndexOf("/");
  const prefix = slash === -1 ? "" : head.slice(0, slash + 1);
  let stem = slash === -1 ? head : head.slice(slash + 1);
  let ext = "";
  const m = EXTENSION.exec(stem);
  if (m && m.index > 0) {
    ext = m[0];
    stem = stem.slice(0, m.index);
  }
  return { prefix, stem, ext, anchor };
}

// Code spans and fenced blocks are not link-bearing text. A wikilink quoted
// inside documentation prose is an EXAMPLE of a link rather than a link the DM
// expects to resolve, and blocking a migration commit on one would be a false
// alarm on the loudest rail in the system.
//
// ONE definition of "quoted", shared by BOTH halves. The extraction half used to
// strip fences while the rewrite half did not, so a fenced example wikilink in a
// file the plan named in `op.links` was rewritten as if it were real: the
// rewriter silently edited the DM's documentation, and the rail, which never saw
// that link, had nothing to say about it. Measured, on a doc carrying one real
// link plus a fenced example plus an inline code span, the rewriter reported
// three rewrites. Both halves now derive their regions from protectedRanges, so
// a span either is link-bearing for both or for neither, by construction rather
// than by two regexes agreeing.
//
// Fences first, then code spans OUTSIDE them, which is the order the strip form
// used: a backtick pair inside a fenced block is fence content, not a span.
const FENCE = /^[ \t]*(`{3,}|~{3,})[\s\S]*?^[ \t]*\1[ \t]*$/gm;
const CODE_SPAN = /`[^`\n]*`/g;

function protectedRanges(text) {
  const ranges = [];
  let m;
  FENCE.lastIndex = 0;
  while ((m = FENCE.exec(text)) !== null) ranges.push([m.index, m.index + m[0].length]);
  const fences = ranges.length;
  CODE_SPAN.lastIndex = 0;
  while ((m = CODE_SPAN.exec(text)) !== null) {
    let inFence = false;
    for (let i = 0; i < fences; i++) {
      if (m.index >= ranges[i][0] && m.index < ranges[i][1]) {
        inFence = true;
        break;
      }
    }
    if (!inFence) ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}

function withinProtected(ranges, offset) {
  for (const [start, end] of ranges) {
    if (offset >= start && offset < end) return true;
  }
  return false;
}

// Blanked rather than deleted, so every offset in the returned string is the
// offset it had in the original. That is what lets the rewrite half test a match
// position against the same ranges this one erases.
function linkBearingText(text) {
  const source = String(text);
  const ranges = protectedRanges(source);
  if (ranges.length === 0) return source;
  const chars = source.split("");
  for (const [start, end] of ranges) {
    for (let i = start; i < end; i++) {
      if (chars[i] !== "\n") chars[i] = " ";
    }
  }
  return chars.join("");
}

/**
 * Rewrites every wikilink whose target FILENAME matches oldStem, preserving any
 * path prefix, extension, anchor, separator style, and display text. Matching is
 * case-insensitive, which is what lets a case-only rename take its referring
 * links with it.
 *
 * A wikilink inside a code span or a fenced block is left alone, on the same
 * terms the link-integrity assertion leaves it alone. A named file whose only
 * occurrence is quoted therefore reports zero rewrites, which the rename and
 * merge executors already treat as a drop: a plan naming a documentation file as
 * a referrer is a stale plan, and saying so is better than editing prose that
 * was never a link.
 *
 * @returns {{text: string, count: number}}
 */
export function rewriteWikilinks(text, oldStem, newStem) {
  const source = String(text);
  const wanted = String(oldStem).trim().toLowerCase();
  const quoted = protectedRanges(source);
  let count = 0;
  const out = source.replace(WIKILINK, (whole, inner, offset) => {
    if (withinProtected(quoted, offset)) return whole;
    const { target, sep, display } = splitWikilink(inner);
    const { prefix, stem, ext, anchor } = dissectTarget(target);
    if (stem.trim().toLowerCase() !== wanted) return whole;
    count++;
    const bang = whole.startsWith("!") ? "!" : "";
    return `${bang}[[${prefix}${newStem}${ext}${anchor}${sep}${display}]]`;
  });
  return { text: out, count };
}

function wikilinkTargetsIn(text) {
  const out = [];
  const scannable = linkBearingText(text);
  WIKILINK.lastIndex = 0;
  let m;
  while ((m = WIKILINK.exec(scannable)) !== null) out.push(splitWikilink(m[1]).target);
  return out;
}

// Every from/to pair a plan MOVES, at every granularity, which is the one input
// the link rail reasons about the plan through: scopeCandidates maps a declared
// root through it, and arrivalRoots reads the far end of it.
//
// THE MODULE'S OWN "moves" RULE decides membership, not a list of kinds. An entry
// counts when it carries BOTH a `from` and a `to`, which is exactly the test
// planVacates and findDestinationCollisions' `vacated` already apply and for the
// same reason: an in-place edit carries a `from` and no `to` precisely to say it
// leaves the file where it is, and create-index, merge-index, rebuild-index and
// tag-registry carry a `to` and no `from` because they write a file rather than
// carry one there. Both are correctly absent, and a kind added later is classified
// by its own shape rather than by remembering to name it here.
//
// Read through destinationEntriesOf so both per-file shapes arrive as well as the
// folder-level pairs, and so absorb-folder's folder-level pair stays excluded on
// exactly the terms it is excluded there: the executor never moves that pair as a
// unit, it moves each enumerated file.
function planMoves(operations) {
  const out = [];
  for (const o of list(operations)) {
    if (!o || typeof o !== "object") continue;
    for (const e of destinationEntriesOf(o)) {
      if (!e.from || !e.to) continue;
      out.push({ op: e.op, from: toPosix(e.from), to: toPosix(e.to) });
    }
  }
  return out;
}

// The paths a DECLARED prong root can actually be at once the plan has run.
//
// The settings the apply phase is handed are the conventions.json that was on
// disk when the run started, so every root in them is a PRE-migration path, and
// relocating those roots to the canonical layout is precisely what this release
// exists to do. relocate-prong is operation #1, so by the time the assertion
// runs the declared root is already gone. Filtering the declared roots on
// existsSync alone therefore dropped the relocated prong silently, and because
// the zero-coverage fallback only fires when EVERY root vanishes, one surviving
// prong was enough to shrink the rail to that prong and let a dead wikilink
// through. Measured: filesChecked 1, linksChecked 0, ok true, committed.
//
// So a declared root is resolved THROUGH the plan's own moves, which already
// carry `from` and `to`. Every intermediate is kept as a candidate and existsSync
// decides which of them to walk, rather than the mapping deciding: a relocation
// that was skipped for a git-ignored source, or that failed, leaves the root
// exactly where it was declared and the walk has to find it there; a chain (A to
// B, then B to C) leaves it at the end of the chain; a half-applied run can leave
// content at both. Keeping both ends covers all three without the assertion
// needing to know each operation's outcome.
//
// EVERY MOVING KIND, not relocate-prong alone, and that regressed once already.
// The list was written against relocate-prong when relocate-prong was the only
// kind that moved a whole path; this release added relocate-path, which shares the
// executor and the mechanics, and planPathMoves puts no protectedFolders guard on
// it, so a `pathMoves` entry may name a prong root and is the ONLY way to express
// a v1-to-v3 relayout such as rolara-kb to settings/rolara (a rename keeps the
// root's parent, a retirement puts it under an archive). Measured with the narrow
// list: the whole relocated knowledge base was never opened, roots came back as
// the one prong that did not move, and the run reported filesChecked 1,
// linksChecked 0, ok true with a dead wikilink inside the moved base.
//
// Widening it costs nothing, because the match below is what filters: a pair whose
// `from` is neither the root nor an ancestor of it does not touch `current`. That
// is why the per-file moves of an absorb or a split ride along harmlessly, and why
// the one shape among them that CAN carry a root (split-folder permits a bucket
// article that is a directory) is mapped rather than missed.
function scopeCandidates(root, relocations) {
  const out = [toPosix(root)];
  let current = out[0];
  for (const move of list(relocations)) {
    if (!move || !move.from || !move.to) continue;
    const from = toPosix(move.from);
    const to = toPosix(move.to);
    let next = null;
    if (current === from) next = to;
    else if (current.startsWith(`${from}/`)) next = to + current.slice(from.length);
    if (next == null || next === current) continue;
    current = next;
    if (!out.includes(current)) out.push(current);
  }
  return out;
}

// The folders a plan carried content OUT of the walked roots and into, as posix
// project-relative paths, sorted.
//
// scopeCandidates answers where a DECLARED root went. This answers the other half:
// where a plan put material that WAS in a declared root and no longer is. Two
// planners this release adds produce exactly that, and both made their own
// operation unable to finish a run:
//
//   planSettingSplits moves articles to the kbRoot of a world conventions.json
//   does not yet record, by construction: it declines outright if the name is
//   already there. So the destination is under no prong root of any setting the
//   apply phase is handed, the moved articles are absent from the resolvable set,
//   and every INCOMING crossing that crossBoundaryLinks enumerated as the approved
//   cost of the split reads to the rail as a dead link. A conforming folder's index
//   links every article in it, so any split of an indexed article hit this.
//   Measured: one applied operation, linkIntegrity.ok false, restore instruction
//   printed, and the articles sitting in a folder conventions.json records nothing
//   for, because the caller writes conventions only after the rail returns.
//
//   planCampaignRetirements moves <sessionReportsRoot>/<campaign> under an archive.
//   scopeCandidates cannot help there even with every kind in it: it maps a ROOT,
//   and here the moved path is a sub-path of a root that itself stays put.
//
// THE PLAN'S OWN MOVES ARE THE INPUT, and that is what keeps this from being a
// whitelist. It does not take an "expected crossings" list from the split planner,
// so the rail never has to re-derive or trust the DM's intent, and there is no
// input that can excuse a link: what a move buys is that the folder its content
// LANDED IN is read, and a target that is not a file in any read folder is still
// dead. Widening the walk can only add files that genuinely exist to the resolvable
// set; it can never remove a dead link from the report. A split whose whole cost is
// N approved crossings therefore commits, and a split that also dropped a rewrite
// nobody approved still refuses, on the same walk.
//
// ONLY A MOVE THAT CROSSES OUT, which `covered` decides: the source has to sit
// under a root the rail is already walking. That is what keeps the coverage rail
// from being dissolved by this addition. `expectLinks` exists to catch a run whose
// walked roots "are not where this run put the content", and a rule that followed
// EVERY destination would follow the run to wherever it was working and report a
// tidy pass over a knowledge base conventions.json does not point at. Measured on
// the suite's own fixture: a rename inside kb/ with the declared root at
// settings/rolara went from the intended coverage refusal to a clean commit.
// Following material that WAS in scope is the rail keeping up with the run;
// following material that never was is the rail losing track of the settings.
//
// The limit that leaves, stated: a source whose declared root is no longer on disk
// at all is not covered, so the move out of it is not followed. That direction is
// the conservative one. The material is unwalked, so a link into it reads dead and
// the run REFUSES with the work intact, rather than committing a graph nothing
// checked.
//
// DIRECTORY OR FILE, decided by asking the disk after the run rather than by
// guessing from the path: relocate-path moves a whole campaign folder in one entry
// and one article in the next. A destination that is not there at all was skipped,
// failed, or is hand-edited, and its dirname is asked about instead, which
// existsSync in the caller then drops if that is not there either. Same posture as
// scopeCandidates: propose both ends and let the disk decide.
//
// THE PROJECT ROOT IS NEVER AN ARRIVAL. assertLinkIntegrity reserves it for the
// case where no setting resolved at all, and reaching it from one destination would
// resolve every wikilink in the run against every markdown file in the project,
// which is the exact widening that function's own comment records as having let a
// dead link commit clean. A move to the project root is outside every knowledge
// base and this rail has nothing to say about it.
//
// Read-only: statSync only.
function arrivalRoots(cwd, moves, covered) {
  const out = [];
  for (const move of list(moves)) {
    const from = toPosix(move && move.from);
    const to = toPosix(move && move.to);
    if (!from || !to || !covered(path.resolve(cwd, from))) continue;
    let st = null;
    try {
      st = statSync(path.resolve(cwd, to));
    } catch {
      st = null;
    }
    const folder = st && st.isDirectory() ? to : path.posix.dirname(to);
    if (!folder || folder === "." || folder === "/" || folder === "..") continue;
    // The three names walkMarkdown steps around are not article folders anywhere
    // else in this module and are not arrival roots either. The vault move is what
    // reaches this: its destination is <kbRoot>/.obsidian.
    if (PRONG_CHILDREN_SKIPPED.has(path.posix.basename(folder))) continue;
    if (!out.includes(folder)) out.push(folder);
  }
  // Sorted so a parent sorts before anything beneath it, which is what lets the
  // caller drop a nested arrival in one left-to-right pass.
  return out.sort();
}

/**
 * The post-migration link-integrity assertion. It runs after every rename and
 * every link rewrite has been applied and BEFORE the migration commit, because
 * the dropped-worker accounting reports a drop only after the repository would
 * already carry the dead links, and reporting a problem after committing it is
 * not a safety rail.
 *
 * Extraction walks every markdown file under every prong root of every setting,
 * each root resolved through the plan's moves first (see scopeCandidates), PLUS
 * every folder those same moves landed content in that no declared root covers
 * (see arrivalRoots). The second half is not a courtesy: a setting split and a
 * campaign retirement both put content outside every declared root by
 * construction, and without it the rail read the split's own approved cost as a
 * wall of dead links and refused every run that carried one.
 *
 * `relocations` is the plan's moves, from planMoves. The name is kept because it
 * is what the two callers and the suite already say; what changed is that it is
 * no longer relocate-prong alone.
 *
 * Resolution is FILENAME-based rather than path-based, because Obsidian
 * wikilinks are filename-based. It resolves against the markdown files IN THE
 * WALKED ROOTS, not against every markdown file in the project. Project-wide
 * resolution was the wider claim and it was wrong in a way that defeated the
 * rail: measured, with an unrelated archive/old/Sword.md sitting outside every
 * prong root, a dropped rewrite left [[Sword]] behind, the renamed file was
 * indeed gone from every path, and a DIFFERENT file with the same basename
 * satisfied the link, so the run committed clean. Filename resolution is
 * plan-mandated; resolving it against files the settings do not enumerate was
 * not, and that is the half that gave a stranger's basename standing.
 *
 * The limitation this trades for, stated plainly: a wikilink from inside a prong
 * root out to a file that lives under no prong root of any setting now reads as
 * dead. That is a refusal to commit, with the work intact in the working tree
 * and the snapshot intact behind it, which is recoverable. A dead link committed
 * because an unrelated file happened to share a basename is not.
 *
 * `expectLinks` says the caller has EVIDENCE that this knowledge base holds at
 * least one wikilink. In that case an assertion that checked ZERO links is
 * reported as a failure rather than a pass, because the module's own principle
 * is that an assertion which silently checks nothing is not an assertion: if a
 * wikilink is known to exist and the walk found none, the walk is pointed away
 * from the content. `roots` and `filesChecked` are returned so that a caller
 * reporting the refusal can name the roots it actually walked.
 *
 * The evidence must be evidence, not an assumption. applyPlan arms this from the
 * wikilinks its own run rewrote, never from the operation kinds the plan carried:
 * "this plan contains a rename" is not evidence that any wikilink exists, and
 * arming on it turned a wikilink-free knowledge base into a migration that could
 * never finish. See the call site.
 *
 * @returns {{ok: boolean, dead: Array<{file: string, target: string}>,
 *            filesChecked: number, linksChecked: number,
 *            coverage: "ok"|"no-links-checked", roots: Array<string>}}
 */
export function assertLinkIntegrity({ cwd, settings, relocations, expectLinks }) {
  const roots = [];
  for (const setting of list(settings)) {
    for (const declared of prongRootsOf(setting)) {
      for (const candidate of scopeCandidates(declared, relocations)) {
        const abs = path.resolve(cwd, candidate);
        if (existsSync(abs) && !roots.includes(abs)) roots.push(abs);
      }
    }
  }
  // Then wherever this plan carried content OUT of those roots. Dropped when a
  // root already covers the destination, which is the ordinary case and is what
  // keeps setup's own runs reporting exactly the roots they always did: a
  // relocate-prong's destination is the declared root's own new path, and a
  // rename's is the folder the file was already in. `roots` stays the list of
  // folders this rail actually read, so the refusal message can still name them.
  //
  // TO A FIXED POINT, because a scope may carry two splits and the second may take
  // its material out of the world the first created. `covered` reads the live
  // array, and each pass that changes anything adds at least one root, so the move
  // count bounds the loop.
  const covered = (abs) => roots.some((r) => abs === r || abs.startsWith(r + path.sep));
  for (let pass = 0; pass < list(relocations).length; pass++) {
    let grew = false;
    for (const arrival of arrivalRoots(cwd, relocations, covered)) {
      const abs = path.resolve(cwd, arrival);
      if (!existsSync(abs) || covered(abs)) continue;
      roots.push(abs);
      grew = true;
    }
    if (!grew) break;
  }
  // No settings resolved: assert over the whole project rather than over
  // nothing. An assertion that silently checks zero files is not an assertion.
  if (roots.length === 0) roots.push(path.resolve(cwd));

  // Walked once. Both the file list and the resolvable-basename set come from
  // this same pass, so the scope being checked and the scope being resolved
  // against cannot drift apart.
  const files = [];
  const seenFiles = new Set();
  for (const root of roots) {
    for (const file of walkMarkdown(root)) {
      const rel = toPosix(path.relative(cwd, file));
      if (seenFiles.has(rel)) continue;
      seenFiles.add(rel);
      files.push({ abs: file, rel });
    }
  }
  const known = new Set(files.map((f) => path.basename(f.abs).slice(0, -3).toLowerCase()));

  const dead = [];
  let linksChecked = 0;
  for (const { abs, rel } of files) {
    let text;
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    for (const target of wikilinkTargetsIn(text)) {
      const { stem, ext } = dissectTarget(target);
      const trimmed = stem.trim();
      if (trimmed === "") continue; // [[#Heading]], a link into this same file.
      if (ext !== "" && ext.toLowerCase() !== ".md") continue; // An attachment, not an article.
      linksChecked++;
      if (known.has(trimmed.toLowerCase())) continue;
      dead.push({ file: rel, target });
    }
  }

  const coverage = expectLinks === true && linksChecked === 0 ? "no-links-checked" : "ok";
  return {
    ok: dead.length === 0 && coverage === "ok",
    dead,
    filesChecked: seenFiles.size,
    linksChecked,
    coverage,
    roots: roots.map((r) => toPosix(path.relative(cwd, r)) || "."),
  };
}

// ---------------------------------------------------------------------------
// Raw-text frontmatter editing
// ---------------------------------------------------------------------------
//
// Never parse-and-regenerate. The hook's parseYamlLines is a documented subset
// that drops comments and nested maps, and parseScalar strips quoting, which
// would erase a quoted "false" that conventions-schema.md calls a real bug worth
// surfacing. Everything below moves or edits raw LINES.

function splitTextLines(text) {
  const bom = text.charCodeAt(0) === 0xfeff ? "﻿" : "";
  const body = bom ? text.slice(1) : text;
  const eol = body.includes("\r\n") ? "\r\n" : "\n";
  return { bom, eol, lines: body.split(/\r?\n/) };
}

const joinTextLines = ({ bom, eol, lines }) => bom + lines.join(eol);

function frontmatterBounds(lines) {
  if (lines[0] !== "---") return null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---" || lines[i] === "...") return { start: 1, end: i };
  }
  return null;
}

const KEY_LINE = /^([A-Za-z0-9_][A-Za-z0-9_.-]*)[ \t]*:/;

// One block per top-level field, plus one block per zero-indent comment or blank
// line. A field's block carries its continuation lines, so a nested map or a
// block sequence travels with its key instead of being stranded.
function frontmatterBlocks(lines, start, end) {
  const blocks = [];
  let current = null;
  for (let i = start; i < end; i++) {
    const line = lines[i];
    const indented = /^[ \t]/.test(line);
    const key = indented ? null : (KEY_LINE.exec(line) || [])[1];
    if (key) {
      current = { key, lines: [line] };
      blocks.push(current);
      continue;
    }
    if (!indented) {
      // A zero-indent comment or blank line keeps its own place rather than
      // riding along with whichever field happened to precede it.
      current = null;
      blocks.push({ key: null, lines: [line] });
      continue;
    }
    if (current) current.lines.push(line);
    else blocks.push({ key: null, lines: [line] });
  }
  return blocks;
}

// A permutation, not a rewrite. Only blocks whose key the canonical order names
// move, and they move only into slots those same blocks already occupied, so
// every comment, blank line, unknown field, and nested map stays exactly where
// it was and every line is carried across byte for byte.
function reorderFrontmatterBlocks(blocks, order) {
  const rank = new Map(order.map((f, i) => [f, i]));
  const slots = [];
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].key != null && rank.has(blocks[i].key)) slots.push(i);
  }
  const moving = slots.map((i) => blocks[i]).sort((a, b) => rank.get(a.key) - rank.get(b.key));
  const out = blocks.slice();
  for (let i = 0; i < slots.length; i++) out[slots[i]] = moving[i];
  return out;
}

// Splits a raw scalar into its quoting and its value, so a corrected value can
// be written back in the quoting style the DM used.
function unquoteScalar(raw) {
  const t = raw.trim();
  if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) {
    return { quote: t[0], value: t.slice(1, -1) };
  }
  return { quote: "", value: t };
}

// An inline comment is " #" outside quoting. Anything less careful would cut a
// value like "Chapter #3" in half. The index returned is the START of the
// whitespace run before the "#", not the last character of it: returning the
// last character silently collapsed two spaces into one and rewrote the DM's
// formatting, which this whole raw-text approach exists to avoid.
function inlineCommentIndex(raw) {
  let quote = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (quote) {
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "#" && i > 0 && /[ \t]/.test(raw[i - 1])) {
      let start = i - 1;
      while (start > 0 && /[ \t]/.test(raw[start - 1])) start--;
      return start;
    }
  }
  return -1;
}

// Renders an inserted default. Values arrive from a rule's params, so they are
// already JSON scalars; only a string that YAML would read as something else
// needs quoting.
function renderScalar(value) {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return `[${value.map(renderScalar).join(", ")}]`;
  const s = String(value);
  if (s === "" || /^[\s>|&*!%@`]/.test(s) || /:\s|\s#/.test(s) || /^(true|false|null|~|-?\d)/i.test(s)) {
    return JSON.stringify(s);
  }
  return s;
}

// The value for a field the plan asks to insert. Only a rule that documents a
// default can supply one: inventing a value for a DM's article is exactly the
// class of guess this whole module refuses to make, so an unresolvable field
// fails the operation instead.
function defaultValueFor(field, sources) {
  for (const source of sources) {
    const rules = rulesOf(source);
    for (const id of Object.keys(rules)) {
      const rule = rules[id];
      if (!rule || rule.check !== "default") continue;
      const params = rule.params || {};
      if (params.field !== field) continue;
      if ("value" in params) return { found: true, value: params.value };
      if ("default" in params) return { found: true, value: params.default };
    }
  }
  return { found: false };
}

function fieldOrderFor(ctx) {
  for (const source of ctx.ruleSources) {
    const fields = ruleParam(source, "frontmatterFieldOrder", "fields", null);
    if (Array.isArray(fields) && fields.length > 0) return fields;
  }
  return FALLBACK_FIELD_ORDER;
}

// ---------------------------------------------------------------------------
// Per-operation executors
// ---------------------------------------------------------------------------

const entryFor = (op) => ({
  op: op.op,
  from: op.from,
  to: op.to,
  applied: false,
  detail: "",
});

function readText(ctx, rel) {
  try {
    return { ok: true, text: readFileSync(path.resolve(ctx.cwd, rel), "utf8") };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function writeText(ctx, rel, text) {
  try {
    mkdirSync(path.dirname(path.resolve(ctx.cwd, rel)), { recursive: true });
    writeFileSync(path.resolve(ctx.cwd, rel), text);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// 1. Relocate a prong root.
function applyRelocateProng(op, ctx) {
  const entry = entryFor(op);
  const from = toPosix(op.from);
  const to = toPosix(op.to);
  if (!from || !to) {
    entry.detail = "relocate-prong needs both from and to.";
    return entry;
  }
  if (from === to) {
    entry.detail = "Source and destination are the same path; nothing to move.";
    return entry;
  }

  // git refuses to move a directory into its own child, so a nested destination
  // is staged through a temporary sibling. The confirmation step upstream exists
  // for the same hazard; this is the mechanical half of it.
  if (to.startsWith(`${from}/`)) {
    const staging = temporaryNeighbour(ctx.cwd, from);
    if (staging == null) {
      entry.detail = "No free temporary staging name beside the prong root.";
      return entry;
    }
    const out = gitMove(ctx, from, staging);
    if (!out.ok) {
      entry.detail = `Staging move failed: ${out.error}`;
      return entry;
    }
    const back = gitMove(ctx, staging, to);
    if (!back.ok) {
      gitMove(ctx, staging, from);
      entry.detail = `Move into the nested destination failed and the prong was put back: ${back.error}`;
      return entry;
    }
    entry.applied = true;
    entry.mode = "staged";
    entry.detail = `Relocated through the temporary sibling ${staging}, because the destination sits inside the source.`;
    return entry;
  }

  const out = gitMove(ctx, from, to);
  if (!out.ok) {
    entry.detail = `git mv failed: ${out.error}`;
    return entry;
  }
  entry.applied = true;
  entry.mode = out.mode;
  entry.detail = `Relocated with git mv (${out.mode}).`;
  return entry;
}

// Dissolve a leaf folder into its parent. One accounting entry for the whole
// dissolution, on the same principle a rename carries its link rewrite: a folder
// reported as absorbed while one of its files was left behind is the failure the
// accounting exists to prevent.
//
// `op.articles` names every file in the folder, not only the markdown ones, and
// each is moved individually. The folder's own index is the one file removed
// rather than moved. Then the emptied folder itself goes, which is the third step
// and not a side effect of the second; see removeAbsorbedFolder.
function applyAbsorbFolder(op, ctx) {
  const entry = entryFor(op);
  entry.moved = 0;
  const files = list(op.articles);
  const folder = toPosix(op.from);
  if (!folder) {
    entry.detail = "The operation names no folder to dissolve, so there is nothing to absorb.";
    return entry;
  }

  for (const a of files) {
    const out = gitMove(ctx, toPosix(a.from), toPosix(a.to));
    if (!out.ok) {
      entry.detail = `git mv failed for ${a.from}: ${out.error}. ${entry.moved} of ${files.length} file(s) had already moved; the snapshot is the undo.`;
      return entry;
    }
    entry.moved++;
  }

  if (op.index) {
    const removed = gitRemove(ctx, toPosix(op.index));
    if (!removed.ok) {
      entry.detail = `Every file moved but the folder's index could not be removed: ${removed.error}`;
      return entry;
    }
  }

  const gone = removeAbsorbedFolder(ctx, folder);
  if (!gone.ok) {
    entry.detail =
      `Every file moved${op.index ? " and the folder's own index was removed" : ""}, but ${folder} is still ` +
      `there: ${gone.error} A folder that outlives its own dissolution is content with no index to the ` +
      "validation sweep, and it makes a later absorb of the parent decline as a folder that holds a subfolder, " +
      "so this reports applied false rather than counting the dissolution as done.";
    return entry;
  }

  entry.applied = true;
  entry.detail =
    `Absorbed ${entry.moved} file(s) into ${op.to}` +
    (op.index ? ", removed the folder's own index, and" : " and") +
    ` removed the emptied folder ${folder}.`;
  return entry;
}

// Divide a folder into DM-named buckets. One accounting entry for the whole
// split: a partition applied halfway is worse than one not applied at all,
// because the DM approved a shape the tree no longer matches either way.
//
// Nothing is removed and nothing is created here. The folder being split keeps
// whatever the buckets did not claim, which is the ordinary partial split, and
// each bucket's own index is a separate create-index operation the planner pairs
// with this one. So the folder cannot be left indexless the way an absorb's could.
//
// The moves come from articleMovesOf, which is the same enumeration the
// prechecks and the skip list read. That is the point: what this executor moves
// is exactly what was checked for a collision and for a git-ignored source, with
// no second traversal of the bucket shape to drift out of step with the first.
function applySplitFolder(op, ctx) {
  const entry = entryFor(op);
  entry.from = toPosix(op.from);
  entry.moved = 0;
  const all = articleMovesOf(op);

  for (const a of all) {
    const out = gitMove(ctx, toPosix(a.from), toPosix(a.to));
    if (!out.ok) {
      entry.detail = `git mv failed for ${a.from}: ${out.error}. ${entry.moved} of ${all.length} article(s) had moved; the snapshot is the undo.`;
      return entry;
    }
    entry.moved++;
  }

  entry.applied = true;
  // Filtered, because a malformed bucket used to put a literal null in a field a
  // later task renders into the DM's report. applyPlan refuses such a plan before
  // this executor is reached, so this is the guard for a caller that reaches
  // applyOperation directly, which is an exported entry point.
  entry.buckets = list(op.buckets).map((b) => b && b.folder).filter(Boolean);
  entry.detail = `Split ${entry.moved} article(s) across ${entry.buckets.length} subfolder(s).`;
  return entry;
}

// The emptied folder, removed explicitly and never recursively.
//
// `git mv` empties a folder; it does not remove it. Measured in two scratch
// repositories: moving every tracked file out of misc/ leaves misc/ on disk, and
// adding a `git rm` of the last tracked file is what removes it. So the shape
// planAbsorbFolders produces whenever no file matches the index suffix, or the
// setting declares no suffix, has no `git rm` in it at all and used to leave the
// folder standing while the entry reported applied true.
//
// Emptiness is VERIFIED first, and the removal is non-recursive so that it
// cannot succeed against a folder that still holds something. Anything left in
// there is a file this operation did not enumerate, and deleting a file the DM's
// approved proposal never named is the one thing this module must not do.
//
// The path is resolved and then checked to be strictly inside cwd. Every other
// mutation here goes through git, which refuses a path outside the repository on
// its own; this is the module's only raw filesystem removal, so it does that
// check itself rather than inheriting it.
function removeAbsorbedFolder(ctx, folder) {
  const abs = path.resolve(ctx.cwd, folder);
  const root = path.resolve(ctx.cwd);
  if (abs === root || !abs.startsWith(root + path.sep)) {
    return { ok: false, error: `${folder} does not resolve to a path inside the project.` };
  }
  let leftovers;
  try {
    leftovers = readdirSync(abs);
  } catch (err) {
    // Already gone is the ordinary outcome when the index removal happened to
    // prune it, which is what `git rm` of the last tracked file does.
    if (err.code === "ENOENT") return { ok: true };
    return { ok: false, error: `could not read it to confirm it is empty: ${err.message}` };
  }
  if (leftovers.length > 0) {
    return {
      ok: false,
      error:
        `it still holds ${leftovers.length} ${leftovers.length === 1 ? "entry" : "entries"} this operation never ` +
        `named (${leftovers.join(", ")}), and removing a file the DM's proposal did not name is not this ` +
        "operation's call.",
    };
  }
  try {
    rmdirSync(abs);
  } catch (err) {
    return { ok: false, error: `it is empty but could not be removed: ${err.message}` };
  }
  return { ok: true };
}

// 2. Normalize a base-type value, in place, matching on the value the plan says
//    is there. A file that no longer carries typeFrom means a stale plan, and a
//    stale plan is reported rather than guessed at.
function applyNormalizeType(op, ctx) {
  const entry = entryFor(op);
  const read = readText(ctx, op.from);
  if (!read.ok) {
    entry.detail = `Could not read the file: ${read.error}`;
    return entry;
  }
  const doc = splitTextLines(read.text);
  const bounds = frontmatterBounds(doc.lines);
  if (!bounds) {
    entry.detail = "No frontmatter block, so there is no type field to normalize.";
    return entry;
  }
  for (let i = bounds.start; i < bounds.end; i++) {
    const m = /^(type[ \t]*:[ \t]*)(.*)$/.exec(doc.lines[i]);
    if (!m) continue;
    let rest = m[2];
    let comment = "";
    const c = inlineCommentIndex(rest);
    if (c !== -1) {
      comment = rest.slice(c);
      rest = rest.slice(0, c);
    }
    const { quote, value } = unquoteScalar(rest);
    if (value !== op.typeFrom) {
      entry.detail = `The file carries type ${JSON.stringify(value)}, not the ${JSON.stringify(
        op.typeFrom
      )} this plan was built against. Left unchanged rather than guessed at; re-run the plan phase.`;
      return entry;
    }
    doc.lines[i] = `${m[1]}${quote}${op.typeTo}${quote}${comment}`;
    const written = writeText(ctx, op.from, joinTextLines(doc));
    if (!written.ok) {
      entry.detail = `Could not write the file: ${written.error}`;
      return entry;
    }
    entry.applied = true;
    entry.detail = `type ${JSON.stringify(op.typeFrom)} became ${JSON.stringify(
      op.typeTo
    )} as a single line edit; quoting and any inline comment were carried across.`;
    return entry;
  }
  entry.detail = "No type field in the frontmatter block.";
  return entry;
}

// 3. A rename AND its link rewrite, as one unit of work with one accounting
//    entry. If any named file's rewrite does not land, the entry reports applied
//    false even though the file moved: two batched passes would have reported
//    the move as done and left a dead wikilink that fails silently.
function applyRenameWithLinkRewrite(op, ctx) {
  const entry = entryFor(op);
  entry.linksRewritten = 0;
  entry.linksExpected = list(op.links).length;

  const moved = gitMove(ctx, op.from, op.to);
  if (!moved.ok) {
    entry.detail = `git mv failed: ${moved.error}`;
    return entry;
  }
  entry.mode = moved.mode;

  const oldStem = stemOf(op.from);
  const newStem = stemOf(op.to);
  const missed = [];
  for (const link of list(op.links)) {
    const read = readText(ctx, link);
    if (!read.ok) {
      missed.push(`${link} (unreadable: ${read.error})`);
      continue;
    }
    const rewritten = rewriteWikilinks(read.text, oldStem, newStem);
    if (rewritten.count === 0) {
      missed.push(`${link} (no wikilink to ${oldStem} found)`);
      continue;
    }
    const written = writeText(ctx, link, rewritten.text);
    if (!written.ok) {
      missed.push(`${link} (unwritable: ${written.error})`);
      continue;
    }
    entry.linksRewritten += rewritten.count;
  }

  if (missed.length > 0) {
    entry.detail =
      `The file moved with git mv (${moved.mode}), but the link rewrite half did not complete for: ` +
      `${missed.join("; ")}. The rename and its rewrite are one unit of work, so this entry reports ` +
      "applied false rather than counting the move as done.";
    return entry;
  }
  entry.applied = true;
  entry.detail =
    `git mv (${moved.mode}); rewrote ${entry.linksRewritten} wikilink(s) across ` +
    `${entry.linksExpected} referring file(s) in the same unit of work.`;
  return entry;
}

// 3b. Rename an entity: the file, its frontmatter `name`, and every wikilink
//     naming it, as ONE unit of work with one accounting entry. Modelled on
//     applyRenameWithLinkRewrite just above and holding the same property for the
//     same reason: a dead wikilink is valid markdown that fails silently in
//     Obsidian, so a move reported as done with a dropped rewrite is invisible
//     without this. The frontmatter name is the part this one adds.
//
// BODY PROSE IS NOT TOUCHED. "Rename X to Y everywhere" reads as including the
// sentences that mention X, and it does not: rewriting those is chronicler's
// work, behind chronicler's own proposal gate. Doing it here would rewrite the
// DM's own writing under an approval they gave for a structural change. A case in
// migrate.apply.test.mjs pins that boundary from both sides rather than trusting
// this paragraph.
//
// The frontmatter name is read and checked against the plan BEFORE git mv runs,
// on the same posture applyNormalizeType takes for its typeFrom check: a stale
// plan is reported with the project untouched, rather than moved first and only
// then discovered stale against a tree that already carries the move. That
// ordering matters here specifically because a plan naming no referrers
// (`links: []`) orphans nothing when the file moves, so link integrity has
// nothing to refuse on a stale name alone; checking the name before git mv runs
// is what stops a stale rename from landing, and committing, half-applied. A
// file carrying no name field at all is a different case and is never treated
// as stale: the base schema does not require the field, and this executor never
// inserts it.
//
// The drop rules are the sibling's, deliberately identical rather than merely
// similar. An unreadable or unwritable referrer, and a referrer holding no
// wikilink to the old name, are all collected and reported together after the
// move has already landed, and every one of them makes the entry report applied
// false even though the file moved; the frontmatter name check is the one
// failure mode that runs before the move, for exactly this reason. Zero
// rewrites in a NAMED file is the rewriteWikilinks contract's own case: a
// wikilink inside a code span or a fenced block is left alone, so a plan naming
// a documentation file as a referrer is a stale plan, and saying so is better
// than editing prose that was never a link.
//
// A `links` entry naming this operation's own `from` is tolerated rather than
// declined: the DM's scope can legitimately list the article being renamed as
// its own referrer, when it carries a self-referential wikilink to its old
// name, and by the time the links loop below runs, that content (self-link
// included) already lives at `to`, because the move already carried it there.
// So that one entry is read and written at `to` rather than at the `from` path
// it names; every other entry is read and written at the path it names,
// unchanged.
function applyRenameEntity(op, ctx) {
  const entry = entryFor(op);
  entry.linksRewritten = 0;
  entry.linksExpected = list(op.links).length;
  // Stated rather than left absent, because a later task renders these entries to
  // the DM: "false" says the article carried no name field, which is a normal
  // outcome, while a missing field says nothing at all.
  entry.nameUpdated = false;

  const from = toPosix(op.from);
  const to = toPosix(op.to);

  // The frontmatter name, if the plan names one AND the article carries one,
  // read from `from` because nothing has moved yet. Absence is normal rather
  // than a fault: the base schema does not require the field, so nothing is
  // ever inserted here, on the same rule that keeps `publish` out of every
  // insertion in this module. A plan carrying no nameFrom cannot match on
  // anything, so it does not check or edit anything either.
  let namePrefix = "";
  let nameQuote = "";
  let nameComment = "";
  let nameLineIndex = -1;
  let doc = null;
  if (op.nameFrom != null && op.nameTo != null) {
    const read = readText(ctx, from);
    if (!read.ok) {
      entry.detail = `Could not read the file to check its frontmatter name before renaming, so nothing moved: ${read.error}`;
      return entry;
    }
    doc = splitTextLines(read.text);
    const bounds = frontmatterBounds(doc.lines);
    if (bounds) {
      for (let i = bounds.start; i < bounds.end; i++) {
        const m = /^(name[ \t]*:[ \t]*)(.*)$/.exec(doc.lines[i]);
        if (!m) continue;
        let rest = m[2];
        let comment = "";
        const c = inlineCommentIndex(rest);
        if (c !== -1) {
          comment = rest.slice(c);
          rest = rest.slice(0, c);
        }
        // Raw lines, never a parse and regenerate, and the quoting and any inline
        // comment are carried across: the same rule and the same mechanics as
        // applyNormalizeType.
        const { quote, value } = unquoteScalar(rest);
        if (value !== op.nameFrom) {
          entry.detail = `The file carries name ${JSON.stringify(value)}, not the ${JSON.stringify(
            op.nameFrom
          )} this plan was built against. Left unchanged rather than guessed at, so nothing moved; re-run the plan phase.`;
          return entry;
        }
        nameLineIndex = i;
        namePrefix = m[1];
        nameQuote = quote;
        nameComment = comment;
        break;
      }
    }
  }

  const moved = gitMove(ctx, from, to);
  if (!moved.ok) {
    entry.detail = `git mv failed: ${moved.error}`;
    return entry;
  }
  entry.mode = moved.mode;

  if (nameLineIndex !== -1) {
    doc.lines[nameLineIndex] = `${namePrefix}${nameQuote}${op.nameTo}${nameQuote}${nameComment}`;
    const written = writeText(ctx, to, joinTextLines(doc));
    if (!written.ok) {
      entry.detail = `The file moved with git mv (${moved.mode}) but the frontmatter name could not be written, so it still holds the old value: ${written.error}`;
      return entry;
    }
    entry.nameUpdated = true;
  }

  const oldStem = stemOf(from);
  const newStem = stemOf(to);
  const missed = [];
  for (const link of list(op.links)) {
    // The operation's own source is read and written at `to` instead of at
    // the `from` path it names: the move already carried that file there, so
    // `from` no longer exists to read.
    const target = toPosix(link) === from ? to : link;
    const read = readText(ctx, target);
    if (!read.ok) {
      missed.push(`${link} (unreadable: ${read.error})`);
      continue;
    }
    const rewritten = rewriteWikilinks(read.text, oldStem, newStem);
    if (rewritten.count === 0) {
      missed.push(`${link} (no wikilink to ${oldStem} found)`);
      continue;
    }
    const written = writeText(ctx, target, rewritten.text);
    if (!written.ok) {
      missed.push(`${link} (unwritable: ${written.error})`);
      continue;
    }
    entry.linksRewritten += rewritten.count;
  }

  // A plan carrying no nameFrom never expected a name, so its absence on disk
  // is the ordinary case. A plan carrying a nameFrom DID expect one, and
  // finding none is the same kind of drift a value mismatch reports, just by
  // absence rather than by a different value. It is not failed outright,
  // because doing so would fail this executor's own no-name-field case (an
  // entity that legitimately never carried the field still has to rename), so
  // the distinction is carried in the wording rather than in `applied`.
  const nameNote = entry.nameUpdated
    ? "the frontmatter name was updated"
    : op.nameFrom != null
      ? `the plan expected a frontmatter name (${JSON.stringify(
          op.nameFrom
        )}) but the file carried no name field to update, so nothing was inserted and the plan should be re-checked`
      : "there was no frontmatter name to update";
  if (missed.length > 0) {
    entry.detail =
      `The file moved with git mv (${moved.mode}) and ${nameNote}, but the link rewrite half did not complete ` +
      `for: ${missed.join("; ")}. The rename and its rewrites are one unit of work, so this entry reports ` +
      "applied false rather than counting the move as done.";
    return entry;
  }
  entry.applied = true;
  entry.detail =
    `git mv (${moved.mode}) to ${newStem}, ${nameNote}, and ${entry.linksRewritten} wikilink(s) rewritten across ` +
    `${entry.linksExpected} referring file(s) in the same unit of work. Body prose naming the old entity was not ` +
    "touched: rewriting the DM's sentences is chronicler's work, behind its own proposal gate.";
  return entry;
}

// The article stems in a folder, sorted: every .md file that is not itself an
// index. Subfolders are skipped, and that is load-bearing rather than
// incidental: a subfolder's articles belong to its own index, and listing them
// in the parent would put one article in two indexes, which is the
// single-ownership violation the validation sweep exists to find.
//
// Shared by applyCreateIndex and applyRebuildIndex, which need the identical
// membership answer: one writes a new index from it, the other refreshes an
// existing index's list from it. The two callers disagree on what an
// unreadable folder means for them, though: applyCreateIndex treats it as an
// empty folder and proceeds, while applyRebuildIndex reports it as a failed
// entry. So a readdirSync failure here is returned as { ok: false, error }
// rather than swallowed, letting each caller keep its own behavior.
function articleStemsIn(ctx, folder, suffix) {
  const abs = path.resolve(ctx.cwd, folder);
  let names;
  try {
    names = readdirSync(abs).sort();
  } catch (err) {
    return { ok: false, error: err.message };
  }

  const stems = [];
  for (const name of names) {
    if (!name.toLowerCase().endsWith(".md")) continue;
    let st;
    try {
      st = statSync(path.join(abs, name));
    } catch {
      continue;
    }
    // isFile() is the subfolder guard as well as the junk guard: a subfolder is
    // another index's territory, and listing its articles here would put them in
    // two indexes at once, which is the single-ownership violation the sweep
    // exists to find.
    if (!st.isFile()) continue;
    const stem = name.slice(0, -3);
    if (suffix && stem.endsWith(suffix)) continue; // Another index, not an article.
    stems.push(stem);
  }
  return { ok: true, stems };
}

// 4. Create the missing index for a content-bearing folder. The type value is
//    DERIVED from the suffix rule the generated filename satisfies rather than
//    guessed, and publish is never written: setting a disclosure flag is the
//    DM's call.
function applyCreateIndex(op, ctx) {
  const entry = entryFor(op);
  const to = toPosix(op.to);
  if (existsSync(path.resolve(ctx.cwd, to))) {
    entry.detail = "Destination already exists; refusing to overwrite the DM's file.";
    return entry;
  }
  const folder = path.posix.dirname(to);
  const indexStem = stemOf(to);
  const suffix = indexSuffixFor(ctx.settingForPath(folder), ctx.baseRules);
  const type = typeForSuffix(indexStem, ctx) || "Index";
  const title = indexStem.endsWith(suffix) ? indexStem.slice(0, -suffix.length) : indexStem;

  const scanned = articleStemsIn(ctx, folder, suffix);
  const entries = scanned.ok ? scanned.stems : [];

  const body =
    `---\ntype: ${type}\n---\n\n# ${title}\n\n` +
    (entries.length > 0
      ? entries.map((e) => `- [[${e}]]\n`).join("")
      : "No articles in this folder yet.\n");
  const written = writeText(ctx, to, body);
  if (!written.ok) {
    entry.detail = `Could not write the index: ${written.error}`;
    return entry;
  }
  entry.applied = true;
  entry.detail = `Created with type ${type} (from the suffix rule the filename satisfies) and ${entries.length} article link(s). No publish field: that flag is the DM's call.`;
  return entry;
}

function typeForSuffix(stem, ctx) {
  for (const source of ctx.ruleSources) {
    const rules = rulesOf(source);
    for (const id of Object.keys(rules)) {
      const rule = rules[id];
      if (!rule || rule.check !== "suffixByType") continue;
      for (const pair of list(rule.params && rule.params.mapping)) {
        if (pair && typeof pair.suffix === "string" && pair.suffix !== "" && stem.endsWith(pair.suffix)) {
          return pair.type;
        }
      }
    }
  }
  return null;
}

// Rebuild an EXISTING index's link list from its folder's actual contents.
//
// The list is replaced; everything else in the file is preserved byte for byte.
// That split is the whole design: an index carries the DM's own frontmatter and
// often prose explaining how the folder is organised, and regenerating the file
// wholesale would delete both. CONTEXT.md's avoid list names "silent index
// rewrites" for exactly this reason.
//
// The link list is identified as the maximal run of consecutive lines matching
// LINK_LINE, anchored at the FIRST such line. Prose after the list survives
// because the run stops at the first non-matching line.
const LINK_LINE = /^[ \t]*[-*][ \t]+\[\[[^\]]+\]\][ \t]*$/;

function applyRebuildIndex(op, ctx) {
  const entry = entryFor(op);
  const to = toPosix(op.to);
  const folder = toPosix(op.folder) || path.posix.dirname(to);
  entry.to = to;

  if (!existsSync(path.resolve(ctx.cwd, to))) {
    entry.detail =
      "No index at that path. create-index is the operation that creates one; rebuilding a file that is not there would turn a stale plan into a file the DM never approved.";
    return entry;
  }
  const readIndex = readText(ctx, to);
  if (!readIndex.ok) {
    entry.detail = `Could not read the index: ${readIndex.error}`;
    return entry;
  }

  const suffix = indexSuffixFor(ctx.settingForPath(folder), ctx.baseRules);
  const scanned = articleStemsIn(ctx, folder, suffix);
  if (!scanned.ok) {
    entry.detail = `Could not read the folder: ${scanned.error}`;
    return entry;
  }
  const stems = scanned.stems;

  const doc = splitTextLines(readIndex.text);
  const rendered = stems.map((s) => `- [[${s}]]`);
  const firstLink = doc.lines.findIndex((l) => LINK_LINE.test(l));

  let before;
  let after;
  if (firstLink === -1) {
    // No list yet. Append one, keeping a blank line before it unless the file
    // already ends in one, so an index whose links were all deleted by hand can
    // still be rebuilt rather than refused.
    before = doc.lines.slice();
    while (before.length > 0 && before[before.length - 1].trim() === "") before.pop();
    before.push("");
    after = [""];
  } else {
    let last = firstLink;
    while (last + 1 < doc.lines.length && LINK_LINE.test(doc.lines[last + 1])) last++;
    before = doc.lines.slice(0, firstLink);
    after = doc.lines.slice(last + 1);
  }

  doc.lines = [...before, ...rendered, ...after];
  const written = writeText(ctx, to, joinTextLines(doc));
  if (!written.ok) {
    entry.detail = `Could not write the index: ${written.error}`;
    return entry;
  }
  entry.applied = true;
  entry.entries = stems.length;
  entry.detail = `Rebuilt the link list from ${stems.length} article(s) on disk; frontmatter and prose were preserved.`;
  return entry;
}

// 5. Merge a multi-index folder losslessly. Each source's FULL raw content is
//    concatenated under a provenance heading naming it, so headings, grouping,
//    ordering, and prose all survive; the wikilinks that named a merged-away
//    source are rewritten onto the survivor; and only then is the source
//    removed. All of it is ONE unit of work with one accounting entry, exactly
//    as a rename and its rewrite are, and for the same reason: a dropped rewrite
//    is a dead wikilink, which is valid markdown that fails silently in
//    Obsidian, so a merge reported as done while a rewrite went missing is the
//    failure the accounting exists to prevent.
//
//    REWRITTEN TO THE SURVIVOR rather than reported to the DM. That is what a
//    merge means: the source's content now lives inside the survivor, so a link
//    that pointed at that content still resolves to where the content actually
//    is, and every referring line keeps its wording. The alternative was to
//    report each orphan for the DM to resolve by hand, which was rejected on
//    what it costs: the link-integrity rail correctly refuses to commit a run
//    carrying dead links, so reporting leaves the whole migration blocked until
//    every orphan is repaired one at a time. On the reference consumer that is
//    six repairs standing between the DM and a migration with nothing wrong with
//    it. This does change article content rather than only moving files, so it
//    is held to the same two limits the rename path is: it touches ONLY the
//    files the plan names, and it rewrites ONLY the wikilink target, leaving
//    display text, anchors, path prefixes, and every other byte alone.
//
//    A link that named a source and now names the survivor can land in the
//    survivor's own text as a self-link, since the survivor is usually the file
//    listing the sub-indexes it is absorbing. That is left as a self-link rather
//    than deleted: the line still points at the content, and removing it would
//    be a prose edit, which is a judgment about the DM's material and not
//    something a mechanical pass gets to make.
//
//    The plan carries the referring files in `sourceLinks`; re-deriving them
//    here would be the apply phase inventing an operation. A source the plan
//    named no referrers for gets no rewrite, and any link it orphans is caught
//    by the link-integrity assertion, which blocks the commit. That is the same
//    contract rename-with-link-rewrite has, and the rail is unchanged.
function applyMergeIndex(op, ctx) {
  const entry = entryFor(op);
  const to = toPosix(op.to);
  const sources = list(op.sources).map(toPosix);
  entry.linksRewritten = 0;
  entry.linksExpected = 0;
  if (sources.length === 0) {
    entry.detail = "merge-index carries no sources; nothing to merge.";
    return entry;
  }

  // The referring files the plan names, grouped by the source they point at. The
  // accounted unit is the PAIR: one article referring to two merged-away sources
  // is two rewrites to account for, because either one going missing is one dead
  // wikilink.
  const named = op.sourceLinks && typeof op.sourceLinks === "object" ? op.sourceLinks : {};
  const refsOf = new Map();
  for (const source of sources) {
    const refs = [];
    for (const raw of list(named[source])) {
      const ref = toPosix(raw);
      if (ref && !refs.includes(ref)) refs.push(ref);
    }
    refsOf.set(source, refs);
    entry.linksExpected += refs.length;
  }

  const survivorRead = readText(ctx, to);
  let merged = survivorRead.ok ? survivorRead.text : "";
  if (!survivorRead.ok && existsSync(path.resolve(ctx.cwd, to))) {
    entry.detail = `Could not read the surviving index: ${survivorRead.error}`;
    return entry;
  }

  const folded = [];
  for (const source of sources) {
    const read = readText(ctx, source);
    if (!read.ok) {
      entry.detail = `Could not read the source index ${source}: ${read.error}. Nothing was merged or removed.`;
      return entry;
    }
    if (!merged.endsWith("\n")) merged += "\n";
    merged += `\n## Merged from ${path.posix.basename(source)}\n\n${read.text}`;
    folded.push(source);
  }

  const survivorStem = stemOf(to);
  const missed = [];

  // A referring file that IS the survivor or one of the sources is now text
  // inside `merged`, so its rewrite happens there rather than on disk: on disk
  // the survivor is about to be overwritten by this same merged text and each
  // source is about to be removed by the git rm below, so a rewrite written to
  // either would be discarded. This is not the corner case it sounds like. On
  // the reference consumer every one of the six inbound links to items/'s
  // merged-away sub-indexes lives in the survivor itself, because the survivor
  // is precisely the index that lists them.
  //
  // ONE pass per SOURCE, not one per referring pair. `merged` is a single
  // document by this point, so one pass over it rewrites every occurrence no
  // matter which original file contributed it, and a second pass for the same
  // source would find nothing left and report a drop that did not happen.
  const inMerged = new Set([to, ...sources]);
  for (const source of sources) {
    const here = refsOf.get(source).filter((ref) => inMerged.has(ref));
    if (here.length === 0) continue;
    const out = rewriteWikilinks(merged, stemOf(source), survivorStem);
    if (out.count === 0) {
      missed.push(`${here.join(", ")} (no wikilink to ${stemOf(source)} in the merged text)`);
      continue;
    }
    merged = out.text;
    entry.linksRewritten += out.count;
  }

  const written = writeText(ctx, to, merged);
  if (!written.ok) {
    entry.detail = `Could not write the merged index: ${written.error}. No source was removed.`;
    return entry;
  }

  // Through gitRemove, which is where the pathspec guard this call needs lives:
  // a merge source is a DM-chosen index filename, and a bare pathspec removed an
  // unrelated neighbour when one held brackets. The rationale is written once,
  // above gitRemove, rather than restated here.
  const undeleted = [];
  for (const source of folded) {
    const removed = gitRemove(ctx, source);
    if (!removed.ok) undeleted.push(`${source} (${removed.error})`);
  }
  if (undeleted.length > 0) {
    entry.detail =
      `Content from every source was merged into ${to}, but these sources are still on disk and ` +
      `would now duplicate it: ${undeleted.join("; ")}.`;
    return entry;
  }

  // Referring files outside the merged text, rewritten on disk. After the
  // removal, the same order rename-with-link-rewrite uses: a rewrite that does
  // not land leaves a dead wikilink for the link-integrity assertion to block
  // the commit on, which is the loud outcome. Rewriting first and removing after
  // would instead leave a failed merge looking link-clean and let a folder with
  // duplicated content commit quietly.
  const onDisk = new Map();
  for (const source of sources) {
    for (const ref of refsOf.get(source)) {
      if (inMerged.has(ref)) continue;
      if (!onDisk.has(ref)) onDisk.set(ref, []);
      onDisk.get(ref).push(source);
    }
  }
  for (const [ref, refSources] of onDisk) {
    const read = readText(ctx, ref);
    if (!read.ok) {
      missed.push(`${ref} (unreadable: ${read.error})`);
      continue;
    }
    let text = read.text;
    let rewrittenHere = 0;
    for (const source of refSources) {
      const out = rewriteWikilinks(text, stemOf(source), survivorStem);
      if (out.count === 0) {
        missed.push(`${ref} (no wikilink to ${stemOf(source)} found)`);
        continue;
      }
      text = out.text;
      rewrittenHere += out.count;
    }
    // A file whose rewrites all missed has nothing to write back, and writing it
    // anyway would rewrite the DM's file with its own bytes for no reason.
    if (rewrittenHere === 0) continue;
    const wrote = writeText(ctx, ref, text);
    if (!wrote.ok) {
      missed.push(`${ref} (unwritable: ${wrote.error})`);
      continue;
    }
    entry.linksRewritten += rewrittenHere;
  }

  entry.sources = folded;
  if (missed.length > 0) {
    entry.detail =
      `Content from every source was merged into ${to} and each source removed with git rm, but the link ` +
      `rewrite half did not complete for: ${missed.join("; ")}. The merge and its rewrites are one unit of ` +
      "work, so this entry reports applied false rather than counting the merge as done.";
    return entry;
  }
  entry.applied = true;
  entry.detail =
    `Folded ${folded.length} source index/indexes into ${to}, each under a provenance heading naming it, ` +
    `then removed them with git rm. Rewrote ${entry.linksRewritten} wikilink(s) across ${entry.linksExpected} ` +
    "referring file/source pair(s) onto the survivor, in the same unit of work.";
  return entry;
}

// 6. Repair frontmatter: insert defaulted fields EXCEPT publish, and reorder to
//    canonical order. Both halves are line moves on the raw text.
function applyRepairFrontmatter(op, ctx) {
  const entry = entryFor(op);
  // publish is stripped here as well as in the plan phase. The DM can edit the
  // plan between the two phases, so the last component that could write the flag
  // is the one that refuses to, rather than trusting the file it was handed.
  const requested = list(op.insert);
  const insert = requested.filter((f) => f !== "publish");
  const declined = requested.filter((f) => f === "publish");

  if (insert.length === 0 && op.reorder !== true) {
    // NOTHING IS WRITTEN ON EITHER BRANCH, and the detail says so on both. The
    // publish branch still reports applied, because refusing publish IS the whole
    // of what this operation had to do and reporting it failed would sink
    // result.ok over an operation that behaved correctly. What it must not do is
    // let a DM counting `applied` read a repair that changed a file, which is the
    // one place in this module where applied true and "no byte changed" coincide.
    // So the sentence names the outcome the way applyUpdateProsePaths names its
    // own no-op: the file was left exactly as it was.
    entry.detail =
      declined.length > 0
        ? "The only field this operation asked to insert was publish, which is never written unattended. Nothing was written and the file is byte for byte as it was; refusing the flag is the whole of what this operation had to do, which is why it counts as applied."
        : "Nothing to insert and no reorder requested. Nothing was written and the file is byte for byte as it was.";
    entry.applied = declined.length > 0;
    return entry;
  }

  const read = readText(ctx, op.from);
  if (!read.ok) {
    entry.detail = `Could not read the file: ${read.error}`;
    return entry;
  }
  const doc = splitTextLines(read.text);
  const bounds = frontmatterBounds(doc.lines);
  if (!bounds) {
    entry.detail = "No frontmatter block. Refusing to invent one.";
    return entry;
  }

  let blocks = frontmatterBlocks(doc.lines, bounds.start, bounds.end);
  const present = new Set(blocks.map((b) => b.key).filter(Boolean));
  const unresolved = [];
  const inserted = [];
  for (const field of insert) {
    if (present.has(field)) continue;
    const resolved = defaultValueFor(field, ctx.ruleSources);
    if (!resolved.found) {
      unresolved.push(field);
      continue;
    }
    blocks.push({ key: field, lines: [`${field}: ${renderScalar(resolved.value)}`] });
    inserted.push(field);
  }
  if (unresolved.length > 0) {
    entry.detail =
      `No rule documents a default for: ${unresolved.join(", ")}. Nothing was written: inventing a ` +
      "value for a DM's article is a guess, and a guess in frontmatter is what the enum and leak guards exist to catch.";
    return entry;
  }

  if (op.reorder === true) blocks = reorderFrontmatterBlocks(blocks, fieldOrderFor(ctx));

  const rebuilt = [];
  for (const block of blocks) rebuilt.push(...block.lines);
  doc.lines.splice(bounds.start, bounds.end - bounds.start, ...rebuilt);

  const written = writeText(ctx, op.from, joinTextLines(doc));
  if (!written.ok) {
    entry.detail = `Could not write the file: ${written.error}`;
    return entry;
  }
  entry.applied = true;
  entry.detail =
    (inserted.length > 0 ? `Inserted ${inserted.join(", ")}. ` : "") +
    (op.reorder === true ? "Reordered to canonical field order. " : "") +
    (declined.length > 0
      ? "Declined to insert publish: setting a disclosure flag is the DM's call, and defaulting it would either hide finished lore or leak secret lore. "
      : "") +
    "Applied as a line move on the raw text, so comments, quoting, and nested maps were carried across untouched.";
  return entry;
}

// Rewrite stale path references in a file the DM named. This is the last of
// setup's five deferrals: the consumer's CLAUDE.md, its conventions document,
// and the DM's separate wiki-website project all name paths that went stale the
// moment the prongs moved, and none of them are knowledge base articles the
// migration would otherwise touch.
//
// It EDITS IN PLACE, so it carries `from` and no `to`, on the same terms as
// normalize-type and repair-frontmatter: a `to` means a destination a move could
// overwrite, and this operation moves nothing.
//
// Replacements are applied IN THE ORDER THE PLAN GIVES, as literal strings.
// Order is the planner's responsibility and it matters: "rolara-kb/" is a prefix
// of "rolara-kb/sessions/", so applying the short one first turns the long one
// into a path the second replacement can no longer match. planProsePathUpdates
// sorts longest first for exactly this reason, and a hand-edited proposal that
// reorders them gets what it asked for rather than a silent re-sort.
//
// Literal, not regex: a path carries "." and may carry "[" or "(", and treating
// a DM-supplied path as a pattern would match text it does not name. String.split
// takes its argument as a literal when it is a string, which is why the pass below
// is split/join rather than replaceAll with a constructed pattern.
function applyUpdateProsePaths(op, ctx) {
  const entry = entryFor(op);
  const target = toPosix(op.from);
  entry.replacements = 0;

  if (!existsSync(path.resolve(ctx.cwd, target))) {
    entry.detail =
      "No file at that path. A prose reference is only ever updated in a file that exists; creating one would invent a document the DM never named.";
    return entry;
  }
  const loaded = readText(ctx, target);
  if (!loaded.ok) {
    entry.detail = `Could not read the file: ${loaded.error}`;
    return entry;
  }

  let text = loaded.text;
  for (const r of list(op.replacements)) {
    const from = r && r.from;
    const to = r && r.to;
    if (typeof from !== "string" || from === "" || typeof to !== "string") continue;
    const parts = text.split(from);
    entry.replacements += parts.length - 1;
    text = parts.join(to);
  }

  if (text === loaded.text) {
    // Not a failure. A DM who already fixed a reference by hand should be able
    // to re-run an approved proposal without it reporting an error.
    entry.applied = true;
    entry.detail = "No stale reference found; the file was left byte for byte as it was.";
    return entry;
  }
  const written = writeText(ctx, target, text);
  if (!written.ok) {
    entry.detail = `Could not write the file: ${written.error}`;
    return entry;
  }
  entry.applied = true;
  entry.detail = `Replaced ${entry.replacements} stale path reference(s).`;
  return entry;
}

// 7. Create or move the per-setting Obsidian vault. Wikilink resolution is
//    basename-only, so one vault per setting is what keeps two worlds apart.
function applyVault(op, ctx) {
  const entry = entryFor(op);
  const to = toPosix(op.to);
  if (op.from) {
    const moved = gitMove(ctx, op.from, to);
    if (!moved.ok) {
      entry.detail = `git mv failed: ${moved.error}`;
      return entry;
    }
    entry.applied = true;
    entry.mode = moved.mode;
    entry.detail = `Moved the vault with git mv (${moved.mode}).`;
    return entry;
  }
  const abs = path.resolve(ctx.cwd, to);
  try {
    mkdirSync(abs, { recursive: true });
  } catch (err) {
    entry.detail = `Could not create the vault directory: ${err.message}`;
    return entry;
  }
  // git cannot track an empty directory, so the vault marker needs one file.
  // "{}" is Obsidian's every-default configuration and states no preference on
  // the DM's behalf.
  const marker = `${to}/app.json`;
  if (!existsSync(path.resolve(ctx.cwd, marker))) {
    const written = writeText(ctx, marker, "{}\n");
    if (!written.ok) {
      entry.detail = `Could not write the vault marker: ${written.error}`;
      return entry;
    }
  }
  entry.applied = true;
  entry.detail = "Created the vault directory with an all-defaults app.json, which is the minimum git can track.";
  return entry;
}

// 8. Regenerate a setting's tag registry from its post-migration KB. The owning
//    setting is resolved by the registry path the operation targets, because the
//    operation carries no setting index and resolving by NAME would collapse two
//    settings that share one.
function applyTagRegistry(op, ctx) {
  const entry = entryFor(op);
  const to = toPosix(op.to);
  const owner = list(ctx.settings).find((s) => s && toPosix(s.tagRegistryPath || "") === to);
  if (!owner) {
    entry.detail = `No setting declares ${to} as its tagRegistryPath, so there is no KB to count. Left alone rather than regenerated from a guess.`;
    return entry;
  }
  const counts = new Map();
  for (const root of prongRootsOf(owner)) {
    const abs = path.resolve(ctx.cwd, root);
    if (!existsSync(abs)) continue;
    for (const file of walkMarkdown(abs)) {
      let text;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      for (const tag of frontmatterTags(text)) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  const registry = {};
  for (const tag of [...counts.keys()].sort()) registry[tag] = counts.get(tag);
  const written = writeText(ctx, to, `${JSON.stringify(registry, null, 2)}\n`);
  if (!written.ok) {
    entry.detail = `Could not write the registry: ${written.error}`;
    return entry;
  }
  entry.applied = true;
  entry.detail = `Regenerated from ${owner.name || "(unnamed setting)"}'s post-migration KB: ${
    Object.keys(registry).length
  } distinct tag(s).`;
  return entry;
}

// A documented subset, on purpose: the inline form `tags: [a, b]` and the block
// form under `tags:`. Anything else is left uncounted rather than half-parsed.
function frontmatterTags(text) {
  const { lines } = splitTextLines(text);
  const bounds = frontmatterBounds(lines);
  if (!bounds) return [];
  const out = [];
  for (let i = bounds.start; i < bounds.end; i++) {
    const m = /^tags[ \t]*:[ \t]*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const rest = m[1].trim();
    if (rest.startsWith("[")) {
      const inner = rest.slice(1, rest.endsWith("]") ? -1 : undefined);
      for (const raw of inner.split(",")) {
        const { value } = unquoteScalar(raw);
        if (value !== "") out.push(value);
      }
      return out;
    }
    for (let j = i + 1; j < bounds.end; j++) {
      const item = /^[ \t]*-[ \t]*(.*)$/.exec(lines[j]);
      if (!item) break;
      const { value } = unquoteScalar(item[1]);
      if (value !== "") out.push(value);
    }
    return out;
  }
  return out;
}

const EXECUTORS = {
  "relocate-prong": applyRelocateProng,
  // Same implementation, deliberately a distinct kind. A prong root move is
  // "your whole knowledge base moved"; a path move is "these 40 articles moved".
  // The accounting and the DM-facing report have to be able to tell those apart,
  // and a shared kind would flatten them into one line.
  "relocate-path": applyRelocateProng,
  "absorb-folder": applyAbsorbFolder,
  "split-folder": applySplitFolder,
  "normalize-type": applyNormalizeType,
  "rename-with-link-rewrite": applyRenameWithLinkRewrite,
  "rename-entity": applyRenameEntity,
  "create-index": applyCreateIndex,
  "merge-index": applyMergeIndex,
  "rebuild-index": applyRebuildIndex,
  "repair-frontmatter": applyRepairFrontmatter,
  "update-prose-paths": applyUpdateProsePaths,
  vault: applyVault,
  "tag-registry": applyTagRegistry,
};

/**
 * Applies ONE operation. Exported so a host dispatching per-operation workers
 * can delegate to it, and so a worker can wrap it.
 */
export function applyOperation(op, ctx) {
  const executor = EXECUTORS[op && op.op];
  if (!executor) {
    // applyPlan refuses an unknown kind before any mutation, so reaching here
    // means a custom worker routed something the preflight never saw.
    return { op: op && op.op, from: op && op.from, to: op && op.to, applied: false, detail: "No executor for this operation kind." };
  }
  return executor(op, ctx);
}

// ---------------------------------------------------------------------------
// applyPlan
// ---------------------------------------------------------------------------

// The operation kinds that can orphan a wikilink, and so the only ones whose
// rewrite counts are evidence that this knowledge base holds wikilinks at all. A
// rename changes a target's filename and a merge removes its sources outright.
// relocate-prong is deliberately not one of them: Obsidian resolves wikilinks by
// basename, so a folder move leaves every basename exactly where it was.
//
// Membership here is necessary but NOT sufficient to arm the zero-link rail; see
// the expectLinks argument in applyPlan. A plan carrying one of these kinds says
// only what was attempted.
//
// rename-entity is here on exactly the rename argument above: it changes a
// target's filename and carries `links` to repair the wikilinks that named it. Its
// omission would have left the rail unarmed for a /migrate run made entirely of
// entity renames, so a walk pointed away from the content would have passed with
// zero links checked. Inert for setup's unattended migration either way, because
// no planner buildPlan reaches emits the kind.
const LINK_BEARING_OPERATIONS = new Set(["rename-with-link-rewrite", "rename-entity", "merge-index"]);

// The recovery instruction, whole rather than half of one.
//
// `git reset --hard <snapshot>` restores every TRACKED path, and the files this
// run CREATED were never staged, so it leaves them behind: a created index, a
// vault's app.json, a tag registry written to a path that was not tracked
// before. Measured, on a blocked run that created one index: the DM follows the
// printed line, the created index is still on disk as an untracked file, and the
// rerun then aborts in the prechecks on an on-disk collision with that very
// file. So the printed instruction sent the DM to a state where the migration
// refuses to start.
//
// Chosen: the message names what else is needed. The alternative was for the
// blocked path to remove what the run created, and it was rejected twice over.
// This module deliberately imports no primitive that can destroy a FILE (no
// rmSync, no unlinkSync, no renameSync) precisely so that no code path can quietly
// lose one, and the blocked path is the one where something has ALREADY gone wrong,
// which is the worst available moment to start deleting unattended.
//
// rmdirSync IS imported, and it is the single exception rather than a hole in that
// claim: it is non-recursive, it is reached only from removeAbsorbedFolder, and
// that function verifies the folder is empty and resolves inside the project first,
// so it can remove a directory this module has already emptied through git and
// nothing else. See removeAbsorbedFolder for why the emptiness check is what makes
// the non-recursive form the safe one.
//
// The leftovers are READ BACK from git rather than inferred from the plan, so
// the list is what `git clean -fd` will actually remove and the DM can check it
// before running anything. Ignored paths are in neither list: `--porcelain`
// without `--ignored` does not report them and `clean -fd` without `-x` does not
// remove them, which is the right pairing, since an ignored file was never in
// the snapshot to be restored to in the first place.
function restoreInstruction(git, cwd, snapshot) {
  const base = `Restore the tracked files with: git -C ${cwd} reset --hard ${snapshot}.`;
  const status = git(["status", "--porcelain"]);
  if (!status.ok) {
    return `${base} That may not be the whole recovery: any file this run CREATED is untracked, and reset --hard leaves untracked files behind. Check git status afterward.`;
  }
  const created = status.stdout
    .split("\n")
    .filter((line) => line.startsWith("?? "))
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
  if (created.length === 0) return base;
  return (
    `${base} That is NOT the whole recovery: this run created ${created.length} untracked path(s) that reset --hard ` +
    `leaves behind, and a rerun aborts on them in the prechecks as on-disk collisions. They are: ${created.join(", ")}. ` +
    `Remove them after the reset with: git -C ${cwd} clean -fd.`
  );
}

// One skip, in the DM's terms. A one-operation item reads exactly as it did before
// grouping existed. A grouped item is ONE item rather than several, which is the
// point of the grouping, and it names every operation it took with it so that the
// accounting stays complete: an operation the DM cannot see in the report is an
// operation the DM cannot check.
function skipDetail(item) {
  const entry = item.group === null ? "(no group id)" : item.group;
  // `from` first, because for the two kinds that emit groups today it is the folder
  // the DM named in the scope; `to` is the fallback for the index kinds, which carry
  // no source. Naming an absorb by its `to` would name the PARENT it dissolves into
  // rather than the folder being dissolved.
  const named = item.ops.map((o) => `${o.op} ${o.from || o.to || "(unnamed)"}`).join(", ");
  if (item.ignored.length === 0) {
    // Reachable only from a hand-edited plan, where an operation can belong to a
    // group whose ignored source sits on an operation reported under a DIFFERENT
    // group of its own. Named rather than papered over: a skip that gives no reason
    // is worse than one that reads unusually.
    return (
      `Skipped: another operation from scope entry ${entry} names a git-ignored source, so every operation from ` +
      `that entry is skipped together and none of these was run: ${named}.`
    );
  }
  const base = `Skipped: ${item.ignored.join(", ")} is git-ignored, so the pre-migration snapshot does not contain it and moving it would be unrecoverable. Reported and left exactly where it is.`;
  if (item.ops.length <= 1) return base;
  return (
    `${base} All ${item.ops.length} operations from scope entry ${entry} are skipped together, because applying ` +
    `the rest would leave the project matching neither its old shape nor the one that was approved: ${named}.`
  );
}

// A description of how an operation's enumerated files fail to arrive in the shape
// the executors and the prechecks both read, or null when they do not.
//
// `buckets[].articles` is a bare STRING array in the scope key the DM negotiates
// with the command, and an OBJECT array carrying `from` and `to` in the operation,
// under the same field name. So a DM editing the proposal between the two phases
// has a documented reason to write the string form, and this is not an exotic
// hand-edit. Measured on exactly that shape: articleMovesOf drops every non-object
// entry, so the prechecks examined nothing and applySplitFolder moved nothing, and
// the executor then fell out of its loop and set applied true with the detail
// "Split 0 article(s) across 2 subfolder(s)". With the create-index operations the
// planner always pairs with a split in the same plan, the DM got two empty bucket
// folders and a report saying the split applied.
//
// REFUSED rather than coerced, and refused for the whole RUN rather than for the
// one entry. Coercing would mean rebuilding each destination here out of the bucket
// folder and the basename, which is the planner's job: the apply phase would be
// inventing the moves it then performs, and the proposal the DM approved did not
// contain them. Failing only the entry would leave the paired index operations to
// run on top of a partition that never happened, which is the grouped-skip defect
// again. This fires before the snapshot, so the project is byte-identical, which is
// the posture every other unreadable-plan refusal here takes.
function malformedShapeOf(o) {
  const shape = "each entry must be an object carrying `from` and `to`, which is the shape the planner emits";
  const stringNote =
    "A bare string is the SCOPE syntax for that field, not the operation syntax. Moving nothing while reporting the operation as applied is worse than refusing to start.";
  const where = `Operation ${JSON.stringify(o.op)} on ${o.from || o.to || "(unnamed)"}`;
  // A field present but not an array is the same silent drop by a different route:
  // list() reads it as empty, so articleMovesOf finds no moves and the executor
  // reports the operation applied having moved nothing. Absent is fine, and is what
  // every kind that carries neither field looks like.
  for (const field of ["articles", "buckets"]) {
    if (o[field] != null && !Array.isArray(o[field])) {
      return `${where} carries \`${field}\` as ${JSON.stringify(o[field])} rather than an array, so every entry it was meant to name is invisible to the prechecks and to the executor alike.`;
    }
  }
  // `replacements` is `update-prose-paths`'s own list, read by no precheck (this
  // kind carries no `to`, so it never reaches destinationEntriesOf or
  // findIgnoredSources), but the executor hazard is the same one the loop above
  // exists to refuse: list() reads a non-array as empty, so
  // applyUpdateProsePaths makes zero substitutions and reports the file left
  // byte for byte as it was, indistinguishable from a proposal that genuinely
  // found nothing stale to fix.
  if (o.replacements != null && !Array.isArray(o.replacements)) {
    return `${where} carries \`replacements\` as ${JSON.stringify(o.replacements)} rather than an array, so every substitution it was meant to make silently does not happen, and the run reports success for none of them.`;
  }
  for (const [i, a] of list(o.articles).entries()) {
    if (a && typeof a === "object") continue;
    return `${where} carries ${JSON.stringify(a)} in \`articles\` at position ${i}: ${shape}. ${stringNote}`;
  }
  for (const [bi, b] of list(o.buckets).entries()) {
    if (!b || typeof b !== "object") {
      return `${where} carries ${JSON.stringify(b)} in \`buckets\` at position ${bi}: each bucket must be an object carrying \`folder\`, \`name\`, and \`articles\`. A bucket that cannot be read is a bucket of the partition the DM approved that would silently not happen.`;
    }
    if (b.articles != null && !Array.isArray(b.articles)) {
      return `${where} carries \`buckets[${bi}].articles\` as ${JSON.stringify(b.articles)} rather than an array, so every article it was meant to name is invisible to the prechecks and to the executor alike.`;
    }
    for (const [i, a] of list(b.articles).entries()) {
      if (a && typeof a === "object") continue;
      return `${where} carries ${JSON.stringify(a)} in \`buckets[${bi}].articles\` at position ${i}: ${shape}. ${stringNote}`;
    }
  }
  return null;
}

/**
 * Applies a plan. Every refusal happens BEFORE any mutation, and every refusal
 * leaves the project byte-identical.
 *
 * @param {{operations: Array}} plan
 * @param {{cwd: string, settings?: Array, baseRules?: object, worker?: Function,
 *          commit?: boolean, commitMessage?: string}} options
 * @returns {{ok: boolean, refused: object|null, snapshot: string|null,
 *            migration: string|null, committed: boolean,
 *            applied: Array, failed: Array, dropped: Array, skipped: Array,
 *            ignoredEdits: Array, ignoredMoved: Array,
 *            linkIntegrity: object|null, messages: Array<string>}}
 *
 * `skipped` is one item per SKIP, not per operation, because a scope entry that
 * emitted several operations is skipped as a unit; see groupsOf. Each item carries
 * `group` (the scope-entry id, or null for an ungrouped operation), `ops` with
 * every operation the item covers, and `ignored` with the git-ignored paths that
 * caused it. An ungrouped operation still produces an item of exactly one.
 *
 * `settings` are the conventions that were on disk when the run started, so
 * their prong roots are PRE-migration paths, and a scope can put content
 * somewhere none of them names at all. Both are the ordinary shape and both are
 * handled: the link-integrity assertion resolves each declared root through this
 * plan's own moves before walking it, and walks the folders those moves landed
 * content in that no declared root covers.
 */
export function applyPlan(plan, options = {}) {
  const cwd = options.cwd;
  const settings = list(options.settings);
  const baseRules = options.baseRules || null;
  const worker = typeof options.worker === "function" ? options.worker : applyOperation;
  const wantCommit = options.commit !== false;
  const commitMessage =
    typeof options.commitMessage === "string" && options.commitMessage.trim() !== ""
      ? options.commitMessage
      : DEFAULT_MIGRATION_COMMIT_MESSAGE;

  const result = {
    ok: false,
    refused: null,
    snapshot: null,
    migration: null,
    committed: false,
    applied: [],
    failed: [],
    dropped: [],
    skipped: [],
    ignoredEdits: [],
    ignoredMoved: [],
    linkIntegrity: null,
    messages: [],
  };
  const refuse = (reason, detail) => {
    result.refused = { reason, detail };
    result.messages.push(detail);
    return result;
  };

  if (!cwd || !existsSync(cwd)) {
    return refuse("no-project", "No project root was given, or it does not exist. Nothing was touched.");
  }
  const operations = list(plan && plan.operations).filter((o) => o && typeof o === "object");
  if (!Array.isArray(plan && plan.operations)) {
    return refuse("no-operations", "The plan carries no operations array. Nothing was touched.");
  }

  // A plan can be hand-edited between the two phases; that is a designed path.
  // So the shape is checked here rather than assumed from the plan phase.
  for (const op of operations) {
    if (DEFERRED_OPERATIONS.includes(op.op)) {
      return refuse(
        "deferred-operation",
        `The plan carries a ${op.op} operation. Split and absorb are structural judgments about the DM's own material and are never executed unattended. Nothing was touched.`
      );
    }
    if (!EXECUTORS[op.op]) {
      return refuse(
        "unknown-operation",
        `No executor for operation kind ${JSON.stringify(op.op)}. Refusing to start rather than silently skipping a whole class of work. Nothing was touched.`
      );
    }
    const malformed = malformedShapeOf(op);
    if (malformed) {
      return refuse("malformed-operation", `${malformed} Nothing was touched.`);
    }
  }
  const outOfOrder = findOutOfOrder(operations);
  if (outOfOrder) {
    return refuse(
      "out-of-order",
      `Operation ${outOfOrder.index} (${outOfOrder.op}) comes after ${outOfOrder.after} in the plan, but the declared order is a dependency order: a file's required suffix derives from its type, so renaming before normalizing computes suffixes from stale values. Nothing was touched.`
    );
  }

  // Re-run the prechecks against the operations actually being applied rather
  // than trusting plan.prechecks, which a hand-edited plan can contradict.
  const prechecks = runPrechecks({ operations, projectRoot: cwd });

  // prechecks.ignored is Array OR null, and null means the question could not be
  // answered. It is NOT wrapped in list(), because that would turn null into []
  // and read "undetermined" as "nothing is ignored", which is the exact defect
  // the three-state signal exists to prevent. Undetermined refuses the run: the
  // apply phase's whole contract for an ignored source is to skip it, and it
  // cannot honour that contract without knowing which ones they are.
  if (prechecks.ignored === null) {
    return refuse(
      "ignored-undetermined",
      "Which sources are git-ignored could not be determined (no repository, or git could not be asked). An ignored file is outside the snapshot, so moving it would be unrecoverable, and an undetermined verdict is not the claim that nothing is ignored. Nothing was touched."
    );
  }
  if (!prechecks.ok) {
    return refuse(
      "collisions",
      `The destination prechecks report ${prechecks.collisions.length} collision(s), each of which would overwrite a file. Nothing was touched. Resolve them and re-run: ${JSON.stringify(
        prechecks.collisions
      )}`
    );
  }

  const git = makeGit(cwd);

  // THE SNAPSHOT PRECEDES EVERY MUTATION. Verified, not assumed.
  const headOut = git(["rev-parse", "HEAD"]);
  if (!headOut.ok) {
    return refuse(
      "no-snapshot",
      `No commit to restore to: ${firstLine(headOut.stderr)}. The migration executor expects a verified snapshot commit to already exist. Nothing was touched.`
    );
  }
  const statusOut = git(["status", "--porcelain"]);
  if (!statusOut.ok) {
    return refuse("no-snapshot", `Could not read the working tree state: ${firstLine(statusOut.stderr)}. Nothing was touched.`);
  }
  if (statusOut.stdout.trim() !== "") {
    return refuse(
      "dirty-tree",
      "The working tree is not clean, so the commit at HEAD does not contain the current state and there would be nothing to restore to. Commit or stash first. Nothing was touched."
    );
  }
  result.snapshot = headOut.stdout.trim();

  const ruleSources = [baseRules].filter(Boolean);
  const ctx = {
    cwd,
    git,
    settings,
    baseRules,
    ruleSources,
    settingForPath: (rel) => settingOwning(settings, rel),
  };

  // ------------------------------------------------------------------
  // What this run skips, decided for every operation BEFORE any of them runs
  // ------------------------------------------------------------------
  //
  // The enumerated files of an absorb or a split are sources here for the same
  // reason findIgnoredSources counts them: neither kind moves its own `from`, it
  // moves each file it enumerates one `git mv` at a time, so the source that can
  // be git-ignored is one of those files. articleMovesOf is what reaches a split's
  // articles, which sit inside `buckets` rather than flat in `articles`.
  //
  // DECIDED: an absorb or a split carrying a git-ignored file is skipped WHOLE,
  // not per file and, for a split, not per bucket. Adding the files to `sources`
  // is what puts an ignored one inside the operation rather than beside it. Three
  // reasons it is the right unit. The module's contract for an ignored source is
  // that it is skipped and reported rather than moved, and per-file skipping would
  // move the folder's other files, so the ignored file would be left sitting alone
  // in a folder whose index had just been removed: skipped in name and stranded in
  // fact. A half-absorbed folder, or a partition applied to some of its buckets,
  // is precisely the failure the one-entry-per-operation accounting exists to
  // prevent, and there is no partial entry to report it with. And `git mv` on an
  // ignored file hard-fails with "not under version control", exit 128, so
  // per-file skipping would only be choosing which way to arrive at that same
  // half-applied folder: measured on a two-bucket split whose second bucket held
  // an ignored draft, the first bucket's article moved, an empty second bucket
  // folder was created, and only then did the operation fail.
  //
  // AND THE UNIT IS WIDER THAN THE OPERATION: it is the SCOPE ENTRY that emitted
  // it. One entry emits several operations, and skipping the one that carries the
  // ignored file while running its siblings produced two measured defects, both
  // recorded against groupsOf, which is where the id and its hand-edit tolerance
  // are documented. That is why this is a pass of its own ahead of the apply loop
  // rather than a test inside it: whether an operation runs can depend on a LATER
  // operation's ignored source, so every verdict has to be known before the first
  // mutation.
  //
  // The cost is that one git-ignored draft declines the whole scope entry the DM
  // asked for. That is a reported refusal the DM can act on by moving the draft or
  // unignoring it, and it is recoverable; the alternative is not.
  //
  // The decision itself lives in ignoredSkipDecision, shared with buildScopedPlan's
  // plan-side decline rather than written out twice. A scoped plan already declines
  // the operations this pass would skip, so on a /migrate run this normally finds
  // nothing left to do; it still runs, because a hand-edited plan and setup's own
  // unattended migration both arrive here without ever having been through that
  // decline. Two skip rules that could drift apart is exactly what the shared
  // function exists to prevent.
  const skips = ignoredSkipDecision(operations, prechecks.ignored);

  // ------------------------------------------------------------------
  // Apply, in plan order
  // ------------------------------------------------------------------
  const raw = [];
  const skipItems = new Map();
  for (const op of operations) {
    const skip = skips.skipOf(op);
    if (skip) {
      let item = skipItems.get(skip.key);
      if (!item) {
        item = { op: op.op, from: op.from, to: op.to, applied: false, group: skip.group, ops: [], ignored: [], detail: "" };
        skipItems.set(skip.key, item);
        // Pushed now so the items stay in plan order; the detail is written once
        // the item's whole membership is known, below.
        result.skipped.push(item);
      }
      item.ops.push({ op: op.op, from: op.from, to: op.to });
      for (const s of skips.ignoredOf(op)) if (!item.ignored.includes(s)) item.ignored.push(s);
      raw.push({ op, outcome: "skipped" });
      continue;
    }
    // Per-setting rules win over the base layer, the same precedence the index
    // suffix resolution already uses.
    const owner = op.from || op.to ? settingOwning(settings, toPosix(op.from || op.to)) : null;
    const opCtx = Object.assign({}, ctx, {
      ruleSources: [owner && owner.rules, baseRules].filter(Boolean),
    });
    // A worker that throws must not escape mid-run. An exception here would
    // abandon the remaining operations, skip the link-integrity assertion, and
    // return nothing at all, leaving a half-applied repository with no report of
    // what happened to it. A throw is treated as the drop it is.
    let entry;
    try {
      entry = worker(op, opCtx);
    } catch (err) {
      entry = null;
      result.messages.push(`The worker for ${op.op} (${op.from || op.to}) threw: ${err && err.message}`);
    }
    raw.push({ op, outcome: "worked", entry });
  }

  for (const item of result.skipped) item.detail = skipDetail(item);

  // An operation belonging to BOTH a skipped scope entry and one that ran, runs. The
  // asymmetry that decides it is argued at groupsOf, and it is the right call: the
  // alternative leaves the entry that DID run with a parent index linking an index it
  // just removed, which is a dead wikilink and blocks the whole commit.
  //
  // This is where the cost of that call is disclosed. Two sibling absorbs into one
  // parent share the deduped parent rebuild, so one entry being skipped still rebuilds
  // the parent index from what the parent holds NOW, and the folder whose entry was
  // skipped is left on disk and no longer linked from it. The skip item cannot say so,
  // because the operation it would have to name is not in the item: it ran. Without
  // this note the DM was told the folder was "left exactly where it is" and nothing
  // else, so the one property the single-entry case guarantees (the parent index still
  // links the folder that survived) silently did not hold for two.
  const partiallySkipped = [];
  for (const record of raw) {
    if (record.outcome === "skipped") continue;
    const skippedToo = groupsOf(record.op).filter((g) => skips.skippedGroups.has(g));
    if (skippedToo.length === 0) continue;
    partiallySkipped.push(
      `${record.op.op} ${record.op.to || record.op.from || "(unnamed)"} (also from skipped scope entry ${skippedToo.join(", ")})`
    );
  }
  if (partiallySkipped.length > 0) {
    result.messages.push(
      `Note: ${partiallySkipped.length} operation(s) ran even though a scope entry they belong to was skipped, because ` +
        `another entry sharing them did run: ${partiallySkipped.join("; ")}. Dropping one of these would leave the entry ` +
        "that DID run holding a dead wikilink, which fails the link-integrity rail and blocks the whole commit, so " +
        "running it is the lesser evil." +
        (partiallySkipped.some((p) => p.startsWith("rebuild-index"))
          ? " The cost lands on the rebuild: an index is rebuilt from what its folder holds NOW, so a folder whose own " +
            "entry was skipped is still on disk and is no longer linked from that index. Re-run the skipped entry once " +
            "its git-ignored file is dealt with, or add the link back by hand."
          : "")
    );
  }

  // Dropped-worker accounting, the shape validation-sweep.mjs's fix phase uses:
  // a worker that failed or returned nothing is NOT counted as done, because a
  // half-applied run reported as complete is the worst outcome available here.
  for (const record of raw) {
    if (record.outcome === "skipped") continue;
    const entry = record.entry;
    if (!entry || typeof entry !== "object") {
      result.dropped.push({
        op: record.op.op,
        from: record.op.from,
        to: record.op.to,
        applied: false,
        detail:
          "The worker for this operation failed or returned nothing. It is not confirmed applied and needs a manual look; it is not silently counted as done.",
      });
      continue;
    }
    if (entry.applied) {
      // The scope entry this operation came from, carried into the result because
      // conventionsAfterScope's third argument is exactly this list and its whole
      // question is which entries actually ran; see appliedGate.
      //
      // Read from the OPERATION rather than trusted from the worker, so a host
      // dispatching its own workers cannot lose the id, and stamped only when there
      // is one. Setup's unattended plan stamps no groups on anything, so groupsOf
      // returns [] for every operation it emits and its entries come back byte for
      // byte what they were before this field existed. Applied only: a failed or
      // dropped operation is not evidence that anything moved, which is the only
      // question this field answers.
      const groups = groupsOf(record.op);
      if (groups.length > 0) entry.groups = groups;
      result.applied.push(entry);
    } else result.failed.push(entry);
  }
  if (result.dropped.length > 0) {
    result.messages.push(
      `Warning: ${result.dropped.length} of ${raw.length} operation worker(s) failed or returned nothing. Those operations were not confirmed applied.`
    );
  }

  // ------------------------------------------------------------------
  // What the snapshot will not undo, disclosed rather than left silent
  // ------------------------------------------------------------------
  //
  // Both lists are filtered to operations that actually RAN: an operation that was
  // skipped moved nothing and rewrote nothing, so reporting its ignored contents or
  // referrers would be reporting an edit that never happened.
  //
  // Filtered on the SKIP DECISION rather than on the ignored-source set, so that
  // the sentence above stays true for an operation skipped because its scope entry
  // was.
  //
  // Matched on EVERY path an operation names as a source, not on `from` alone. `from`
  // is not the key both lists carry, and merge-index is the counterexample: it has no
  // `from` at all. Its sources live in `sources`, which is where the skip pass finds
  // an ignored one, so such a merge is correctly skipped, while findIgnoredReferrers
  // keys its rows by the `sourceLinks` key and findIgnoredWithinSources by `from`.
  // Keyed on `from` alone a skipped merge produced the degenerate key
  // "merge-index::", which no row can equal, so its referrer rows survived the filter
  // and the run told the DM that a git-ignored file's wikilinks had been rewritten
  // unrecoverably by a merge that never opened it. merge-index is in OPERATION_ORDER,
  // so that false claim landed in setup's unattended after-action report.
  //
  // A row is dropped only when EVERY operation naming that path was skipped, which
  // is why `ran` is collected beside `skipped`. If one operation naming a path ran
  // and another was skipped, the rewrite DID happen and the disclosure is real. A row
  // no operation matches at all is kept rather than dropped, on the same asymmetry
  // the rest of this module runs on: a missing disclosure hides an unrecoverable edit,
  // while a spurious one is only misleading.
  const skippedKeys = new Set();
  const ranKeys = new Set();
  for (const record of raw) {
    const into = record.outcome === "skipped" ? skippedKeys : ranKeys;
    for (const p of sourcePathsOf(record.op)) into.add(`${record.op.op}::${p}`);
  }
  const runOf = (key) => !skippedKeys.has(key) || ranKeys.has(key);
  result.ignoredEdits = list(prechecks.ignoredReferrers).filter((r) => runOf(`${r.op}::${r.source}`));
  result.ignoredMoved = list(prechecks.ignoredBeneath).filter((r) => runOf(`${r.op}::${r.from}`));
  if (result.ignoredEdits.length > 0) {
    result.messages.push(
      `Note: ${result.ignoredEdits.length} git-ignored referring file(s) were named by the plan and had their wikilinks ` +
        `rewritten in place rather than skipped: ${result.ignoredEdits.map((r) => r.referrer).join(", ")}. ` +
        "Only the wikilink target changed; display text, anchors, and every other byte were left alone. The rename would " +
        "otherwise have left each of them holding a dead link. These files are outside the snapshot, so restoring it will " +
        "NOT undo these edits. Each operation's own entry reports whether its rewrites landed."
    );
  }
  if (result.ignoredMoved.length > 0) {
    const named = result.ignoredMoved.map((r) => `${r.from} -> ${r.to}: ${r.entries.join(", ")}`);
    result.messages.push(
      `Note: ${result.ignoredMoved.length} directory move(s) carried git-ignored files to the new path, because git mv moves ` +
        `a directory's whole contents and the skip rule tests the operation's source, not each file beneath it: ${named.join("; ")}. ` +
        "Nothing was lost and the files now sit at the new path, but they are outside the snapshot, so restoring it will not put them back."
    );
  }

  // ------------------------------------------------------------------
  // The link-integrity assertion, BEFORE the commit
  // ------------------------------------------------------------------
  //
  // The plan's moves are handed over because the settings above carry
  // PRE-migration prong roots, and the run has already moved them; see
  // scopeCandidates. They are ALSO what tells the rail about the folders this plan
  // created outside every declared root, which a setting split and a campaign
  // retirement both do by construction; see arrivalRoots. One input rather than
  // two, derived by one rule, so the two halves of the root set cannot be built
  // from different ideas of what this plan moved.
  //
  // Derived from the PLAN rather than from result.applied, on the same terms
  // scopeCandidates already states: propose both ends of every move and let
  // existsSync decide which are real. A move that was skipped or that failed left
  // its content at its source, which is where the declared root still points, and
  // its destination is simply not on disk to be walked.
  //
  // expectLinks is handed over because an assertion that walks a knowledge base
  // known to hold wikilinks and finds none is reporting on nothing.
  //
  // It is armed from what the run actually DID, not from what the plan asked
  // for, and the difference is the difference between a rail and a dead end.
  // Armed from the plan, any plan carrying a link-bearing operation demanded a
  // nonzero link count, so a knowledge base that genuinely holds no wikilink
  // could never finish its migration: measured, a wikilink-free KB plus one
  // ordinary filename fix refused with dead `[]`, refused again after the
  // documented restore, and had no override to reach for. No skip, no failure,
  // and no ignored file were needed to get there.
  //
  // What arms it now is EVIDENCE that a wikilink exists in this knowledge base:
  // a link-bearing operation that actually rewrote at least one. Then a walk
  // that checks zero links is demonstrably pointed away from the content, which
  // is precisely the defect this rail exists to catch, and it still refuses. An
  // operation that was skipped, or that ran and rewrote nothing, put no wikilink
  // at risk and supplies no such evidence, so it does not arm the rail. Read
  // from each entry rather than from the plan, which means a partly-failed merge
  // whose sources are already gone and whose rewrites half landed DOES arm it:
  // that run demonstrably touched a wikilink.
  //
  // This narrows the rail's scope; it does not weaken its verdict. An assertion
  // that checks nothing is still not an assertion.
  const rewroteAWikilink = raw.some(
    (record) =>
      record.outcome === "worked" &&
      record.entry &&
      LINK_BEARING_OPERATIONS.has(record.op.op) &&
      Number(record.entry.linksRewritten) > 0
  );
  result.linkIntegrity = assertLinkIntegrity({
    cwd,
    settings,
    relocations: planMoves(operations),
    expectLinks: rewroteAWikilink,
  });
  if (!result.linkIntegrity.ok) {
    result.messages.push(
      (result.linkIntegrity.coverage === "no-links-checked"
        ? "Link integrity could NOT be asserted: this run rewrote at least one wikilink, so this knowledge base " +
          `demonstrably has them, but the assertion then found zero wikilinks across the ${result.linkIntegrity.filesChecked} ` +
          `file(s) it walked, in ${JSON.stringify(result.linkIntegrity.roots)}. An assertion that checks nothing is not an ` +
          "assertion, so this is a failure rather than a pass. Those walked roots are not where this run put the content: " +
          "check each setting's prong roots in conventions.json against where the articles actually landed. There are no " +
          "dead links to list, because nothing was inspected. "
        : `Link integrity failed: ${result.linkIntegrity.dead.length} wikilink(s) resolve to nothing after the run. `) +
        "The migration was NOT committed. A dead wikilink is valid markdown that fails silently in Obsidian, " +
        "so this is checked before the commit rather than reported after it. " +
        restoreInstruction(git, cwd, result.snapshot) +
        (result.linkIntegrity.dead.length > 0
          ? ` Dead links: ${JSON.stringify(result.linkIntegrity.dead)}`
          : "")
    );
    return result;
  }

  // ------------------------------------------------------------------
  // The migration commit
  // ------------------------------------------------------------------
  if (!wantCommit) {
    result.ok = result.failed.length === 0 && result.dropped.length === 0;
    result.messages.push("Commit skipped at the caller's request; the changes are in the working tree.");
    return result;
  }
  const staged = git(["add", "-A"]);
  if (!staged.ok) {
    result.messages.push(
      `Could not stage the migration: ${firstLine(staged.stderr)}. Not committed. ${restoreInstruction(git, cwd, result.snapshot)}`
    );
    return result;
  }
  const pending = git(["status", "--porcelain"]);
  if (pending.ok && pending.stdout.trim() === "") {
    result.messages.push("Nothing changed on disk, so there was nothing to commit.");
    result.ok = result.failed.length === 0 && result.dropped.length === 0;
    return result;
  }
  const committed = git(["commit", "-q", "-m", commitMessage]);
  if (!committed.ok) {
    // Everything is staged by this point, and `reset --hard` DOES remove a
    // staged-but-uncommitted addition, so here the reset usually is the whole
    // recovery. restoreInstruction reads the state back rather than assuming
    // that, so it says so only when it is true.
    result.messages.push(
      `The migration commit failed: ${firstLine(committed.stderr)}. The snapshot is intact at ${result.snapshot}. ${restoreInstruction(git, cwd, result.snapshot)}`
    );
    return result;
  }
  const after = git(["rev-parse", "HEAD"]);
  result.committed = true;
  result.migration = after.ok ? after.stdout.trim() : null;
  result.ok = result.failed.length === 0 && result.dropped.length === 0;
  return result;
}

// The declared order is a dependency order, so a plan handed back with its
// operations shuffled is refused rather than half-run. Same posture as
// planOperation throwing on an unknown kind: nothing has been mutated yet.
function findOutOfOrder(operations) {
  let highest = -1;
  let highestOp = null;
  for (let i = 0; i < operations.length; i++) {
    const rank = APPLY_ORDER.indexOf(operations[i].op);
    if (rank < highest) return { index: i, op: operations[i].op, after: highestOp };
    if (rank > highest) {
      highest = rank;
      highestOp = operations[i].op;
    }
  }
  return null;
}

// The setting whose prong roots contain a path. By declared position, never by
// name: two settings may share a name or both omit one.
function settingOwning(settings, rel) {
  const target = toPosix(rel || "");
  let best = null;
  let bestLength = -1;
  for (const setting of list(settings)) {
    for (const root of prongRootsOf(setting)) {
      const r = toPosix(root);
      if (target !== r && !target.startsWith(`${r}/`)) continue;
      if (r.length > bestLength) {
        best = setting;
        bestLength = r.length;
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Workflow entry point
// ---------------------------------------------------------------------------

export const meta = {
  name: "migrate",
  description:
    "Migration executor for professor-orb. Plan phase (default) surveys the confirmed prong mapping and the schema survey and returns an ordered operation list with its prechecks, mutating nothing. Apply phase (args.mode \"apply\") applies ONLY what that plan carries, moving every file with git mv, skipping any operation whose source is git-ignored, and asserting link integrity before the migration commit. Invoke by name migrate; pass args.mode.",
  whenToUse:
    "Driven by setup's schema migration, and later by /migrate with a DM-scoped plan. Not run on its own: the apply phase expects a verified snapshot commit to already exist and refuses to start without one.",
  phases: [
    { title: "Plan", detail: "Build the ordered operation list and run the prechecks" },
    { title: "Apply", detail: "Execute the plan, assert link integrity, then commit" },
  ],
};

// Builds a plan from the arguments a workflow invocation carries. args may
// arrive already parsed or as the raw JSON string, the same way
// validation-sweep.mjs accepts both.
export function runPlanFromArgs(input) {
  const parsed = (typeof input === "string" && input.trim() ? JSON.parse(input) : input) || {};
  return buildPlan({
    projectRoot: parsed.projectRoot,
    settings: parsed.settings,
    baseRules: parsed.baseRules,
    discovered: parsed.discovered,
  });
}

// Applies a plan the caller already has. It applies ONLY what args carries and
// never re-derives the operation list: re-surveying here would be the apply
// phase inventing an operation, and the DM may have edited the plan in between.
export function runApplyFromArgs(input) {
  const parsed = (typeof input === "string" && input.trim() ? JSON.parse(input) : input) || {};
  const plan = parsed.plan && typeof parsed.plan === "object" ? parsed.plan : { operations: parsed.operations };
  return applyPlan(plan, {
    cwd: parsed.projectRoot,
    settings: parsed.settings,
    baseRules: parsed.baseRules,
    commit: parsed.commit !== false,
    commitMessage: parsed.commitMessage,
  });
}

export function runFromArgs(input) {
  const parsed = (typeof input === "string" && input.trim() ? JSON.parse(input) : input) || {};
  return parsed.mode === "apply" ? runApplyFromArgs(parsed) : runPlanFromArgs(parsed);
}

// validation-sweep.mjs ends with `export default await run()`, which executes
// on import and is exactly why it cannot be imported. This module has to be
// importable, so the entry point is guarded on the workflow host's `args`
// global, which a plain import does not provide. Importing this file therefore
// starts nothing and touches no disk. In particular an import can never reach
// applyPlan, so the half that moves files is only ever entered deliberately.
export default typeof args === "undefined" ? null : runFromArgs(args);
