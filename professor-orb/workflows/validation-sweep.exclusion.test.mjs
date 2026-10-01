#!/usr/bin/env node
// Regression guard for the sweep's walled-off folder exclusion.
//
// Unlike validation-sweep.ownership.test.mjs, which mirrors pure logic, this
// suite runs the real validation-sweep.mjs the way the workflow host does: the
// leading `export const meta` is special-cased and the rest of the file is the
// body of an async function that receives the runtime globals. The globals are
// stubs. The scout returns a canned conventions reading, and the first census
// call records the command it was handed and stops the run, because the census
// command is where the exclusion has to appear.
//
// It exists because the exclusion was dead from the day it shipped (11fe92e,
// 2026-08-03) until 2026-10-01: the call site passed a field the setting
// entries never carry, so every sweep enumerated and sharded walled-off
// folders. A test of excludedSegmentsFrom alone passed the whole time; the
// defect was in the wiring, which only a run of the real file can see.
//
// Run: node professor-orb/workflows/validation-sweep.exclusion.test.mjs

import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./validation-sweep.mjs", import.meta.url), "utf8");
const AsyncFunction = (async () => {}).constructor;
const sweep = new AsyncFunction(
  "args",
  "agent",
  "parallel",
  "phase",
  "log",
  source.replace(/^export const meta/m, "const meta")
);

let passed = 0;
const failures = [];

function check(name, actual, expected) {
  if (actual === expected) {
    passed++;
    console.log(`  [PASS] ${name}`);
  } else {
    failures.push(name);
    console.log(`  [FAIL] ${name}: expected ${expected}, got ${actual}`);
  }
}

// Runs a scan with one setting whose exclusion rule carries the given params
// and enforcement, and returns the census command plus everything logged.
async function censusCommandFor({ tags, requiredSegment, enforcement }) {
  const rules = {
    frontmatterExcludedTagLocation: {
      provenance: "professor-orb",
      category: "frontmatter",
      check: "tagImpliesPath",
      enforcement,
      params: { tags, requiredSegment },
    },
  };
  const scout = {
    conventionsFound: true,
    prongRoots: [{ index: 0, setting: "rolara", kind: "kb", path: "settings/rolara" }],
    settingConfigs: [
      { index: 0, setting: "rolara", rulesJson: JSON.stringify(rules), tagRegistryPath: "", indexSuffix: "-INDEX" },
    ],
    message: "",
  };
  const STOP = new Error("stop after the first census");
  const censusPrompts = [];
  const logs = [];
  const agent = async (prompt, opts) => {
    if (opts.label === "scout") return scout;
    if (opts.label.startsWith("census:")) {
      censusPrompts.push(prompt);
      throw STOP;
    }
    throw new Error(`unexpected agent call: ${opts.label}`);
  };
  const parallel = (thunks) => Promise.all(thunks.map((t) => t()));
  try {
    await sweep({ mode: "scan" }, agent, parallel, () => {}, (m) => logs.push(String(m)));
  } catch (err) {
    if (err !== STOP) throw err;
  }
  return { command: censusPrompts[0] || "", logs: logs.join("\n") };
}

console.log("a walled-off folder is excluded from the census:");
{
  const { command, logs } = await censusCommandFor({ tags: ["NSFW"], requiredSegment: "nsfw", enforcement: "block" });
  check("the census command excludes the folder", command.includes("! -path '*/nsfw/*'"), true);
  check("the run says what it excluded", logs.includes('Excluding "nsfw/"'), true);
}

console.log("an off rule still excludes the folder:");
{
  // "off" stops placement checks; it never means "start reading the folder".
  const { command } = await censusCommandFor({ tags: ["NSFW"], requiredSegment: "nsfw", enforcement: "off" });
  check("the census command excludes the folder", command.includes("! -path '*/nsfw/*'"), true);
}

console.log("the shipped rule, with no tags, excludes nothing:");
{
  const { command } = await censusCommandFor({ tags: [], requiredSegment: "nsfw", enforcement: "off" });
  check("a census command was issued", command.includes("LC_ALL=C find"), true);
  check("no folder is excluded", command.includes("*/nsfw/*"), false);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
