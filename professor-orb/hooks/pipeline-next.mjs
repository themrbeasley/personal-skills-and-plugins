#!/usr/bin/env node
// Stop hook: suggests the next session-pipeline step, deterministically.
//
// Reads .professor-orb/pipeline-state.json from the current working directory
// and, if the last completed step is recent, prints a one-line suggestion for
// what to run next. Purely mechanical: no model judgment, no conversation
// parsing. Never blocks (always exits 0).

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
  if (message) {
    process.stdout.write(message + "\n");
  }

  process.exit(0);
}

main();
