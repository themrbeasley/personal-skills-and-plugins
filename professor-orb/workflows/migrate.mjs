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
// Node built-ins only.

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
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
 * `ignored` is Array OR null. null means the question could not be answered;
 * see findIgnoredSources. An empty array and null are not interchangeable.
 *
 * @returns {{ok: boolean, collisions: Array, caseRenames: Array, ignored: Array|null}}
 */
export function runPrechecks({ operations, projectRoot }) {
  const collisions = findDestinationCollisions(operations, projectRoot);
  const caseRenames = list(operations).filter(
    (o) => o.from && o.to && o.from.toLowerCase() === o.to.toLowerCase() && o.from !== o.to
  );
  const ignored = findIgnoredSources(operations, projectRoot);
  // Only collisions abort. An ignored file is skipped and reported, never moved,
  // so it must not fail the run: one ignored file inside a prong would otherwise
  // stop the whole migration. ignored still rides along because the after-action
  // report has to name every file the run declined to touch.
  return { ok: collisions.length === 0, collisions, caseRenames, ignored };
}

// Operation kinds whose destination is SUPPOSED to be there already, so finding
// it on disk is not a collision. merge-index targets the surviving index it
// folds the others into, and tag-registry regenerates a registry an earlier run
// wrote. Every other kind is checked, including one added later: a new kind that
// aborts on a destination it meant to create is a louder failure than one that
// silently overwrites the DM's file.
const DESTINATION_MAY_EXIST = new Set(["merge-index", "tag-registry"]);

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
function findDestinationCollisions(operations, projectRoot) {
  const ops = list(operations).filter((o) => o && typeof o === "object");
  const foldKey = (p) => `${path.dirname(p)}::${path.basename(p)}`.toLowerCase();
  const rootUsable = Boolean(projectRoot) && existsSync(projectRoot);

  // A move vacates its own source, so a path some operation renames away from
  // is free by the time the plan reaches it, and A -> B, B -> C is legal.
  // Only an operation carrying BOTH from and to vacates anything: an in-place
  // edit carries from and no to exactly because it leaves the file where it is,
  // so its source must not count as freed.
  const vacated = new Set();
  for (const o of ops) {
    if (o.from && o.to) vacated.add(foldKey(toPosix(o.from)));
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

    if (!rootUsable || DESTINATION_MAY_EXIST.has(o.op)) continue;
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
// It does walk the tree, though, and Task 15 should not read the paragraph
// above as saying otherwise: reportMissingPublish recurses every prong root of
// every setting and reads the frontmatter of every markdown file it finds, and
// findDestinationCollisions and findIgnoredSources both stat the project. The
// read-only property is not an absence of walking. It is that the only fs
// functions this module imports are readdirSync, readFileSync, statSync, and
// existsSync, none of which can write, plus a git command set that is a fixed
// literal in this file and takes nothing from the caller or the project.
//
// Every field is optional; a survey that found nothing of a kind may omit it.
//
//   prongMoves         [{ settingIndex, setting, kind, from, to }]
//   typeMismatches     [{ file, typeFrom, typeTo }]
//   renames            [{ file, to, ruleId, links }]
//   missingIndexes     [{ folder, settingIndex, basename }]
//   multiIndexFolders  [{ folder, survivor, sources }]
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
//   merge-index carries `sources`, the indexes being merged away. It is ONE
//   operation per folder, not one per source. Emitting one per source would
//   give every source the same `to`, and findDestinationCollisions would then
//   read a six-sub-index folder (the reference consumer's items/ is exactly
//   that) as five collisions and abort a migration that has nothing wrong
//   with it.
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
//    survey note above for why one per source would abort the run.
function planIndexMerges({ discovered }) {
  return list(discovered && discovered.multiIndexFolders)
    .filter((f) => f && f.survivor && list(f.sources).length > 0)
    .map((f) => ({
      op: "merge-index",
      to: toPosix(f.survivor),
      sources: list(f.sources).map(toPosix),
      reason:
        `Folder ${toPosix(f.folder)} carries ${list(f.sources).length + 1} indexes. ` +
        "Merge concatenates each source's full content under a provenance heading, " +
        "so headings, grouping, ordering, and prose all survive.",
    }));
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
          "Not executed: crossing the threshold says the folder should divide, not how to partition it. Take it to /migrate.",
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
          ". Not executed: dissolving a folder that holds subfolders is undefined, and prong, setting, and campaign folders are exempt permanently. Take it to /migrate.",
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
    if (name === ".git" || name === ".obsidian") continue;
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

// An ignored file is not in the snapshot, so moving it would be unrecoverable.
// Every operation whose source is ignored is reported here and skipped by the
// apply phase. It does not fail the run: see runPrechecks.
//
// THREE states, not two, and a consumer using this as a skip list has to tell
// them apart:
//
//   []    determined, and nothing in the plan has an ignored source.
//   [...] determined, and these are the operations to skip.
//   null  NOT DETERMINED. No projectRoot (re-running the prechecks against a
//         bare plan object, which carries no root), a projectRoot that is not
//         there, a project that is not a git repository, or a git call that
//         failed for any reason including outrunning maxBuffer.
//
// null and [] are not interchangeable, which is why null rather than a flag
// beside an empty array: a consumer that iterates it without handling the third
// state fails loudly instead of quietly reading "unknown" as "nothing to skip".
// The non-repo case is the sharp one. No repository means no snapshot either,
// so it is not that nothing is ignored, it is that EVERY source is outside the
// snapshot, and returning [] there would say the opposite.
function findIgnoredSources(operations, projectRoot) {
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
  if (ignoredFiles.size === 0 && ignoredDirs.length === 0) return [];

  const isIgnored = (source) => {
    const rel = toPosix(path.relative(repoRoot, path.resolve(projectRoot, source)));
    if (rel === "" || rel.startsWith("../")) return false;
    if (ignoredFiles.has(rel)) return true;
    return ignoredDirs.some((d) => rel === d.slice(0, -1) || rel.startsWith(d));
  };

  const out = [];
  for (const o of list(operations)) {
    if (!o || typeof o !== "object") continue;
    for (const source of [o.from, ...list(o.sources)]) {
      if (!source || !isIgnored(source)) continue;
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
// Workflow entry point
// ---------------------------------------------------------------------------

export const meta = {
  name: "migrate",
  description:
    "Migration executor for professor-orb. Plan phase surveys the confirmed prong mapping and the schema survey and returns an ordered operation list with its prechecks, mutating nothing. Invoke by name migrate.",
  whenToUse:
    "Driven by setup's schema migration, and later by /migrate with a DM-scoped plan. Not run on its own: it expects a verified snapshot commit to already exist.",
  phases: [{ title: "Plan", detail: "Build the ordered operation list and run the prechecks" }],
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

// validation-sweep.mjs ends with `export default await run()`, which executes
// on import and is exactly why it cannot be imported. This module has to be
// importable, so the entry point is guarded on the workflow host's `args`
// global, which a plain import does not provide. Importing this file therefore
// starts nothing and touches no disk.
//
// The apply phase is a separate commit. Until it lands, a workflow invocation
// gets the plan and nothing else, which is the honest answer: there is no
// execution half yet to run.
export default typeof args === "undefined" ? null : runPlanFromArgs(args);
