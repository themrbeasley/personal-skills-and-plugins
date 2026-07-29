#!/usr/bin/env node
// Regression suite for the PostToolUse write-time validator.
//
// Drives the real hook with real PostToolUse payloads against a disposable
// fixture project. Node built-ins only, no test framework.
//
// Run: node professor-orb/hooks/validate-write.test.mjs

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), "validate-write.mjs");

let passed = 0;
const failures = [];

export function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  [PASS] ${name}`);
  } else {
    failures.push(name);
    console.log(`  [FAIL] ${name}`);
    console.log(`         expected: ${JSON.stringify(expected)}`);
    console.log(`         actual:   ${JSON.stringify(actual)}`);
  }
}

// Builds a disposable project, writes the given files and conventions, then
// fires the hook at targetRel as though a Write had just landed there.
export function runHook({ conventions, files, targetRel }) {
  const dir = path.join(os.tmpdir(), `orb-hook-${process.pid}-${Math.abs(hashOf(targetRel))}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
  }
  if (conventions !== null) {
    const abs = path.join(dir, ".professor-orb", "conventions.json");
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, JSON.stringify(conventions, null, 2), "utf8");
  }

  const payload = JSON.stringify({
    cwd: dir,
    tool_name: "Write",
    tool_input: { file_path: path.join(dir, targetRel) },
  });

  try {
    const out = execFileSync("node", [HOOK], { input: payload, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    return { code: 0, out: out.trim(), err: "" };
  } catch (e) {
    return { code: e.status, out: (e.stdout || "").trim(), err: (e.stderr || "").trim() };
  }
}

// Deterministic per-target temp dir so parallel cases do not collide.
function hashOf(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

export function report() {
  console.log(`\n${passed}/${passed + failures.length} expectations met.`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

const ENUM_RULE = {
  frontmatterTypeEnum: {
    category: "frontmatter",
    check: "enum",
    enforcement: "block",
    description: 'type must be one of the recognized article types.',
    params: { field: "type", values: ["Person", "Location"] },
  },
};

console.log("=== baseline: today's behavior ===");

{
  const r = runHook({
    conventions: null,
    files: { "kb/Bad.md": "---\ntype: Nope\n---\n\nbody\n" },
    targetRel: "kb/Bad.md",
  });
  check("no conventions.json: silent, exit 0", [r.code, r.out, r.err], [0, "", ""]);
}

{
  const r = runHook({
    conventions: { version: 1, kbRoot: "kb", rules: ENUM_RULE },
    files: { "kb/Bad.md": "---\ntype: Nope\n---\n\nbody\n" },
    targetRel: "kb/Bad.md",
  });
  check("v1 file, bad enum value: blocks with exit 2", r.code, 2);
}

console.log("\n=== base rules artifact ===");

{
  const { readFileSync } = await import("node:fs");
  const raw = readFileSync(
    new URL("../references/base-rules.json", import.meta.url),
    "utf8"
  );
  const base = JSON.parse(raw);
  const ids = Object.keys(base.rules);
  check("base-rules.json parses and carries a schemaVersion", typeof base.schemaVersion, "number");
  check("every base rule carries provenance professor-orb",
    ids.every((id) => base.rules[id].provenance === "professor-orb"), true);
  check("no base rule ships an autofix on a filename rule",
    ids.filter((id) => base.rules[id].category === "filename")
       .every((id) => base.rules[id].autofix === undefined), true);
  check("publish is not in the blocking required subset",
    base.rules.frontmatterRequiredSubset.params.requiredSubset, ["type"]);
  // The three frontmatter required-fields rules exist separately because they
  // sit at two different enforcement levels. Pin each one: a later edit that
  // folds them back together would silently promote publish to blocking.
  check("the required subset blocks",
    base.rules.frontmatterRequiredSubset.enforcement, "block");
  check("field order only warns",
    base.rules.frontmatterFieldOrder.enforcement, "warn");
  check("publish presence only warns",
    base.rules.frontmatterPublishPresence.enforcement, "warn");
  check("the type enum carries both groups",
    base.rules.frontmatterTypeEnum.params.values.includes("Person") &&
    base.rules.frontmatterTypeEnum.params.values.includes("magic-item"), true);
}

console.log("\n=== extendedBy and scope ===");

const EXTENDED_ENUM = {
  frontmatterTypeEnum: {
    provenance: "professor-orb",
    category: "frontmatter",
    check: "enum",
    enforcement: "block",
    extendedBy: ["Settlement"],
    description: "type must be recognized.",
    params: { field: "type", values: ["Person", "Location"] },
  },
};

{
  const r = runHook({
    conventions: { version: 2, kbRoot: "kb", rules: EXTENDED_ENUM },
    files: { "kb/A.md": "---\ntype: Settlement\n---\n\nbody\n" },
    targetRel: "kb/A.md",
  });
  check("extendedBy value is accepted", r.code, 0);
}

{
  const r = runHook({
    conventions: { version: 2, kbRoot: "kb", rules: EXTENDED_ENUM },
    files: { "kb/B.md": "---\ntype: Person\n---\n\nbody\n" },
    targetRel: "kb/B.md",
  });
  check("base value still accepted alongside extendedBy", r.code, 0);
}

{
  const r = runHook({
    conventions: { version: 2, kbRoot: "kb", rules: EXTENDED_ENUM },
    files: { "kb/C.md": "---\ntype: Nope\n---\n\nbody\n" },
    targetRel: "kb/C.md",
  });
  check("a value in neither list still blocks", r.code, 2);
}

console.log("\n=== v3 conventions shape ===");

const V3 = {
  version: 3,
  settings: [
    {
      name: "rolara",
      kbRoot: "settings/rolara",
      homebrewRoot: "homebrew/rolara",
      sessionReportsRoot: "session-reports/rolara",
      rules: {
        frontmatterTypeEnum: {
          provenance: "professor-orb",
          category: "frontmatter",
          check: "enum",
          enforcement: "block",
          description: "type must be recognized.",
          params: { field: "type", values: ["Person", "Location"] },
        },
      },
    },
  ],
};

{
  const r = runHook({
    conventions: V3,
    files: { "settings/rolara/Bad.md": "---\ntype: Nope\n---\n\nbody\n" },
    targetRel: "settings/rolara/Bad.md",
  });
  check("v3 file: hook still blocks a bad enum value", r.code, 2);
}

{
  const r = runHook({
    conventions: V3,
    files: { "settings/rolara/Good.md": "---\ntype: Person\n---\n\nbody\n" },
    targetRel: "settings/rolara/Good.md",
  });
  check("v3 file: a valid article passes", r.code, 0);
}

console.log("\n=== scope gate against a real prongKind ===");

// Until this task, ctx.prongKind did not exist, so the gate
// `rule.scope === "kb" && ctx.prongKind && ctx.prongKind !== "kb"` always
// short-circuited on the falsy prongKind and could not be exercised. These
// three cases pin both sides of it plus a control.
function scopedV3(scope) {
  const rule = {
    provenance: "professor-orb",
    category: "frontmatter",
    check: "enum",
    enforcement: "block",
    description: "type must be recognized.",
    params: { field: "type", values: ["Person", "Location"] },
  };
  if (scope) rule.scope = scope;
  return {
    version: 3,
    settings: [
      {
        name: "rolara",
        kbRoot: "settings/rolara",
        homebrewRoot: "homebrew/rolara",
        sessionReportsRoot: "session-reports/rolara",
        rules: { frontmatterTypeEnum: rule },
      },
    ],
  };
}

{
  const r = runHook({
    conventions: scopedV3("kb"),
    files: { "homebrew/rolara/ScopedOut.md": "---\ntype: Nope\n---\n\nbody\n" },
    targetRel: "homebrew/rolara/ScopedOut.md",
  });
  check('scope "kb" rule is skipped for a file in the homebrew prong', r.code, 0);
}

{
  // Control for the case above: the same homebrew file, same bad value, rule
  // carrying no scope. Without this, the exit 0 above would also be produced by
  // the homebrew prong never being recognized as owned at all.
  const r = runHook({
    conventions: scopedV3(null),
    files: { "homebrew/rolara/Unscoped.md": "---\ntype: Nope\n---\n\nbody\n" },
    targetRel: "homebrew/rolara/Unscoped.md",
  });
  check("an unscoped rule does run against that same homebrew file", r.code, 2);
}

{
  const r = runHook({
    conventions: scopedV3("kb"),
    files: { "settings/rolara/ScopedIn.md": "---\ntype: Nope\n---\n\nbody\n" },
    targetRel: "settings/rolara/ScopedIn.md",
  });
  check('scope "kb" rule does run for a file in the kb prong', r.code, 2);
}

console.log("\n=== owning-setting selection across two settings ===");

// Every other v3 fixture in this file declares exactly one setting, which makes
// "picks the setting whose prong roots contain the file" indistinguishable from
// "picks settings[0]". These fixtures give the two settings DIFFERENT enum
// values, so selecting the wrong owner produces a visibly different exit code
// rather than the same one. Verified by mutation: hardcoding owner = settings[0]
// turns the "second" cases red.
function twoSettingRule(values) {
  return {
    frontmatterTypeEnum: {
      provenance: "professor-orb",
      category: "frontmatter",
      check: "enum",
      enforcement: "block",
      description: "type must be recognized.",
      params: { field: "type", values },
    },
  };
}

const V3_TWO = {
  version: 3,
  settings: [
    {
      name: "first",
      kbRoot: "settings/first",
      homebrewRoot: "homebrew/first",
      sessionReportsRoot: "session-reports/first",
      // Accepts Person, rejects Deity.
      rules: twoSettingRule(["Person"]),
    },
    {
      name: "second",
      kbRoot: "settings/second",
      homebrewRoot: "homebrew/second",
      sessionReportsRoot: "session-reports/second",
      // Accepts Deity, rejects Person. The mirror image of the first.
      rules: twoSettingRule(["Deity"]),
    },
  ],
};

{
  const r = runHook({
    conventions: V3_TWO,
    files: { "settings/second/Allowed.md": "---\ntype: Deity\n---\n\nbody\n" },
    targetRel: "settings/second/Allowed.md",
  });
  check("second setting owns its own kb file: its enum accepts Deity", r.code, 0);
}

{
  const r = runHook({
    conventions: V3_TWO,
    files: { "settings/second/Rejected.md": "---\ntype: Person\n---\n\nbody\n" },
    targetRel: "settings/second/Rejected.md",
  });
  check("second setting's rules apply, so Person is rejected there", r.code, 2);
}

{
  const r = runHook({
    conventions: V3_TWO,
    files: { "homebrew/second/Allowed.md": "---\ntype: Deity\n---\n\nbody\n" },
    targetRel: "homebrew/second/Allowed.md",
  });
  check("ownership reaches a non-first setting through a non-kb prong", r.code, 0);
}

// The pair in the other direction. These two would stay green under
// owner = settings[0]; they exist to catch the opposite regression, a loop that
// ends up preferring the LAST matching setting.
{
  const r = runHook({
    conventions: V3_TWO,
    files: { "settings/first/Allowed.md": "---\ntype: Person\n---\n\nbody\n" },
    targetRel: "settings/first/Allowed.md",
  });
  check("first setting still owns its own kb file: its enum accepts Person", r.code, 0);
}

{
  const r = runHook({
    conventions: V3_TWO,
    files: { "settings/first/Rejected.md": "---\ntype: Deity\n---\n\nbody\n" },
    targetRel: "settings/first/Rejected.md",
  });
  check("first setting's rules apply, so Deity is rejected there", r.code, 2);
}

console.log("\n=== malformed settings entries are filtered, not fatal ===");

// resolveSettings filters entries that are null or carry a non-string kbRoot.
// Without that filter prongContaining dereferences null and main() throws an
// uncaught TypeError, which surfaces as exit 1 on every write. Verified by
// mutation: dropping the filter turns both of these red with exit 1.
{
  const r = runHook({
    conventions: {
      version: 3,
      settings: [
        null,
        { name: "bogus", kbRoot: 42, homebrewRoot: "homebrew/bogus", rules: twoSettingRule(["Person"]) },
        { name: "valid", kbRoot: "settings/valid", rules: twoSettingRule(["Person"]) },
      ],
    },
    files: { "settings/valid/Bad.md": "---\ntype: Nope\n---\n\nbody\n" },
    targetRel: "settings/valid/Bad.md",
  });
  check("a valid entry still resolves alongside malformed ones, and blocks", r.code, 2);
}

{
  const r = runHook({
    conventions: {
      version: 3,
      settings: [null, { name: "bogus", kbRoot: 42, rules: twoSettingRule(["Person"]) }],
    },
    files: { "settings/valid/Bad.md": "---\ntype: Nope\n---\n\nbody\n" },
    targetRel: "settings/valid/Bad.md",
  });
  check("a settings array of only malformed entries exits 0 without crashing", r.code, 0);
}

console.log("\n=== prong scoping and entry counts ===");

{
  // A session report linking to a KB article must resolve: the search root is
  // the union of the setting's prongs, not its kbRoot alone.
  //
  // The link target is deliberately placed under homebrewRoot, not kbRoot.
  // ctx.kbRootAbs is always owner.kbRoot regardless of which prong owns the
  // file being written, so a target that happens to live directly under
  // kbRoot (as in the brief's own worked example) resolves under the OLD
  // single-root search too and would not actually exercise this fix; verified
  // by running this scenario against the pre-fix hook, which still resolved a
  // kbRoot-resident target (exit 0) but blocks on this homebrew-resident one
  // (exit 2). Only a target outside kbRoot discriminates the fix.
  const conventions = {
    version: 3,
    settings: [{
      name: "r",
      kbRoot: "settings/r",
      homebrewRoot: "homebrew/r",
      sessionReportsRoot: "session-reports/r",
      rules: {
        contentWikilinks: {
          provenance: "professor-orb",
          category: "content",
          check: "wikilinkPolicy",
          enforcement: "block",
          description: "wikilink targets must exist.",
          params: { requireExistingTarget: true, requireDisplayText: false },
        },
      },
    }],
  };
  const r = runHook({
    conventions,
    files: {
      "homebrew/r/MagicSword.md": "---\ntype: Item\n---\n\nx\n",
      "session-reports/r/c/S1-REPORT.md": "---\ntype: Session Report\n---\n\nFound the [[MagicSword]].\n",
    },
    targetRel: "session-reports/r/c/S1-REPORT.md",
  });
  check("a report-to-homebrew wikilink resolves across prongs", r.code, 0);
}

{
  // A folder of 3 articles plus 3 subfolders is not 6 articles.
  const conventions = {
    version: 3,
    settings: [{
      name: "r",
      kbRoot: "settings/r",
      homebrewRoot: null,
      sessionReportsRoot: null,
      rules: {
        structuralSplitThreshold: {
          provenance: "professor-orb",
          category: "structural",
          check: "splitThreshold",
          enforcement: "block",
          scope: "kb",
          description: "folder is over the split threshold.",
          params: { minEntries: 6, indexSuffix: "-INDEX" },
        },
      },
    }],
  };
  const files = {
    "settings/r/items/A.md": "---\ntype: Item\n---\n\nx\n",
    "settings/r/items/B.md": "---\ntype: Item\n---\n\nx\n",
    "settings/r/items/C.md": "---\ntype: Item\n---\n\nx\n",
    "settings/r/items/items-INDEX.md": "---\ntype: Index\n---\n\nx\n",
    "settings/r/items/sub1/X.md": "---\ntype: Item\n---\n\nx\n",
    "settings/r/items/sub2/Y.md": "---\ntype: Item\n---\n\nx\n",
    "settings/r/items/sub3/Z.md": "---\ntype: Item\n---\n\nx\n",
  };
  const r = runHook({ conventions, files, targetRel: "settings/r/items/C.md" });
  check("three articles plus three subfolders does not trip the split threshold", r.code, 0);
}

// The absorb threshold's shipped description says "fewer than four articles";
// a 3-article folder fires under both `count <= maxEntries` (the bug) and
// `count < maxEntries` (the fix), so it cannot tell them apart. Only a folder
// holding exactly maxEntries articles discriminates: the buggy `<=` fires on
// it, the fixed `<` does not.
function absorbConventions(maxEntries) {
  return {
    version: 3,
    settings: [{
      name: "r",
      kbRoot: "settings/r",
      homebrewRoot: null,
      sessionReportsRoot: null,
      rules: {
        structuralAbsorbThreshold: {
          provenance: "professor-orb",
          category: "structural",
          check: "absorbThreshold",
          enforcement: "block",
          scope: "kb",
          description: "folder is under the absorb threshold.",
          params: { maxEntries, indexSuffix: "-INDEX" },
        },
      },
    }],
  };
}

{
  // Exactly 4 articles (plus an index, which is excluded by suffix), maxEntries 4.
  const files = {
    "settings/r/leaf/A.md": "---\ntype: Item\n---\n\nx\n",
    "settings/r/leaf/B.md": "---\ntype: Item\n---\n\nx\n",
    "settings/r/leaf/C.md": "---\ntype: Item\n---\n\nx\n",
    "settings/r/leaf/D.md": "---\ntype: Item\n---\n\nx\n",
    "settings/r/leaf/leaf-INDEX.md": "---\ntype: Index\n---\n\nx\n",
  };
  const r = runHook({ conventions: absorbConventions(4), files, targetRel: "settings/r/leaf/D.md" });
  check("a folder holding exactly maxEntries articles is not absorbed (fewer than, not at most)", r.code, 0);
}

{
  // One below the threshold still fires, so the fix did not neuter the rule.
  const files = {
    "settings/r/leaf/A.md": "---\ntype: Item\n---\n\nx\n",
    "settings/r/leaf/B.md": "---\ntype: Item\n---\n\nx\n",
    "settings/r/leaf/C.md": "---\ntype: Item\n---\n\nx\n",
  };
  const r = runHook({ conventions: absorbConventions(4), files, targetRel: "settings/r/leaf/C.md" });
  check("a folder holding one fewer than maxEntries articles still trips the absorb threshold", r.code, 2);
}

report();
