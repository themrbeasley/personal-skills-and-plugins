#!/usr/bin/env node
// PostToolUse hook on AskUserQuestion: records every option offered.
//
// On 2026-09-18 a debrief option whose DESCRIPTION stated an outcome ("The team
// answered on camera as the Neighborhood Watch Association") became a sentence
// in a session report, then a source for the index, chronicler, and a recap.
// The pipeline laundered its own proposal into canon. This file is half of the
// detector for that: it remembers what was offered, and validate-write's
// optionEcho check refuses a report sentence that paraphrases one.
//
// EVERY option is recorded, not only those selected. The DM states the option
// was never selected on their screen, so matching against the full offered set
// is what covers the case as reported, and it removes any dependence on the
// shape of tool_response.
//
// The record is hook-owned: read by hooks, never by the model. Keeping it out
// of the model's context is part of its contract, not incidental, because it
// holds proposed-scene text. It lives in the OS temp directory, one file per
// session, at <os.tmpdir()>/professor-orb/asked-options-<session_id>.json.
// Outside the project, git can never pick it up; named by session, one session
// can never read another's options. validate-write's checkOptionEcho computes
// the same path, and the end-to-end case in option-echo.test.mjs fails if the
// two drift apart.
//
// ponytail: one small file per questioning session is left for the OS's temp
// cleanup. Delete it from a SessionEnd hook if that ever matters.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// The session id becomes part of a file name. Anything but a plain token (a
// path separator, "..", a dot, an empty string) writes nothing rather than a
// file somewhere the reader will not look.
const SESSION_ID = /^[A-Za-z0-9_-]+$/;

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    process.exit(0);
  }
  if (!input || typeof input !== "object") process.exit(0);
  if (input.tool_name !== "AskUserQuestion") process.exit(0);

  const cwd = typeof input.cwd === "string" && input.cwd.length > 0 ? input.cwd : process.cwd();
  // Setup never ran, so professor-orb is not in use here and there is no
  // report for the record to protect.
  if (!existsSync(path.resolve(cwd, ".professor-orb"))) process.exit(0);

  const sessionId = typeof input.session_id === "string" ? input.session_id : "";
  if (!SESSION_ID.test(sessionId)) process.exit(0);

  const questions = input.tool_input && Array.isArray(input.tool_input.questions)
    ? input.tool_input.questions
    : [];

  const offered = [];
  for (const question of questions) {
    if (!question || !Array.isArray(question.options)) continue;
    for (const option of question.options) {
      if (!option || typeof option !== "object") continue;
      const label = typeof option.label === "string" ? option.label.trim() : "";
      const description = typeof option.description === "string" ? option.description.trim() : "";
      const joined = [label, description].filter(Boolean).join(". ");
      if (joined !== "") offered.push(joined);
    }
  }
  // Nothing usable. Writing an empty record would only churn the file.
  if (offered.length === 0) process.exit(0);

  const stateDir = path.join(os.tmpdir(), "professor-orb");
  const statePath = path.join(stateDir, `asked-options-${sessionId}.json`);

  let options = [];
  try {
    const prior = JSON.parse(readFileSync(statePath, "utf8"));
    if (prior && Array.isArray(prior.options)) options = prior.options;
  } catch {
    // No prior file, or an unreadable one. Start fresh rather than fail.
  }

  try {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(statePath, JSON.stringify({ options: [...options, ...offered] }, null, 2) + "\n", "utf8");
  } catch {
    // An unwritable temp directory must not break the DM's question.
  }
  process.exit(0);
}

main();
