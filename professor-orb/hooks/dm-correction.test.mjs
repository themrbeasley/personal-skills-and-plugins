#!/usr/bin/env node
// Regression suite for the correction-detection hook.
//
// Drives the real hook as a child process the way Claude Code invokes it:
// UserPromptSubmit JSON on stdin, stdout injected into the turn as context.
// Node built-ins only, no test framework.
//
// The must-NOT-fire column matters as much as the must-fire column. This hook
// runs on every DM message, so a pattern list wide enough to catch ordinary
// conversation turns every turn into a lane grep.
//
// Run: node professor-orb/hooks/dm-correction.test.mjs

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), "dm-correction.mjs");
const MARKER = "reads as a correction";

let passed = 0;
const failures = [];

function runHook(prompt, cwd, envOverrides) {
  try {
    return execFileSync("node", [HOOK], {
      input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt, cwd: cwd || process.cwd(), session_id: "s1" }),
      encoding: "utf8",
      env: envOverrides ? { ...process.env, ...envOverrides } : process.env,
    });
  } catch (err) {
    // A non-zero exit is itself a failure of the fail-silent contract; surface
    // the output so the assertion below reports something legible.
    return `HOOK EXITED NON-ZERO: ${err.stdout || ""}${err.stderr || ""}`;
  }
}

function checkFires(prompt, shouldFire) {
  const out = runHook(prompt);
  const fired = out.includes(MARKER);
  if (fired === shouldFire) {
    passed++;
    console.log(`  [PASS] ${shouldFire ? "fires" : "silent"}: ${JSON.stringify(prompt)}`);
  } else {
    failures.push(prompt);
    console.log(`  [FAIL] expected ${shouldFire ? "fire" : "silence"}: ${JSON.stringify(prompt)}`);
    console.log(`         actual output: ${JSON.stringify(out)}`);
  }
}

console.log("must fire:");
[
  "This NEVER fucking happened",
  "that never happened",
  "the reporter thing didn't happen",
  "no that's wrong, the clan name came later",
  "that is incorrect",
  "that's not what I said",
  "I already told you they use they/them",
  "no, it was Pemberton who warned them",
  "you used the wrong pronouns for Psyche again",
].forEach((p) => checkFires(p, true));

console.log("must stay silent:");
[
  "what happened next?",
  "that's right, keep going",
  "I said yes to the first option",
  "never mind, let's move on",
  "write the recap",
  "the party never found the ledger, so they moved on",
  "was that wrong of them in character?",
  "No, it isn't a big deal, don't worry about it",
  "no, it was worth it in the end",
  "no, it is what it is",
  "",
].forEach((p) => checkFires(p, false));

console.log("fail-silent contract:");
(function () {
  const out = (() => {
    try {
      return execFileSync("node", [HOOK], { input: "not json at all", encoding: "utf8" });
    } catch (err) {
      return `HOOK EXITED NON-ZERO: ${err.stdout || ""}${err.stderr || ""}`;
    }
  })();
  if (out === "") {
    passed++;
    console.log("  [PASS] malformed stdin exits 0 with no output");
  } else {
    failures.push("malformed stdin");
    console.log(`  [FAIL] malformed stdin produced: ${JSON.stringify(out)}`);
  }
})();

import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";

// A disposable fixture project: a conventions file carrying `settings`, plus
// every entry of `files` written at its path relative to the project root.
function project(name, settings, files) {
  const dir = path.join(os.tmpdir(), `orb-corr-${name}-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, ".professor-orb"), { recursive: true });
  writeFileSync(
    path.join(dir, ".professor-orb", "conventions.json"),
    JSON.stringify({ schemaVersion: 3, settings })
  );
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return dir;
}

// Every fixture file here is markdown with frontmatter.
const md = (type, ...lines) => ["---", `type: ${type}`, "---", "", ...lines, ""].join("\n");

// Scores one block's [name, actual, expected] triples. `out` is echoed on a
// failure so the diagnosis does not need a rerun.
function report(cases, out) {
  for (const [name, actual, expected] of cases) {
    if (actual === expected) {
      passed++;
      console.log(`  [PASS] ${name}`);
    } else {
      failures.push(name);
      console.log(`  [FAIL] ${name}: expected ${expected}, got ${actual}`);
      console.log(`         output: ${JSON.stringify(out)}`);
    }
  }
}

console.log("lane search:");
(function () {
  const dir = project(
    "hits",
    [{ name: "adjustice", kbRoot: "kb/adjustice", sessionReportsRoot: "session-reports/adjustice" }],
    {
      "session-reports/adjustice/clean-hands/2026-09-18-Clean-Hands-REPORT.md": md(
        "Session Report",
        "The reporter asked what the team was called, and they answered on camera.",
        "",
        "## NPCs",
        "",
        "- The reporter who survived the crash now knows the team's name.",
        "",
        "## Locations",
        "",
        "- The lab showed hints of research into superpowered plants."
      ),
    }
  );
  const out = runHook("That NEVER happened, the reporter never asked what the team was called", dir);

  const cases = [
    ["names the report file", out.includes("2026-09-18-Clean-Hands-REPORT.md"), true],
    ["reports the body line", out.includes("The reporter asked what the team was called"), true],
    ["reports the NPC line", out.includes("now knows the team's name"), true],
    ["leaves an unrelated line out", out.includes("superpowered plants"), false],
    ["states the search is scope, not truth", out.includes("scope, not truth"), true],
    ["carries a file:line pointer", /2026-09-18-Clean-Hands-REPORT\.md:\d+/.test(out), true],
  ];
  report(cases, out);
  rmSync(dir, { recursive: true, force: true });
})();

console.log("a correction the hook cannot locate still speaks:");
(function () {
  const dir = path.join(os.tmpdir(), `orb-corr-bare-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const out = runHook("That never happened", dir);
  const cases = [
    ["still says it read as a correction", out.includes(MARKER), true],
    ["says nothing matched", out.includes("No line in the campaign lane matched"), true],
    ["does not claim a hit", /:\d+\s\s/.test(out), false],
  ];
  report(cases, out);
  rmSync(dir, { recursive: true, force: true });
})();

console.log("a large first root must not starve a later root's budget:");
(function () {
  // Reproduces the real defect at a small, fast scale via the env override:
  // two settings, the first with enough filler files to exhaust a small
  // per-root share on its own, the second holding the real target in a
  // single file. Before the fix, MAX_FILES was a shared global pool, so the
  // first root alone could (and on the real 1855-article consumer project,
  // did) exhaust it before the second root's own, much smaller content was
  // ever reached.
  const dir = project(
    "starve",
    [
      { name: "big", kbRoot: "settings/big" },
      { name: "small", sessionReportsRoot: "session-reports/small" },
    ],
    {
      ...Object.fromEntries(
        Array.from({ length: 60 }, (_, i) => [
          `settings/big/filler-${i}.md`,
          md("Person", "Nothing relevant here, filler content only."),
        ])
      ),
      "session-reports/small/Adjustice/2026-09-18-Clean-Hands-REPORT.md": md(
        "Session Report",
        "The reporter asked what the team was called, and they answered on camera."
      ),
    }
  );
  // findHits floors perRootCap at 50 (Math.max(50, ...)) regardless of how low
  // MAX_FILES goes, so a 2-root split cannot be driven below 50 by the env
  // override alone; "big" ships 60 filler files, comfortably over that floor,
  // so walking it alone truncates and sets `truncated`, while the outer loop
  // still moves on to walk "small" in full and finds the real target.
  const out = runHook(
    "that never happened, the reporter never asked what the team was called",
    dir,
    { DM_CORRECTION_MAX_FILES: "10" }
  );
  const cases = [
    ["finds the target in the second, small root despite a large first root", out.includes("2026-09-18-Clean-Hands-REPORT.md"), true],
    ["does not falsely claim completeness when a root was truncated", out.includes("may be incomplete"), true],
  ];
  report(cases, out);
  rmSync(dir, { recursive: true, force: true });
})();

console.log("a noisy first root must not fill the whole hit budget:");
(function () {
  // The same starvation as the test above, one level down. That one proves a
  // large early root cannot consume every root's FILE budget. This one proves
  // it cannot consume every root's share of the 20 HITS the DM is shown:
  // before the fix, both roots were walked, but the first root's matches
  // filled the shared hit array before the second root's were recorded.
  // Measured on the real consumer project: 12 of 20 hits were coincidental
  // matches in the first setting, and the target file never appeared.
  //
  // The filler here MATCHES the search, unlike the file-count test's inert
  // filler, because hit starvation needs hits. 30 files is well over the
  // 20-hit budget and well under the 50-file per-root floor, so the file cap
  // never fires and this test isolates the hit budget.
  const dir = project(
    "hitstarve",
    [
      { name: "noisy", kbRoot: "settings/noisy" },
      { name: "quiet", sessionReportsRoot: "session-reports/quiet" },
    ],
    {
      ...Object.fromEntries(
        Array.from({ length: 30 }, (_, i) => [
          `settings/noisy/noisy-${i}.md`,
          md("Person", "The reporter asked what the team was called here too."),
        ])
      ),
      "session-reports/quiet/Adjustice/2026-09-18-Clean-Hands-REPORT.md": md(
        "Session Report",
        "The reporter asked what the team was called, and they answered on camera."
      ),
    }
  );
  const out = runHook("that never happened, the reporter never asked what the team was called", dir);
  const cases = [
    ["finds the target in the quiet root despite 30 matching files in the noisy one", out.includes("2026-09-18-Clean-Hands-REPORT.md"), true],
    ["says so when the hit budget itself cut the list short", out.includes("may be incomplete"), true],
    ["still fills the budget rather than under-reporting", (out.match(/^ {2}\S+:\d+ {2}/gm) || []).length === 20, true],
  ];
  report(cases, out);
  rmSync(dir, { recursive: true, force: true });
})();

console.log("one noisy file does not crowd out its siblings:");
(function () {
  // The within-root half of the same property. A single file with many
  // matching lines must not consume its root's whole share: on the real
  // project the target root's own prep file held seven matches ahead of the
  // report file in walk order, which is why a per-root hit share alone would
  // still have missed the report.
  const dir = path.join(os.tmpdir(), `orb-corr-filestarve-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, ".professor-orb"), { recursive: true });
  mkdirSync(path.join(dir, "session-reports", "one", "Adjustice", "prep"), { recursive: true });
  mkdirSync(path.join(dir, "session-reports", "one", "Adjustice", "reports"), { recursive: true });
  writeFileSync(
    path.join(dir, ".professor-orb", "conventions.json"),
    JSON.stringify({
      schemaVersion: 3,
      settings: [{ name: "one", sessionReportsRoot: "session-reports/one" }],
    })
  );
  // "prep" sorts before "reports", and carries far more matching lines.
  writeFileSync(
    path.join(dir, "session-reports", "one", "Adjustice", "prep", "2026-09-18-PREP.md"),
    ["---", "type: Session Prep", "---", ""]
      .concat(Array.from({ length: 40 }, (_, i) => `Line ${i}: the reporter asked what the team was called.`))
      .join("\n") + "\n"
  );
  writeFileSync(
    path.join(dir, "session-reports", "one", "Adjustice", "reports", "2026-09-18-Clean-Hands-REPORT.md"),
    "---\ntype: Session Report\n---\n\nThe reporter asked what the team was called, and they answered on camera.\n"
  );
  const out = runHook("that never happened, the reporter never asked what the team was called", dir);
  const cases = [
    ["the report file appears despite a 40-match prep file walked first", out.includes("Clean-Hands-REPORT.md"), true],
    ["the prep file is capped rather than taking every slot", (out.match(/2026-09-18-PREP\.md:/g) || []).length <= 5, true],
  ];
  report(cases, out);
  rmSync(dir, { recursive: true, force: true });
})();

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
