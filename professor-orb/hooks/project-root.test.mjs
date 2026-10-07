#!/usr/bin/env node
// Checks projectRootFrom, the lookup every professor-orb hook uses to find the
// project it serves.
//
// Run: node professor-orb/hooks/project-root.test.mjs

import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { projectRootFrom } from "./project-root.mjs";

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

const base = path.join(os.tmpdir(), `orb-root-${process.pid}`);
rmSync(base, { recursive: true, force: true });

// A worktree that is a project of its own, inside a checkout that is one too:
// the layout of every rolara worktree session.
const outer = path.join(base, "outer");
const inner = path.join(outer, ".claude", "worktrees", "wt");
mkdirSync(path.join(outer, ".professor-orb"), { recursive: true });
mkdirSync(path.join(inner, ".professor-orb"), { recursive: true });
mkdirSync(path.join(inner, "session-reports", "w", "Camp"), { recursive: true });
const bare = path.join(base, "bare", "sub");
mkdirSync(bare, { recursive: true });

check("the project root finds itself", projectRootFrom(inner), inner);
check("a campaign folder climbs to its project", projectRootFrom(path.join(inner, "session-reports", "w", "Camp")), inner);
check("a worktree stops at its own project, not the checkout around it", projectRootFrom(path.join(inner, "session-reports")), inner);
check("a folder with no project above it comes back unchanged", projectRootFrom(bare), bare);

rmSync(base, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
