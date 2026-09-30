---
name: live-test
description: Use when a Foundry VTT module, macro or automation change is ready to try in a live world (the testing stage of a plan), or when the user hands over a signed-in world to test. Tests through the built-in browser on throwaway actors and logs problems to a report instead of fixing mid-wave.
argument-hint: <world> <what to test>
allowed-tools: Read, Write, Edit, Bash, mcp__Claude_Browser__navigate, mcp__Claude_Browser__computer, mcp__Claude_Browser__javascript_tool, mcp__Claude_Browser__read_page, mcp__Claude_Browser__find, mcp__Claude_Browser__get_page_text, mcp__Claude_Browser__read_console_messages, mcp__Claude_Browser__browser_batch
---

## Context

A patch or automation is ready to test in a live Foundry world, or the user has handed one over ("you're signed in as Gamemaster, go ahead"). Test target: $ARGUMENTS. If that's empty, take the target from the plan or the conversation.

## Your Task

### Steps

1. **Point Foundry at the code under test** (module work only). Foundry loads a local module through a folder link (junction) at `Data/modules/<id>` that points at the repo's main checkout (Data is `%LOCALAPPDATA%\FoundryVTT\Data`). If there's no link yet (a new module repo), ask the user to close Foundry, then create it with `cmd /c mklink /J "<link>" "<main checkout>"`. To test a different checkout, such as a git worktree:
   - Ask the user to close Foundry, then build the module's compendiums in that checkout.
   - Remove the link with `cmd /c rmdir "<link>"`, never `Remove-Item` (PowerShell 5.1 can follow a junction and delete the real files). Recreate it with `cmd /c mklink /J "<link>" "<checkout>"`.
   - Tell the user the link moved and when it goes back. Point it back at the main checkout once the change is approved or merged.
2. **Have the user connect.** Unless they've already signed you in, ask the user to open **http://localhost:8678** in the built-in browser, sign in as Gamemaster, and say go once the world has loaded. Don't open it or wait on it yourself: load times vary by world and module set. Never use 192.168.1.11 (the LAN address forces an "Allow once" prompt on every action, which blocks auto mode). Once they say go, check that `location.origin` is localhost, which world is loaded, and that you're signed in as Gamemaster. If the world is wrong, ask the user to switch. When testing a module, fetch a changed file (for example `/modules/<id>/scripts/main.mjs`) from the page and check it contains the change, so you know Foundry is serving the code under test.
3. **Pick a test report file** in the current workspace (for example `<workspace>/reports/live-test-<date>.md`). Create it if needed.
4. **Set up without touching real characters:**
   - Before the first test, record the ids of all actors, items, chat messages, folders and scenes, plus the tokens on the test scene. Cleanup checks against this list.
   - Make a temporary actor (`Actor.create`, copy items in with `toObject()`) in a scratch scene, or use the "testing grounds" test actors.
   - Never cast from a token copy of a real character. Combat Booster writes `flags.combatbooster.recentItems` to the base actor.
   - Snapshot any existing actor you'll touch (`toObject()`) before you start.
5. **Run each test.** For Midi attacks, press ATTACK on the chat card, then "Normal". Touch spells need tokens within 5 ft. Check the effect, damage, concentration link (`flags.dnd5e.dependentOn`), animation, and console errors.
   - For repeatable runs from the console: `MidiQOL.completeActivityUse(activity, { midiOptions: { targetUuids, autoRollAttack: true, fastForwardAttack: true, autoRollDamage: "always", fastForwardDamage: true } }, { configure: false })`.
   - When testing a forced crit, re-roll a natural 20. It crits anyway, so it proves nothing.
6. **Log, don't fix.** Record each result as a row in the report: what you tested, what you expected, what happened, and any console error. Fix problems only after the wave, in a follow-up pass.
7. **Clean up:** delete the temporary actors, scratch scene and test chat cards. Compare any snapshotted actor against its snapshot and restore the differences. Leave the active scene as it was.
   - Delete everything whose id wasn't on the starting list, then confirm the id lists match it again.
   - Compare snapshotted actors with `foundry.utils.diffObject` after dropping `_stats`, so only real changes show.
8. **Summarize in plain language:** what works, what's broken, and what's next. Mark items "Working" only when a live test passed.

### Guardrails

- Never change the active scene or anything players can see.
- The user can toggle modules for testing. Tell them which ones you need and why.
- Any LevelDB or module file write needs Foundry **closed**. Ask the user to close it; don't do it yourself.
- Every write outside the throwaway actor and scene needs its own go-ahead.
- If a Levels "no matching level" prompt appears, click "Generate level from document top and bottom" and report it.
- Midi requests NPC saves through Epic Rolls when its `rollNPCSaves` setting is `"rer"`. The workflow waits until someone clicks the die under the token portrait on the overlay. Start the activity in one javascript_tool call, click the die, then read the results in another call. A single awaited call times out after 45 seconds.
- Return plain values from javascript_tool (`JSON.stringify`, `toObject()`). Returning a Foundry document fails with "Object reference chain is too long".
- Toggle statuses with `actor.toggleStatusEffect(id)`. The token HUD icons are about 9 px in the browser pane, and a pixel click can hit the wrong one.
- Don't use em dashes.

---
*Source: `%USERPROFILE%\GitHub\claude-skills_and_plugins-homebrew\foundryvtt\skills\live-test\SKILL.md`. Edit it there, never an installed copy, then raise `version` in both `foundryvtt/.claude-plugin/plugin.json` and the repo's `.claude-plugin/marketplace.json`.*
