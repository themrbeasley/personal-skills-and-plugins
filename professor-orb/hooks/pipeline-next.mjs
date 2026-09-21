#!/usr/bin/env node
// Stop hook: suggests the next session-pipeline step, deterministically.
//
// Pipeline state is kept per campaign, at
// <sessionReportsRoot>/<campaign>/pipeline-state.json, so it reaches main in
// the campaign's own /log commit and two campaigns never share a slot. This
// hook reads .professor-orb/conventions.json from the current working
// directory for each setting's sessionReportsRoot, reads the state file in
// every folder directly under that root, and prints one line per campaign
// whose last completed step is recent: the campaign's folder name, then the
// suggestion. Purely mechanical: no model judgment, no conversation parsing.
// Never blocks (always exits 0).
//
// Before 1.20.0 the state was one shared .professor-orb/pipeline-state.json
// naming no campaign, and a skill could record one campaign's work against
// another campaign's session. This hook does not read that file; setup's
// resync deletes it.
//
// A second, independent read of .professor-orb/versioning.json (or the legacy
// .professor-orb/catalog-versioning.json, when versioning.json does not yet
// exist) decides whether a lane-command clause is appended to each base
// message. The base message always emits on its own; only the appended clause
// is conditional on the versioning marker. Every read shares the same
// fail-silent contract: a missing file, unreadable JSON, or unrecognized shape
// is treated as "nothing to say" for that read, never as a crash, and never as
// a reason to suppress another campaign's line. This hook never writes or
// converts the versioning marker; it only reads it.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const STALE_MS = 2 * 60 * 60 * 1000; // 2 hours

// Both maps below are built with a null prototype (the "__proto__: null"
// object-literal key sets the object's own [[Prototype]] to null; it does
// not create an own "__proto__" property). This is structural, not a guard:
// a plain object literal inherits from Object.prototype, so a corrupted or
// crafted lastStep such as "__proto__", "toString", "constructor", or
// "hasOwnProperty" would resolve to a truthy inherited value (an object or a
// native function) on an ordinary "{}"-style map, defeating the truthiness
// checks below and printing that inherited value's string coercion instead
// of staying silent. With no prototype chain to inherit from, a lookup by
// any name that is not one of this map's own keys returns undefined, no
// matter what Object.prototype happens to expose.
const NEXT_STEP_MESSAGES = {
  __proto__: null,
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
// no NEXT_STEP_MESSAGES entry stays silent regardless of this map. There is
// no "timeline" entry: timeline never writes pipeline state, so
// NEXT_STEP_MESSAGES has no "timeline" key and this hook can never reach
// this map with that lastStep in the first place. The chronology-document
// lane wording belongs to timeline/SKILL.md's own handoff line, not here.
const LANE_CLAUSES = {
  __proto__: null,
  debrief: " /log can commit the session report.",
  content: " /log can commit the recap and handouts.",
  // Chronicler writes in two lanes now: kbRoot articles that /scribe commits,
  // and staged articles in the campaign's articles/ folder that /log commits.
  // The hook reads only pipeline state, conventions.json's settings, and
  // versioning.json, so it cannot know the run's mode; naming both
  // unconditionally is the only correct shape.
  chronicler: " /scribe can commit the KB changes, and /log the campaign's staged articles.",
};

// Parses a JSON file, or returns null for a missing or unreadable one.
function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

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

  if (!marker || typeof marker !== "object" || Array.isArray(marker)) {
    return null;
  }

  return typeof marker.mode === "string" ? marker.mode : null;
}

// One campaign's suggestion, or null when its state has nothing to say: not
// an object, no parseable updatedAt, older than STALE_MS, or a lastStep with
// no NEXT_STEP_MESSAGES entry. A null silences this campaign only.
function suggestionFor(state, mode) {
  if (!state || typeof state !== "object") return null;
  const { lastStep, updatedAt } = state;
  if (typeof updatedAt !== "string") return null;
  const updatedAtMs = Date.parse(updatedAt);
  if (Number.isNaN(updatedAtMs)) return null;
  // Stale, the suggestion is no longer relevant.
  if (Date.now() - updatedAtMs > STALE_MS) return null;
  if (typeof lastStep !== "string") return null;
  const message = NEXT_STEP_MESSAGES[lastStep];
  if (!message) return null;
  const clause = mode === "git" || mode === "github" ? LANE_CLAUSES[lastStep] : undefined;
  return clause ? message + clause : message;
}

function main() {
  const cwd = process.cwd();
  const conventions = readJson(path.resolve(cwd, ".professor-orb", "conventions.json"));
  // A v1 or v2 file has no settings array and so no sessionReportsRoot to
  // look under. Silent until setup resyncs it to v3.
  const settings =
    conventions && Array.isArray(conventions.settings) ? conventions.settings : [];
  const mode = readVersioningMode(cwd);

  const lines = [];
  for (const setting of settings) {
    const root = setting && setting.sessionReportsRoot;
    if (typeof root !== "string" || root.length === 0) continue;
    let names;
    try {
      names = readdirSync(path.resolve(cwd, root)).sort();
    } catch {
      continue;
    }
    // A plain file under the root (an index, say) has no state file inside
    // it, so its read returns null and it is skipped like any campaign that
    // has not run a pipeline step yet.
    for (const name of names) {
      const state = readJson(path.resolve(cwd, root, name, "pipeline-state.json"));
      const line = suggestionFor(state, mode);
      if (line) lines.push(`${name}: ${line}`);
    }
  }

  if (lines.length > 0) process.stdout.write(lines.join("\n") + "\n");
  process.exit(0);
}

main();
