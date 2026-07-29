#!/usr/bin/env node
// Executable companion to the 2026-07-28 professor-orb spec set.
//
// Two rounds of adversarial spec review kept producing blocking findings about
// git and filesystem semantics: exactly the class of claim prose cannot validate
// and a ten-line test settles permanently. This file is that test. Each
// expectation encodes OBSERVED behavior, so a passing run means the specs'
// mechanism claims still hold on this platform.
//
// Two expectations deliberately encode known defects rather than desired
// behavior, and are labelled DEFECT. When the underlying bug is fixed, those
// expectations flip and must be updated, which is the point: the fix cannot
// land silently.
//
//   1. lane-scoped commit that includes NEW files and excludes pre-staged foreign paths
//   2. .gitignore pattern anchoring for vaults nested under settings/<setting>/
//   3. move and rename authority, including case-only renames on this filesystem
//   4. the real hook's behavior under a v3 conventions.json (settings array, no kbRoot)
//
// Run: node proto.mjs

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, existsSync, renameSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

// Resolved from this file's own location, not hard-coded absolutely, so the
// suite always measures the hook belonging to the checkout it lives in. An
// absolute path silently measured a different checkout whenever this ran from
// a git worktree: the run reported PASS while never executing the code under
// test, which is precisely the class of confidently wrong answer this suite
// exists to rule out.
const HOOK = fileURLToPath(
  new URL("../../../professor-orb/hooks/validate-write.mjs", import.meta.url)
);

const results = [];
function check(name, actual, expected, note) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ name, pass, actual, expected, note });
  const tag = pass ? "PASS" : "FAIL";
  console.log(`  [${tag}] ${name}`);
  if (!pass) {
    console.log(`         expected: ${JSON.stringify(expected)}`);
    console.log(`         actual:   ${JSON.stringify(actual)}`);
  }
  if (note) console.log(`         note: ${note}`);
}

function git(cwd, args, allowFail = false) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (e) {
    if (allowFail) return { failed: true, status: e.status, stderr: (e.stderr || "").trim() };
    throw e;
  }
}

function freshRepo(label) {
  const dir = path.join(os.tmpdir(), `orb-proto-${label}-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "proto@example.invalid"]);
  git(dir, ["config", "user.name", "proto"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  return dir;
}

function write(dir, rel, content) {
  const abs = path.join(dir, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
  return abs;
}

function filesInHead(dir) {
  return git(dir, ["show", "--pretty=", "--name-only", "HEAD"]).split("\n").filter(Boolean).sort();
}

// ---------------------------------------------------------------------------
// 1. Lane-scoped commit
// ---------------------------------------------------------------------------
console.log("\n=== 1. lane-scoped commit ===");
{
  const dir = freshRepo("lane");

  // Baseline tracked content in all three lanes plus root.
  write(dir, "settings/rolara/Thoric.md", "old\n");
  write(dir, "homebrew/rolara/Bond.md", "old\n");
  write(dir, "session-reports/rolara/ashes/R1-REPORT.md", "old\n");
  write(dir, "README.md", "old\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-qm", "baseline"]);

  // Now: a NEW file and a MODIFIED file in the KB lane, plus churn elsewhere,
  // plus a foreign path the DM already staged themselves.
  write(dir, "settings/rolara/NewArticle.md", "new\n");          // new, in lane
  write(dir, "settings/rolara/Thoric.md", "modified\n");          // modified, in lane
  write(dir, "homebrew/rolara/NewEntry.md", "new\n");             // new, other lane
  write(dir, "session-reports/rolara/ashes/R1-REPORT.md", "mod\n"); // modified, other lane
  write(dir, "README.md", "modified\n");                          // modified, root
  git(dir, ["add", "--", "homebrew/rolara/NewEntry.md"]);         // PRE-STAGED FOREIGN PATH

  const LANE = "settings/rolara";

  // Candidate A, the mechanism spec 3 currently specifies: commit --only with a
  // pathspec, no prior add.
  const dirA = dir + "-A";
  execFileSync("git", ["clone", "-q", dir, dirA]);
  // Reproduce working state in the clone.
  write(dirA, "settings/rolara/NewArticle.md", "new\n");
  write(dirA, "settings/rolara/Thoric.md", "modified\n");
  git(dirA, ["config", "user.email", "proto@example.invalid"]);
  git(dirA, ["config", "user.name", "proto"]);
  const a = git(dirA, ["commit", "-q", "--only", "-m", "kb(rolara)", "--", LANE], true);
  const aFailed = !!(a && a.failed);
  const aHead = aFailed ? [] : filesInHead(dirA);
  check(
    "A (TRAP): `git commit --only -- <lane>` with no prior add SILENTLY OMITS new files",
    aFailed ? "COMMAND FAILED" : aHead.includes("settings/rolara/NewArticle.md"),
    false,
    aFailed
      ? `command failed: ${(a.stderr || "").split("\n")[0]}`
      : `committed only: ${JSON.stringify(aHead)}. No error, exit 0. New files are the ` +
        "primary artifact of every lane, so this fails at the common case."
  );

  // Candidate B: add the lane, then commit with the same pathspec.
  const b1 = git(dir, ["add", "--", LANE]);
  const b2 = git(dir, ["commit", "-q", "-m", "kb(rolara): lane only", "--only", "--", LANE], true);
  const bFailed = !!(b2 && b2.failed);
  const head = bFailed ? [] : filesInHead(dir);
  check(
    "B: `git add -- <lane>` then `git commit --only -- <lane>` commits new + modified in lane",
    head,
    ["settings/rolara/NewArticle.md", "settings/rolara/Thoric.md"],
    bFailed ? `command failed: ${(b2.stderr || "").split("\n")[0]}` : undefined
  );
  const stillStaged = bFailed
    ? []
    : git(dir, ["diff", "--cached", "--name-only"]).split("\n").filter(Boolean);
  check(
    "B: the pre-staged foreign path is NOT in the commit and is still staged",
    stillStaged,
    ["homebrew/rolara/NewEntry.md"],
    "the DM's own staging must survive untouched"
  );
  const stillDirty = git(dir, ["status", "--porcelain"]).split("\n").filter(Boolean).length;
  check("B: other lanes and root remain uncommitted", stillDirty > 0, true);
}

// ---------------------------------------------------------------------------
// 2. .gitignore anchoring
// ---------------------------------------------------------------------------
console.log("\n=== 2. .gitignore anchoring for nested vaults ===");
{
  const dir = freshRepo("ignore");
  write(dir, "settings/rolara/.obsidian/workspace.json", "{}\n");
  write(dir, "settings/rolara/.obsidian/plugins/foo/main.js", "//\n");
  write(dir, "settings/rolara/Thoric.md", "x\n");

  const isIgnored = (rel) => {
    const r = git(dir, ["check-ignore", "-q", "--", rel], true);
    return !(r && r.failed);
  };

  // The pattern the spec currently states.
  write(dir, ".gitignore", ".obsidian/workspace*.json\n.obsidian/plugins/\n");
  check(
    "spec's pattern `.obsidian/workspace*.json` ignores a vault at settings/<setting>/",
    isIgnored("settings/rolara/.obsidian/workspace.json"),
    false,
    "a mid-string slash anchors the pattern to the repo root, so it matches nothing nested"
  );
  check(
    "spec's pattern `.obsidian/plugins/` ignores nested plugin bundles",
    isIgnored("settings/rolara/.obsidian/plugins/foo/main.js"),
    false
  );

  // The corrected pattern.
  write(dir, ".gitignore", "**/.obsidian/workspace*.json\n**/.obsidian/plugins/\n");
  check(
    "corrected `**/.obsidian/workspace*.json` ignores the nested vault file",
    isIgnored("settings/rolara/.obsidian/workspace.json"),
    true
  );
  check(
    "corrected `**/.obsidian/plugins/` ignores nested plugin bundles",
    isIgnored("settings/rolara/.obsidian/plugins/foo/main.js"),
    true
  );
  check(
    "corrected pattern does not over-match real articles",
    isIgnored("settings/rolara/Thoric.md"),
    false
  );
}

// ---------------------------------------------------------------------------
// 3. Move and rename authority, including case-only renames
// ---------------------------------------------------------------------------
console.log("\n=== 3. move and case-only rename ===");
{
  const dir = freshRepo("move");
  write(dir, "settings/rolara/items/Sword.md", "x\n");
  write(dir, "settings/rolara/items/items-index.md", "x\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-qm", "baseline"]);

  // Plain rename to a different name: uncontroversial, establishes the baseline.
  const plain = git(dir, ["mv", "settings/rolara/items/Sword.md", "settings/rolara/items/Blade.md"], true);
  check("git mv to a different basename succeeds", !(plain && plain.failed), true);

  // Case-only rename, the case the spec calls out as hazardous on Windows.
  const direct = git(
    dir,
    ["mv", "settings/rolara/items/items-index.md", "settings/rolara/items/items-INDEX.md"],
    true
  );
  const directFailed = !!(direct && direct.failed);
  check(
    "git mv performs a case-only rename in one step (core.ignorecase=true)",
    directFailed ? "FAILED" : "ok",
    "ok",
    directFailed
      ? `failed here: ${(direct.stderr || "").split("\n")[0]} -- use the two-step fallback`
      : "so the spec's mandatory two-step is unnecessary; keep it only as a fallback"
  );

  // The two-step, kept as the fallback path when git mv does report an error.
  if (directFailed) {
    const tmp = "settings/rolara/items/__tmp-index.md";
    git(dir, ["mv", "settings/rolara/items/items-index.md", tmp]);
    const step2 = git(dir, ["mv", tmp, "settings/rolara/items/items-INDEX.md"], true);
    check("two-step case-only rename fallback succeeds", !(step2 && step2.failed), true);
  }
  const tracked = git(dir, ["ls-files"]).split("\n").filter(Boolean).sort();
  check(
    "final tracked set carries the corrected casing",
    tracked.includes("settings/rolara/items/items-INDEX.md"),
    true,
    `tracked: ${JSON.stringify(tracked)}`
  );

  // What a Write/Edit-only worker (the sweep's grant) could actually manage:
  // copy content to the new path, with no way to remove the original.
  const dir2 = freshRepo("writeonly");
  write(dir2, "kb/Sword.md", "content\n");
  git(dir2, ["add", "-A"]);
  git(dir2, ["commit", "-qm", "base"]);
  write(dir2, "kb/Blade.md", "content\n"); // copy, cannot delete
  const woStatus = git(dir2, ["status", "--porcelain"]).split("\n").filter(Boolean);
  check(
    "a Write-only worker leaves the original in place, duplicating the article",
    woStatus,
    ["?? kb/Blade.md"],
    "kb/Sword.md is still tracked and present, so a suffix rename would produce two " +
      "files claiming one article and a guaranteed basename collision. migrate.mjs's " +
      "workers need Bash for git mv, unlike validation-sweep.mjs's Read/Edit/Write workers."
  );

  // And a plain filesystem rename, for contrast: recoverable, but only if both
  // sides are staged.
  const dir3 = freshRepo("fsrename");
  write(dir3, "kb/Sword.md", "content\n");
  git(dir3, ["add", "-A"]);
  git(dir3, ["commit", "-qm", "base"]);
  renameSync(path.join(dir3, "kb/Sword.md"), path.join(dir3, "kb/Blade.md"));
  const fsStatus = git(dir3, ["status", "--porcelain"]).split("\n").filter(Boolean).sort();
  check(
    "a plain filesystem rename shows as delete plus untracked",
    fsStatus,
    ["?? kb/Blade.md", "D kb/Sword.md"],
    "coherent only if both sides are staged; git mv records one staged rename instead"
  );
}

// ---------------------------------------------------------------------------
// 4. The real hook under a v3 conventions.json
// ---------------------------------------------------------------------------
console.log("\n=== 4. real hook vs v3 conventions.json ===");
{
  if (!existsSync(HOOK)) {
    console.log("  [SKIP] hook not found at", HOOK);
  } else {
    const dir = freshRepo("hook");
    const article = write(
      dir,
      "settings/rolara/Bad.md",
      "---\ntype: NotARealType\n---\n\nbody\n"
    );

    const runHook = () => {
      const payload = JSON.stringify({
        cwd: dir,
        tool_name: "Write",
        tool_input: { file_path: article },
      });
      try {
        const out = execFileSync("node", [HOOK], {
          input: payload,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        });
        return { code: 0, out: out.trim(), err: "" };
      } catch (e) {
        return { code: e.status, out: (e.stdout || "").trim(), err: (e.stderr || "").trim() };
      }
    };

    const rules = {
      frontmatterTypeEnum: {
        category: "frontmatter",
        check: "enum",
        enforcement: "block",
        description: "type must be one of the recognized article types.",
        params: { field: "type", values: ["Person", "Location"] },
      },
    };

    // No conventions.json at all: the documented degrade-to-silent baseline.
    const none = runHook();
    check("no conventions.json: hook is silent, exit 0", [none.code, none.out, none.err], [0, "", ""]);

    // v2-shaped file with a top-level kbRoot: the hook should fire.
    write(
      dir,
      ".professor-orb/conventions.json",
      JSON.stringify({ version: 2, kbRoot: "settings/rolara", rules }, null, 2)
    );
    const v2 = runHook();
    check(
      "v2 file with top-level kbRoot: hook emits a violation",
      v2.code !== 0 || (v2.out + v2.err).length > 0,
      true,
      `exit ${v2.code}, output ${JSON.stringify((v2.out + v2.err).slice(0, 90))}`
    );

    // v3-shaped file: settings array, NO top-level kbRoot.
    write(
      dir,
      ".professor-orb/conventions.json",
      JSON.stringify(
        {
          version: 3,
          settings: [
            {
              name: "rolara",
              kbRoot: "settings/rolara",
              homebrewRoot: "homebrew/rolara",
              sessionReportsRoot: "session-reports/rolara",
              rules,
            },
          ],
        },
        null,
        2
      )
    );
    const v3 = runHook();
    check(
      "v3 file (settings array, no top-level kbRoot): hook is SILENT (DEFECT, must be fixed)",
      v3.code !== 0 || (v3.out + v3.err).length > 0,
      false,
      `exit ${v3.code}, output ${JSON.stringify((v3.out + v3.err).slice(0, 60))}. ` +
        "validate-write.mjs:717 requires a top-level kbRoot and exits 0 when it is absent, " +
        "so the v3 shape disables ALL write-time validation with no error. Phase 2 must " +
        "change that guard. When it does, flip this expectation to true."
    );
  }
}

// ---------------------------------------------------------------------------
console.log("\n=== summary ===");
const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} expectations met.`);
if (failed.length) {
  console.log("\nUnmet expectations (each is a spec claim that needs correcting):");
  for (const f of failed) console.log(`  - ${f.name}`);
}
process.exit(0);
