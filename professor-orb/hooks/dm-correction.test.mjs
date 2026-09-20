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

function runHook(prompt, cwd) {
  try {
    return execFileSync("node", [HOOK], {
      input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt, cwd: cwd || process.cwd(), session_id: "s1" }),
      encoding: "utf8",
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

// A fixture project with a conventions file and one report carrying the
// 2026-09-18 sentence in two places, the way it actually spread.
function makeFixture(name) {
  const dir = path.join(os.tmpdir(), `orb-corr-${name}-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, ".professor-orb"), { recursive: true });
  mkdirSync(path.join(dir, "session-reports", "adjustice", "clean-hands"), { recursive: true });
  writeFileSync(
    path.join(dir, ".professor-orb", "conventions.json"),
    JSON.stringify({
      schemaVersion: 3,
      settings: [{ name: "adjustice", kbRoot: "kb/adjustice", sessionReportsRoot: "session-reports/adjustice" }],
    })
  );
  writeFileSync(
    path.join(dir, "session-reports", "adjustice", "clean-hands", "2026-09-18-Clean-Hands-REPORT.md"),
    [
      "---",
      "type: Session Report",
      "---",
      "",
      "The reporter asked what the team was called, and they answered on camera.",
      "",
      "## NPCs",
      "",
      "- The reporter who survived the crash now knows the team's name.",
      "",
      "## Locations",
      "",
      "- The lab showed hints of research into superpowered plants.",
      "",
    ].join("\n")
  );
  return dir;
}

console.log("lane search:");
(function () {
  const dir = makeFixture("hits");
  const out = runHook("That NEVER happened, the reporter never asked what the team was called", dir);

  const cases = [
    ["names the report file", out.includes("2026-09-18-Clean-Hands-REPORT.md"), true],
    ["reports the body line", out.includes("The reporter asked what the team was called"), true],
    ["reports the NPC line", out.includes("now knows the team's name"), true],
    ["leaves an unrelated line out", out.includes("superpowered plants"), false],
    ["states the search is scope, not truth", out.includes("scope, not truth"), true],
    ["carries a file:line pointer", /2026-09-18-Clean-Hands-REPORT\.md:\d+/.test(out), true],
  ];
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
  rmSync(dir, { recursive: true, force: true });
})();

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
