---
name: rig-hazard-region
description: Use when the user wants a 2024 DMG hazard or trap (pit, trip wire, pressure plate, fire-casting statue, gas, webs, quicksand and the rest of the Multitrap token's list) to go off by itself when a creature enters a region on a Foundry v14 scene, or wants an extra such as an animation, a stop-and-pause or a conditional effect added to one.
argument-hint: <world> <hazard or trap> <where> [party level]
allowed-tools: Read, Write, Edit, Bash, PowerShell, mcp__Claude_Browser__navigate, mcp__Claude_Browser__computer, mcp__Claude_Browser__javascript_tool, mcp__Claude_Browser__read_page, mcp__Claude_Browser__find, mcp__Claude_Browser__get_page_text, mcp__Claude_Browser__read_console_messages, mcp__Claude_Browser__browser_batch, mcp__Claude_Browser__tabs_context, mcp__Claude_Browser__tabs_create, mcp__Claude_Browser__tabs_select, mcp__Claude_Browser__tabs_close
---

## Context

The user wants a hazard or trap from the 2024 DMG to go off by itself when a creature walks into a region. The baseline needs no code: a region, Midi-QOL's **Midi Region Activity** behavior (`midi-qol.regionActivity`), and a hidden Multitrap token nearby whose item activity it fires. Target: $ARGUMENTS. If that's empty, take it from the conversation.

Some hazards need more than the baseline: an animation, a stop-and-pause, a conditional effect. Those are small scripts on the same region. Build one only after the user approves it, test it well, and record it in the macro library so the next run offers it again. Nothing in this skill goes into House Automation.

Only the moment the hazard goes off is automated. Ongoing effects (sinking, suffocation, escape checks, moving through floors) stay manual, and so do touch hazards: a region can't tell when someone touches something. Flying is the GM's call at the table: the baseline fires on any entry, so the GM raises a flyer's elevation and waves off a result when one sets something off anyway.

This is prep-time work. Sign in, test and clean up as `foundryvtt:live-test` says (its WHO, START, JOIN, READY, POPUPS, PLACE and DRAG blocks by name), in the world the user names, on a scratch scene that is viewed and never activated. If anyone but the GM is connected, stop and ask.

## Commands

JS blocks run in `javascript_tool` in the GM tab (the tab signed in as Gamemaster). State carries in `window.__h`.

**FIND MULTITRAP.** The Multitrap actor carries the DMG items. Other worlds may have none: if it isn't there, ask the user where to get one and never build one.

```js
const actor = game.actors.find(a => /^multitrap/i.test(a.name));
const item = actor?.items.getName("<item name>");
window.__h = {actor: actor?.uuid, item: item?.uuid};
JSON.stringify({actor: actor?.name, item: item?.name, desc: item?.system.description.value.replace(/<[^>]+>/g, " ").slice(0, 600),
  activities: item?.system.activities.map(a => ({id: a.id, uuid: a.uuid, name: a.name, type: a.type, area: a.target?.template?.type || ""}))})
```

**PLACE MULTITRAP.** A hidden Multitrap token on the region's level, next to the hazard (on the statue for the statue), so area activities have somewhere to come from. Copy the existing Multitrap token and view the level first (live-test's PLACE explains why).

```js
const scene = game.scenes.viewed, lid = "<level id>", at = {x: 0, y: 0};
await scene.view({level: lid});
const src = game.scenes.contents.flatMap(s => s.tokens.contents).find(t => /^multitrap/i.test(t.name));
const o = src.toObject(); delete o._id; delete o._movementHistory; delete o._regions;
Object.assign(o, {level: lid, hidden: true, x: at.x, y: at.y, elevation: scene.levels.get(lid).elevation.bottom});
(await scene.createEmbeddedDocuments("Token", [o]))[0].id
```

**MAKE REGION.** Adopt a region the user drew (set its `levels` and `elevation`), or make one on the squares the user named. Set `levels` to the floor's level id. Elevation starts at the level's bottom and the top is about a foot above it (`bottom + 1`), so a creature raised above the region passes over it. A Midi region on the wrong level never fires.

```js
const scene = game.scenes.viewed, lid = "<level id>", bottom = scene.levels.get(lid).elevation.bottom;
const data = {name: "<Hazard> (<band>)", color: "#ff6a00", levels: [lid], elevation: {bottom, top: bottom + 1},
  visibility: CONST.REGION_VISIBILITY.GAMEMASTER, shapes: [{type: "rectangle", x: 0, y: 0, width: 0, height: 0, rotation: 0, hole: false}]};
const existing = scene.regions.get("<region id the user drew, or leave empty>");
const region = existing ? (await existing.update({levels: data.levels, elevation: data.elevation}), existing) : (await scene.createEmbeddedDocuments("Region", [data]))[0];
window.__h.region = region.uuid; region.id
```

**ADD MIDI RULES.** One rule per trigger, each firing the chosen activity on the creature that triggered it: `entry`, `exit`, `turnStart` (start of its turn inside) or `turnEnd`. Set `dispositionFilter` to 0, so the rule is not skipped for creatures sharing the Multitrap token's disposition. `excludeSource` stays on so the Multitrap token doesn't set itself off. `oncePerTurn` only counts during an active combat.

```js
const region = fromUuidSync(window.__h.region);
const act = "<activity uuid>", triggers = ["entry"]; // the statue: ["entry", "turnStart"]
await region.createEmbeddedDocuments("RegionBehavior", [{
  type: "midi-qol.regionActivity", name: "<Hazard>",
  system: {sourceItemUuid: window.__h.item, sourceActorUuid: window.__h.actor, dispositionFilter: 0, excludeSource: true, oncePerTurn: true, castLevel: 0,
    rules: triggers.map(trigger => ({trigger, action: "useActivity", targetUuid: act}))}}]);
"rules added"
```

**ADD SCRIPT.** An extra is an Execute Script behavior beside Midi's. `source` is the script text; to paste a recorded macro file exactly, read it with the Read tool and put its text in the literal below with `JSON.stringify`, so no escaping is needed. Events are `tokenMoveIn`, `tokenEnter`, `tokenTurnStart` and the rest of `CONST.REGION_EVENTS`.

```js
const region = fromUuidSync(window.__h.region);
await region.createEmbeddedDocuments("RegionBehavior", [{type: "executeScript", name: "<Extra name>",
  system: {events: ["tokenMoveIn"], source: "<the script text>"}}]);
"script added"
```

For an animation, look the file up in Sequencer's database before using it (`Sequencer.Database.getPathsUnder("jb2a.breath_weapons.fire.cone")`) and ask the user how the cone should aim and how long it runs.

**FIND EXTRAS** (Bash). Recorded extras are in the Data folder's macro catalog, tagged with the hazard's name.

```bash
grep -i "<hazard name>" "$LOCALAPPDATA/FoundryVTT/Data/macros/INDEX.md"
```

## The item table

Take the band from the party's level. Where an item has bands, ask the user for the level if they gave none. "Region on" says where the region goes; read each item's own description (FIND MULTITRAP prints it) before trusting a row.

| Item | Bands | Fires when | Region on | Notes |
|---|---|---|---|---|
| Collapsing Roof | 1-4, 5-10, 11-16, 17-20 | a creature crosses the trip wire | the trip wire squares | `entry`. Only the first creature sets it off: the GM disables the behavior after. |
| Falling Net | same | a creature crosses the trip wire | the trip wire squares | `entry`, first creature only. Escape Check and Set Trap stay manual. |
| Spiked Pit, Hidden Pit | same | a creature moves onto the lid | the lid squares | `entry`. The lid stays open: disable after. |
| Poisoned Darts | same | a creature moves onto the pressure plate, first time on a turn | the plate squares | `entry`, `oncePerTurn`. |
| Fire-Casting Statue | same | pressure plate, first time on a turn, or starts its turn there | the plate squares, next to the statue | `entry` and `turnStart`, `oncePerTurn`. The cone is area-shaped (see the area note). |
| Rolling Stone | 11-16, 17-20 | pressure plate | the plate squares | `entry`. The Slow check stays manual. |
| Poisonous Gas | 1-4, 5-10, 11-16, 17-20 | in the gas | the gas cubes | `entry` and `turnStart`, `oncePerTurn`. "Place Gas" is a template, not a trigger. |
| Webs | one | enters the webs | the web squares | `entry` and `turnStart`, `oncePerTurn`. Escape Check manual. |
| Quicksand Pit | one | enters the pit | the pit squares | No activity for stepping in: all of it is extra (see Extras). Escape checks manual. |
| Yellow Mold | one | starts its turn in the spores | the 10-foot cube | `turnStart` fires "Start of Turn Damage". "Touch Mold" is a touch: manual. |
| Brown Mold, Fireball Fungus, Razorvine, Vicious Vine, Rockslide, Inferno, River Styx | per item | read the item text | read the item text | Pick the trigger from the description and say so in the proposal. |
| Green Slime, Poisoned Needle | | contact, a lock opened wrong | none | Manual: no region event. |

Area activities (the statue's cone, a gas cube): Midi fires the activity at the creature that stepped in, not at everyone in the area, and first starts the area's template placement on the GM's client. The creature's move stays paused until the GM clicks the canvas to place the template, so the GM aims the cone. In the browser pane Escape does not reach the canvas and a click did not place it: reloading the GM tab ends the wait. Tell the user all this, and offer covering the area as an extra.

## Your Task

### Steps

1. **Take the request.** Which hazard or trap, which scene and level, and the party's level if the item has bands (ask when it does and none was given). The user marks the spot in Foundry: a region they drew (adopt it), or a token or tile it sits next to (propose squares around it). Never pick squares from the map art. A world with no Multitrap: ask where to get one.
2. **Read the item** with FIND MULTITRAP, fill its table row, and name the activity for the band.
3. **Look for recorded extras** with FIND EXTRAS, by the hazard's name.
4. **Propose the setup in one message and wait for the user's OK.** Say: the region and its level, the Multitrap token's spot, the Midi rules (trigger and activity), whether `oncePerTurn` is on, whether to add core's Pause Game behavior (it stops the token and pauses, but only when a player moved it, never when a GM did), the area gap if the activity has an area, recorded extras to reuse, and what stays manual. Create nothing before the OK.
5. **Build what was approved.** PLACE MULTITRAP, MAKE REGION, ADD MIDI RULES, then Pause Game or an extra if approved.
6. **Test.** With `foundryvtt:live-test`'s PLACE and DRAG blocks, put each test token outside the region, then bring it in by dragging. A displace placement inside the region fires it, so never place a token inside. Check, moved by the GM and by the Test Player:
   - walking in sets it off, and walking through does too;
   - the damage or effect lands on the token. The Multitrap actor is GM-owned, so Midi runs the activity on the GM's client even when a player moved: the roll window ("Normal" button, `button[data-action="normal"]`) opens in the GM tab, and the mover's token stays paused until someone answers it. Answer it, then check the token finished its move (`token._source.x`, since `token.x` is the animated value);
   - the Multitrap token itself doesn't set it off;
   - a token on another level at the same spot doesn't;
   - a token raised above the region passes over.
   Record what an area activity does. Read the console in both tabs. `oncePerTurn` only counts during an active combat, so test it inside one.
7. **Record any new extra** (next section), commit it, and report: what was built, what passed, what stays manual.

### Extras

Anything beyond the baseline is an extra: an animation (Sequencer and JB2A are installed), a conditional effect, a stop-and-pause whoever moved, a view jump to the token, covering an area. `Data/macros/quicksand-region-trigger.js` is the worked example: an Execute Script behavior on Token Move In that stops the token on the mover's client (`event.user.isSelf`) and does the rest on the active GM's client (`game.user.isActiveGM`), as two separate halves.

1. **Propose it first** and wait for the OK: what it does, which event, where it lives. If FIND EXTRAS found a recorded one, offer that instead of writing a new one: its file is the one to paste into a new region's Execute Script behavior.
2. **Build it** as an Execute Script behavior beside Midi's, with a `TRAP_TOKEN` and item uuid at the top.
3. **Test it** with `foundryvtt:live-test` as the GM and as the Test Player. Test the GM half from one tab by briefly overriding `game.user.isActiveGM` and calling the behavior's `_handleRegionEvent` with a fake event.
4. **Record it.** Save it to `Data/macros/<kebab-name>.js` with the house header (TITLE, a rule line, 1 to 3 lines, `Environment:`, `Usage:`, `Tags:` naming the hazard, a closing rule line), add its row to `macros/INDEX.md` (alphabetical by filename), and commit in the Data repo with explicit paths only: `git add -- <path> <path>`, never `git add -A`, `git clean`, `git reset --hard`, `git stash -u` or a branch switch there.

### Guardrails

- Create nothing in a world before the user approves the setup, and build no extra the user didn't approve. A recorded extra is reused, never rebuilt.
- Test only in the world the user names, on a scratch scene that is viewed and never activated, as `foundryvtt:live-test` says. Clean up what you made, and keep the Test Player account.
- Never build a Multitrap actor or a hazard item of your own.
- Never add anything to House Automation: it only patches other modules into working.
- Leave touch hazards and ongoing effects manual, and say so in the proposal.
- Return plain values from `javascript_tool` (`JSON.stringify`, `toObject()`), never a Foundry document.
- Don't use em dashes.

---
*Source: `%USERPROFILE%\GitHub\claude-skills_and_plugins-homebrew\foundryvtt\skills\rig-hazard-region\SKILL.md`. Edit it there, never an installed copy, then raise `version` in both `foundryvtt/.claude-plugin/plugin.json` and the repo's `.claude-plugin/marketplace.json`.*
