#!/usr/bin/env node
// Regression suite for the AskUserQuestion option recorder.
//
// The recorder stores EVERY option offered, not only those selected. That is
// deliberate and it is what makes the optionEcho check cover the 2026-09-18
// case as the DM describes it: they state the option was never selected on
// their screen. Matching against the full offered set catches a phantom
// selection and a real one alike, and removes any dependence on the shape of
// tool_response.
//
// Run: node professor-orb/hooks/record-options.test.mjs

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), "record-options.mjs");

let passed = 0;
const failures = [];

function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++;
    console.log(`  [PASS] ${name}`);
  } else {
    failures.push(name);
    console.log(`  [FAIL] ${name}`);
    console.log(`         expected: ${JSON.stringify(expected)}`);
    console.log(`         actual:   ${JSON.stringify(actual)}`);
  }
}

function fixture(name) {
  const dir = path.join(os.tmpdir(), `orb-rec-${name}-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, ".professor-orb"), { recursive: true });
  mkdirSync(path.join(dir, "tmp"), { recursive: true });
  return dir;
}

// The recorder resolves os.tmpdir() from these variables (TEMP and TMP on
// Windows, TMPDIR elsewhere), so each fixture's record lands in its own tmp/.
function run(dir, sessionId, questions) {
  const tmp = path.join(dir, "tmp");
  execFileSync("node", [HOOK], {
    input: JSON.stringify({
      hook_event_name: "PostToolUse",
      tool_name: "AskUserQuestion",
      session_id: sessionId,
      cwd: dir,
      tool_input: { questions },
    }),
    encoding: "utf8",
    env: { ...process.env, TEMP: tmp, TMP: tmp, TMPDIR: tmp },
  });
}

function state(dir, sessionId) {
  const p = path.join(dir, "tmp", "professor-orb", `asked-options-${sessionId}.json`);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}

// Everything under the fixture's temp folder, so a case can assert that the
// recorder wrote nothing at all.
function tempEntries(dir) {
  return readdirSync(path.join(dir, "tmp"), { recursive: true }).map(String).sort();
}

const ASKED = [
  {
    question: "What happened in the aftermath?",
    header: "Aftermath",
    multiSelect: true,
    options: [
      { label: "Reporter asked the name", description: "The team answered on camera as the Neighborhood Watch Association" },
      { label: "Nothing on camera", description: "The crash site cleared without press" },
    ],
  },
];

console.log("recording:");
(function () {
  const dir = fixture("basic");
  run(dir, "s1", ASKED);
  const s = state(dir, "s1");
  check("both options recorded, selected or not", s?.options?.length, 2);
  check(
    "label and description joined",
    s?.options?.[0],
    "Reporter asked the name. The team answered on camera as the Neighborhood Watch Association"
  );
  check("the file name carries the session, so the record carries no session field", s !== null && "sessionId" in s, false);
  check("nothing is written inside the project", existsSync(path.join(dir, ".professor-orb", "asked-options.json")), false);
  rmSync(dir, { recursive: true, force: true });
})();

console.log("appending, and one file per session:");
(function () {
  const dir = fixture("append");
  run(dir, "s1", ASKED);
  run(dir, "s1", ASKED);
  check("same session appends", state(dir, "s1")?.options?.length, 4);
  run(dir, "s2", ASKED);
  check("a new session starts its own file", state(dir, "s2")?.options?.length, 2);
  check("the earlier session's file is untouched", state(dir, "s1")?.options?.length, 4);
  rmSync(dir, { recursive: true, force: true });
})();

console.log("a session id that is not a plain token writes nothing:");
(function () {
  for (const [i, bad] of ["../escape", "a/b", "a\\b", "s1.json", ""].entries()) {
    const dir = fixture(`bad-${i}`);
    run(dir, bad, ASKED);
    check(`session id ${JSON.stringify(bad)}: no file written`, tempEntries(dir), []);
    rmSync(dir, { recursive: true, force: true });
  }
  const dir = fixture("no-session");
  run(dir, undefined, ASKED);
  check("no session id: no file written", tempEntries(dir), []);
  rmSync(dir, { recursive: true, force: true });
})();

console.log("fail-silent contract:");
(function () {
  // No .professor-orb directory: setup never ran, so the recorder writes nothing.
  const bare = path.join(os.tmpdir(), `orb-rec-bare-${process.pid}`);
  rmSync(bare, { recursive: true, force: true });
  mkdirSync(path.join(bare, "tmp"), { recursive: true });
  run(bare, "s1", ASKED);
  check("no .professor-orb means no record", tempEntries(bare), []);
  rmSync(bare, { recursive: true, force: true });

  let threw = false;
  try {
    execFileSync("node", [HOOK], { input: "not json", encoding: "utf8" });
  } catch {
    threw = true;
  }
  check("malformed stdin exits 0", threw, false);

  const dir = fixture("silent");
  run(dir, "s1", [{ question: "q", header: "h", multiSelect: false, options: "not an array" }]);
  check("malformed questions writes nothing", tempEntries(dir), []);
  rmSync(dir, { recursive: true, force: true });
})();

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
