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
// WRITE APIs live in the apply half only. mkdirSync and writeFileSync below are
// reached from applyPlan and from nothing the plan phase calls; the plan phase's
// own functions call readdirSync, readFileSync, statSync, and existsSync and
// nothing else. The git command set is likewise split: the plan phase issues
// only `rev-parse --show-toplevel` and `status --ignored --porcelain -z`, and
// every mutating git argv (mv, rm, add, commit) is built inside the apply half.
//
// Node built-ins only.

import { readdirSync, readFileSync, statSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
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
// folds the others into, and tag-registry regenerates a registry an earlier run
// wrote. Every other kind is checked, including one added later: a new kind that
// aborts on a destination it meant to create is a louder failure than one that
// silently overwrites the DM's file.
const DESTINATION_MAY_EXIST = new Set(["merge-index", "tag-registry"]);

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
function findDestinationCollisions(operations, projectRoot, ignored) {
  const ops = list(operations).filter((o) => o && typeof o === "object");
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
  const ignoredFroms =
    ignored === null ? null : new Set(list(ignored).map((i) => i.from).filter(Boolean));
  const vacated = new Set();
  for (const o of ops) {
    if (!o.from || !o.to) continue;
    if (ignoredFroms === null || ignoredFroms.has(o.from)) continue;
    vacated.add(foldKey(toPosix(o.from)));
  }

  const byDir = new Map();
  const hits = [];
  for (const o of ops) {
    if (!o.to) continue;
    const to = toPosix(o.to);
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

    if (!rootUsable || destinationMayExist(o)) continue;
    if (vacated.has(key)) continue;
    if (!existsSync(path.resolve(projectRoot, to))) continue;
    hits.push({
      kind: "on-disk",
      op: o.op,
      from: o.from,
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
// nothing from the caller or the project. The module also imports mkdirSync and
// writeFileSync and builds mutating git argv, but only inside the apply half
// below, which no plan-phase function reaches.
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
          "Not executed: crossing the threshold says the folder should divide, not how to partition it. Reported here for the DM to decide.",
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
          ". Not executed: dissolving a folder that holds subfolders is undefined, and prong, setting, and campaign folders are exempt permanently. Reported here for the DM to decide.",
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
      out.push({
        op: o.op,
        source: toPosix(source),
        from: o.from,
        to: o.to,
        reason:
          "Source is git-ignored, so the pre-migration snapshot does not contain it. Reported and left where it is; moving it would be unrecoverable.",
      });
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
function findIgnoredWithinSources(operations, oracle, projectRoot) {
  if (oracle === null) return null;
  const out = [];
  for (const o of list(operations)) {
    if (!o || typeof o !== "object" || !o.from || !o.to) continue;
    let st;
    try {
      st = statSync(path.resolve(projectRoot, o.from));
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    const entries = oracle.ignoredBeneath(o.from);
    if (entries.length === 0) continue;
    out.push({
      op: o.op,
      from: toPosix(o.from),
      to: toPosix(o.to),
      entries,
      reason:
        "These git-ignored paths live inside a directory this operation moves, so git mv carries them to the new path. They are outside the snapshot, so restoring it does not put them back.",
    });
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

export const DEFAULT_MIGRATION_COMMIT_MESSAGE = "Apply the professor-orb schema migration";

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
  // pathspec-consuming git call in this module is the `git rm` in
  // applyMergeIndex, and it carries the prefix.
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
// So a declared root is resolved THROUGH the plan's own relocate-prong
// operations, which already carry `from` and `to`. Every intermediate is kept as
// a candidate and existsSync decides which of them to walk, rather than the
// mapping deciding: a relocation that was skipped for a git-ignored source, or
// that failed, leaves the root exactly where it was declared and the walk has to
// find it there; a chain (A to B, then B to C) leaves it at the end of the
// chain; a half-applied run can leave content at both. Keeping both ends covers
// all three without the assertion needing to know each operation's outcome.
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

/**
 * The post-migration link-integrity assertion. It runs after every rename and
 * every link rewrite has been applied and BEFORE the migration commit, because
 * the dropped-worker accounting reports a drop only after the repository would
 * already carry the dead links, and reporting a problem after committing it is
 * not a safety rail.
 *
 * Extraction walks every markdown file under every prong root of every setting,
 * each root resolved through the plan's relocations first; see scopeCandidates.
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

  const entries = [];
  const abs = path.resolve(ctx.cwd, folder);
  let names = [];
  try {
    names = readdirSync(abs).sort();
  } catch {
    names = [];
  }
  for (const name of names) {
    if (!name.toLowerCase().endsWith(".md")) continue;
    let st;
    try {
      st = statSync(path.join(abs, name));
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    const stem = name.slice(0, -3);
    if (suffix && stem.endsWith(suffix)) continue; // Another index, not an article.
    entries.push(stem);
  }

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

  // `--` stops OPTION parsing; it does not make what follows a literal path.
  // `git rm` takes a PATHSPEC, so `*`, `?`, `[`, and `]` inside a DM-chosen
  // index filename are read as wildcards, and this source arrives from the DM's
  // filesystem by way of the scout with no sanitization in between. Measured
  // against real git, with an unrelated `items/Weapons O-INDEX.md` sitting beside
  // the merge's `items/Weapons [OS]-INDEX.md`: the bare pathspec removed BOTH,
  // and the run reported ok, committed, zero failures, zero drops, and clean link
  // integrity, because the unnamed file's content had never been merged anywhere
  // and no rail was looking at it. `:(literal)` disables wildcard interpretation
  // for that pathspec element; the same fix and the same reasoning as the lane
  // pathspecs in `commands/`. Keep both: `--` and `:(literal)` fix different
  // halves of this line and neither substitutes for the other.
  const undeleted = [];
  for (const source of folded) {
    const removed = ctx.git(["rm", "-q", "--", `:(literal)${source}`]);
    if (!removed.ok) undeleted.push(`${source} (${firstLine(removed.stderr)})`);
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
    entry.detail =
      declined.length > 0
        ? "The only field this operation asked to insert was publish, which is never written unattended. Nothing to do."
        : "Nothing to insert and no reorder requested.";
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
  "normalize-type": applyNormalizeType,
  "rename-with-link-rewrite": applyRenameWithLinkRewrite,
  "create-index": applyCreateIndex,
  "merge-index": applyMergeIndex,
  "repair-frontmatter": applyRepairFrontmatter,
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
const LINK_BEARING_OPERATIONS = new Set(["rename-with-link-rewrite", "merge-index"]);

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
// This module deliberately imports no delete primitive (no rmSync, no
// unlinkSync, no renameSync) precisely so that no code path can quietly destroy
// a file, and the blocked path is the one where something has ALREADY gone
// wrong, which is the worst available moment to start deleting unattended.
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
 * `settings` are the conventions that were on disk when the run started, so
 * their prong roots are PRE-migration paths. That is the ordinary shape and it
 * is handled: the link-integrity assertion resolves each declared root through
 * this plan's own relocate-prong operations before walking it.
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

  const ignoredSources = new Set(prechecks.ignored.map((i) => i.source));
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
  // Apply, in plan order
  // ------------------------------------------------------------------
  const raw = [];
  for (const op of operations) {
    const sources = [op.from, ...list(op.sources)].filter(Boolean).map(toPosix);
    const ignoredHere = sources.filter((s) => ignoredSources.has(s));
    if (ignoredHere.length > 0) {
      result.skipped.push({
        op: op.op,
        from: op.from,
        to: op.to,
        applied: false,
        detail: `Skipped: ${ignoredHere.join(", ")} is git-ignored, so the pre-migration snapshot does not contain it and moving it would be unrecoverable. Reported and left exactly where it is.`,
      });
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
    if (entry.applied) result.applied.push(entry);
    else result.failed.push(entry);
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
  // Both lists are filtered to operations that actually RAN: an operation
  // skipped for a git-ignored source moved nothing and rewrote nothing, so
  // reporting its ignored contents or referrers would be reporting an edit that
  // never happened.
  result.ignoredEdits = list(prechecks.ignoredReferrers).filter((r) => !ignoredSources.has(r.source));
  result.ignoredMoved = list(prechecks.ignoredBeneath).filter((r) => !ignoredSources.has(r.from));
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
  // The relocations are handed over because the settings above carry
  // PRE-migration prong roots, and relocate-prong has already moved them; see
  // scopeCandidates. expectLinks is handed over because an assertion that walks
  // a knowledge base known to hold wikilinks and finds none is reporting on
  // nothing.
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
    relocations: operations.filter((o) => o.op === "relocate-prong" && o.from && o.to),
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
    const rank = OPERATION_ORDER.indexOf(operations[i].op);
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
