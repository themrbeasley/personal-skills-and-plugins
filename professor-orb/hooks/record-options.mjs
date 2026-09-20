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
// The state file is hook-owned: read by hooks, never by the model, and
// intended to be git-ignored: setup adds the entry to a consumer project's
// .gitignore (skills/setup/SKILL.md), which is not yet true for every
// project until that setup or resync has run. Principle 8's scope discipline
// binds skills, not hooks, and pipeline-state.json is the precedent. Keeping
// it out of the model's context is part of its contract, not incidental,
// because it holds proposed-scene text.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

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
  const orbDir = path.resolve(cwd, ".professor-orb");
  // Setup never ran. Creating the directory is setup's job, not a hook's.
  if (!existsSync(orbDir)) process.exit(0);

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

  const statePath = path.join(orbDir, "asked-options.json");
  const sessionId = typeof input.session_id === "string" ? input.session_id : "";

  let state = { sessionId, options: [] };
  try {
    const prior = JSON.parse(readFileSync(statePath, "utf8"));
    // A record from another session is stale: option text from a different
    // debrief must never block this session's report.
    if (prior && prior.sessionId === sessionId && Array.isArray(prior.options)) {
      state.options = prior.options;
    }
  } catch {
    // No prior file, or an unreadable one. Start fresh rather than fail.
  }

  state.options = [...state.options, ...offered];
  try {
    writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n", "utf8");
  } catch {
    // A read-only checkout must not break the DM's question.
  }
  process.exit(0);
}

main();
