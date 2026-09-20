#!/usr/bin/env node
// Regression suite for the optionEcho check, driven through the real
// validate-write hook against fixture projects.
//
// The known-positive case is the 2026-09-18 sentence. It is a PARAPHRASE of the
// option that produced it, merging the option's label and description, which is
// why this check scores content-word overlap rather than edit distance. A
// levenshtein-based threshold tuned to pass the must-not-fire cases below can
// never catch it.
//
// Run: node professor-orb/hooks/option-echo.test.mjs

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), "validate-write.mjs");
const RULES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "references", "base-rules.json");

let passed = 0;
const failures = [];
const OFFERED = [
  "Reporter asked the name. The team answered on camera as the Neighborhood Watch Association",
];

// dmSaid: the DM's own prose for the transcript. Pass "" for a session where
// they never typed the claim, which is the 09-18 shape.
function fixture(name, reportBody, offered, dmSaid) {
  const dir = path.join(os.tmpdir(), `orb-echo-${name}-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, ".professor-orb"), { recursive: true });
  mkdirSync(path.join(dir, "session-reports", "adjustice", "clean-hands"), { recursive: true });

  const transcript = path.join(dir, "transcript.jsonl");
  writeFileSync(
    transcript,
    [
      JSON.stringify({ type: "user", message: { role: "user", content: "let's debrief the clean hands session" } }),
      JSON.stringify({ type: "user", message: { role: "user", content: typeof dmSaid === "string" ? dmSaid : "" } }),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: "drafting the report" } }),
    ].join("\n") + "\n"
  );

  const base = JSON.parse(readFileSync(RULES, "utf8"));
  writeFileSync(
    path.join(dir, ".professor-orb", "conventions.json"),
    JSON.stringify({
      schemaVersion: 3,
      settings: [
        {
          name: "adjustice",
          kbRoot: "kb/adjustice",
          sessionReportsRoot: "session-reports/adjustice",
          rules: base.rules,
        },
      ],
    })
  );
  if (offered) {
    writeFileSync(
      path.join(dir, ".professor-orb", "asked-options.json"),
      JSON.stringify({ sessionId: "s1", options: offered })
    );
  }
  const file = path.join(dir, "session-reports", "adjustice", "clean-hands", "2026-09-18-Clean-Hands-REPORT.md");
  writeFileSync(file, ["---", "type: Session Report", "---", "", reportBody, ""].join("\n"));
  return { dir, file, transcript };
}

// Returns { blocked: boolean, output: string }. validate-write signals a block
// with exit 2 and stderr; a pass or warn exits 0.
function runValidator(dir, file, transcript) {
  try {
    execFileSync("node", [HOOK], {
      cwd: dir,
      input: JSON.stringify({
        hook_event_name: "PostToolUse",
        tool_name: "Write",
        cwd: dir,
        transcript_path: transcript,
        tool_input: { file_path: file },
      }),
      encoding: "utf8",
    });
    return { blocked: false, output: "" };
  } catch (err) {
    return { blocked: err.status === 2, output: `${err.stdout || ""}${err.stderr || ""}` };
  }
}

function check(name, actual, expected) {
  if (actual === expected) {
    passed++;
    console.log(`  [PASS] ${name}`);
  } else {
    failures.push(name);
    console.log(`  [FAIL] ${name}: expected ${expected}, got ${actual}`);
  }
}

const LAUNDERED = "The reporter asked what the team was called, and they answered on camera.";

console.log("the 2026-09-18 case:");
(function () {
  // The DM's transcript talks about the session but never states this claim,
  // which is the whole shape of the bug: only the option ever said it.
  const { dir, file, transcript } = fixture("known-positive", LAUNDERED, OFFERED, "we wrapped up at the warehouse, pretty short night");
  const r = runValidator(dir, file, transcript);
  check("a paraphrase of an offered option blocks the write", r.blocked, true);
  check("the violation names the rule", r.output.includes("contentOptionEcho"), true);
  check("the violation quotes the sentence", r.output.includes("answered on camera"), true);
  rmSync(dir, { recursive: true, force: true });
})();

console.log("no deadlock when the DM said it themselves:");
(function () {
  // The escape hatch, and the case that makes `block` safe. A sentence the DM
  // confirmed in prose still overlaps the option heavily, because a good option
  // paraphrases what it asks about. Without this branch the rule would refuse
  // the TRUE sentence forever and the DM could never get it into the report.
  const { dir, file, transcript } = fixture(
    "dm-said-it",
    LAUNDERED,
    OFFERED,
    "yes the reporter asked what the team was called and they answered on camera, that one happened"
  );
  check("the DM's own prose lets it through", runValidator(dir, file, transcript).blocked, false);
  rmSync(dir, { recursive: true, force: true });
})();

console.log("a long scattered transcript must not suppress the block:");
(function () {
  // The case that forces per-message containment. None of these messages states
  // the claim, but between them they use every content word in it. Pooled, that
  // scores 1.00 and kills the rule while leaving it looking alive; per message
  // the best is 0.33. This case fails loudly if anyone reintroduces pooling.
  const dir = path.join(os.tmpdir(), `orb-echo-scattered-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, ".professor-orb"), { recursive: true });
  mkdirSync(path.join(dir, "session-reports", "adjustice", "clean-hands"), { recursive: true });
  const base = JSON.parse(readFileSync(RULES, "utf8"));
  writeFileSync(
    path.join(dir, ".professor-orb", "conventions.json"),
    JSON.stringify({
      schemaVersion: 3,
      settings: [{ name: "adjustice", kbRoot: "kb/adjustice", sessionReportsRoot: "session-reports/adjustice", rules: base.rules }],
    })
  );
  writeFileSync(path.join(dir, ".professor-orb", "asked-options.json"), JSON.stringify({ sessionId: "s1", options: OFFERED }));
  const transcript = path.join(dir, "transcript.jsonl");
  writeFileSync(
    transcript,
    [
      "the team regrouped at the warehouse after the crash",
      "a reporter survived and was hospitalized",
      "they asked me about insurance later",
      "the camera crew packed up early",
      "someone called Pemberton on the way out",
      "the whole team answered the door together",
      "done, write the report",
    ]
      .map((c) => JSON.stringify({ type: "user", message: { role: "user", content: c } }))
      .join("\n") + "\n"
  );
  const file = path.join(dir, "session-reports", "adjustice", "clean-hands", "2026-09-18-Clean-Hands-REPORT.md");
  writeFileSync(file, ["---", "type: Session Report", "---", "", LAUNDERED, ""].join("\n"));
  check("scattered words across many messages still blocks", runValidator(dir, file, transcript).blocked, true);
  rmSync(dir, { recursive: true, force: true });
})();

console.log("an AskUserQuestion selection is not the DM's prose:");
(function () {
  // The selection comes back through the transcript as a user-role event
  // carrying a tool_result. Counting it as DM prose would feed the option's own
  // text back in and suppress exactly the block this rule exists for.
  const dir = path.join(os.tmpdir(), `orb-echo-toolresult-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, ".professor-orb"), { recursive: true });
  mkdirSync(path.join(dir, "session-reports", "adjustice", "clean-hands"), { recursive: true });
  const base = JSON.parse(readFileSync(RULES, "utf8"));
  writeFileSync(
    path.join(dir, ".professor-orb", "conventions.json"),
    JSON.stringify({
      schemaVersion: 3,
      settings: [{ name: "adjustice", kbRoot: "kb/adjustice", sessionReportsRoot: "session-reports/adjustice", rules: base.rules }],
    })
  );
  writeFileSync(path.join(dir, ".professor-orb", "asked-options.json"), JSON.stringify({ sessionId: "s1", options: OFFERED }));
  const transcript = path.join(dir, "transcript.jsonl");
  writeFileSync(
    transcript,
    [
      JSON.stringify({ type: "user", message: { role: "user", content: "let's debrief" } }),
      JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "t1", content: OFFERED[0], text: OFFERED[0] }],
        },
      }),
    ].join("\n") + "\n"
  );
  const file = path.join(dir, "session-reports", "adjustice", "clean-hands", "2026-09-18-Clean-Hands-REPORT.md");
  writeFileSync(file, ["---", "type: Session Report", "---", "", LAUNDERED, ""].join("\n"));
  check("a tool_result carrying the option text still blocks", runValidator(dir, file, transcript).blocked, true);
  rmSync(dir, { recursive: true, force: true });
})();

console.log("harness-injected content is not counted as the DM's prose:");
(function () {
  // A long injected block (well over MAX_DM_MESSAGE_CHARS) that happens to
  // contain the laundered sentence verbatim, the way this correction hook's
  // own stdout or a system-reminder block might if it ever lands in a
  // transcript as user-role text. Must NOT suppress the block.
  const dir = path.join(os.tmpdir(), `orb-echo-harness-noise-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, ".professor-orb"), { recursive: true });
  mkdirSync(path.join(dir, "session-reports", "adjustice", "clean-hands"), { recursive: true });
  const base = JSON.parse(readFileSync(RULES, "utf8"));
  writeFileSync(
    path.join(dir, ".professor-orb", "conventions.json"),
    JSON.stringify({
      schemaVersion: 3,
      settings: [{ name: "adjustice", kbRoot: "kb/adjustice", sessionReportsRoot: "session-reports/adjustice", rules: base.rules }],
    })
  );
  writeFileSync(path.join(dir, ".professor-orb", "asked-options.json"), JSON.stringify({ sessionId: "s1", options: OFFERED }));
  const longInjectedBlock = "<system-reminder>\n" + "padding content ".repeat(400) + LAUNDERED + "\n</system-reminder>";
  const transcript = path.join(dir, "transcript.jsonl");
  writeFileSync(
    transcript,
    [
      JSON.stringify({ type: "user", message: { role: "user", content: "let's debrief" } }),
      JSON.stringify({ type: "user", isMeta: true, message: { role: "user", content: longInjectedBlock } }),
    ].join("\n") + "\n"
  );
  const file = path.join(dir, "session-reports", "adjustice", "clean-hands", "2026-09-18-Clean-Hands-REPORT.md");
  writeFileSync(file, ["---", "type: Session Report", "---", "", LAUNDERED, ""].join("\n"));
  check("a long isMeta block containing the sentence verbatim still blocks", runValidator(dir, file, transcript).blocked, true);
  rmSync(dir, { recursive: true, force: true });
})();

console.log("must not fire:");
(function () {
  const cases = [
    ["an unrelated sentence sharing one word", "The reporter survived the crash and was hospitalized overnight."],
    ["a short sentence", "The reporter left."],
    // The measured near-miss. Under a Math.min denominator this scores exactly
    // 0.60 against the offered option and blocks at any threshold low enough to
    // catch the real one; under Jaccard it scores 0.27 against the real 0.50.
    ["an innocent sentence sharing three words", "The reporter and the team were on camera together at the scene."],
  ];
  for (const [name, body] of cases) {
    const { dir, file, transcript } = fixture(name.replace(/\W+/g, "-"), body, OFFERED, "");
    check(name, runValidator(dir, file, transcript).blocked, false);
    rmSync(dir, { recursive: true, force: true });
  }
})();

console.log("fail-silent contract:");
(function () {
  let f = fixture("no-state", LAUNDERED, null, "");
  check("no recorded options means no violation", runValidator(f.dir, f.file, f.transcript).blocked, false);
  rmSync(f.dir, { recursive: true, force: true });

  // No transcript means the check cannot tell a laundered sentence from a
  // confirmed one, and a block on no evidence is worse than no block.
  f = fixture("no-transcript", LAUNDERED, OFFERED, "");
  check("an unreadable transcript passes rather than blocks", runValidator(f.dir, f.file, path.join(f.dir, "nope.jsonl")).blocked, false);
  rmSync(f.dir, { recursive: true, force: true });
})();

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
