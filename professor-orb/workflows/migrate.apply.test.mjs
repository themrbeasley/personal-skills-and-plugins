#!/usr/bin/env node
// Regression suite for the migration executor's APPLY phase.
//
// This is the only component in professor-orb that can destroy a DM's work, so
// every case here runs against a DISPOSABLE git repository built in the OS temp
// directory and removed afterward. Nothing in this file touches the worktree it
// lives in, and nothing touches a real campaign project.
//
// Node built-ins only, no test framework.
//
// Run: node professor-orb/workflows/migrate.apply.test.mjs

import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  statSync,
  existsSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import {
  applyPlan,
  applyOperation,
  gitMove,
  assertLinkIntegrity,
  rewriteWikilinks,
  runPrechecks,
} from "./migrate.mjs";

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

// ---------------------------------------------------------------------------
// Disposable fixtures
// ---------------------------------------------------------------------------

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
];

const article = (frontmatter, body) => `---\n${frontmatter}\n---\n\n${body}\n`;

// base-rules.json documents no `default` check at all, so a case driven with it
// would show no publish field whether the apply phase strips publish or simply
// cannot resolve a value for it. This copy DOES document a default for publish,
// so only the explicit refusal keeps it out of the file. `tags` gets one too, so
// the case cannot pass merely because insertion is broken outright.
const BASE_RULES_WITH_DEFAULTS = {
  ...BASE_RULES,
  rules: {
    ...BASE_RULES.rules,
    frontmatterPublishDefault: {
      category: "frontmatter",
      check: "default",
      enforcement: "warn",
      description: "publish defaults to false.",
      params: { field: "publish", value: false },
    },
    frontmatterTagsDefault: {
      category: "frontmatter",
      check: "default",
      enforcement: "warn",
      description: "tags defaults to the empty list.",
      params: { field: "tags", value: [] },
    },
  },
};

// base-rules.json maps the -INDEX suffix to the type "Index", which is
// byte-identical to the hardcoded fallback in the executor. Asserting "Index"
// would therefore pass whether the suffix mapping was read or never opened. This
// copy pins a type unlike the fallback, so only an actual read produces it.
const BASE_RULES_DISTINCT_INDEX_TYPE = {
  ...BASE_RULES,
  rules: {
    ...BASE_RULES.rules,
    filenameSuffixByType: {
      ...BASE_RULES.rules.filenameSuffixByType,
      params: {
        mapping: [
          { type: "Folder Index", suffix: "-INDEX" },
          { type: "Session Report", suffix: "-REPORT" },
        ],
      },
    },
  },
};

function writeInto(root, rel, body) {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, body);
  return abs;
}

function git(root, argv) {
  return execFileSync("git", argv, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function initRepo(root) {
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Apply Test"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "snapshot"]);
}

// A repository whose working tree is clean and whose HEAD is the snapshot: the
// exact precondition the apply phase requires before it mutates anything.
function withRepo(files, fn) {
  const root = mkdtempSync(path.join(os.tmpdir(), "orb-migrate-apply-"));
  try {
    for (const rel of Object.keys(files)) writeInto(root, rel, files[rel]);
    initRepo(root);
    return fn(root);
  } finally {
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 5 });
    } catch {
      /* Windows keeps handles on .git objects; a leftover temp dir is not a failure. */
    }
  }
}

// A directory with no repository at all, for the undetermined-ignored case.
function withBareDir(files, fn) {
  const root = mkdtempSync(path.join(os.tmpdir(), "orb-migrate-apply-norepo-"));
  try {
    for (const rel of Object.keys(files)) writeInto(root, rel, files[rel]);
    return fn(root);
  } finally {
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 5 });
    } catch {
      /* Same handle caveat. */
    }
  }
}

const porcelain = (root) =>
  git(root, ["status", "--porcelain"]).split("\n").map((l) => l.trimEnd()).filter(Boolean).sort();
const lsFiles = (root) => git(root, ["ls-files"]).split("\n").filter(Boolean).sort();
const head = (root) => git(root, ["rev-parse", "HEAD"]).trim();
const has = (root, rel) => existsSync(path.join(root, rel));

// Every reach into a result or a produced file goes through these. A broken
// implementation must make a case go RED, not throw and take every later case
// down with it: an exception here would hide exactly the red set that proves
// the suite can fail.
const read = (root, rel) => {
  try {
    return readFileSync(path.join(root, rel), "utf8");
  } catch {
    return "";
  }
};
const first = (xs) => (Array.isArray(xs) && xs.length > 0 ? xs[0] : {});
const links = (r) => r.linkIntegrity || { ok: null, dead: [], filesChecked: -1, linksChecked: -1 };
const parsed = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

// Everything a mutation would disturb, plus git's own view of it. Compared
// across a refused applyPlan call: a refusal must leave the project untouched.
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
        out.push(`f ${rel} ${st.size} ${readFileSync(abs, "utf8").length}`);
      }
    }
  };
  walk(root);
  try {
    out.push("git " + git(root, ["status", "--porcelain", "--ignored"]));
  } catch {
    out.push("git (not a repository)");
  }
  return out.join("\n");
}

const apply = (root, operations, extra) =>
  applyPlan(
    { operations },
    Object.assign({ cwd: root, settings: SETTINGS, baseRules: BASE_RULES, commit: false }, extra)
  );

const bucketTotal = (r) =>
  r.applied.length + r.failed.length + r.dropped.length + r.skipped.length;

// ---------------------------------------------------------------------------
// Every relocation goes through git mv
// ---------------------------------------------------------------------------

console.log("\nEvery relocation goes through git mv");

withRepo(
  {
    "settings/rolara/items/Sword.md": article("publish: false\ntype: Item", "A blade."),
    "settings/rolara/items/Items-INDEX.md": article("publish: false\ntype: Index", "- [[Sword]]"),
  },
  (root) => {
    const r = apply(root, [
      {
        op: "rename-with-link-rewrite",
        from: "settings/rolara/items/Sword.md",
        to: "settings/rolara/items/Sword-of-Dawn.md",
        links: ["settings/rolara/items/Items-INDEX.md"],
        reason: "suffix",
      },
    ]);

    const status = porcelain(root);
    check(
      "the move is recorded as one staged rename",
      status.filter((l) => l.startsWith("R ")),
      ["R  settings/rolara/items/Sword.md -> settings/rolara/items/Sword-of-Dawn.md"]
    );
    check(
      "and not as a delete plus an untracked pair",
      status.filter((l) => l.startsWith("D ") || l.startsWith("?? ")),
      []
    );
    check("the original path is gone from the working tree", has(root, "settings/rolara/items/Sword.md"), false);
    check("the destination is on disk", has(root, "settings/rolara/items/Sword-of-Dawn.md"), true);
    check(
      "the old path is no longer tracked, so no two files claim one article",
      lsFiles(root).includes("settings/rolara/items/Sword.md"),
      false
    );
    check("the relocation is reported applied", r.applied.length, 1);
  }
);

console.log("\nA rename and its link rewrite are one unit of work");

withRepo(
  {
    "settings/rolara/items/Sword.md": article("publish: false\ntype: Item", "A blade."),
    "settings/rolara/items/Items-INDEX.md": article(
      "publish: false\ntype: Index",
      "| Item | Note |\n| --- | --- |\n| [[Sword\\|The Sword]] | main |\n\n- [[Sword]]\n- [[Sword#Origins]]"
    ),
    "settings/rolara/lore/Origins.md": article("publish: false\ntype: Concept", "See [[items/Sword|the blade]]."),
  },
  (root) => {
    const r = apply(root, [
      {
        op: "rename-with-link-rewrite",
        from: "settings/rolara/items/Sword.md",
        to: "settings/rolara/items/Sword-of-Dawn.md",
        links: ["settings/rolara/items/Items-INDEX.md", "settings/rolara/lore/Origins.md"],
        reason: "suffix",
      },
    ]);

    check("the rename and its rewrite produce exactly ONE accounting entry", bucketTotal(r), 1);
    check("that entry is applied", r.applied.length, 1);
    check("it reports every wikilink it rewrote", first(r.applied).linksRewritten, 4);

    const index = read(root, "settings/rolara/items/Items-INDEX.md");
    check("the table-escaped wikilink is rewritten and stays escaped",
      index.includes("[[Sword-of-Dawn\\|The Sword]]"), true);
    check("the plain wikilink is rewritten", index.includes("- [[Sword-of-Dawn]]"), true);
    check("the anchor survives the rewrite", index.includes("[[Sword-of-Dawn#Origins]]"), true);
    // Counted, not tested for absence with a broad negative lookahead: the
    // lookahead form matched nothing at all even when NO rewrite had happened,
    // so the case passed whether or not the code worked. This counts wikilinks
    // whose target is exactly "Sword", in every separator form.
    check("no reference to the old name survives in the index",
      (index.match(/\[\[Sword(?=[\]|#\\])/g) || []).length, 0);

    const lore = read(root, "settings/rolara/lore/Origins.md");
    check("a path-qualified wikilink keeps its path and display text",
      lore.includes("[[items/Sword-of-Dawn|the blade]]"), true);
  }
);

withRepo(
  {
    "settings/rolara/items/Sword.md": article("publish: false\ntype: Item", "A blade."),
    "settings/rolara/items/Items-INDEX.md": article("publish: false\ntype: Index", "- [[Sword]]"),
    "settings/rolara/lore/Silent.md": article("publish: false\ntype: Concept", "No link here."),
  },
  (root) => {
    // The plan names a file that carries no matching wikilink. The rewrite half
    // did not complete, so the ONE entry reports applied false even though the
    // file moved: two batched passes would have reported the move as done.
    const r = apply(root, [
      {
        op: "rename-with-link-rewrite",
        from: "settings/rolara/items/Sword.md",
        to: "settings/rolara/items/Sword-of-Dawn.md",
        links: ["settings/rolara/items/Items-INDEX.md", "settings/rolara/lore/Silent.md"],
        reason: "suffix",
      },
    ]);
    check("a rename whose rewrite half is incomplete is not reported applied", r.applied.length, 0);
    check("it lands in failed, still as one entry", r.failed.length, 1);
    check("the failure names the file whose rewrite did not land",
      /Silent\.md/.test(first(r.failed).detail || ""), true);
  }
);

console.log("\nCase-only renames");

withRepo(
  {
    "settings/rolara/items/items-index.md": article("publish: false\ntype: Index", "- [[Blade]]"),
    // Spelled with different casing than the file it points at, which Obsidian
    // still resolves. It has to travel with the rename or it dies silently.
    "settings/rolara/items/Blade.md": article("publish: false\ntype: Item", "Listed in [[Items-Index]]."),
  },
  (root) => {
    const r = apply(root, [
      {
        op: "rename-with-link-rewrite",
        from: "settings/rolara/items/items-index.md",
        to: "settings/rolara/items/items-INDEX.md",
        links: ["settings/rolara/items/Blade.md"],
        reason: "suffix",
      },
    ]);
    check("a case-only rename is applied", r.applied.length, 1);
    check("its referring link is rewritten in the same unit of work",
      read(root, "settings/rolara/items/Blade.md").includes("[[items-INDEX]]"), true);
    check("git mv handles it in one step on this filesystem", first(r.applied).mode, "direct");
    check("the corrected casing is what git tracks",
      lsFiles(root).includes("settings/rolara/items/items-INDEX.md"), true);
    check("and the old casing is not",
      lsFiles(root).includes("settings/rolara/items/items-index.md"), false);
  }
);

withRepo(
  {
    "settings/rolara/items/items-index.md": article("publish: false\ntype: Index", "- [[Blade]]"),
    "settings/rolara/items/Blade.md": article("publish: false\ntype: Item", "A blade."),
  },
  (root) => {
    // The two-step is a FALLBACK, not the default path, so it only runs when
    // git mv reports an error. This filesystem is case-insensitive and git mv
    // succeeds directly here, so the fallback is exercised by handing gitMove a
    // git runner that fails exactly the direct case-only move and passes
    // everything else through to the real one.
    const calls = [];
    let failedOnce = false;
    const realGit = (argv) => {
      try {
        return { ok: true, stdout: git(root, argv), stderr: "" };
      } catch (err) {
        return { ok: false, stdout: "", stderr: String((err && err.stderr) || err.message) };
      }
    };
    const fussyGit = (argv) => {
      calls.push(argv.join(" "));
      if (!failedOnce && argv[0] === "mv" && argv[3] === "settings/rolara/items/items-INDEX.md") {
        failedOnce = true;
        return { ok: false, stdout: "", stderr: "fatal: destination exists (simulated)" };
      }
      return realGit(argv);
    };
    const moved = gitMove(
      { cwd: root, git: fussyGit },
      "settings/rolara/items/items-index.md",
      "settings/rolara/items/items-INDEX.md"
    );
    check("git mv is attempted directly first, with no staging name",
      calls[0], "mv -- settings/rolara/items/items-index.md settings/rolara/items/items-INDEX.md");
    check("the fallback runs only after that direct attempt reported an error",
      failedOnce && calls.length > 1, true);
    check("the two-step fallback succeeds", moved.ok, true);
    check("and reports which path it took", moved.mode, "two-step");
    check("the corrected casing is tracked after the fallback",
      lsFiles(root).includes("settings/rolara/items/items-INDEX.md"), true);
    check("no temporary staging path is left behind",
      lsFiles(root).some((f) => f.includes("orb-migrate-tmp")), false);
  }
);

console.log("\nA prong relocated into its own child");

withRepo(
  {
    "homebrew/Dragon-Materials.md": article("publish: false\ntype: Item", "Scales."),
    "settings/rolara/items/Items-INDEX.md": article("publish: false\ntype: Index", "Nothing linked."),
  },
  (root) => {
    // git refuses to move a directory into itself, so a nested destination is
    // staged through a temporary sibling.
    const r = apply(root, [
      { op: "relocate-prong", from: "homebrew", to: "homebrew/rolara", reason: "canonical layout" },
    ]);
    check("a folder moved into its own child is applied", r.applied.length, 1);
    check("and reports that it was staged through a temporary sibling", first(r.applied).mode, "staged");
    check("the content lands under the nested destination",
      lsFiles(root).includes("homebrew/rolara/Dragon-Materials.md"), true);
    check("nothing is left at the old path",
      lsFiles(root).includes("homebrew/Dragon-Materials.md"), false);
    check("no temporary staging path survives",
      lsFiles(root).some((f) => f.includes("orb-migrate-tmp")), false);
  }
);

console.log("\nAn index merge is lossless");

withRepo(
  {
    "settings/rolara/items/Items-INDEX.md": article(
      "publish: false\ntype: Index",
      "## Weapons\n\nThe armoury holds these.\n\n- [[Blade]]"
    ),
    "settings/rolara/items/Artifacts-INDEX.md": article(
      "publish: false\ntype: Index",
      "## Artifacts\n\nRelics of the first crown.\n\n- [[Crown]]"
    ),
    "settings/rolara/items/Materials-INDEX.md": article(
      "publish: false\ntype: Index",
      "## Materials\n\nDragon scale and star iron.\n\n- [[Scale]]"
    ),
    "settings/rolara/items/Blade.md": article("publish: false\ntype: Item", "x"),
    "settings/rolara/items/Crown.md": article("publish: false\ntype: Item", "x"),
    "settings/rolara/items/Scale.md": article("publish: false\ntype: Item", "x"),
  },
  (root) => {
    const r = apply(root, [
      {
        op: "merge-index",
        to: "settings/rolara/items/Items-INDEX.md",
        sources: [
          "settings/rolara/items/Artifacts-INDEX.md",
          "settings/rolara/items/Materials-INDEX.md",
        ],
        reason: "multi-index folder",
      },
    ]);
    check("the merge is applied", r.applied.length, 1);
    const survivor = read(root, "settings/rolara/items/Items-INDEX.md");
    check("the survivor's own heading survives", survivor.includes("## Weapons"), true);
    check("the survivor's own prose survives", survivor.includes("The armoury holds these."), true);
    check("the first source's heading survives", survivor.includes("## Artifacts"), true);
    check("the first source's prose survives", survivor.includes("Relics of the first crown."), true);
    check("the second source's heading survives", survivor.includes("## Materials"), true);
    check("the second source's prose survives", survivor.includes("Dragon scale and star iron."), true);
    check("every source's wikilinks survive",
      survivor.includes("[[Crown]]") && survivor.includes("[[Scale]]") && survivor.includes("[[Blade]]"), true);
    check("each source arrives under a provenance heading naming it",
      survivor.includes("Artifacts-INDEX") && survivor.includes("Materials-INDEX"), true);
    check("the merged-away sources are gone from the working tree",
      has(root, "settings/rolara/items/Artifacts-INDEX.md"), false);
    check("and gone from the index too",
      lsFiles(root).filter((f) => /Artifacts-INDEX|Materials-INDEX/.test(f)), []);
  }
);

console.log("\nA merge carries its link rewrites, the way a rename does");

withRepo(
  {
    "settings/rolara/items/Items-INDEX.md": article(
      "publish: false\ntype: Index",
      "## Sub-indexes\n\n- [[Artifacts-INDEX]]\n- [[Materials-INDEX]]"
    ),
    "settings/rolara/items/Artifacts-INDEX.md": article("publish: false\ntype: Index", "## Artifacts\n\n- [[Crown]]"),
    "settings/rolara/items/Materials-INDEX.md": article("publish: false\ntype: Index", "## Materials\n\n- [[Scale]]"),
    "settings/rolara/items/Crown.md": article("publish: false\ntype: Item", "x"),
    "settings/rolara/items/Scale.md": article("publish: false\ntype: Item", "x"),
  },
  (root) => {
    // The reference consumer's EXACT shape, and the one that blocked the
    // migration: surveyed read-only, all six inbound links to items/'s
    // merged-away sub-indexes live in the survivor itself, because the survivor
    // is precisely the index that lists them. Those referring files are text
    // inside the merged document by the time the rewrite runs, so a rewrite
    // aimed at the survivor on disk would be discarded by the merge's own write.
    const before = head(root);
    const r = applyPlan(
      {
        operations: [
          {
            op: "merge-index",
            to: "settings/rolara/items/Items-INDEX.md",
            sources: [
              "settings/rolara/items/Artifacts-INDEX.md",
              "settings/rolara/items/Materials-INDEX.md",
            ],
            sourceLinks: {
              "settings/rolara/items/Artifacts-INDEX.md": ["settings/rolara/items/Items-INDEX.md"],
              "settings/rolara/items/Materials-INDEX.md": ["settings/rolara/items/Items-INDEX.md"],
            },
            reason: "multi-index folder",
          },
        ],
      },
      { cwd: root, settings: SETTINGS, baseRules: BASE_RULES, commit: true }
    );
    const survivor = read(root, "settings/rolara/items/Items-INDEX.md");
    check("the merge is applied", r.applied.length, 1);
    check("no wikilink to a merged-away source survives",
      /\[\[(Artifacts|Materials)-INDEX/.test(survivor), false);
    check("each one points at the survivor instead",
      (survivor.match(/\[\[Items-INDEX\]\]/g) || []).length, 2);
    check("both rewrites are accounted on the merge's own entry, not a later pass",
      [first(r.applied).linksExpected, first(r.applied).linksRewritten], [2, 2]);
    check("the absorbed content still arrives under its provenance heading",
      survivor.includes("## Merged from Artifacts-INDEX.md") && survivor.includes("- [[Crown]]"), true);
    check("link integrity passes after the rewrite", links(r).ok, true);
    check("so the migration this release exists to perform reaches its commit", r.committed, true);
    check("and HEAD moved off the snapshot", head(root) !== before, true);
  }
);

withRepo(
  {
    "settings/rolara/items/Items-INDEX.md": article("publish: false\ntype: Index", "## Weapons\n\n- [[Blade]]"),
    "settings/rolara/items/Artifacts-INDEX.md": article("publish: false\ntype: Index", "## Artifacts\n\n- [[Crown]]"),
    "settings/rolara/items/Blade.md": article("publish: false\ntype: Item", "x"),
    "settings/rolara/items/Crown.md": article("publish: false\ntype: Item", "x"),
    "settings/rolara/lore/Compendium.md": article(
      "publish: false\ntype: Concept",
      "See [[Artifacts-INDEX|the relic list]] and ![[Artifacts-INDEX#Artifacts]]."
    ),
  },
  (root) => {
    // A referring file OUTSIDE the merge, rewritten on disk. Only the wikilink
    // target moves: display text, anchor, and the embed marker are the DM's
    // prose and are carried across byte for byte.
    const r = apply(root, [
      {
        op: "merge-index",
        to: "settings/rolara/items/Items-INDEX.md",
        sources: ["settings/rolara/items/Artifacts-INDEX.md"],
        sourceLinks: {
          "settings/rolara/items/Artifacts-INDEX.md": ["settings/rolara/lore/Compendium.md"],
        },
        reason: "multi-index folder",
      },
    ]);
    const compendium = read(root, "settings/rolara/lore/Compendium.md");
    check("a referring article outside the merge is rewritten too", r.applied.length, 1);
    check("its link now names the survivor, keeping display text and anchor",
      compendium.includes("[[Items-INDEX|the relic list]]") && compendium.includes("![[Items-INDEX#Artifacts]]"),
      true);
    check("and nothing still names the merged-away source",
      compendium.includes("Artifacts-INDEX"), false);
    check("two wikilinks in one named file count as two rewrites over one pair",
      [first(r.applied).linksExpected, first(r.applied).linksRewritten], [1, 2]);
    check("the rest of the sentence is untouched",
      compendium.includes("See ") && compendium.includes(" and ") && compendium.includes("."), true);
  }
);

withRepo(
  {
    "settings/rolara/items/Items-INDEX.md": article("publish: false\ntype: Index", "## Weapons\n\n- [[Blade]]"),
    "settings/rolara/items/Artifacts-INDEX.md": article("publish: false\ntype: Index", "## Artifacts\n\n- [[Crown]]"),
    "settings/rolara/items/Materials-INDEX.md": article("publish: false\ntype: Index", "## Materials\n\n- [[Scale]]"),
    "settings/rolara/items/Blade.md": article("publish: false\ntype: Item", "x"),
    "settings/rolara/items/Crown.md": article("publish: false\ntype: Item", "x"),
    "settings/rolara/items/Scale.md": article("publish: false\ntype: Item", "x"),
    "settings/rolara/lore/Compendium.md": article(
      "publish: false\ntype: Concept",
      "Both [[Artifacts-INDEX]] and [[Materials-INDEX]]."
    ),
    "settings/rolara/lore/Almanac.md": article("publish: false\ntype: Concept", "Only [[Artifacts-INDEX]]."),
  },
  (root) => {
    // The accounted unit is the PAIR, not the file: one article referring to two
    // merged-away sources is two rewrites, because either one going missing is
    // one dead wikilink. Three pairs here across two files and two sources.
    const r = apply(root, [
      {
        op: "merge-index",
        to: "settings/rolara/items/Items-INDEX.md",
        sources: [
          "settings/rolara/items/Artifacts-INDEX.md",
          "settings/rolara/items/Materials-INDEX.md",
        ],
        sourceLinks: {
          "settings/rolara/items/Artifacts-INDEX.md": [
            "settings/rolara/lore/Compendium.md",
            "settings/rolara/lore/Almanac.md",
          ],
          "settings/rolara/items/Materials-INDEX.md": ["settings/rolara/lore/Compendium.md"],
        },
        reason: "multi-index folder",
      },
    ]);
    check("a file referring to two merged-away sources counts as two pairs",
      [first(r.applied).linksExpected, first(r.applied).linksRewritten], [3, 3]);
    check("both of that file's links point at the survivor",
      (read(root, "settings/rolara/lore/Compendium.md").match(/\[\[Items-INDEX\]\]/g) || []).length, 2);
    check("and the second file naming the same source is rewritten as well",
      read(root, "settings/rolara/lore/Almanac.md").includes("[[Items-INDEX]]"), true);
    check("every link in the project resolves afterward", links(r).ok, true);
  }
);

withRepo(
  {
    "settings/rolara/items/Items-INDEX.md": article("publish: false\ntype: Index", "## Weapons\n\n- [[Blade]]"),
    "settings/rolara/items/Artifacts-INDEX.md": article("publish: false\ntype: Index", "## Artifacts\n\n- [[Crown]]"),
    "settings/rolara/items/Blade.md": article("publish: false\ntype: Item", "x"),
    "settings/rolara/items/Crown.md": article("publish: false\ntype: Item", "x"),
    "settings/rolara/lore/Bystander.md": article("publish: false\ntype: Concept", "Mentions nothing."),
  },
  (root) => {
    // A stale plan, the merge's version of the rename case: the named file
    // carries no such wikilink. The merge and its rewrites are one unit, so the
    // entry reports applied false rather than counting the merge as done.
    const r = apply(root, [
      {
        op: "merge-index",
        to: "settings/rolara/items/Items-INDEX.md",
        sources: ["settings/rolara/items/Artifacts-INDEX.md"],
        sourceLinks: {
          "settings/rolara/items/Artifacts-INDEX.md": ["settings/rolara/lore/Bystander.md"],
        },
        reason: "multi-index folder",
      },
    ]);
    check("a named referring file carrying no such wikilink fails the whole unit",
      [r.applied.length, r.failed.length], [0, 1]);
    check("and the entry names the file whose rewrite did not land",
      /Bystander\.md \(no wikilink to Artifacts-INDEX found\)/.test(first(r.failed).detail || ""), true);
    check("so the run is not reported ok", r.ok, false);
  }
);

console.log("\nA merge removes the source it names and nothing else");

withRepo(
  {
    "settings/rolara/items/Items-INDEX.md": article("publish: false\ntype: Index", "## Items\n\n- [[Longsword]]"),
    // The merge's only source. Its DM-chosen name carries glob characters, which
    // is ordinary: index names come off the DM's filesystem by way of the scout
    // and are never sanitized on the way here.
    "settings/rolara/items/Weapons [OS]-INDEX.md": article(
      "publish: false\ntype: Index",
      "## Weapons\n\nSteel and star iron."
    ),
    // Named by NO operation in this plan, and irreplaceable. The glob [OS]
    // matches the single character O, so a bare `git rm` pathspec swept it away
    // with the source: measured, the folder was left holding only Items-INDEX.md
    // and Longsword.md, this file's content had been merged nowhere, and the run
    // still reported ok true, committed true, zero failures, zero drops, clean
    // link integrity, and no messages. `--` stops option parsing; only
    // `:(literal)` stops wildcard interpretation.
    "settings/rolara/items/Weapons O-INDEX.md": article(
      "publish: false\ntype: Index",
      "## Weapons of Office\n\nIRREPLACEABLE CONTENT."
    ),
    "settings/rolara/items/Longsword.md": article("publish: false\ntype: Item", "A blade."),
  },
  (root) => {
    const r = apply(root, [
      {
        op: "merge-index",
        to: "settings/rolara/items/Items-INDEX.md",
        sources: ["settings/rolara/items/Weapons [OS]-INDEX.md"],
        reason: "multi-index folder",
      },
    ]);
    check("the merge is applied", [r.applied.length, r.failed.length, r.dropped.length], [1, 0, 0]);
    check("the source the plan named is gone", has(root, "settings/rolara/items/Weapons [OS]-INDEX.md"), false);
    check("its content arrived in the survivor",
      read(root, "settings/rolara/items/Items-INDEX.md").includes("Steel and star iron."), true);
    check("the sibling the glob would otherwise have matched is still on disk",
      has(root, "settings/rolara/items/Weapons O-INDEX.md"), true);
    check("with its content untouched",
      read(root, "settings/rolara/items/Weapons O-INDEX.md").includes("IRREPLACEABLE CONTENT."), true);
    check("and still tracked by git",
      lsFiles(root).includes("settings/rolara/items/Weapons O-INDEX.md"), true);
    check("nothing the plan never named was removed from the folder",
      readdirSync(path.join(root, "settings/rolara/items")).sort(),
      ["Items-INDEX.md", "Longsword.md", "Weapons O-INDEX.md"]);
  }
);

console.log("\nThe link-integrity rail still blocks a dropped rewrite");

withRepo(
  {
    "settings/rolara/items/Items-INDEX.md": article("publish: false\ntype: Index", "## Weapons\n\n- [[Artifacts-INDEX]]"),
    "settings/rolara/items/Artifacts-INDEX.md": article("publish: false\ntype: Index", "## Artifacts\n\n- [[Crown]]"),
    "settings/rolara/items/Crown.md": article("publish: false\ntype: Item", "x"),
  },
  (root) => {
    // A plan that names no referrers for a source that HAS one. The rewrite half
    // has nothing to do, the removal orphans the link, and the rail is what
    // makes that loud rather than silent.
    const before = head(root);
    const r = applyPlan(
      {
        operations: [
          {
            op: "merge-index",
            to: "settings/rolara/items/Items-INDEX.md",
            sources: ["settings/rolara/items/Artifacts-INDEX.md"],
            reason: "multi-index folder",
          },
        ],
      },
      { cwd: root, settings: SETTINGS, baseRules: BASE_RULES, commit: true }
    );
    check("a merge that orphans a wikilink is caught by the rail",
      links(r).dead.map((d) => d.target), ["Artifacts-INDEX"]);
    check("and that run does not commit either", r.committed, false);
    check("with HEAD still at the snapshot", head(root), before);
  }
);

withRepo(
  {
    "settings/rolara/items/Items-INDEX.md": article("publish: false\ntype: Index", "## Weapons\n\n- [[Blade]]"),
    "settings/rolara/items/Artifacts-INDEX.md": article("publish: false\ntype: Index", "## Artifacts\n\n- [[Crown]]"),
    "settings/rolara/items/Blade.md": article("publish: false\ntype: Item", "x"),
    "settings/rolara/items/Crown.md": article("publish: false\ntype: Item", "x"),
    "settings/rolara/lore/Compendium.md": article("publish: false\ntype: Concept", "See [[Artifacts-INDEX]]."),
  },
  (root) => {
    // The plan DOES carry the rewrite and a worker drops it anyway. This is the
    // case the rail exists for, and adding the rewrite must not disarm it: the
    // assertion has to still block the commit when the rewrite goes missing.
    const before = head(root);
    const strippingWorker = (op, ctx) =>
      applyOperation(op.op === "merge-index" ? Object.assign({}, op, { sourceLinks: undefined }) : op, ctx);
    const r = applyPlan(
      {
        operations: [
          {
            op: "merge-index",
            to: "settings/rolara/items/Items-INDEX.md",
            sources: ["settings/rolara/items/Artifacts-INDEX.md"],
            sourceLinks: {
              "settings/rolara/items/Artifacts-INDEX.md": ["settings/rolara/lore/Compendium.md"],
            },
            reason: "multi-index folder",
          },
        ],
      },
      { cwd: root, settings: SETTINGS, baseRules: BASE_RULES, commit: true, worker: strippingWorker }
    );
    check("a rewrite the plan carried but the worker dropped still leaves the link dead",
      links(r).dead.map((d) => `${d.file} -> ${d.target}`),
      ["settings/rolara/lore/Compendium.md -> Artifacts-INDEX"]);
    check("the rail still blocks the commit", [links(r).ok, r.committed], [false, false]);
    check("and HEAD is still the snapshot to restore to", head(root), before);
  }
);

console.log("\nFrontmatter repair is a line move on raw text");

withRepo(
  {
    "settings/rolara/locations/Tavern.md":
      "---\n" +
      "# DM note: keep this one dark until session 40\n" +
      'type: "Location"\n' +
      "tags: [city, tavern]\n" +
      "nested:\n" +
      "  owner: Brand\n" +
      '  sealed: "false"\n' +
      'publish: "false"\n' +
      "---\n" +
      "\nA tavern.\n",
  },
  (root) => {
    const r = apply(root, [
      {
        op: "repair-frontmatter",
        from: "settings/rolara/locations/Tavern.md",
        insert: [],
        reorder: true,
        reason: "canonical order",
      },
    ]);
    check("the reorder is applied", r.applied.length, 1);
    const text = read(root, "settings/rolara/locations/Tavern.md");
    const fm = text.split("---")[1].split("\n").filter(Boolean);
    check("the YAML comment survives",
      fm.includes("# DM note: keep this one dark until session 40"), true);
    check('a quoted "false" keeps its quotes', text.includes('publish: "false"'), true);
    check('a quoted "false" inside a nested map keeps its quotes too',
      text.includes('  sealed: "false"'), true);
    check("the nested map survives whole",
      text.includes("nested:\n  owner: Brand\n"), true);
    check("the canonical fields end up in canonical order",
      fm.filter((l) => /^(publish|type|tags):/.test(l)).map((l) => l.split(":")[0]),
      ["publish", "type", "tags"]);
    check("quoting on a moved field is untouched", text.includes('type: "Location"'), true);
    check("the body is untouched", text.endsWith("\nA tavern.\n"), true);
  }
);

console.log("\npublish is never inserted, even by a hand-edited plan");

withRepo(
  {
    "settings/rolara/locations/Tavern.md": "---\ntype: Location\n---\n\nA tavern.\n",
  },
  (root) => {
    // The plan phase strips publish out of `insert`. The DM can edit the plan
    // between phases, so the apply phase strips it again rather than trusting
    // the file it was handed. Driven with a rules layer that DOES document a
    // default for publish, so the field's absence proves the refusal rather
    // than proving the value could not be resolved.
    const r = apply(
      root,
      [
        {
          op: "repair-frontmatter",
          from: "settings/rolara/locations/Tavern.md",
          insert: ["publish", "tags"],
          reorder: true,
          reason: "hand-edited",
        },
      ],
      { baseRules: BASE_RULES_WITH_DEFAULTS }
    );
    const text = read(root, "settings/rolara/locations/Tavern.md");
    check("the repair is applied", r.applied.length, 1);
    check("a non-publish field with a documented default IS inserted",
      /^tags: \[\]$/m.test(text), true);
    check("no publish field is written, even though a default exists for it",
      /^publish\s*:/m.test(text), false);
    check("the refusal to write publish is reported",
      /Declined to insert publish/.test((first(r.applied).detail || first(r.failed).detail || "")), true);
  }
);

console.log("\nAn operation whose source is git-ignored is skipped");

withRepo(
  {
    ".gitignore": "settings/rolara/editor-state/\n",
    "settings/rolara/editor-state/scratch.md": article("publish: false\ntype: Concept", "Scratch."),
    // Carries a wikilink that survives both renames, so this fixture exercises
    // the skip and ONLY the skip. Without one, the walk ends with zero links
    // checked, which the rail now reports as a coverage failure, and this case
    // would be quietly riding a blocked rail while appearing to test skipping.
    "settings/rolara/Ashfall.md": article("publish: false\ntype: Organization", "A compact with [[Concord]]."),
    "settings/rolara/Concord.md": article("publish: false\ntype: Organization", "A pact."),
  },
  (root) => {
    const r = apply(root, [
      {
        op: "rename-with-link-rewrite",
        from: "settings/rolara/editor-state/scratch.md",
        to: "settings/rolara/editor-state/Scratch-CONCEPT.md",
        reason: "suffix",
      },
      {
        op: "rename-with-link-rewrite",
        from: "settings/rolara/Ashfall.md",
        to: "settings/rolara/Ashfall-ORG.md",
        reason: "suffix",
      },
    ]);
    check("the ignored-source operation is skipped, not applied",
      r.skipped.map((s) => s.from), ["settings/rolara/editor-state/scratch.md"]);
    check("its file is still exactly where it was",
      has(root, "settings/rolara/editor-state/scratch.md"), true);
    check("and its destination was never created",
      has(root, "settings/rolara/editor-state/Scratch-CONCEPT.md"), false);
    check("the tracked operation beside it still runs",
      lsFiles(root).includes("settings/rolara/Ashfall-ORG.md"), true);
    check("a skipped operation still gets exactly one accounting entry", bucketTotal(r), 2);
    check("and the skip states why", /ignored/.test(first(r.skipped).detail || ""), true);
  }
);

console.log("\nThe link-integrity assertion gates the commit");

withRepo(
  {
    "settings/rolara/items/Sword.md": article("publish: false\ntype: Item", "A blade."),
    "settings/rolara/items/Items-INDEX.md": article("publish: false\ntype: Index", "- [[Sword]]"),
  },
  (root) => {
    const before = head(root);
    // A worker that moves the file and reports success while dropping the link
    // rewrite half. The accounting believes it; only the assertion catches it.
    const lyingWorker = (op, ctx) => {
      if (op.op !== "rename-with-link-rewrite") return applyOperation(op, ctx);
      const moved = gitMove(ctx, op.from, op.to);
      return { op: op.op, from: op.from, to: op.to, applied: moved.ok, detail: "moved only" };
    };
    const r = applyPlan(
      {
        operations: [
          {
            op: "rename-with-link-rewrite",
            from: "settings/rolara/items/Sword.md",
            to: "settings/rolara/items/Sword-of-Dawn.md",
            links: ["settings/rolara/items/Items-INDEX.md"],
            reason: "suffix",
          },
        ],
      },
      { cwd: root, settings: SETTINGS, baseRules: BASE_RULES, commit: true, worker: lyingWorker }
    );

    check("the accounting reports the dropped rewrite as applied", r.applied.length, 1);
    check("the link-integrity assertion fails anyway", links(r).ok, false);
    check("it names the dead target", links(r).dead.map((d) => d.target), ["Sword"]);
    check("and the file that carries it",
      links(r).dead.map((d) => d.file), ["settings/rolara/items/Items-INDEX.md"]);
    check("the migration is NOT committed", r.committed, false);
    check("HEAD is still the snapshot", head(root), before);
    check("the run points at the snapshot for restoration", r.snapshot, before);
    check("and the whole run is reported not ok", r.ok, false);
  }
);

withRepo(
  {
    "settings/rolara/items/Sword.md": article("publish: false\ntype: Item", "A blade."),
    "settings/rolara/items/Items-INDEX.md": article("publish: false\ntype: Index", "- [[Sword]]"),
  },
  (root) => {
    const before = head(root);
    const r = applyPlan(
      {
        operations: [
          {
            op: "rename-with-link-rewrite",
            from: "settings/rolara/items/Sword.md",
            to: "settings/rolara/items/Sword-of-Dawn.md",
            links: ["settings/rolara/items/Items-INDEX.md"],
            reason: "suffix",
          },
        ],
      },
      { cwd: root, settings: SETTINGS, baseRules: BASE_RULES, commit: true }
    );
    check("a healthy run passes the assertion", links(r).ok, true);
    // linksChecked, not just ok. ok and an empty dead list are BOTH satisfied by
    // a rail that walked nothing at all, so on their own they cannot tell a
    // clean pass from a disarmed assertion. This is the number that can.
    check("and the pass is a real one: it checked the link that could have died",
      links(r).linksChecked, 1);
    check("over the files that could have carried it", links(r).filesChecked, 2);
    check("and commits", r.committed, true);
    check("the migration commit is a new commit", r.migration !== before, true);
    check("the snapshot hash recorded is the pre-run HEAD", r.snapshot, before);
    check("the working tree is clean afterward", porcelain(root), []);
  }
);

console.log("\nThe link-integrity assertion on its own");

withRepo(
  {
    "settings/rolara/a/Alpha.md": article("publish: false\ntype: Concept", "See [[Beta]] and [[Gamma]]."),
    "settings/rolara/b/Beta.md": article("publish: false\ntype: Concept", "Back to [[Alpha#Top]]."),
    "session-reports/rolara/S1-REPORT.md": article("publish: false\ntype: Session Report", "See [[S2-REPORT]] and [[Alpha]]."),
    "session-reports/rolara/S2-REPORT.md": article("publish: false\ntype: Session Report", "Earlier: [[S1-REPORT]]."),
  },
  (root) => {
    const bad = assertLinkIntegrity({ cwd: root, settings: SETTINGS });
    check("an unresolved target is reported", bad.dead.map((d) => d.target), ["Gamma"]);
    check("with the file that carries it",
      bad.dead.map((d) => d.file), ["settings/rolara/a/Alpha.md"]);
    check("and the verdict is not ok", bad.ok, false);

    writeInto(root, "settings/rolara/a/Gamma.md", article("publish: false\ntype: Concept", "x"));
    const good = assertLinkIntegrity({ cwd: root, settings: SETTINGS });
    check("resolution is filename-based, not path-based: a link across folders resolves",
      good.ok, true);
    check("report-to-report and report-to-article links are both walked",
      good.filesChecked, 5);
    check("and every one of their links was actually resolved, not merely walked past",
      good.linksChecked, 6);
  }
);

withRepo(
  {
    "settings/rolara/a/Alpha.md": article(
      "publish: false\ntype: Concept",
      "Code: `[[NotALink]]`\n\n```\n[[AlsoNotALink]]\n```\n\nReal: [[Beta]] and an image ![[map.png]] and a self link [[#Top]]."
    ),
    "settings/rolara/b/Beta.md": article("publish: false\ntype: Concept", "x"),
  },
  (root) => {
    const r = assertLinkIntegrity({ cwd: root, settings: SETTINGS });
    check("a wikilink inside a code span is not asserted", r.ok, true);
    check("and neither is one inside a fenced block, an attachment, or a bare anchor",
      r.dead, []);
    // Same reason as above: ok plus an empty dead list would hold just as well
    // if extraction returned nothing. Exactly one of the five bracketed things
    // in this fixture is a link, and this is the assertion that says so.
    check("the real link IS counted, so quoting is skipped rather than everything being skipped",
      r.linksChecked, 1);
  }
);

// ---------------------------------------------------------------------------
// The rail's own scope
// ---------------------------------------------------------------------------

console.log("\nA relocated prong does not disarm the rail");

// The settings the apply phase is handed are the conventions.json that was on
// disk when the run started, so kbRoot is the PRE-migration path. This is the
// reference consumer's own first-run shape, not a contrived one.
const PRE_MIGRATION_SETTINGS = [
  {
    name: "rolara",
    kbRoot: "kb",
    homebrewRoot: "homebrew/rolara",
    sessionReportsRoot: "session-reports/rolara",
    rules: {},
    tagRegistryPath: ".professor-orb/tag-registry.rolara.json",
  },
];

withRepo(
  {
    "kb/items/Sword.md": article("publish: false\ntype: Item", "A blade."),
    "kb/items/Items-INDEX.md": article("publish: false\ntype: Index", "- [[Sword]]"),
    // One prong that does NOT move and carries no wikilinks. It is what used to
    // keep the rail alive-looking: the declared kbRoot vanished from disk the
    // moment the relocation landed and was silently dropped, and because the
    // zero-coverage fallback only fires when EVERY root vanishes, the rail
    // shrank to this one file and reported a clean run.
    "session-reports/rolara/S1-REPORT.md": article("publish: false\ntype: Session Report", "No links here."),
  },
  (root) => {
    const before = head(root);
    const r = applyPlan(
      {
        operations: [
          { op: "relocate-prong", from: "kb", to: "settings/rolara", reason: "canonical layout" },
          {
            op: "rename-with-link-rewrite",
            from: "settings/rolara/items/Sword.md",
            to: "settings/rolara/items/Sword-ITEM.md",
            reason: "suffix",
          },
        ],
      },
      { cwd: root, settings: PRE_MIGRATION_SETTINGS, baseRules: BASE_RULES, commit: true }
    );

    check("both operations apply", r.applied.length, 2);
    check("the rail walks the relocated prong at its POST-migration path",
      links(r).roots, ["settings/rolara", "session-reports/rolara"]);
    check("so it checked a real link rather than nothing", links(r).linksChecked, 1);
    check("across every file the run left behind", links(r).filesChecked, 3);
    check("the dropped rewrite is caught", links(r).dead.map((d) => `${d.file} -> ${d.target}`),
      ["settings/rolara/items/Items-INDEX.md -> Sword"]);
    check("the migration is NOT committed", r.committed, false);
    check("and HEAD is still the snapshot", head(root), before);
  }
);

withRepo(
  {
    "kb/items/Sword.md": article("publish: false\ntype: Item", "A blade."),
    "kb/items/Items-INDEX.md": article("publish: false\ntype: Index", "- [[Sword]]"),
  },
  (root) => {
    // The mapping proposes, existsSync disposes. A relocation that was skipped
    // for a git-ignored source, or that failed outright, leaves the prong where
    // it was declared, and the walk has to find it there rather than at the path
    // the plan intended.
    const r = assertLinkIntegrity({
      cwd: root,
      settings: PRE_MIGRATION_SETTINGS,
      relocations: [{ from: "kb", to: "settings/rolara" }],
      expectLinks: true,
    });
    check("a relocation that did not happen leaves the walk at the declared root", r.roots, ["kb"]);
    check("and the rail still checks its links", r.linksChecked, 1);
    check("with nothing dead", r.ok, true);
  }
);

console.log("\nAn assertion that checks zero links is a failure, not a pass");

withRepo(
  {
    // Where the knowledge base actually is, and it holds a wikilink.
    "kb/Items-INDEX.md": article("publish: false\ntype: Index", "- [[Sword]]"),
    "kb/Sword.md": article("publish: false\ntype: Item", "A blade."),
    // The DECLARED prong root. It exists, so the walk does not fall back to the
    // whole project, and nothing under it carries a wikilink.
    "settings/rolara/Placeholder.md": article("publish: false\ntype: Concept", "No wikilinks here."),
  },
  (root) => {
    const before = head(root);
    // The rename ran and demonstrably rewrote a wikilink, so this knowledge base
    // has them. The walk then found zero, which can only mean the roots are
    // pointed away from where the run put the content. That is the defect this
    // rail exists to catch, and it must keep refusing: the module's own principle
    // is that an assertion which silently checks nothing is not an assertion.
    const r = applyPlan(
      {
        operations: [
          {
            op: "rename-with-link-rewrite",
            from: "kb/Sword.md",
            to: "kb/Sword-ITEM.md",
            links: ["kb/Items-INDEX.md"],
            reason: "suffix",
          },
        ],
      },
      { cwd: root, settings: SETTINGS, baseRules: BASE_RULES, commit: true }
    );
    check("the rewrite landed, so a wikilink demonstrably exists in this project",
      first(r.applied).linksRewritten, 1);
    check("zero links checked after it is reported as a coverage failure",
      [links(r).ok, links(r).coverage, links(r).linksChecked], [false, "no-links-checked", 0]);
    check("with no dead link to blame it on", links(r).dead, []);
    check("nothing is committed on it", r.committed, false);
    check("HEAD is still the snapshot", head(root), before);
    check("and the message says which roots were walked, so the DM can find the mismatch",
      /walked, in \["settings\/rolara"\]/.test(r.messages.join(" ")), true);
  }
);

withRepo(
  {
    // A knowledge base that genuinely carries no wikilink anywhere, which is an
    // ordinary shape for one early in its life, and one plain filename fix.
    "settings/rolara/KB-INDEX.md": article("publish: false\ntype: Index", "The knowledge base. No wikilinks anywhere."),
    "settings/rolara/The Rusty Flagon.md": article("publish: false\ntype: Location", "A tavern. Still no wikilinks."),
  },
  (root) => {
    const before = head(root);
    // Armed from the PLAN, this was a dead end rather than a warning: the run
    // refused with dead [], refused identically with commit disabled because the
    // guard sits before that branch, carried no override, and refused again after
    // the documented restore. No skip, no failure, and no git-ignored file were
    // needed to reach it. A rename that rewrote no wikilink put none at risk.
    const r = applyPlan(
      {
        operations: [
          {
            op: "rename-with-link-rewrite",
            from: "settings/rolara/The Rusty Flagon.md",
            to: "settings/rolara/The-Rusty-Flagon.md",
            reason: "filename convention",
          },
        ],
      },
      { cwd: root, settings: SETTINGS, baseRules: BASE_RULES, commit: true }
    );
    check("the rename applied",
      [r.applied.length, has(root, "settings/rolara/The-Rusty-Flagon.md")], [1, true]);
    check("a run that rewrote no wikilink does not arm the zero-link rail",
      [links(r).ok, links(r).coverage, links(r).linksChecked], [true, "ok", 0]);
    check("so a wikilink-free knowledge base can finish its migration", r.committed, true);
    check("and HEAD moved off the snapshot", head(root) !== before, true);
  }
);

withRepo(
  {
    "settings/rolara/locations/Tavern.md": "---\ntype: Location\npublish: false\n---\n\nA tavern.\n",
  },
  (root) => {
    // The converse. A plan carrying no operation that can orphan a wikilink is
    // not held to the same standard: relocations are basename-safe and an
    // in-place frontmatter edit moves nothing, so zero links here means zero
    // links, not a rail pointed somewhere wrong.
    const r = applyPlan(
      {
        operations: [
          {
            op: "repair-frontmatter",
            from: "settings/rolara/locations/Tavern.md",
            insert: [],
            reorder: true,
            reason: "canonical order",
          },
        ],
      },
      { cwd: root, settings: SETTINGS, baseRules: BASE_RULES, commit: true }
    );
    check("a plan that cannot orphan a wikilink passes on zero links",
      [links(r).ok, links(r).coverage, links(r).linksChecked], [true, "ok", 0]);
    check("and commits", r.committed, true);
  }
);

console.log("\nResolution is scoped to the roots being walked");

withRepo(
  {
    "settings/rolara/items/Sword.md": article("publish: false\ntype: Item", "A blade."),
    "settings/rolara/items/Items-INDEX.md": article("publish: false\ntype: Index", "- [[Sword]]"),
    // A different file that happens to share the basename, sitting under no
    // prong root of any setting. Resolving project-wide let it stand in for the
    // renamed article and the run committed a dead wikilink.
    "archive/old/Sword.md": article("publish: false\ntype: Item", "An older, unrelated draft."),
  },
  (root) => {
    const before = head(root);
    const r = applyPlan(
      {
        operations: [
          {
            op: "rename-with-link-rewrite",
            from: "settings/rolara/items/Sword.md",
            to: "settings/rolara/items/Sword-ITEM.md",
            reason: "suffix",
          },
        ],
      },
      { cwd: root, settings: SETTINGS, baseRules: BASE_RULES, commit: true }
    );
    check("an unrelated file outside every prong root cannot satisfy the orphaned link",
      links(r).dead.map((d) => d.target), ["Sword"]);
    check("the walk scope and the resolution scope are the same roots",
      links(r).roots, ["settings/rolara"]);
    check("the run does not commit", r.committed, false);
    check("HEAD is still the snapshot", head(root), before);
    check("and the archive copy is left exactly where it was", has(root, "archive/old/Sword.md"), true);
  }
);

withRepo(
  {
    "settings/rolara/items/Blade.md": article("publish: false\ntype: Item", "Twin of [[Karsk-Relic]]."),
    "settings/karsk/Karsk-Relic.md": article("publish: false\ntype: Item", "x"),
  },
  (root) => {
    // Scoping must not break the legitimate case it is often confused with: a
    // link into ANOTHER setting's prong root. Every setting's roots are walked,
    // so that link resolves.
    const r = assertLinkIntegrity({
      cwd: root,
      settings: [SETTINGS[0], { name: "karsk", kbRoot: "settings/karsk", rules: {} }],
      expectLinks: true,
    });
    check("a link into another setting's prong root still resolves", r.ok, true);
    check("because every setting's roots are walked", r.roots.slice().sort(),
      ["settings/karsk", "settings/rolara"]);
    check("and it was actually checked", r.linksChecked, 1);
  }
);

console.log("\nThe rewriter and the rail agree about quoted wikilinks");

{
  const doc = "Real: [[Sword]].\n\n```\n- [[Sword]]\n```\n\nInline `[[Sword]]` too.\n";
  const out = rewriteWikilinks(doc, "Sword", "Sword-ITEM");
  check("only the real wikilink is rewritten", out.count, 1);
  check("the fenced example is left exactly as the DM wrote it", out.text.includes("\n- [[Sword]]\n"), true);
  check("and so is the one inside a code span", out.text.includes("`[[Sword]]` too"), true);
  check("the real one did change", out.text.startsWith("Real: [[Sword-ITEM]]."), true);
}

withRepo(
  {
    "settings/rolara/items/Sword.md": article("publish: false\ntype: Item", "A blade."),
    "settings/rolara/docs/Style.md": article(
      "publish: false\ntype: Concept",
      "How we write links:\n\n```\n- [[Sword]]\n```\n"
    ),
    "settings/rolara/lore/Alpha.md": article("publish: false\ntype: Concept", "See [[Beta]]."),
    "settings/rolara/lore/Beta.md": article("publish: false\ntype: Concept", "x"),
  },
  (root) => {
    const styleBefore = read(root, "settings/rolara/docs/Style.md");
    const r = apply(root, [
      {
        op: "rename-with-link-rewrite",
        from: "settings/rolara/items/Sword.md",
        to: "settings/rolara/items/Sword-ITEM.md",
        links: ["settings/rolara/docs/Style.md"],
        reason: "suffix",
      },
    ]);
    check("a plan naming a file whose only wikilink is quoted reports the drop",
      [r.applied.length, r.failed.length], [0, 1]);
    check("and the DM's documentation is left byte-identical",
      read(root, "settings/rolara/docs/Style.md"), styleBefore);
    check("the rail does not flag that quoted example either, which is the agreement",
      links(r).dead, []);
    check("and it was not an empty walk", links(r).linksChecked, 1);
  }
);

console.log("\nThe documented recovery actually recovers");

const BLOCKED_OPERATIONS = [
  {
    op: "rename-with-link-rewrite",
    from: "settings/rolara/items/Sword.md",
    to: "settings/rolara/items/Sword-ITEM.md",
    reason: "suffix",
  },
  { op: "create-index", to: "settings/rolara/npcs/Npcs-INDEX.md", reason: "folder holds content but no index" },
];

withRepo(
  {
    "settings/rolara/items/Sword.md": article("publish: false\ntype: Item", "A blade."),
    "settings/rolara/items/Items-INDEX.md": article("publish: false\ntype: Index", "- [[Sword]]"),
    "settings/rolara/npcs/Guard.md": article("publish: false\ntype: NPC", "A guard."),
  },
  (root) => {
    const r = applyPlan(
      { operations: BLOCKED_OPERATIONS },
      { cwd: root, settings: SETTINGS, baseRules: BASE_RULES, commit: true }
    );
    check("the run is blocked before the commit", [links(r).ok, r.committed], [false, false]);

    const instruction = r.messages.find((m) => /Restore the tracked files/.test(m)) || "";
    check("the instruction names the untracked file reset --hard will leave behind",
      instruction.includes("settings/rolara/npcs/Npcs-INDEX.md"), true);
    check("and names the second command that removes it", /clean -fd/.test(instruction), true);

    // Followed exactly as printed, in order, and nothing else.
    git(root, ["reset", "--hard", "-q", r.snapshot]);
    check("reset --hard alone does NOT finish the job: it never staged what the run created",
      has(root, "settings/rolara/npcs/Npcs-INDEX.md"), true);
    git(root, ["clean", "-fd", "-q"]);
    check("the created index is gone once the whole instruction is followed",
      has(root, "settings/rolara/npcs/Npcs-INDEX.md"), false);
    check("the renamed article is back at its original path",
      [has(root, "settings/rolara/items/Sword.md"), has(root, "settings/rolara/items/Sword-ITEM.md")],
      [true, false]);
    check("the working tree is clean", porcelain(root), []);

    const pre = runPrechecks({ operations: BLOCKED_OPERATIONS, projectRoot: root });
    check("and the rerun's prechecks pass instead of aborting on the leftover",
      [pre.ok, pre.collisions.length], [true, 0]);
  }
);

console.log("\nWhat the snapshot will not undo is disclosed");

withRepo(
  {
    ".gitignore": "kb/editor-state/\n",
    "kb/items/Sword.md": article("publish: false\ntype: Item", "A blade."),
    "kb/items/Items-INDEX.md": article("publish: false\ntype: Index", "- [[Sword]]"),
    "kb/editor-state/scratch.md": "Untracked DM scratch.\n",
  },
  (root) => {
    // The skip rule tests the operation's SOURCE. kb/ is tracked, so the
    // relocation runs, and git mv carries the ignored directory inside it along
    // for the ride. That is not skipped and not refused; it is reported.
    const settings = [{ name: "rolara", kbRoot: "kb", rules: {} }];
    const operations = [{ op: "relocate-prong", from: "kb", to: "settings/rolara", reason: "canonical layout" }];

    const pre = runPrechecks({ operations, projectRoot: root });
    check("the prong root itself is not ignored, so nothing is skipped", pre.ignored, []);
    check("but the ignored paths beneath it are named",
      pre.ignoredBeneath.map((e) => e.entries.join(",")), ["kb/editor-state/"]);

    const r = apply(root, operations, { settings });
    check("the relocation still applies", [r.applied.length, r.skipped.length], [1, 0]);
    check("git mv carried the ignored file to the new path",
      has(root, "settings/rolara/editor-state/scratch.md"), true);
    check("the run reports the move, because restoring the snapshot will not put it back",
      r.ignoredMoved.map((e) => `${e.from} -> ${e.to}`), ["kb -> settings/rolara"]);
    check("in a message the DM will see", r.messages.some((m) => /editor-state/.test(m)), true);
  }
);

withRepo(
  {
    ".gitignore": "drafts/\n",
    "settings/rolara/items/Sword.md": article("publish: false\ntype: Item", "A blade."),
    "settings/rolara/items/Items-INDEX.md": article("publish: false\ntype: Index", "- [[Sword]]"),
    "drafts/Secret.md": "See [[Sword]].\n",
  },
  (root) => {
    // A git-ignored REFERRING file is edited rather than skipped, because the
    // rename breaks its wikilink either way and a repaired ignored file beats a
    // broken one. What makes that defensible is that the run says so.
    const r = apply(root, [
      {
        op: "rename-with-link-rewrite",
        from: "settings/rolara/items/Sword.md",
        to: "settings/rolara/items/Sword-ITEM.md",
        links: ["settings/rolara/items/Items-INDEX.md", "drafts/Secret.md"],
        reason: "suffix",
      },
    ]);
    check("the rename and both rewrites are one applied unit",
      [r.applied.length, r.failed.length, r.skipped.length], [1, 0, 0]);
    check("the ignored referring file is repaired rather than left holding a dead link",
      read(root, "drafts/Secret.md"), "See [[Sword-ITEM]].\n");
    check("the run names it, because git reset --hard will not undo that edit",
      r.ignoredEdits.map((e) => e.referrer), ["drafts/Secret.md"]);
    check("in a message the DM will see", r.messages.some((m) => /drafts\/Secret\.md/.test(m)), true);
    check("a tracked referrer is not reported as one of them",
      r.ignoredEdits.some((e) => /Items-INDEX/.test(e.referrer)), false);
  }
);

console.log("\nThe snapshot precedes every mutation");

withRepo(
  {
    "settings/rolara/items/Sword.md": article("publish: false\ntype: Item", "A blade."),
  },
  (root) => {
    // A dirty tree means the snapshot commit does not contain the current state,
    // so there is nothing to restore to. Refuse before touching anything.
    writeInto(root, "settings/rolara/items/Sword.md", article("publish: false\ntype: Item", "Edited."));
    const before = snapshotTree(root);
    const r = apply(root, [
      {
        op: "rename-with-link-rewrite",
        from: "settings/rolara/items/Sword.md",
        to: "settings/rolara/items/Sword-of-Dawn.md",
        reason: "suffix",
      },
    ]);
    check("a dirty working tree refuses the run", r.refused && r.refused.reason, "dirty-tree");
    check("nothing was applied", bucketTotal(r), 0);
    check("and the project is untouched", snapshotTree(root), before);
  }
);

withBareDir(
  {
    "settings/rolara/items/Sword.md": article("publish: false\ntype: Item", "A blade."),
  },
  (root) => {
    // No repository means no snapshot, and it also means the git-ignored
    // question cannot be answered: prechecks.ignored is null, which is NOT the
    // same claim as "nothing is ignored". Refuse rather than read it as empty.
    const before = snapshotTree(root);
    const r = apply(root, [
      {
        op: "rename-with-link-rewrite",
        from: "settings/rolara/items/Sword.md",
        to: "settings/rolara/items/Sword-of-Dawn.md",
        reason: "suffix",
      },
    ]);
    check("an undetermined ignored verdict refuses the run",
      r.refused && r.refused.reason, "ignored-undetermined");
    check("the refusal says the question could not be answered",
      /could not be determined/.test((r.refused || {}).detail || ""), true);
    check("nothing was applied", bucketTotal(r), 0);
    check("and the project is untouched", snapshotTree(root), before);
  }
);

console.log("\nA plan the apply phase will not execute");

withRepo(
  {
    "settings/rolara/items/Sword.md": article("publish: false\ntype: Item", "A blade."),
    "settings/rolara/items/Sword of Dawn.md": article("publish: false\ntype: Item", "Another blade."),
  },
  (root) => {
    const before = snapshotTree(root);
    const r = apply(root, [
      {
        op: "rename-with-link-rewrite",
        from: "settings/rolara/items/Sword.md",
        to: "settings/rolara/items/Sword-of-Dawn.md",
        reason: "charset",
      },
      {
        op: "rename-with-link-rewrite",
        from: "settings/rolara/items/Sword of Dawn.md",
        to: "settings/rolara/items/Sword-of-Dawn.md",
        reason: "charset",
      },
    ]);
    check("a collision refuses the run", r.refused && r.refused.reason, "collisions");
    check("nothing was applied", bucketTotal(r), 0);
    check("and the project is untouched", snapshotTree(root), before);
  }
);

withRepo(
  {
    "settings/rolara/items/Sword.md": article("publish: false\ntype: Item", "A blade."),
  },
  (root) => {
    const before = snapshotTree(root);
    // from and to are both present, so a lenient executor that fell back to a
    // move for an unrecognized kind would really move the file. Without them the
    // untouched assertion would hold no matter what the guard did.
    const unknown = apply(root, [
      {
        op: "obliterate",
        from: "settings/rolara/items/Sword.md",
        to: "settings/rolara/items/Gone.md",
        reason: "hand-edited into the plan",
      },
    ]);
    check("an operation kind the executor does not know refuses the run",
      unknown.refused && unknown.refused.reason, "unknown-operation");
    check("the refusal names the kind", /obliterate/.test((unknown.refused || {}).detail || ""), true);
    check("and the project is untouched", snapshotTree(root), before);

    // split and absorb are structural judgments about the DM's own material.
    // The plan phase puts them in `declined`; a hand-edited plan that promotes
    // one into `operations` is still refused here.
    const deferred = apply(root, [
      {
        op: "split",
        target: "settings/rolara/items",
        from: "settings/rolara/items",
        to: "settings/rolara/blades",
        reason: "hand-edited into the plan",
      },
    ]);
    check("a deferred operation promoted into the plan refuses the run",
      deferred.refused && deferred.refused.reason, "deferred-operation");
    check("the deferred refusal names the kind", /split/.test((deferred.refused || {}).detail || ""), true);
    check("and the project is still untouched", snapshotTree(root), before);
  }
);

withRepo(
  {
    "settings/rolara/history/First-Age.md": article("publish: false\ntype: chronology", "Long ago."),
  },
  (root) => {
    const before = snapshotTree(root);
    // A rename before its type normalization computes the suffix from a stale
    // type value. The declared order is the dependency order, so a plan handed
    // back out of order is refused rather than half-run.
    const r = apply(root, [
      {
        op: "rename-with-link-rewrite",
        from: "settings/rolara/history/First-Age.md",
        to: "settings/rolara/history/First-Age-CHRONOLOGY.md",
        reason: "suffix",
      },
      {
        op: "normalize-type",
        from: "settings/rolara/history/First-Age.md",
        typeFrom: "chronology",
        typeTo: "Chronology",
        reason: "enum",
      },
    ]);
    check("a plan whose operations are out of the declared order refuses the run",
      r.refused && r.refused.reason, "out-of-order");
    check("and the project is untouched", snapshotTree(root), before);
  }
);

console.log("\nNormalize type edits the value and nothing else");

withRepo(
  {
    "settings/rolara/history/First-Age.md":
      '---\npublish: false\ntype: "chronology"  # legacy lowercase\ntags: [era]\n---\n\nLong ago.\n',
  },
  (root) => {
    const r = apply(root, [
      {
        op: "normalize-type",
        from: "settings/rolara/history/First-Age.md",
        typeFrom: "chronology",
        typeTo: "Chronology",
        reason: "enum",
      },
    ]);
    check("the normalization is applied", r.applied.length, 1);
    const text = read(root, "settings/rolara/history/First-Age.md");
    check("the corrected value keeps the original quoting",
      text.includes('type: "Chronology"'), true);
    check("the inline comment survives", text.includes("# legacy lowercase"), true);
    check("no other field moved",
      text.split("\n").slice(1, 4), ["publish: false", 'type: "Chronology"  # legacy lowercase', "tags: [era]"]);
  }
);

withRepo(
  {
    "settings/rolara/history/First-Age.md": article("publish: false\ntype: Chronology", "Long ago."),
  },
  (root) => {
    // The plan carries typeFrom so the apply phase can match on it. A file that
    // no longer holds that value is a stale plan, and guessing is worse than
    // reporting.
    const r = apply(root, [
      {
        op: "normalize-type",
        from: "settings/rolara/history/First-Age.md",
        typeFrom: "chronology",
        typeTo: "Something-Else",
        reason: "enum",
      },
    ]);
    check("a type that no longer matches typeFrom is not rewritten", r.failed.length, 1);
    check("and the file is left exactly as it was",
      read(root, "settings/rolara/history/First-Age.md").includes("type: Chronology"), true);
  }
);

console.log("\nIndex creation and the tag registry");

withRepo(
  {
    "settings/rolara/culture/Feasts.md": article("publish: false\ntype: Concept", "x"),
    "settings/rolara/culture/Rites.md": article("publish: false\ntype: Concept", "x"),
  },
  (root) => {
    const r = apply(
      root,
      [
        {
          op: "create-index",
          to: "settings/rolara/culture/Culture-INDEX.md",
          reason: "folder holds content but no index",
        },
      ],
      { baseRules: BASE_RULES_DISTINCT_INDEX_TYPE }
    );
    check("the index is created", r.applied.length, 1);
    const text = read(root, "settings/rolara/culture/Culture-INDEX.md");
    check("its type comes from the suffix mapping the filename satisfies, not a hardcoded fallback",
      /^type: Folder Index$/m.test(text), true);
    check("it carries no publish field", /^publish\s*:/m.test(text), false);
    check("it lists every article in the folder",
      text.includes("[[Feasts]]") && text.includes("[[Rites]]"), true);
    check("and the links it writes all resolve",
      assertLinkIntegrity({ cwd: root, settings: SETTINGS }).ok, true);
  }
);

withRepo(
  {
    "settings/rolara/a/Alpha.md": article("publish: false\ntype: Concept\ntags: [faction, politics]", "x"),
    "settings/rolara/b/Beta.md": article("publish: false\ntype: Concept\ntags:\n  - faction\n  - trade", "x"),
    ".professor-orb/tag-registry.rolara.json": "{}\n",
  },
  (root) => {
    const r = apply(root, [
      {
        op: "tag-registry",
        to: ".professor-orb/tag-registry.rolara.json",
        reason: "regenerate",
      },
    ]);
    check("the registry is regenerated", r.applied.length, 1);
    check("counting both the inline and the block tag forms",
      parsed(read(root, ".professor-orb/tag-registry.rolara.json")),
      { faction: 2, politics: 1, trade: 1 });
  }
);

console.log("\nThe vault boundary");

withRepo(
  {
    "settings/rolara/a/Alpha.md": article("publish: false\ntype: Concept", "x"),
  },
  (root) => {
    const r = apply(root, [
      { op: "vault", to: "settings/rolara/.obsidian", reason: "one vault per setting" },
    ]);
    check("a vault is created", r.applied.length, 1);
    check("as a real directory Obsidian will recognize",
      has(root, "settings/rolara/.obsidian/app.json"), true);
  }
);

withRepo(
  {
    "settings/rolara/a/Alpha.md": article("publish: false\ntype: Concept", "x"),
    "settings/rolara/.obsidian/app.json": '{"theme":"obsidian"}\n',
  },
  (root) => {
    // A resync against a project whose vault is already there. This is the
    // ordinary second run, and the reference consumer is already in that state,
    // so the create shape has to be idempotent rather than destructive: the
    // marker is written only when absent, so the DM's own Obsidian settings
    // survive untouched.
    const r = apply(root, [
      { op: "vault", to: "settings/rolara/.obsidian", reason: "one vault per setting" },
    ]);
    check("a resync over an existing vault is not refused", r.refused, null);
    check("and applies as a no-op rather than failing", r.applied.length, 1);
    check("without overwriting the DM's own Obsidian settings",
      read(root, "settings/rolara/.obsidian/app.json"), '{"theme":"obsidian"}\n');
  }
);

withRepo(
  {
    "settings/rolara/a/Alpha.md": article("publish: false\ntype: Concept", "x"),
    "settings/rolara/.obsidian/app.json": "{}\n",
    "settings/karsk/.obsidian/app.json": '{"theme":"obsidian"}\n',
  },
  (root) => {
    // The MEASUREMENT behind keeping the vault MOVE shape checked in the plan
    // phase, driven through applyOperation so the plan-phase abort does not
    // stand in front of it. git mv onto a destination that is already a
    // directory does NOT fail: it reports success and moves the source INSIDE
    // the destination. That is why the destination-may-exist exemption covers
    // the create shape only; exempting the kind wholesale would let this land
    // silently and leave the setting with no vault where Obsidian looks.
    const entry = applyOperation(
      {
        op: "vault",
        from: "settings/rolara/.obsidian",
        to: "settings/karsk/.obsidian",
        reason: "move the vault",
      },
      {
        cwd: root,
        git: (argv) => {
          try {
            return { ok: true, stdout: git(root, argv), stderr: "" };
          } catch (err) {
            return { ok: false, stdout: "", stderr: String((err && (err.stderr || err.message)) || err) };
          }
        },
        settings: SETTINGS,
        baseRules: BASE_RULES,
        ruleSources: [BASE_RULES],
        settingForPath: () => SETTINGS[0],
      }
    );
    check("git mv onto an existing directory reports success rather than failing",
      entry.applied, true);
    check("while actually nesting the source inside the destination",
      has(root, "settings/karsk/.obsidian/.obsidian/app.json"), true);
    check("so the destination the setting needs is not the vault that moved",
      read(root, "settings/karsk/.obsidian/app.json"), '{"theme":"obsidian"}\n');
  }
);

console.log("\nEvery operation lands in exactly one bucket");

withRepo(
  {
    ".gitignore": "settings/rolara/editor-state/\n",
    "settings/rolara/editor-state/scratch.md": article("publish: false\ntype: Concept", "x"),
    "settings/rolara/history/First-Age.md": article("publish: false\ntype: chronology", "Long ago."),
    "settings/rolara/items/Sword.md": article("publish: false\ntype: Item", "A blade."),
    "settings/rolara/items/Items-INDEX.md": article("publish: false\ntype: Index", "- [[Sword]]"),
    "settings/rolara/locations/Tavern.md": "---\ntype: Location\ntags: [city]\n---\n\nA tavern.\n",
  },
  (root) => {
    const operations = [
      {
        op: "normalize-type",
        from: "settings/rolara/history/First-Age.md",
        typeFrom: "chronology",
        typeTo: "Chronology",
        reason: "enum",
      },
      {
        op: "rename-with-link-rewrite",
        from: "settings/rolara/editor-state/scratch.md",
        to: "settings/rolara/editor-state/Scratch-CONCEPT.md",
        reason: "suffix",
      },
      {
        op: "rename-with-link-rewrite",
        from: "settings/rolara/items/Sword.md",
        to: "settings/rolara/items/Sword-of-Dawn.md",
        links: ["settings/rolara/items/Items-INDEX.md"],
        reason: "suffix",
      },
      {
        op: "repair-frontmatter",
        from: "settings/rolara/locations/Tavern.md",
        insert: [],
        reorder: true,
        reason: "canonical order",
      },
    ];
    // One worker returns nothing at all, the shape validation-sweep's dropped
    // accounting exists for: a half-applied run must never read as complete.
    const droppingWorker = (op, ctx) => (op.op === "repair-frontmatter" ? null : applyOperation(op, ctx));
    const r = applyPlan(
      { operations },
      { cwd: root, settings: SETTINGS, baseRules: BASE_RULES, commit: false, worker: droppingWorker }
    );
    check("every operation is accounted for exactly once", bucketTotal(r), operations.length);
    check("the worker that returned nothing is counted as dropped, not as done",
      r.dropped.map((d) => d.op), ["repair-frontmatter"]);
    check("the ignored source is skipped", r.skipped.length, 1);
    check("the rest are applied", r.applied.length, 2);
    check("and the run is not reported ok while work was dropped", r.ok, false);
  }
);

withRepo(
  {
    "settings/rolara/items/Sword.md": article("publish: false\ntype: Item", "A blade."),
    "settings/rolara/items/Items-INDEX.md": article("publish: false\ntype: Index", "- [[Sword]]"),
    "settings/rolara/locations/Tavern.md": "---\ntype: Location\ntags: [city]\n---\n\nA tavern.\n",
  },
  (root) => {
    // A worker that throws must not escape mid-run: that would abandon the rest
    // of the plan, skip the link-integrity assertion, and return nothing at all
    // about a repository that has already been half-migrated.
    const throwingWorker = (op, ctx) => {
      if (op.op === "rename-with-link-rewrite") throw new Error("worker exploded");
      return applyOperation(op, ctx);
    };
    let raw = null;
    let escaped = null;
    try {
      raw = applyPlan(
        {
          operations: [
            {
              op: "rename-with-link-rewrite",
              from: "settings/rolara/items/Sword.md",
              to: "settings/rolara/items/Sword-of-Dawn.md",
              links: ["settings/rolara/items/Items-INDEX.md"],
              reason: "suffix",
            },
            {
              op: "repair-frontmatter",
              from: "settings/rolara/locations/Tavern.md",
              insert: [],
              reorder: true,
              reason: "canonical order",
            },
          ],
        },
        { cwd: root, settings: SETTINGS, baseRules: BASE_RULES, commit: false, worker: throwingWorker }
      );
    } catch (err) {
      escaped = err;
    }
    check("the throw does not escape applyPlan", escaped === null, true);
    const r = raw || { applied: [], failed: [], dropped: [], skipped: [], messages: [], linkIntegrity: null };
    check("a worker that throws is counted as a drop, not an escape",
      r.dropped.map((d) => d.op), ["rename-with-link-rewrite"]);
    check("the operations after it still run", r.applied.length, 1);
    check("the throw is reported",
      r.messages.some((m) => /worker exploded/.test(m)), true);
    check("and the link-integrity assertion still ran", links(r).ok, true);
  }
);

console.log("\nWikilink rewriting in isolation");

{
  const cases = [
    ["[[Sword]]", "[[Blade]]"],
    ["[[Sword|the sword]]", "[[Blade|the sword]]"],
    ["[[Sword\\|the sword]]", "[[Blade\\|the sword]]"],
    ["[[Sword#Origins]]", "[[Blade#Origins]]"],
    ["[[items/Sword]]", "[[items/Blade]]"],
    ["[[Sword.md]]", "[[Blade.md]]"],
    ["![[Sword]]", "![[Blade]]"],
    ["[[Swordfish]]", "[[Swordfish]]"],
    ["[[Sword of Dawn]]", "[[Sword of Dawn]]"],
  ];
  for (const [input, expected] of cases) {
    check(`rewrite ${input}`, rewriteWikilinks(input, "Sword", "Blade").text, expected);
  }
  check("a case-only rename rewrites the referring links too",
    rewriteWikilinks("[[items-index]]", "items-index", "items-INDEX").text, "[[items-INDEX]]");
  // Obsidian resolves wikilinks case-insensitively, so [[Items-Index]] is a
  // LIVE link to items-index.md and has to travel with the rename. The exact
  // spelling above matches whether or not the comparison folds case, so on its
  // own it proved nothing about the folding.
  check("and matching folds case, the way Obsidian resolves",
    rewriteWikilinks("[[Items-Index]]", "items-index", "items-INDEX").text, "[[items-INDEX]]");
}

console.log("\n=== relocate-path ===");

withRepo(
  {
    "settings/rolara/misc/Old-Note.md": article("type: Concept", "Body."),
    "settings/rolara/notes/Keep-INDEX.md": article("type: Index", "- [[Old-Note]]"),
  },
  (root) => {
    const r = apply(root, [
      { op: "relocate-path", from: "settings/rolara/misc/Old-Note.md", to: "settings/rolara/notes/Old-Note.md", reason: "scope" },
    ]);
    check("relocate-path applies", [r.ok, first(r.applied).applied], [true, true]);
    check("the file is at its destination", has(root, "settings/rolara/notes/Old-Note.md"), true);
    check("and gone from its source", has(root, "settings/rolara/misc/Old-Note.md"), false);
    // Obsidian resolves a wikilink by stem, so moving a file inside one vault
    // does not break a link to it. This asserts the link was left ALONE, which
    // is the correct behavior and easy to regress into a needless rewrite.
    check("a wikilink to it is untouched",
      read(root, "settings/rolara/notes/Keep-INDEX.md").includes("[[Old-Note]]"), true);
    check("git recorded a rename, not a delete plus an untracked file",
      porcelain(root).some((l) => l.startsWith("R")), true);
  }
);

withRepo({ "settings/rolara/A.md": article("type: Person", "Body.") }, (root) => {
  const r = apply(root, [
    { op: "relocate-path", from: "settings/rolara/A.md", to: "settings/rolara/A.md", reason: "x" },
  ]);
  // r.applied is [] when the move is declined, and [] is truthy, so
  // `r.applied || r.failed` would never fall through to r.failed. Chained off
  // .applied instead, the same way line 872 chains .detail across both
  // buckets: first({}).applied is undefined, which || correctly passes through
  // to first(r.failed).applied.
  check("a no-op move is reported, not applied",
    first(r.applied).applied || first(r.failed).applied, false);
});

console.log("\n=== rebuild-index ===");

withRepo(
  {
    "settings/rolara/items/Items-INDEX.md":
      "---\ntype: Index\npublish: false\n---\n\n# Items\n\nThe DM's own note about how this index is organised.\n\n- [[Sword]]\n- [[Gone-Article]]\n",
    "settings/rolara/items/Sword.md": article("type: Item", "Body."),
    "settings/rolara/items/Shield.md": article("type: Item", "Body."),
  },
  (root) => {
    const r = apply(root, [
      { op: "rebuild-index", to: "settings/rolara/items/Items-INDEX.md", folder: "settings/rolara/items", reason: "scope" },
    ]);
    const text = read(root, "settings/rolara/items/Items-INDEX.md");
    check("rebuild-index applies", [r.ok, first(r.applied).applied], [true, true]);
    check("an article present on disk but missing from the index is added", text.includes("[[Shield]]"), true);
    check("an article listed but no longer on disk is dropped", text.includes("[[Gone-Article]]"), false);
    check("an article that was already correct survives", text.includes("[[Sword]]"), true);
    // The DM's frontmatter and prose are not the index's link list and are not
    // this operation's business. A rebuild that regenerated the whole file would
    // silently delete publish: false and the note above the list, which is
    // exactly the "silent index rewrite" CONTEXT.md's avoid list names.
    check("the DM's frontmatter survives verbatim", text.includes("publish: false"), true);
    check("the DM's prose survives verbatim",
      text.includes("The DM's own note about how this index is organised."), true);
    check("the entries are sorted", text.indexOf("[[Shield]]") < text.indexOf("[[Sword]]"), true);
  }
);

withRepo(
  {
    "settings/rolara/items/Items-INDEX.md": article("type: Index", "# Items\n\n- [[Sword]]"),
    "settings/rolara/items/Sword.md": article("type: Item", "Body."),
    "settings/rolara/items/weapons/Weapons-INDEX.md": article("type: Index", "# Weapons"),
  },
  (root) => {
    const r = apply(root, [
      { op: "rebuild-index", to: "settings/rolara/items/Items-INDEX.md", folder: "settings/rolara/items", reason: "scope" },
    ]);
    const text = read(root, "settings/rolara/items/Items-INDEX.md");
    check("a sibling index is not listed as an article", text.includes("[[Weapons-INDEX]]"), false);
    // A subfolder is another index's territory, and listing its contents here
    // would put the same article in two indexes, violating singleOwnership.
    check("a subfolder's contents are not absorbed into the parent index",
      text.includes("[[Weapons]]"), false);
    check("the rebuild still applied", [r.ok, first(r.applied).applied], [true, true]);
  }
);

withRepo({ "settings/rolara/items/Sword.md": article("type: Item", "Body.") }, (root) => {
  const r = apply(root, [
    { op: "rebuild-index", to: "settings/rolara/items/Items-INDEX.md", folder: "settings/rolara/items", reason: "scope" },
  ]);
  // create-index is the operation that creates. Rebuilding a file that is not
  // there would quietly turn a stale plan into a new file the DM never approved.
  check("rebuilding an index that does not exist is reported, not created",
    [first(r.applied.concat(r.failed)).applied, has(root, "settings/rolara/items/Items-INDEX.md")],
    [false, false]);
});

console.log("\n=== absorb-folder ===");

withRepo(
  {
    "settings/rolara/Rolara-INDEX.md": article("type: Index", "- [[Misc-INDEX]]"),
    "settings/rolara/misc/Misc-INDEX.md": article("type: Index", "- [[Odds]]"),
    "settings/rolara/misc/Odds.md": article("type: Concept", "Body."),
  },
  (root) => {
    // The fixture's parent index carries a real inbound [[Misc-INDEX]] link, the
    // same shape the Step 1 plan fixture uses, and planAbsorbFolders always pairs
    // an absorb-folder with a rebuild-index on the parent for exactly that link.
    // Applying the absorb alone leaves it dangling and the link-integrity rail
    // correctly blocks the commit on it, so the paired op rides along here too:
    // this is what a real plan for this folder actually contains.
    const r = apply(root, [
      {
        op: "absorb-folder",
        from: "settings/rolara/misc",
        to: "settings/rolara",
        articles: [{ from: "settings/rolara/misc/Odds.md", to: "settings/rolara/Odds.md" }],
        index: "settings/rolara/misc/Misc-INDEX.md",
        reason: "scope",
      },
      { op: "rebuild-index", to: "settings/rolara/Rolara-INDEX.md", folder: "settings/rolara", reason: "scope" },
    ]);
    check("absorb-folder applies", [r.ok, first(r.applied).applied], [true, true]);
    check("the article is in the parent", has(root, "settings/rolara/Odds.md"), true);
    check("the folder's index is gone", has(root, "settings/rolara/misc/Misc-INDEX.md"), false);
    check("the article moved by git mv, not copy plus delete",
      porcelain(root).some((l) => l.startsWith("R")), true);
    check("the folder itself is gone", has(root, "settings/rolara/misc"), false);
  }
);

withRepo(
  {
    // A second, non-colliding article rides along so this case can actually
    // tell a precheck-time refusal apart from git mv's own destination-exists
    // refusal on Odds.md alone: with only one article, both mechanisms leave
    // the project identically untouched and the test cannot distinguish them.
    // Measured: with the precheck bypassed, applyAbsorbFolder moves Ends.md
    // (no collision) before it reaches Odds.md and fails, so "nothing moved"
    // catches that partial mutation while a single-article case would not.
    "settings/rolara/misc/Odds.md": article("type: Concept", "Body."),
    "settings/rolara/misc/Ends.md": article("type: Concept", "Body."),
    "settings/rolara/Odds.md": article("type: Concept", "A different article that already lives here."),
  },
  (root) => {
    const r = apply(root, [
      {
        op: "absorb-folder",
        from: "settings/rolara/misc",
        to: "settings/rolara",
        articles: [
          { from: "settings/rolara/misc/Ends.md", to: "settings/rolara/Ends.md" },
          { from: "settings/rolara/misc/Odds.md", to: "settings/rolara/Odds.md" },
        ],
        index: null,
        reason: "scope",
      },
    ]);
    // runPrechecks catches this before anything moves. Asserting the refusal
    // here as well as in the plan suite is deliberate: a hand-edited proposal
    // reaches applyPlan without ever passing through the planner.
    //
    // The reason is asserted alongside, because "nothing moved" alone only
    // discriminates the precheck refusal from git mv's own destination-exists
    // refusal while Ends.md happens to be listed FIRST. Reverse the array and
    // that assertion passes under a bypassed precheck again; the reason pins
    // the mechanism directly and survives a reorder.
    check("a basename collision in the parent refuses the whole run",
      [r.ok, r.refused && r.refused.reason], [false, "collisions"]);
    check("and nothing moved",
      [has(root, "settings/rolara/misc/Odds.md"),
       has(root, "settings/rolara/misc/Ends.md"),
       read(root, "settings/rolara/Odds.md").includes("A different article")],
      [true, true, true]);
  }
);

withRepo(
  {
    "settings/rolara/Rolara-INDEX.md": article("type: Index", "- [[Misc-INDEX]]"),
    "settings/rolara/misc/Misc-INDEX.md": article("type: Index", "- [[Odds]]"),
    "settings/rolara/misc/Odds.md": article("type: Concept", "Body. ![[Map.png]]"),
    "settings/rolara/misc/Map.png": "PNG",
    "settings/rolara/misc/notes.txt": "Loose notes.\n",
  },
  (root) => {
    const r = apply(root, [
      {
        op: "absorb-folder",
        from: "settings/rolara/misc",
        to: "settings/rolara",
        articles: [
          { from: "settings/rolara/misc/Map.png", to: "settings/rolara/Map.png" },
          { from: "settings/rolara/misc/Odds.md", to: "settings/rolara/Odds.md" },
          { from: "settings/rolara/misc/notes.txt", to: "settings/rolara/notes.txt" },
        ],
        index: "settings/rolara/misc/Misc-INDEX.md",
        reason: "scope",
      },
      { op: "rebuild-index", to: "settings/rolara/Rolara-INDEX.md", folder: "settings/rolara", reason: "scope" },
    ]);
    check("a non-markdown file moves with the articles", [r.ok, r.applied.length], [true, 2]);
    check("the image and the text file are in the parent",
      [has(root, "settings/rolara/Map.png"), has(root, "settings/rolara/notes.txt")], [true, true]);
    check("nothing is left behind to orphan",
      [has(root, "settings/rolara/misc"), lsFiles(root).includes("settings/rolara/misc/Map.png")],
      [false, false]);
    // The embed still resolves: Obsidian matches ![[Map.png]] by filename, and
    // both files moved into the same folder.
    check("the embed rides along beside the article that carries it",
      read(root, "settings/rolara/Odds.md").includes("![[Map.png]]"), true);
    // The rebuilt parent index lists articles, and a PNG is not one. Listing it
    // would put a [[Map]] wikilink in the index with no markdown behind it.
    const index = read(root, "settings/rolara/Rolara-INDEX.md");
    check("but the rebuilt parent index lists only the markdown",
      [index.includes("[[Odds]]"), /\[\[Map/.test(index), /\[\[notes/.test(index)],
      [true, false, false]);
  }
);

// git mv EMPTIES a folder; it does not remove it. Measured in a scratch repo:
// moving every tracked file out of misc/ leaves misc/ on disk, and adding a
// `git rm` of the last tracked file is what prunes it. So the index-present case
// above passes on a git side effect, and this shape, which planAbsorbFolders
// produces whenever no file matches the index suffix or the setting has no
// suffix, has no `git rm` in it at all.
withRepo({ "settings/rolara/misc/Odds.md": article("type: Concept", "Body.") }, (root) => {
  const r = apply(root, [
    {
      op: "absorb-folder",
      from: "settings/rolara/misc",
      to: "settings/rolara",
      articles: [{ from: "settings/rolara/misc/Odds.md", to: "settings/rolara/Odds.md" }],
      index: null,
      reason: "scope",
    },
  ]);
  check("an absorb with no index to remove still applies", [r.ok, first(r.applied).applied], [true, true]);
  check("the file is in the parent", has(root, "settings/rolara/Odds.md"), true);
  // Asserted as the executor's own end state rather than left to git's pruning:
  // an empty folder left behind is content-free content the sweep flags, and it
  // makes a later absorb of the PARENT decline as "holds a subfolder".
  check("and the emptied folder is removed rather than left standing",
    has(root, "settings/rolara/misc"), false);
});

withRepo(
  {
    "settings/rolara/misc/Odds.md": article("type: Concept", "Body."),
    "settings/rolara/misc/Ends.md": article("type: Concept", "Body."),
  },
  (root) => {
    const r = apply(root, [
      {
        op: "absorb-folder",
        from: "settings/rolara/misc",
        to: "settings/rolara",
        articles: [{ from: "settings/rolara/misc/Odds.md", to: "settings/rolara/Odds.md" }],
        index: null,
        reason: "scope",
      },
    ]);
    // A hand-edited plan can name fewer files than the folder holds. Emptiness
    // is verified before the folder goes, because removing it recursively would
    // delete a file the DM's approved proposal never named, and a half-absorbed
    // folder reported as absorbed is the failure the one-entry accounting
    // exists to prevent.
    check("a folder still holding an unnamed file is reported, not emptied",
      [r.ok, r.failed.length, has(root, "settings/rolara/misc/Ends.md")], [false, 1, true]);
  }
);

withRepo(
  {
    "settings/rolara/Rolara-INDEX.md": article("type: Index", "- [[Misc-INDEX]]\n- [[Notes-INDEX]]"),
    "settings/rolara/misc/Misc-INDEX.md": article("type: Index", "- [[Odds]]"),
    "settings/rolara/misc/Odds.md": article("type: Concept", "Body."),
    "settings/rolara/notes/Notes-INDEX.md": article("type: Index", "- [[Jot]]"),
    "settings/rolara/notes/Jot.md": article("type: Concept", "Body."),
  },
  (root) => {
    // The end-to-end half of the sibling-absorb case in the plan suite: two
    // stub folders into one parent is the ordinary shape of this feature, and
    // the DM approved ONE migration for it.
    const r = apply(root, [
      {
        op: "absorb-folder",
        from: "settings/rolara/misc",
        to: "settings/rolara",
        articles: [{ from: "settings/rolara/misc/Odds.md", to: "settings/rolara/Odds.md" }],
        index: "settings/rolara/misc/Misc-INDEX.md",
        reason: "scope",
      },
      {
        op: "absorb-folder",
        from: "settings/rolara/notes",
        to: "settings/rolara",
        articles: [{ from: "settings/rolara/notes/Jot.md", to: "settings/rolara/Jot.md" }],
        index: "settings/rolara/notes/Notes-INDEX.md",
        reason: "scope",
      },
      { op: "rebuild-index", to: "settings/rolara/Rolara-INDEX.md", folder: "settings/rolara", reason: "scope" },
    ]);
    check("two sibling absorbs into one parent apply in one run",
      [r.ok, r.applied.length], [true, 3]);
    check("both folders are gone",
      [has(root, "settings/rolara/misc"), has(root, "settings/rolara/notes")], [false, false]);
    check("and both files are in the parent",
      [has(root, "settings/rolara/Odds.md"), has(root, "settings/rolara/Jot.md")], [true, true]);
  }
);

withRepo(
  {
    ".gitignore": "settings/rolara/misc/Hidden.md\n",
    "settings/rolara/misc/Misc-INDEX.md": article("type: Index", "- [[Odds]]"),
    "settings/rolara/misc/Odds.md": article("type: Concept", "Body."),
    "settings/rolara/misc/Hidden.md": article("type: Concept", "A draft the DM keeps out of git."),
  },
  (root) => {
    const before = snapshotTree(root);
    const r = apply(root, [
      {
        op: "absorb-folder",
        from: "settings/rolara/misc",
        to: "settings/rolara",
        // Odds.md is listed FIRST deliberately. `git mv` on the ignored file
        // hard-fails with "not under version control", exit 128, so with the
        // skip missing the executor moves every PRECEDING file and then fails
        // mid-dissolution. Listing the ignored file first would leave the
        // project untouched by accident and hide that partial mutation.
        articles: [
          { from: "settings/rolara/misc/Odds.md", to: "settings/rolara/Odds.md" },
          { from: "settings/rolara/misc/Hidden.md", to: "settings/rolara/Hidden.md" },
        ],
        index: "settings/rolara/misc/Misc-INDEX.md",
        reason: "scope",
      },
    ]);
    // WHOLE, not per file. An ignored file has no snapshot, so it cannot move;
    // absorbing the rest would leave a half-dissolved folder holding one file
    // and no index, which is the failure the one-entry-per-dissolution
    // accounting exists to prevent.
    check("an absorb carrying a git-ignored file is skipped whole",
      [r.ok, r.skipped.length, r.applied.length, r.failed.length], [true, 1, 0, 0]);
    check("and the folder is left byte-identical", snapshotTree(root), before);
    // ignoredBeneath's reason says git mv carries them to the new path, which
    // this kind never does: it moves file by file. The accurate disclosure is
    // the skip above.
    check("the disclosure is the skip, not the directory-move note",
      r.ignoredMoved.length, 0);
  }
);

console.log("\n=== split-folder ===");

withRepo(
  {
    "settings/rolara/locations/Locations-INDEX.md": article("type: Index", "- [[Ashfall]]\n- [[Karsk]]"),
    "settings/rolara/locations/Ashfall.md": article("type: Location", "Body."),
    "settings/rolara/locations/Karsk.md": article("type: Location", "See [[Ashfall]]."),
  },
  (root) => {
    const r = apply(root, [
      {
        op: "split-folder",
        from: "settings/rolara/locations",
        buckets: [
          {
            folder: "settings/rolara/locations/north",
            name: "north",
            articles: [{ from: "settings/rolara/locations/Ashfall.md", to: "settings/rolara/locations/north/Ashfall.md" }],
          },
        ],
        reason: "scope",
      },
    ]);
    check("split-folder applies", [r.ok, first(r.applied).applied], [true, true]);
    check("the article is in its bucket", has(root, "settings/rolara/locations/north/Ashfall.md"), true);
    check("and gone from the parent", has(root, "settings/rolara/locations/Ashfall.md"), false);
    // Obsidian resolves by stem, so a link from a sibling that did not move
    // still resolves after the move. Left alone deliberately.
    check("a wikilink from an article that stayed is untouched",
      read(root, "settings/rolara/locations/Karsk.md").includes("[[Ashfall]]"), true);
    check("git recorded renames", porcelain(root).some((l) => l.startsWith("R")), true);
  }
);

withRepo(
  {
    "settings/rolara/locations/Ashfall.md": article("type: Location", "Body."),
    "settings/rolara/locations/Karsk.md": article("type: Location", "Body."),
  },
  (root) => {
    const r = apply(root, [
      {
        op: "split-folder",
        from: "settings/rolara/locations",
        buckets: [
          {
            folder: "settings/rolara/locations/north",
            name: "north",
            articles: [
              { from: "settings/rolara/locations/Ashfall.md", to: "settings/rolara/locations/north/Ashfall.md" },
              { from: "settings/rolara/locations/Nope.md", to: "settings/rolara/locations/north/Nope.md" },
            ],
          },
        ],
        reason: "scope",
      },
    ]);
    // One entry for the whole split, on the same principle a rename carries its
    // link rewrite: a split reported as done with one article left behind is
    // exactly what the per-operation accounting exists to prevent.
    const e = first(r.applied.concat(r.failed));
    check("a missing article fails the whole split entry", e.applied, false);
    check("and the detail names how far it got", /1 of 2/.test(e.detail || ""), true);
  }
);

// The bucket index the planner pairs with every split, applied in the same run.
// A fresh bucket folder is populated by the split and read by create-index, in
// that order, which is why APPLY_ORDER puts every index kind after the split.
withRepo(
  {
    "settings/rolara/locations/Locations-INDEX.md": article("type: Index", "- [[Ashfall]]\n- [[Karsk]]"),
    "settings/rolara/locations/Ashfall.md": article("type: Location", "Body."),
    "settings/rolara/locations/Karsk.md": article("type: Location", "Body."),
  },
  (root) => {
    const r = apply(root, [
      {
        op: "split-folder",
        from: "settings/rolara/locations",
        buckets: [
          {
            folder: "settings/rolara/locations/north",
            name: "north",
            articles: [{ from: "settings/rolara/locations/Ashfall.md", to: "settings/rolara/locations/north/Ashfall.md" }],
          },
          {
            folder: "settings/rolara/locations/south",
            name: "south",
            articles: [{ from: "settings/rolara/locations/Karsk.md", to: "settings/rolara/locations/south/Karsk.md" }],
          },
        ],
        reason: "scope",
      },
      { op: "create-index", to: "settings/rolara/locations/north/North-INDEX.md", reason: "scope" },
      { op: "create-index", to: "settings/rolara/locations/south/South-INDEX.md", reason: "scope" },
      {
        op: "rebuild-index",
        to: "settings/rolara/locations/Locations-INDEX.md",
        folder: "settings/rolara/locations",
        reason: "scope",
      },
    ]);
    check("a split and its three paired index operations all apply",
      [r.ok, r.applied.length], [true, 4]);
    // The index has to list what the split just put in the folder. Written
    // before the move it would list nothing, which is the ordering rule
    // APPLY_ORDER encodes.
    check("each bucket index lists the article the split moved in",
      [read(root, "settings/rolara/locations/north/North-INDEX.md").includes("[[Ashfall]]"),
       read(root, "settings/rolara/locations/south/South-INDEX.md").includes("[[Karsk]]")],
      [true, true]);
    // The parent index listed both articles and now holds neither: they live in
    // subfolders, which are another index's territory. Leaving them would put
    // each article in two indexes at once.
    const parent = read(root, "settings/rolara/locations/Locations-INDEX.md");
    check("and the parent index no longer claims the articles that left",
      [/\[\[Ashfall\]\]/.test(parent), /\[\[Karsk\]\]/.test(parent)], [false, false]);
  }
);

withRepo(
  {
    ".gitignore": "settings/rolara/locations/Hidden.md\n",
    "settings/rolara/locations/Ashfall.md": article("type: Location", "Body."),
    "settings/rolara/locations/Hidden.md": article("type: Location", "A draft the DM keeps out of git."),
  },
  (root) => {
    const before = snapshotTree(root);
    const r = apply(root, [
      {
        op: "split-folder",
        from: "settings/rolara/locations",
        buckets: [
          {
            // Ashfall.md is in the FIRST bucket deliberately. `git mv` on the
            // ignored file hard-fails with "not under version control", exit 128,
            // so with the skip blind to the bucket shape the executor moves every
            // PRECEDING article and then fails mid-partition. Putting the ignored
            // one first would leave the project untouched by accident and hide
            // that partial mutation.
            folder: "settings/rolara/locations/north",
            name: "north",
            articles: [{ from: "settings/rolara/locations/Ashfall.md", to: "settings/rolara/locations/north/Ashfall.md" }],
          },
          {
            folder: "settings/rolara/locations/south",
            name: "south",
            articles: [{ from: "settings/rolara/locations/Hidden.md", to: "settings/rolara/locations/south/Hidden.md" }],
          },
        ],
        reason: "scope",
      },
    ]);
    // WHOLE, not one bucket. The operation is the unit of accounting and the unit
    // the skip loop works in, and a split is one operation because the DM approved
    // one partition: applying the buckets that happen to hold no ignored article
    // would leave the tree matching neither the old shape nor the approved one,
    // with no partial entry to report it with.
    check("a split carrying a git-ignored article is skipped whole",
      [r.ok, r.skipped.length, r.applied.length, r.failed.length], [true, 1, 0, 0]);
    check("and the folder is left byte-identical", snapshotTree(root), before);
    check("the skip names the ignored article rather than the folder",
      String(first(r.skipped).detail).includes("settings/rolara/locations/Hidden.md"), true);
  }
);

console.log("\n=== a skipped scope entry takes every operation it emitted with it ===");

// The plan the PLANNER actually emits, not the bare operation. A split always
// arrives with one create-index per bucket and a rebuild of the folder's own
// index, and all four carry the split entry's group id. Measured before the
// grouped skip: the split was skipped whole and correctly, and then its three
// paired index operations ran anyway. applyCreateIndex writes through writeText,
// whose recursive mkdirSync CREATED the two bucket folders the skipped split never
// populated; the run reported ok true and committed them; and the planner then
// declined the documented "unignore it and re-run the same scope" retry, because
// those bucket folders now exist. The rebuild's reason also asserted that the
// folder "was split into 2 subfolder(s)", which was false for that run.
withRepo(
  {
    ".gitignore": "settings/rolara/locations/Hidden.md\n",
    "settings/rolara/locations/Locations-INDEX.md": article("type: Index", "- [[Ashfall]]\n- [[Hidden]]"),
    "settings/rolara/locations/Ashfall.md": article("type: Location", "Body."),
    "settings/rolara/locations/Hidden.md": article("type: Location", "A draft the DM keeps out of git."),
  },
  (root) => {
    const before = snapshotTree(root);
    const group = ["splitFolders[0]"];
    const r = apply(root, [
      {
        op: "split-folder",
        from: "settings/rolara/locations",
        buckets: [
          {
            folder: "settings/rolara/locations/north",
            name: "north",
            articles: [{ from: "settings/rolara/locations/Ashfall.md", to: "settings/rolara/locations/north/Ashfall.md" }],
          },
          {
            folder: "settings/rolara/locations/south",
            name: "south",
            articles: [{ from: "settings/rolara/locations/Hidden.md", to: "settings/rolara/locations/south/Hidden.md" }],
          },
        ],
        groups: group,
        reason: "scope",
      },
      { op: "create-index", to: "settings/rolara/locations/north/North-INDEX.md", groups: group, reason: "scope" },
      { op: "create-index", to: "settings/rolara/locations/south/South-INDEX.md", groups: group, reason: "scope" },
      {
        op: "rebuild-index",
        to: "settings/rolara/locations/Locations-INDEX.md",
        folder: "settings/rolara/locations",
        groups: group,
        reason: "scope",
      },
    ]);
    check("a skipped split takes its paired index operations with it",
      [r.ok, r.skipped.length, r.applied.length, r.failed.length], [true, 1, 0, 0]);
    check("so no empty bucket folder is created and the documented retry stays possible",
      [has(root, "settings/rolara/locations/north"), has(root, "settings/rolara/locations/south")],
      [false, false]);
    check("and the whole project is byte-identical", snapshotTree(root), before);
    check("the one skip item accounts for every operation the entry emitted",
      (first(r.skipped).ops || []).map((o) => o.op),
      ["split-folder", "create-index", "create-index", "rebuild-index"]);
    check("and the DM sees one item rather than four",
      [r.skipped.length, /git-ignored/.test(String(first(r.skipped).detail))], [1, true]);
  }
);

// The Task 3 shape of the same defect, carried in the finding ledger rather than
// fixed there because the fix is this cross-cutting one. Measured before it: the
// absorb was skipped whole, its paired parent rebuild ran anyway, and the parent
// index lost [[Misc-INDEX]] while settings/rolara/misc was still sitting on disk
// holding its own index. The rebuild's reason claimed the folder "was absorbed
// into it", which was false for that run.
withRepo(
  {
    ".gitignore": "settings/rolara/misc/Hidden.md\n",
    "settings/rolara/Rolara-INDEX.md": article("type: Index", "- [[Misc-INDEX]]"),
    "settings/rolara/misc/Misc-INDEX.md": article("type: Index", "- [[Odds]]"),
    "settings/rolara/misc/Odds.md": article("type: Concept", "Body."),
    "settings/rolara/misc/Hidden.md": article("type: Concept", "A draft the DM keeps out of git."),
  },
  (root) => {
    const before = snapshotTree(root);
    const group = ["absorbFolders[0]"];
    const r = apply(root, [
      {
        op: "absorb-folder",
        from: "settings/rolara/misc",
        to: "settings/rolara",
        articles: [
          { from: "settings/rolara/misc/Odds.md", to: "settings/rolara/Odds.md" },
          { from: "settings/rolara/misc/Hidden.md", to: "settings/rolara/Hidden.md" },
        ],
        index: "settings/rolara/misc/Misc-INDEX.md",
        groups: group,
        reason: "scope",
      },
      {
        op: "rebuild-index",
        to: "settings/rolara/Rolara-INDEX.md",
        folder: "settings/rolara",
        groups: group,
        reason: "scope",
      },
    ]);
    check("a skipped absorb takes its parent rebuild with it",
      [r.ok, r.skipped.length, r.applied.length, r.failed.length], [true, 1, 0, 0]);
    check("so the parent index still links the folder that survived",
      read(root, "settings/rolara/Rolara-INDEX.md").includes("[[Misc-INDEX]]"), true);
    check("and the whole project is byte-identical", snapshotTree(root), before);
  }
);

// A hand-edited plan that LOST its group ids. The ids are plain JSON, so a DM can
// delete them, and the decision is that a missing id degrades to per-operation
// skipping, which is exactly the 1.6.0 behaviour, rather than widening a skip to
// operations nothing connects it to.
withRepo(
  {
    ".gitignore": "settings/rolara/locations/Hidden.md\n",
    "settings/rolara/locations/Ashfall.md": article("type: Location", "Body."),
    "settings/rolara/locations/Hidden.md": article("type: Location", "A draft the DM keeps out of git."),
  },
  (root) => {
    const r = apply(root, [
      {
        op: "split-folder",
        from: "settings/rolara/locations",
        buckets: [
          {
            folder: "settings/rolara/locations/north",
            name: "north",
            articles: [{ from: "settings/rolara/locations/Hidden.md", to: "settings/rolara/locations/north/Hidden.md" }],
          },
        ],
        reason: "hand-edited, group id deleted",
      },
      { op: "create-index", to: "settings/rolara/locations/north/North-INDEX.md", reason: "hand-edited" },
    ]);
    check("a plan whose group ids were edited away does not crash and does not widen the skip",
      [r.refused, r.skipped.length, r.applied.length], [null, 1, 1]);
  }
);

// A hand-edited plan that DUPLICATED a group id onto operations no scope entry
// emitted together. That does widen the skip, because applyPlan cannot tell a
// deliberate group from a duplicated id, so the widening is DISCLOSED instead: the
// single report item names every operation it took with it.
withRepo(
  {
    ".gitignore": "settings/rolara/editor-state/\n",
    "settings/rolara/editor-state/scratch.md": article("type: Concept", "x"),
    "settings/rolara/locations/Ashfall.md": article("type: Location", "Body."),
  },
  (root) => {
    const before = snapshotTree(root);
    const r = apply(root, [
      {
        op: "relocate-path",
        from: "settings/rolara/editor-state/scratch.md",
        to: "settings/rolara/notes/scratch.md",
        groups: ["pathMoves[0]"],
        reason: "hand-edited",
      },
      {
        op: "relocate-path",
        from: "settings/rolara/locations/Ashfall.md",
        to: "settings/rolara/notes/Ashfall.md",
        groups: ["pathMoves[0]"],
        reason: "hand-edited, same id pasted twice",
      },
    ]);
    check("a duplicated group id widens the skip rather than crashing",
      [r.skipped.length, r.applied.length], [1, 0]);
    check("and the report names every operation the widening took with it",
      (first(r.skipped).ops || []).map((o) => o.to),
      ["settings/rolara/notes/scratch.md", "settings/rolara/notes/Ashfall.md"]);
    check("nothing moved", snapshotTree(root), before);
  }
);

// A hand-edit can also put an operation in a group whose ignored source sits on an
// operation reported under a DIFFERENT group of its own, which leaves the second
// item with no ignored path of its own to name. It still has to say why it was
// skipped: a skip that gives no reason is worse than one that reads unusually.
withRepo(
  {
    ".gitignore": "settings/rolara/editor-state/\n",
    "settings/rolara/editor-state/scratch.md": article("type: Concept", "x"),
    "settings/rolara/locations/Ashfall.md": article("type: Location", "Body."),
  },
  (root) => {
    const before = snapshotTree(root);
    const r = apply(root, [
      {
        op: "relocate-path",
        from: "settings/rolara/editor-state/scratch.md",
        to: "settings/rolara/notes/scratch.md",
        groups: ["pathMoves[0]", "pathMoves[1]"],
        reason: "hand-edited",
      },
      {
        op: "relocate-path",
        from: "settings/rolara/locations/Ashfall.md",
        to: "settings/rolara/notes/Ashfall.md",
        groups: ["pathMoves[1]"],
        reason: "hand-edited",
      },
    ]);
    check("an operation skipped through a sibling's group is still skipped",
      [r.skipped.length, r.applied.length], [2, 0]);
    check("and its item explains why rather than naming an empty path list",
      [/another operation from scope entry pathMoves\[1\]/.test(String(r.skipped[1].detail)),
       /Skipped:  is git-ignored/.test(String(r.skipped[1].detail))],
      [true, false]);
    check("and nothing moved either way", snapshotTree(root), before);
  }
);

console.log("\n=== a bucket article in the scope's own string syntax ===");

// `buckets[].articles` is a bare string array in the SCOPE key and an object array
// in the OPERATION, under the same field name, so a DM editing the proposal
// between the two phases has a documented reason to write the string form.
// Measured before this refusal: articleMovesOf dropped every string, the executor
// fell out of its loop with moved 0 and set applied true, and the paired
// create-index then created an empty bucket folder. "Split 0 article(s) across 2
// subfolder(s)" with ok true is a success report for a no-op, which is the worst
// outcome available here.
withRepo(
  {
    "settings/rolara/locations/Ashfall.md": article("type: Location", "Body."),
    "settings/rolara/locations/Karsk.md": article("type: Location", "Body."),
  },
  (root) => {
    const before = snapshotTree(root);
    const r = apply(root, [
      {
        op: "split-folder",
        from: "settings/rolara/locations",
        buckets: [{ folder: "settings/rolara/locations/north", name: "north", articles: ["Ashfall.md"] }],
        reason: "hand-edited",
      },
      { op: "create-index", to: "settings/rolara/locations/north/North-INDEX.md", reason: "hand-edited" },
    ]);
    check("a bucket article written as a bare string refuses the run",
      (r.refused || {}).reason, "malformed-operation");
    const detail = String((r.refused || {}).detail);
    check("and the refusal names the field and the shape it needs",
      [/articles/.test(detail), /from/.test(detail), /to/.test(detail), /Ashfall\.md/.test(detail)],
      [true, true, true, true]);
    check("nothing was touched", snapshotTree(root), before);
  }
);

withRepo(
  {
    "settings/rolara/locations/Ashfall.md": article("type: Location", "Body."),
  },
  (root) => {
    const before = snapshotTree(root);
    const r = apply(root, [
      {
        op: "split-folder",
        from: "settings/rolara/locations",
        buckets: [
          {
            folder: "settings/rolara/locations/north",
            name: "north",
            articles: [{ from: "settings/rolara/locations/Ashfall.md", to: "settings/rolara/locations/north/Ashfall.md" }],
          },
          null,
        ],
        reason: "hand-edited",
      },
    ]);
    check("a bucket that is not an object refuses the run too",
      (r.refused || {}).reason, "malformed-operation");
    check("and nothing was touched for that one either", snapshotTree(root), before);
  }
);

// The same silent drop by a different route: a field present but not an array reads
// as empty through list(), so every entry it was meant to name is invisible to the
// prechecks and to the executor alike, and the operation reports applied having
// moved nothing.
withRepo(
  {
    "settings/rolara/misc/Odds.md": article("type: Concept", "Body."),
  },
  (root) => {
    const before = snapshotTree(root);
    const r = apply(root, [
      {
        op: "absorb-folder",
        from: "settings/rolara/misc",
        to: "settings/rolara",
        articles: "settings/rolara/misc/Odds.md",
        reason: "hand-edited",
      },
    ]);
    check("an articles field that is not an array refuses the run",
      [(r.refused || {}).reason, /rather than an array/.test(String((r.refused || {}).detail))],
      ["malformed-operation", true]);
    check("and nothing was touched", snapshotTree(root), before);
  }
);

{
  // applyOperation is exported, so a caller can reach an executor without
  // applyPlan's preflight in front of it. entry.buckets is a DM-facing field a
  // later task renders, so a malformed bucket must not put a null in it.
  const entry = applyOperation(
    { op: "split-folder", from: "settings/rolara/locations", buckets: [null] },
    { cwd: HERE }
  );
  check("a malformed bucket never renders null into the entry's bucket list", entry.buckets, []);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  FAILED: ${f}`);
  process.exit(1);
}
