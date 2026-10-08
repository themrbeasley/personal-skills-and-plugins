---
name: live-test
description: Use when a Foundry VTT module, macro or automation change is ready to try in a live world (the testing stage of a plan), or when the user hands over a signed-in world to test. Starts Foundry itself, tests through the built-in browser as Gamemaster and as the Test Player on throwaway actors, and logs problems to a report instead of fixing mid-wave.
argument-hint: <world> <what to test>
allowed-tools: Read, Write, Edit, Bash, PowerShell, mcp__Claude_Browser__navigate, mcp__Claude_Browser__computer, mcp__Claude_Browser__javascript_tool, mcp__Claude_Browser__read_page, mcp__Claude_Browser__find, mcp__Claude_Browser__get_page_text, mcp__Claude_Browser__read_console_messages, mcp__Claude_Browser__browser_batch, mcp__Claude_Browser__tabs_context, mcp__Claude_Browser__tabs_create, mcp__Claude_Browser__tabs_select, mcp__Claude_Browser__tabs_close
---

## Context

A patch or automation is ready to test in a live Foundry world, or the user has handed one over ("you're signed in as Gamemaster, go ahead"). Test target: $ARGUMENTS. If that's empty, take the target from the plan or the conversation.

Test every change from both sides: as Gamemaster in one browser tab, and as the **Test Player** account in a second tab. A player's click runs different code from the GM's: permission checks, work the GM's browser carries out on the player's behalf, windows that open on the player's screen, and what their chat cards show. A GM-only pass misses all of it.

Start, sign in to, and close Foundry yourself (the user's standing word, 2026-10-06).

## Commands

The steps run these by name. PowerShell blocks go to the PowerShell tool, Bash blocks to Bash, JS blocks to `javascript_tool` with the tab's `tabId`.

**WHO** (PowerShell). Prints `{"active":true,"world":"<id>","users":N}` while Foundry runs, or an error when it's closed. `users` counts everyone connected, your own tabs included.

```powershell
(Invoke-WebRequest -UseBasicParsing http://localhost:8678/api/status -TimeoutSec 5).Content
```

**CLOSE** (PowerShell). Closes the app window, which lets Foundry flush its databases (killing the process can corrupt them), then checks. Expect `running: 0` and `port: False`; run it again if not.

```powershell
Start-Sleep -Seconds 4; Get-Process | Where-Object { $_.ProcessName -eq 'Foundry Virtual Tabletop' -and $_.MainWindowHandle -ne 0 } | ForEach-Object { [void]$_.CloseMainWindow() }; Start-Sleep -Seconds 6; "running: " + (Get-Process | Where-Object { $_.ProcessName -match 'Foundry' }).Count; "port: " + [bool](Get-NetTCPConnection -LocalPort 8678 -State Listen -ErrorAction SilentlyContinue)
```

**START** (PowerShell, only after CLOSE reads `running: 0`). `--world` opens straight into the world and skips the setup screen's administrator password. The world id is its folder name under `Data/worlds/`, such as `rolara-wednesday`.

```powershell
Start-Process -FilePath "C:\Program Files\Foundry Virtual Tabletop\Foundry Virtual Tabletop.exe" -ArgumentList "--world=<world id>"
```

Then wait for it (Bash, `run_in_background`). Expect `ready: 200 http://localhost:8678/join`.

```bash
for i in $(seq 1 60); do r=$(curl -s -o /dev/null -w '%{http_code} %{url_effective}' -L --max-time 5 http://localhost:8678/join); [ "$r" = "200 http://localhost:8678/join" ] && { echo "ready: $r"; exit 0; }; sleep 5; done; echo "not ready: $r"
```

**JOIN** (JS, in a tab already on its `/join` page). Replace `<user>` with the account name.

```js
const el = document.getElementById("join-username"); el.value = "<user>";
el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
setTimeout(() => document.querySelector("button[name=join]").click(), 200); "clicked"
```

**READY** (JS). Run it until `ready` is true, and again after every reload. Each call waits at most 35 seconds, because the tool stops at 45. If `canvas` is false, the world loaded while the pane was hidden: run `setTimeout(() => location.reload(), 100)`, then READY and POPUPS again. A screenshot first gives the pane a size; it can time out, and the reload still works.

```js
for (let i=0;i<35&&!window.game?.ready;i++) await new Promise(r=>setTimeout(r,1000));
JSON.stringify({ origin: location.origin, ready: !!window.game?.ready, canvas: !!window.canvas?.ready, world: game?.world?.id, user: game?.user?.name, gm: game?.user?.isGM, others: game?.users?.filter(u => u.active && u.id !== game.user.id).map(u => u.name) })
```

**POPUPS** (JS, after every sign-in). Each new browser session counts as a first login, so the startup popups come back, and a player with no character also gets Foundry's character picker (`UserConfig`). Close them before opening any tool window, or one can cover a dialog and swallow clicks.

```js
await new Promise(r => setTimeout(r, 3000));
for (const a of [...foundry.applications.instances.values()]) if (a.rendered && (["DialogV2", "UserConfig"].includes(a.constructor.name) || /support-popup|potato-or-not/.test(a.id))) await a.close();
document.querySelectorAll('#notifications li').forEach(n => n.remove()); "cleared"
```

## Your Task

### Steps

1. **Point Foundry at the code under test** (module work only). Foundry loads a local module through a folder link (junction) at `Data/modules/<id>` that points at the repo's main checkout (Data is `%LOCALAPPDATA%\FoundryVTT\Data`). Change the link only while Foundry is closed: run WHO, and CLOSE if it's running (see step 2 for who may be connected).
   - No link yet (a new module repo): create it with `cmd /c mklink /J "<link>" "<main checkout>"`.
   - To test a different checkout, such as a git worktree, build the module's compendiums in that checkout, remove the link with `cmd /c rmdir "<link>"`, and recreate it with `cmd /c mklink /J "<link>" "<checkout>"`. Use `cmd /c rmdir` because PowerShell 5.1's `Remove-Item` can follow a junction and delete the real files.
   - Tell the user the link moved and when it goes back. Point it back at the main checkout once the change is approved or merged, and always before a game.
2. **Start Foundry in the named world and sign in as Gamemaster.** Test only in the world the user names: their worlds are split by campaign day (for example Rolara-Wednesday) and every one is in play, and the old "rolara" world is an out-of-date archive, so never pick or suggest one yourself.
   - If the user has already signed you in, find that tab with `tabs_context`, run READY in it and keep that session.
   - Otherwise run WHO. Closed: START with the named world. Running the named world with `users` 0: go on. Running another world with `users` 0: CLOSE, then START. `users` above 0 means someone else is connected: stop and ask the user.
   - Open the GM tab at **http://localhost:8678/join**, run JOIN as `Gamemaster`, then READY and POPUPS. Expect `gm: true` and `others: []`.
   - When testing a module, fetch a changed file from the page (for example `/modules/<id>/scripts/main.mjs`) and check it contains the change, so you know Foundry is serving the code under test.
3. **Sign in the Test Player on a second tab.**
   - In the GM tab, find or create the account: `game.users.getName("Test Player") ?? await User.create({ name: "Test Player", role: CONST.USER_ROLES.TRUSTED })`. It's permanent: one per world, Trusted Player role, no password, kept after every test.
   - Open a second tab with `tabs_create` and navigate it to **http://127.0.0.1:8678/join**. It's the same server under another address, so the browser keeps this sign-in separate from the GM tab. Run JOIN as `Test Player`, then READY and POPUPS. Expect `user: "Test Player"` and `gm: false`.
   - Note both tab ids and pass `tabId` on every browser call. `location.origin` tells them apart: localhost is the GM, 127.0.0.1 is the Test Player.
   - Keep the GM tab signed in for the whole wave. Modules carry out many player actions in the GM's browser, such as damage and effects on tokens the player doesn't own.
4. **Pick a test report file** in the current workspace (for example `<workspace>/reports/live-test-<date>.md`). Create it if needed.
5. **Set up without touching real characters:**
   - Before the first test, record the ids of all actors, items, chat messages, folders and scenes, plus the tokens on the test scene. Cleanup checks against this list.
   - Make a temporary actor (`Actor.create`, copy items in with `toObject()`) in a scratch scene, or use the "testing grounds" test actors. Use a temporary actor for anything the Test Player runs, so its ownership change goes away with it.
   - Never cast from a token copy of a real character. Combat Booster writes `flags.combatbooster.recentItems` to the base actor.
   - Snapshot any existing actor you'll touch (`toObject()`) before you start.
   - Hand the temporary actor to the Test Player: ``actor.update({ [`ownership.${tp.id}`]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER })`` and `tp.update({ character: actor.id })`.
   - Give the Test Player Observer on the scratch scene the same way. In the GM tab, view it with `scene.view()` and bring the Test Player to it with `scene.pullUsers([tp.id])`. Both move only that browser's view; the active scene stays as it is.
6. **Run each test from both sides.**
   - **GM side**, in the GM tab. For Midi attacks, press ATTACK on the chat card, then "Normal". Touch spells need tokens within 5 ft. Check the effect, damage, concentration link (`flags.dnd5e.dependentOn`), animation, and console errors.
   - **Player side**, in the Test Player tab, the way a player does it: from their own sheet, with their own targets (`canvas.tokens.setTargets([...tokenIds])` in that tab), pressing the buttons on their own chat cards. Then check:
     - the Test Player tab's console (`read_console_messages` with its `tabId`) for permission errors such as "lacks permission";
     - that every change to something the player doesn't own actually landed, read from the GM tab;
     - the windows that open on the player's screen: roll windows, Epic Rolls prompts (Midi sends player saves there when `playerRollSaves` is `"rer"`), Midi reaction prompts. Answer them in the Test Player tab;
     - what the player's chat cards show and hide: NPC names, whispered and blind rolls.
   - A feature only a GM can use gets "n/a" on the player side, with the reason, in its report row.
   - Bring the tab you're working in to the front with `tabs_select`, and keep the Browser pane showing: a hidden pane or a background tab stalls dice, animations and the canvas. If a player step stalls waiting on the GM, bring the GM tab forward.
   - For repeatable runs from the console, in either tab: `MidiQOL.completeActivityUse(activity, { midiOptions: { targetUuids, autoRollAttack: true, fastForwardAttack: true, autoRollDamage: "always", fastForwardDamage: true } }, { configure: false })`.
   - When testing a forced crit, re-roll a natural 20. It crits anyway, so it proves nothing.
7. **Log, don't fix.** Record each test as a row in the report: what you tested, what you expected, the GM result, the player result, and any console error with the tab it came from. Fix problems only after the wave, in a follow-up pass.
8. **Clean up:**
   - Clear the Test Player's character (`tp.update({ character: null })`), close the Test Player tab, and keep the account.
   - Delete the temporary actors, scratch scene and test chat cards. Compare any snapshotted actor against its snapshot and restore the differences. Leave the active scene as it was.
   - Delete everything whose id wasn't on the starting list, then confirm the id lists match it again.
   - Compare snapshotted actors with `foundry.utils.diffObject` after dropping `_stats`, so only real changes show.
   - If you started Foundry, CLOSE it unless the user wants it left open.
9. **Summarize in plain language:** what works, what's broken, and what's next, for each side. Mark items "Working" only when a live test passed on both sides (or the player side is "n/a").

### Guardrails

- Sign in as `Gamemaster` on the GM side, or the GM account the user names (Extra Extra Gamemaster, Assistant GM). Sign in as `Test Player` on the player side, and only as that account: real players' accounts hold their characters and settings. Ahvantir, Rolara-Wednesday and Rolara-Sunday have no passwords. If a password box appears, ask the user to sign you in.
- Use `http://localhost:8678` for the GM and `http://127.0.0.1:8678` for the Test Player. Never use 192.168.1.11: the LAN address forces an "Allow once" prompt on every action, which blocks auto mode.
- Close Foundry only with CLOSE, and only while nobody but your own two tabs is connected.
- Any LevelDB or module file write needs Foundry **closed**. CLOSE it first and START it again after.
- Never change the active scene or anything players can see.
- Switch modules on or off yourself as the test needs: set `core.moduleConfiguration` with `game.settings.set`, then reload the page. Never ask the user to do it. Record the starting module list with the other ids and restore it during cleanup.
- Every write outside the throwaway actor, the scratch scene and the Test Player account needs its own go-ahead.
- If a Levels "no matching level" prompt appears, click "Generate level from document top and bottom" and report it.
- Midi requests NPC saves through Epic Rolls when its `rollNPCSaves` setting is `"rer"`. The workflow waits until someone clicks the die under the token portrait on the overlay. Start the activity in one javascript_tool call, click the die in the tab that shows the prompt, then read the results in another call. A single awaited call times out after 45 seconds.
- A save or check rolled from code can open a roll window (Midi's "Constitution Saving Throw" and the like) and wait there. If a step seems to do nothing, list open windows with `[...foundry.applications.instances.values()]` (it's a Map, so `Object.values` returns nothing) and click the window's "Normal" button (`button[data-action="normal"]`).
- Return plain values from javascript_tool (`JSON.stringify`, `toObject()`). Returning a Foundry document fails with "Object reference chain is too long".
- Toggle statuses with `actor.toggleStatusEffect(id)`. The token HUD icons are about 9 px in the browser pane, and a pixel click can hit the wrong one.
- Don't use em dashes.

---
*Source: `%USERPROFILE%\GitHub\claude-skills_and_plugins-homebrew\foundryvtt\skills\live-test\SKILL.md`. Edit it there, never an installed copy, then raise `version` in both `foundryvtt/.claude-plugin/plugin.json` and the repo's `.claude-plugin/marketplace.json`.*
