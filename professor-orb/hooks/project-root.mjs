// The project a hook serves: the nearest folder at or above the session's
// working folder that holds .professor-orb.
//
// Every hook used to take the working folder itself as the project root. The
// working folder follows the session's shell, and a `cd` into a campaign
// folder moves it there. On 2026-10-07 that left validate-write finding no
// conventions.json and running no rule, while the same text blocked once the
// shell was back at the root. A folder with no .professor-orb above it comes
// back unchanged, so a project that never ran setup behaves exactly as before.
//
// Nearest wins: a worktree under .claude/worktrees/ carries its own
// .professor-orb and must never resolve to the checkout around it.
//
// Known limit: a folder that never ran setup but sits inside one that did
// resolves to the outer project. Its files then fall outside the outer project's
// prong roots, so block-excluded lets them through where its no-conventions
// fallback used to check every markdown file. Setup tracks .professor-orb, so a
// worktree of a set-up project has its own and does not hit this.

import { existsSync } from "node:fs";
import path from "node:path";

export function projectRootFrom(dir) {
  const start = path.resolve(dir);
  for (let at = start; ; at = path.dirname(at)) {
    if (existsSync(path.join(at, ".professor-orb"))) return at;
    if (path.dirname(at) === at) return start;
  }
}
