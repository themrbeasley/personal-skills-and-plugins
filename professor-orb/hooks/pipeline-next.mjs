#!/usr/bin/env node
// Stop hook: suggests the next session-pipeline step, deterministically.
//
// Reads .professor-orb/pipeline-state.json from the current working directory
// and, if the last completed step is recent, prints a one-line suggestion for
// what to run next. Purely mechanical: no model judgment, no conversation
// parsing. Never blocks (always exits 0).
//
// A second, independent read of .professor-orb/versioning.json (or the legacy
// .professor-orb/catalog-versioning.json, when versioning.json does not yet
// exist) decides whether a lane-command clause is appended to that base
// message. The base message always emits on its own; only the appended clause
// is conditional on the versioning marker. Both reads share the same
// fail-silent contract: a missing file, unreadable JSON, or unrecognized
// shape is treated as "no clause," never as a crash and never as a reason to
// suppress the base suggestion. This hook never writes or converts the
// versioning marker; it only reads it.

import { readFileSync } from "node:fs";
import path from "node:path";

const STALE_MS = 2 * 60 * 60 * 1000; // 2 hours

const NEXT_STEP_MESSAGES = {
  debrief:
    "Next: /prep can build a session brief, or /chronicler can update the KB from the session report.",
  prep: "Next: /content can write recaps and handouts, or /chronicler can update the KB.",
  chronicler:
    "Next: the kb-validator agent can audit the changes, and /timeline can record events in the campaign chronology.",
  content:
    "Next: /chronicler can update the KB if not done yet, or /timeline for chronology.",
  // "timeline" and any unrecognized lastStep intentionally have no entry;
  // absence means stay silent.
};

// Appended to the base message above only when a versioning marker exists and
// its mode is "git" or "github". Never appended on its own; a lastStep with
// no NEXT_STEP_MESSAGES entry stays silent regardless of this map, which is
// why "timeline" carries an entry here that this hook can never emit today
// (timeline never writes pipeline-state.json). The wording is settled and
// must stay byte-identical to skills/timeline/SKILL.md's handoff line.
const LANE_CLAUSES = {
  debrief: " /log can commit the session report.",
  content: " /log can commit the recap and handouts.",
  chronicler: " /scribe can commit the KB changes.",
  timeline: " /scribe can commit the chronology document.",
};

// Reads the versioning decision, fail-silent. Tries versioning.json first;
// falls back to the legacy catalog-versioning.json only when versioning.json
// itself is absent (ENOENT or similar). Never converts or writes either
// file; that conversion belongs to setup and /catalog alone. Returns the
// mode string on success, or null if no usable marker could be read.
function readVersioningMode(cwd) {
  const primaryPath = path.resolve(cwd, ".professor-orb", "versioning.json");
  const legacyPath = path.resolve(
    cwd,
    ".professor-orb",
    "catalog-versioning.json"
  );

  let raw;
  try {
    raw = readFileSync(primaryPath, "utf8");
  } catch {
    try {
      raw = readFileSync(legacyPath, "utf8");
    } catch {
      return null;
    }
  }

  let marker;
  try {
    marker = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!marker || typeof marker !== "object") {
    return null;
  }

  return typeof marker.mode === "string" ? marker.mode : null;
}

function main() {
  const statePath = path.resolve(
    process.cwd(),
    ".professor-orb",
    "pipeline-state.json"
  );

  let raw;
  try {
    raw = readFileSync(statePath, "utf8");
  } catch {
    // No state file. Nothing to suggest.
    process.exit(0);
  }

  let state;
  try {
    state = JSON.parse(raw);
  } catch {
    // Malformed state file. Fail silent rather than block.
    process.exit(0);
  }

  if (!state || typeof state !== "object") {
    process.exit(0);
  }

  const { lastStep, updatedAt } = state;

  if (typeof updatedAt !== "string") {
    process.exit(0);
  }

  const updatedAtMs = Date.parse(updatedAt);
  if (Number.isNaN(updatedAtMs)) {
    process.exit(0);
  }

  const ageMs = Date.now() - updatedAtMs;
  if (ageMs > STALE_MS) {
    // Stale, the suggestion is no longer relevant.
    process.exit(0);
  }

  if (typeof lastStep !== "string") {
    process.exit(0);
  }

  const message = NEXT_STEP_MESSAGES[lastStep];
  if (!message) {
    process.exit(0);
  }

  let output = message;
  const mode = readVersioningMode(process.cwd());
  if (mode === "git" || mode === "github") {
    const clause = LANE_CLAUSES[lastStep];
    if (clause) {
      output += clause;
    }
  }

  process.stdout.write(output + "\n");
  process.exit(0);
}

main();
