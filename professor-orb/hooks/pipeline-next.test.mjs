#!/usr/bin/env node
// Regression suite for the Stop hook's next-step suggestion.
//
// Drives the real hook as a child process against a disposable fixture
// project, exactly the way Claude Code invokes it: no stdin payload, the
// hook reads .professor-orb/pipeline-state.json (and, for the lane clause,
// .professor-orb/versioning.json) from its own process.cwd(). Node built-ins
// only, no test framework.
//
// The property under test matters more than usual for this hook: it must
// never SPEAK WRONGLY. A Stop hook that appends a lane clause when it should
// stay quiet is noise on every session. So every silence case here is
// asserted as carefully as every speaking case.
//
// Run: node professor-orb/hooks/pipeline-next.test.mjs

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), "pipeline-next.mjs");

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

function checkContains(name, haystack, needle, shouldContain) {
  const does = haystack.includes(needle);
  const ok = does === shouldContain;
  if (ok) {
    passed++;
    console.log(`  [PASS] ${name}`);
  } else {
    failures.push(name);
    console.log(`  [FAIL] ${name}`);
    console.log(`         expected ${JSON.stringify(needle)} contained: ${shouldContain}`);
    console.log(`         actual output: ${JSON.stringify(haystack)}`);
  }
}

// Deterministic per-case temp dir so parallel cases do not collide.
function hashOf(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

// Builds a disposable project directory, writes whichever fixture files are
// given, then fires the hook with that directory as its cwd (matching how
// the hook resolves process.cwd() for real). Returns stdout, exactly as the
// hook would print it into the Stop hook's transcript.
function runHook(caseName, { pipelineState, versioning, legacyVersioning } = {}) {
  const dir = path.join(os.tmpdir(), `orb-pipeline-next-${process.pid}-${Math.abs(hashOf(caseName))}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, ".professor-orb"), { recursive: true });

  if (pipelineState !== undefined) {
    const content = typeof pipelineState === "string" ? pipelineState : JSON.stringify(pipelineState);
    writeFileSync(path.join(dir, ".professor-orb", "pipeline-state.json"), content, "utf8");
  }
  if (versioning !== undefined) {
    const content = typeof versioning === "string" ? versioning : JSON.stringify(versioning);
    writeFileSync(path.join(dir, ".professor-orb", "versioning.json"), content, "utf8");
  }
  if (legacyVersioning !== undefined) {
    const content = typeof legacyVersioning === "string" ? legacyVersioning : JSON.stringify(legacyVersioning);
    writeFileSync(path.join(dir, ".professor-orb", "catalog-versioning.json"), content, "utf8");
  }

  try {
    const out = execFileSync("node", [HOOK], { cwd: dir, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: e.stdout || "" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function freshState(lastStep) {
  return { lastStep, sessionDate: "2026-07-28", updatedAt: new Date().toISOString() };
}

function report() {
  console.log(`\n${passed}/${passed + failures.length} expectations met.`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

const KB_VALIDATOR_SUGGESTION = "the kb-validator agent can audit the changes";
const PREP_BASELINE =
  "Next: /content can write recaps and handouts, or /chronicler can update the KB.\n";

console.log("=== speaking cases: lane clause appended ===");

{
  const r = runHook("chronicler-git-mode", {
    pipelineState: freshState("chronicler"),
    versioning: { mode: "git", decided: "2026-01-01" },
  });
  checkContains("chronicler + git mode: base kb-validator suggestion still present", r.out, KB_VALIDATOR_SUGGESTION, true);
  checkContains("chronicler + git mode: /scribe clause appended", r.out, "/scribe", true);
  check(
    "chronicler + git mode: clause wording is exact",
    r.out,
    "Next: the kb-validator agent can audit the changes, and /timeline can record events in the campaign chronology. /scribe can commit the KB changes.\n"
  );
}

{
  const r = runHook("chronicler-github-mode", {
    pipelineState: freshState("chronicler"),
    versioning: { mode: "github", decided: "2026-01-01" },
  });
  checkContains("chronicler + github mode: /scribe clause appended", r.out, "/scribe", true);
}

{
  const r = runHook("debrief-git-mode", {
    pipelineState: freshState("debrief"),
    versioning: { mode: "git", decided: "2026-01-01" },
  });
  checkContains("debrief + git mode: /log clause appended", r.out, "/log", true);
  check("debrief + git mode: clause wording is exact", r.out, "Next: /prep can build a session brief, or /chronicler can update the KB from the session report. /log can commit the session report.\n");
}

{
  const r = runHook("content-git-mode", {
    pipelineState: freshState("content"),
    versioning: { mode: "git", decided: "2026-01-01" },
  });
  checkContains("content + git mode: /log clause appended", r.out, "/log", true);
  check("content + git mode: clause wording is exact", r.out, "Next: /chronicler can update the KB if not done yet, or /timeline for chronology. /log can commit the recap and handouts.\n");
}

{
  // The legacy marker, alone (no versioning.json), must still be read: setup
  // and /catalog own the conversion, but the hook must not treat a project
  // that has only ever run /catalog (pre-conversion) as unversioned.
  const r = runHook("chronicler-legacy-marker", {
    pipelineState: freshState("chronicler"),
    legacyVersioning: { mode: "git", decided: "2026-01-01" },
  });
  checkContains("lone catalog-versioning.json in git mode: /scribe clause appended", r.out, "/scribe", true);
}

{
  // versioning.json takes precedence when both exist.
  const r = runHook("chronicler-both-markers-primary-wins", {
    pipelineState: freshState("chronicler"),
    versioning: { mode: "changelog", decided: "2026-01-01" },
    legacyVersioning: { mode: "git", decided: "2025-01-01" },
  });
  checkContains("versioning.json (changelog) wins over legacy marker (git): no /scribe", r.out, "/scribe", false);
  checkContains("versioning.json (changelog) present: base message still emits", r.out, KB_VALIDATOR_SUGGESTION, true);
}

console.log("\n=== silence cases: the hook must not speak wrongly ===");

{
  // No versioning marker of any kind.
  const r = runHook("chronicler-no-marker", {
    pipelineState: freshState("chronicler"),
  });
  checkContains("no versioning.json: base kb-validator suggestion still present", r.out, KB_VALIDATOR_SUGGESTION, true);
  checkContains("no versioning.json: no /scribe clause", r.out, "/scribe", false);
}

{
  // mode changelog: the DM explicitly declined version control.
  const r = runHook("chronicler-changelog-mode", {
    pipelineState: freshState("chronicler"),
    versioning: { mode: "changelog", decided: "2026-01-01" },
  });
  checkContains("mode changelog: base suggestion still present", r.out, KB_VALIDATOR_SUGGESTION, true);
  checkContains("mode changelog: no /scribe clause", r.out, "/scribe", false);
}

{
  // Malformed marker: invalid JSON.
  const r = runHook("chronicler-malformed-marker", {
    pipelineState: freshState("chronicler"),
    versioning: "{ this is not valid json",
  });
  checkContains("malformed versioning.json: base suggestion still present", r.out, KB_VALIDATOR_SUGGESTION, true);
  checkContains("malformed versioning.json: no /scribe clause", r.out, "/scribe", false);
}

{
  // Marker parses but is not a JSON object (an array).
  const r = runHook("chronicler-non-object-marker", {
    pipelineState: freshState("chronicler"),
    versioning: "[1, 2, 3]",
  });
  checkContains("versioning.json is a JSON array, not an object: no /scribe clause", r.out, "/scribe", false);
  checkContains("versioning.json is a JSON array: base suggestion still present", r.out, KB_VALIDATOR_SUGGESTION, true);
}

{
  // Marker is an object but mode is missing or not a string.
  const r = runHook("chronicler-mode-missing", {
    pipelineState: freshState("chronicler"),
    versioning: { decided: "2026-01-01" },
  });
  checkContains("versioning.json with no mode field: no /scribe clause", r.out, "/scribe", false);
}

{
  // Missing pipeline-state.json entirely: the whole hook stays silent, lane
  // clause or not.
  const r = runHook("no-pipeline-state", {
    versioning: { mode: "git", decided: "2026-01-01" },
  });
  check("no pipeline-state.json: completely silent", r.out, "");
}

{
  // lastStep with a base message but no lane clause: prep is unchanged from
  // today, even with a git-mode versioning marker on record.
  const r = runHook("prep-git-mode", {
    pipelineState: freshState("prep"),
    versioning: { mode: "git", decided: "2026-01-01" },
  });
  check("prep + git mode: output is byte-identical to today's baseline", r.out, PREP_BASELINE);
  checkContains("prep + git mode: no lane clause of any kind", r.out, "/log", false);
}

{
  // prep with no versioning marker at all: same baseline.
  const r = runHook("prep-no-marker", {
    pipelineState: freshState("prep"),
  });
  check("prep + no versioning.json: output is byte-identical to today's baseline", r.out, PREP_BASELINE);
}

{
  // lastStep "timeline": NEXT_STEP_MESSAGES has no "timeline" entry (timeline
  // never writes pipeline-state.json), so the whole hook must stay silent
  // regardless of the versioning marker. LANE_CLAUSES has no "timeline"
  // entry either; that wording belongs to timeline/SKILL.md's own handoff
  // line, not to this hook.
  const r = runHook("timeline-laststep-git-mode", {
    pipelineState: freshState("timeline"),
    versioning: { mode: "git", decided: "2026-01-01" },
  });
  check("lastStep timeline + git mode: silent (no NEXT_STEP_MESSAGES entry)", r.out, "");
}

{
  // An unrecognized lastStep stays silent too.
  const r = runHook("unrecognized-laststep", {
    pipelineState: freshState("some-future-step"),
    versioning: { mode: "git", decided: "2026-01-01" },
  });
  check("unrecognized lastStep: silent", r.out, "");
}

console.log("\n=== prototype pollution: a crafted or corrupted lastStep must not leak Object.prototype ===");

// A lastStep equal to an inherited Object.prototype property name is a
// different failure class from the "unrecognized lastStep" case above: on a
// plain object literal, bracket access for these names resolves to a truthy
// inherited value (an object or a native function), not undefined, which
// would defeat the "if (!message)" / "if (clause)" truthiness guards and
// print that inherited value's string coercion instead of staying silent.
// NEXT_STEP_MESSAGES and LANE_CLAUSES are both built with a null prototype
// specifically so none of these names resolve to anything. Every case here
// must produce total silence and exit 0, exactly like any other
// unrecognized lastStep.
for (const pollutedStep of ["__proto__", "toString", "constructor", "hasOwnProperty"]) {
  const r = runHook(`polluted-laststep-${pollutedStep}`, {
    pipelineState: freshState(pollutedStep),
    versioning: { mode: "git", decided: "2026-01-01" },
  });
  check(`lastStep "${pollutedStep}": silent, no inherited Object.prototype value leaks`, r.out, "");
  check(`lastStep "${pollutedStep}": exits 0`, r.code, 0);
}

report();
