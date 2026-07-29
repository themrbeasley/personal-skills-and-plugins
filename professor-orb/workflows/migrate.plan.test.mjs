#!/usr/bin/env node
// Regression suite for the migration executor's PLAN phase.
//
// The plan phase is read-only by contract: it surveys and describes, and the
// apply phase is what mutates. One case here asserts that contract directly by
// comparing the fixture project byte for byte across a buildPlan call.
//
// Node built-ins only, no test framework.
//
// Run: node professor-orb/workflows/migrate.plan.test.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { buildPlan, runPrechecks, OPERATION_ORDER, DEFERRED_OPERATIONS } from "./migrate.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE_RULES = JSON.parse(readFileSync(path.join(HERE, "..", "references", "base-rules.json"), "utf8"));

let passed = 0;
const failures = [];

function check(name, actual, expected) {
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

const list = (v) => (Array.isArray(v) ? v : []);
const kindsOf = (operations) => operations.map((o) => o.op);
const dedupeConsecutive = (xs) => xs.filter((x, i) => i === 0 || x !== xs[i - 1]);
const find = (operations, op) => operations.find((o) => o.op === op) || {};

// Written out rather than imported. Comparing the planned order against
// OPERATION_ORDER would compare the module against itself: reorder the constant
// and both sides move together, so the case would pass whether or not the
// ordering rule held. This literal is the rule, from the phase 2 spec's
// dependency-ordered operation list.
const EXPECTED_ORDER = [
  "relocate-prong",
  "normalize-type",
  "rename-with-link-rewrite",
  "create-index",
  "merge-index",
  "repair-frontmatter",
  "vault",
  "tag-registry",
];

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Two settings, because the layout exists to hold more than one world and the
// cross-setting duplicate basename case needs a second one to be legitimate.
// The second carries its own indexParity rule: under v3 rules live per setting.
const SETTINGS = [
  {
    name: "rolara",
    kbRoot: "settings/rolara",
    homebrewRoot: "homebrew/rolara",
    sessionReportsRoot: "session-reports/rolara",
    campaigns: ["ashes-of-the-first-crown"],
    rules: {},
    tagRegistryPath: ".professor-orb/tag-registry.rolara.json",
  },
  {
    name: "karsk",
    kbRoot: "settings/karsk",
    homebrewRoot: "homebrew/karsk",
    sessionReportsRoot: "session-reports/karsk",
    campaigns: [],
    rules: { structuralIndexParity: { params: { indexSuffix: "-IDX" } } },
    tagRegistryPath: ".professor-orb/tag-registry.karsk.json",
  },
];

// One entry of every discoverable kind, so the order assertion has something
// of each operation to order.
const FULL_SURVEY = {
  prongMoves: [
    { settingIndex: 0, setting: "rolara", kind: "kb", from: "rolara-kb", to: "settings/rolara" },
    { settingIndex: 0, setting: "rolara", kind: "homebrew", from: "homebrew", to: "homebrew/rolara" },
  ],
  typeMismatches: [
    { file: "settings/rolara/history/First-Age.md", typeFrom: "chronology", typeTo: "Chronology" },
  ],
  renames: [
    {
      file: "settings/rolara/history/First-Age.md",
      to: "settings/rolara/history/First-Age-CHRONOLOGY.md",
      ruleId: "filenameSuffixChronology",
      links: ["settings/rolara/Master-INDEX.md", "settings/rolara/history/History-INDEX.md"],
    },
  ],
  missingIndexes: [
    { folder: "settings/rolara/culture", settingIndex: 0 },
    { folder: "settings/karsk/culture", settingIndex: 1 },
  ],
  multiIndexFolders: [
    {
      folder: "settings/rolara/items",
      survivor: "settings/rolara/items/Items-INDEX.md",
      sources: [
        "settings/rolara/items/Artifacts-INDEX.md",
        "settings/rolara/items/Materials-INDEX.md",
        "settings/rolara/items/Spells-INDEX.md",
      ],
    },
  ],
  frontmatterRepairs: [
    { file: "settings/rolara/characters/Aria.md", insert: ["publish", "type"], reorder: true },
  ],
  vaults: [{ settingIndex: 0, setting: "rolara", to: "settings/rolara/.obsidian" }],
  tagRegistries: [
    { settingIndex: 0, setting: "rolara", to: ".professor-orb/tag-registry.rolara.json" },
  ],
  splitCandidates: [
    { folder: "settings/rolara/locations", entryCount: 9, proposal: "one subfolder per region" },
  ],
  absorbCandidates: [{ folder: "settings/rolara/misc", entryCount: 2 }],
};

const plan = (discovered, projectRoot) =>
  buildPlan({ projectRoot, settings: SETTINGS, baseRules: BASE_RULES, discovered });

// ---------------------------------------------------------------------------
// Disposable git fixture, for the two cases that need a real repository:
// git-ignored sources, and the read-only assertion.
// ---------------------------------------------------------------------------

function makeRepo() {
  const root = mkdtempSync(path.join(os.tmpdir(), "orb-migrate-plan-"));
  const write = (rel, body) => {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  };
  write(".gitignore", "settings/rolara/editor-state/\n");
  // Missing publish. Reported, never inserted.
  write("settings/rolara/Ashfall-Compact.md", "---\ntype: Organization\ntags: [faction]\n---\n\nBody.\n");
  // publish present, and false: nothing to report.
  write("settings/rolara/Vault-Of-Secrets.md", "---\npublish: false\ntype: Location\n---\n\nBody.\n");
  // Inside a prong root, and git-ignored: the reference consumer keeps editor
  // state exactly here, which is why an ignored file must not abort a run. It
  // carries publish so that the missing-publish case below stays about publish.
  write("settings/rolara/editor-state/scratch.md", "---\npublish: false\ntype: Concept\n---\n\nScratch.\n");
  const git = (...argv) =>
    execFileSync("git", argv, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Plan Test");
  git("config", "commit.gpgsign", "false");
  git("add", "-A");
  git("commit", "-q", "-m", "fixture");
  return root;
}

// Everything about the working tree that a mutation would disturb, plus git's
// own view of it. Compared across a buildPlan call.
//
// .git/ is walked past rather than into: running git status refreshes the
// index's stat cache, so .git/index's mtime moves on every call and would make
// this compare unequal no matter what the plan phase did. The porcelain line
// below is what covers git's side, and it reports any added, modified, deleted,
// untracked, or ignored path.
function snapshotTree(root) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      if (name === ".git") continue;
      const abs = path.join(dir, name);
      const st = statSync(abs);
      const rel = path.relative(root, abs).replace(/\\/g, "/");
      if (st.isDirectory()) {
        out.push(`d ${rel}`);
        walk(abs);
      } else {
        out.push(`f ${rel} ${st.size} ${st.mtimeMs}`);
      }
    }
  };
  walk(root);
  out.push(
    "git " +
      execFileSync("git", ["status", "--porcelain", "--ignored"], { cwd: root, encoding: "utf8" })
  );
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

console.log("\nOperation order");

{
  const p = plan(FULL_SURVEY);
  check("the declared order is the spec's dependency order", OPERATION_ORDER, EXPECTED_ORDER);
  check("every kind is planned, in that order, with no interleaving",
    dedupeConsecutive(kindsOf(p.operations)), EXPECTED_ORDER);
  check("type normalization precedes the rename pass, so suffixes are computed from corrected types",
    kindsOf(p.operations).indexOf("normalize-type") <
      kindsOf(p.operations).indexOf("rename-with-link-rewrite"), true);
  check("a rename carries the link rewrite it requires as one unit of work",
    list(find(p.operations, "rename-with-link-rewrite").links).length, 2);
}

console.log("\nDeferred operations");

{
  const p = plan(FULL_SURVEY);
  check("split and absorb never appear in operations",
    p.operations.filter((o) => DEFERRED_OPERATIONS.includes(o.op)), []);
  check("split appears in declined, naming the folder",
    p.declined.filter((d) => d.op === "split").map((d) => d.target), ["settings/rolara/locations"]);
  check("absorb appears in declined, naming the folder",
    p.declined.filter((d) => d.op === "absorb").map((d) => d.target), ["settings/rolara/misc"]);
  check("the split reason states the run did not execute it",
    /Not executed/.test(find(p.declined, "split").reason || ""), true);
}

console.log("\nDestination collisions");

{
  // Two sources renaming into one destination in one directory. A move would
  // overwrite, so this aborts before anything is mutated.
  const p = plan({
    renames: [
      { file: "settings/rolara/items/Sword.md", to: "settings/rolara/items/Sword-of-Dawn.md", ruleId: "filenameCharset" },
      { file: "settings/rolara/items/Sword of Dawn.md", to: "settings/rolara/items/Sword-of-Dawn.md", ruleId: "filenameCharset" },
    ],
  });
  check("a same-directory basename collision sets prechecks.ok false", p.prechecks.ok, false);
  check("the colliding pair is reported", p.prechecks.collisions.length, 1);
}

{
  // Case-insensitive filesystem: two destinations differing only in case are
  // one file, so they collide.
  const p = plan({
    renames: [
      { file: "settings/rolara/items/a.md", to: "settings/rolara/items/Sword-of-Dawn.md", ruleId: "filenameCharset" },
      { file: "settings/rolara/items/b.md", to: "settings/rolara/items/SWORD-OF-DAWN.md", ruleId: "filenameCharset" },
    ],
  });
  check("collision detection within a directory is case-insensitive", p.prechecks.ok, false);
}

{
  // Two worlds are each entitled to a Tavern.md. Aborting here would abort for
  // the exact duplication the per-setting layout exists to permit.
  const p = plan({
    renames: [
      { file: "settings/rolara/locations/The Tavern.md", to: "settings/rolara/locations/Tavern.md", ruleId: "filenameCharset" },
      { file: "settings/karsk/locations/The Tavern.md", to: "settings/karsk/locations/Tavern.md", ruleId: "filenameCharset" },
    ],
  });
  check("a cross-setting duplicate basename does not collide", p.prechecks.ok, true);
  check("and reports no collisions", p.prechecks.collisions, []);
}

{
  // The reference consumer's items/ holds six sub-index files. One merge
  // operation per SOURCE would give every source the same destination and read
  // as five collisions, aborting a run with nothing wrong with it.
  const p = plan({ multiIndexFolders: FULL_SURVEY.multiIndexFolders });
  check("a multi-index folder is one merge operation, not one per source",
    p.operations.filter((o) => o.op === "merge-index").length, 1);
  check("the merge carries every source it will consume",
    list(find(p.operations, "merge-index").sources).length, 3);
  check("a three-source merge does not read as a collision", p.prechecks.ok, true);
}

console.log("\nCase-only renames");

{
  const p = plan({
    renames: [
      { file: "settings/rolara/items/items-INDEX.md", to: "settings/rolara/items/Items-INDEX.md", ruleId: "filenameCharset" },
    ],
  });
  check("a rename differing only in case is flagged", p.prechecks.caseRenames.length, 1);
  check("and a case-only rename does not abort the run", p.prechecks.ok, true);
}

console.log("\npublish is never written");

{
  const p = plan({ frontmatterRepairs: FULL_SURVEY.frontmatterRepairs });
  const repair = p.operations.find((o) => o.op === "repair-frontmatter");
  check("a frontmatter repair asked to insert publish drops it", repair.insert, ["type"]);
  check("no operation in the plan inserts publish",
    p.operations.some((o) => list(o.insert).includes("publish")), false);
}

console.log("\nIndex suffix comes from the owning setting");

{
  const p = plan({ missingIndexes: FULL_SURVEY.missingIndexes });
  check("a setting with no rule of its own takes the base suffix",
    p.operations[0].to, "settings/rolara/culture/Culture-INDEX.md");
  check("a setting carrying its own indexParity rule takes that suffix",
    p.operations[1].to, "settings/karsk/culture/Culture-IDX.md");
}

console.log("\nGit-ignored sources, and the read-only contract");

let repo = null;
try {
  repo = makeRepo();

  {
    const before = snapshotTree(repo);
    const p = plan(
      {
        renames: [
          {
            file: "settings/rolara/editor-state/scratch.md",
            to: "settings/rolara/editor-state/Scratch-NOTE.md",
            ruleId: "filenameSuffixByType",
          },
          {
            file: "settings/rolara/Ashfall-Compact.md",
            to: "settings/rolara/Ashfall-Compact-ORG.md",
            ruleId: "filenameSuffixByType",
          },
        ],
      },
      repo
    );

    check("an ignored file inside a prong is reported",
      p.prechecks.ignored.map((i) => i.source), ["settings/rolara/editor-state/scratch.md"]);
    check("and an ignored file does not abort the run", p.prechecks.ok, true);
    check("a tracked source is not reported as ignored",
      p.prechecks.ignored.some((i) => i.source.includes("Ashfall")), false);
    check("the plan phase leaves the project byte-identical", snapshotTree(repo), before);
  }

  {
    const p = plan({}, repo);
    check("an article with no publish field is declined, by path",
      p.declined.filter((d) => d.op === "publish").map((d) => d.target),
      ["settings/rolara/Ashfall-Compact.md"]);
    check("an article carrying publish false is not reported",
      p.declined.some((d) => d.op === "publish" && d.target.includes("Vault-Of-Secrets")), false);
    check("reporting missing publish plans no operation", p.operations, []);
  }

  {
    // runPrechecks is exported for re-running against a plan the DM edited.
    const pre = runPrechecks({
      operations: [
        { op: "rename-with-link-rewrite", from: "settings/rolara/editor-state/scratch.md", to: "settings/rolara/editor-state/Scratch-NOTE.md" },
      ],
      projectRoot: repo,
    });
    check("runPrechecks alone reaches the same ignored verdict", pre.ignored.length, 1);
    check("and still turns on collisions alone", pre.ok, true);
  }
} finally {
  if (repo) {
    try {
      rmSync(repo, { recursive: true, force: true, maxRetries: 5 });
    } catch {
      /* Windows keeps handles on .git objects; a leftover temp dir is not a failure. */
    }
  }
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  FAILED: ${f}`);
  process.exit(1);
}
