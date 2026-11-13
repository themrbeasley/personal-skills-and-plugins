---
name: condense-scenes-to-levels
description: Use when a map is split across several Foundry v14 scenes, one scene per floor, and the user wants it as one scene with one Level per floor (a multi-level building or dungeon from Tom Cartos, Crystal Veil and similar). Copies walls, lights, tokens, combat and stairs into the base scene with checks that nothing was lost.
argument-hint: <world> <source scenes> <base scene>
allowed-tools: Read, Write, Edit, Bash, PowerShell, mcp__Claude_Browser__navigate, mcp__Claude_Browser__computer, mcp__Claude_Browser__javascript_tool, mcp__Claude_Browser__read_page, mcp__Claude_Browser__find, mcp__Claude_Browser__get_page_text, mcp__Claude_Browser__read_console_messages, mcp__Claude_Browser__browser_batch, mcp__Claude_Browser__tabs_context, mcp__Claude_Browser__tabs_create, mcp__Claude_Browser__tabs_select, mcp__Claude_Browser__tabs_close
---

## Context

A map is split across several v14 scenes, one per floor, and the user wants one scene with one Level per floor. Target: $ARGUMENTS. If that's empty, take the world, the source scenes and the base scene from the conversation, and ask for whatever is missing.

Every command here was proven live on Foundry v14 build 368 (dnd5e 5.3.3, Midi-QOL, Perceptive 6.0.8) when "Zedd Dood's Space Tower" was condensed from Dresdens Tower. The Level visibility lists and the Change Level stair region's shape were proven on "Trades Alley" in rolara-sunday on 2026-11-13. Print what a command returns and compare it before the next one.

Sign in, READY and POPUPS work as in `foundryvtt:live-test` (the GM tab at `http://localhost:8678/join`, signed in as Gamemaster). Use that skill's WHO, START and JOIN blocks by name. Keep the GM tab signed in the whole job.

## Commands

All blocks run in `javascript_tool` in the GM tab. State carries between calls in `window.__c`.

**BACKUP.** Before any write: an in-memory copy of every scene, the base scene's wall count (PERCEPTIVE FIX compares against it), and a `created` list that LEVELS adds the new Level ids to (the other blocks' results are checked by their own counts). Saving the JSON to disk is a browser download: ask the user first (`saveDataToFile(JSON.stringify(window.__c.json[name]), "application/json", name + ".json")`). `window.__c` lives only in this tab, so a page reload wipes it, and once LEVELS has run the downloaded base scene JSON is the only copy of the base scene's original. After a reload, rebuild `window.__c` by hand: `base` and `src` by name, `srcWalls` from the untouched sources, `baseWalls` as the walls on `defaultLevel0000`, `lv` from the `floors` table and the Levels' names, `created` as the `lv` ids other than `defaultLevel0000`. Re-running BACKUP mid-job would record the half-merged base scene as the original.

```js
const names = ["<base scene>", "<source 1>", "<source 2>"];
const sc = names.map(n => game.scenes.getName(n));
window.__c = {base: sc[0].id, src: sc.slice(1).map(s => s.id), baseWalls: sc[0].walls.size, srcWalls: Object.fromEntries(sc.slice(1).map(s => [s.name, s.walls.size])),
  json: Object.fromEntries(sc.map(s => [s.name, s.toObject()])), created: []};
names.map(n => [n, JSON.stringify(window.__c.json[n]).length])
```

**SIZES.** Checks the sources can be copied coordinate for coordinate. Every source scene must match the base scene's width, height, grid and padding. If any differs, stop and ask the user: coordinates would need an offset, and every placeable moves with it.

```js
const base = game.scenes.get(window.__c.base);
const key = s => JSON.stringify([s.width, s.height, s.padding, s.grid.type, s.grid.size, s.grid.distance, s.background.offsetX, s.background.offsetY]);
window.__c.src.map(id => game.scenes.get(id)).map(s => [s.name, key(s) === key(base)])
```

**LEVELS.** One Level per floor on the base scene: 9 ft tall and 10 ft apart, so floor n spans `[10n, 10n + 9]`. Floors below ground take negative elevations (a dungeon at -20..-11, a basement at -10..-1). Name each Level by the user's pattern, such as "Collector's Wizard Tower (Library)", and ask for the pattern if there isn't one. Set `background.src` to that floor's map image (the source scene's `background.src`). The base scene's own floor stays on its existing Level, id `defaultLevel0000`: rename and re-elevate it, don't create a second one. Set every Level's `visibility.levels`, base included, to itself plus every Level below it, so viewing a floor draws the floors beneath it while each floor still shows only its own walls. A Level copied from a one-floor scene arrives with an empty list, which leaves the floors unlinked.

```js
const base = game.scenes.get(window.__c.base);
const floors = [ // [source scene name or "base", level name, floor number]
  ["base", "<name>", 0], ["<source 1>", "<name>", 1]];
await base.levels.get("defaultLevel0000").update({name: floors[0][1], "elevation.bottom": floors[0][2] * 10, "elevation.top": floors[0][2] * 10 + 9});
// A Level also holds foreground, fog, background color and texture settings (anchor, scale, fit), so copy the source's own Level, not just its image.
const made = await base.createEmbeddedDocuments("Level", floors.slice(1).map(([s, name, n]) => {
  const o = game.scenes.getName(s).firstLevel.toObject(); delete o._id;
  return {...o, name, sort: n * 100, elevation: {bottom: n * 10, top: n * 10 + 9}}; }));
window.__c.lv = Object.fromEntries(floors.map(([s, , n], i) => [s, i ? made[i - 1].id : "defaultLevel0000"])); // keyed "base", then by source scene name
window.__c.created.push(...made.map(l => l.id));
const order = floors.map(([s, , n]) => [window.__c.lv[s], n]).sort((a, b) => a[1] - b[1]).map(([id]) => id); // lowest floor first
await base.updateEmbeddedDocuments("Level", order.map((id, i) => ({_id: id, "visibility.levels": order.slice(0, i + 1)})));
base.levels.map(l => [l.id, l.name, l.elevation.bottom, l.elevation.top, l.background.src, [...l.visibility.levels]])
```

**BASE TO BASE LEVEL.** An empty `levels` set means every level, so the base scene's own walls, lights, tiles and regions show on every floor until each is assigned to the base level. Tokens carry a single `level` instead of a `levels` set. Lights also get `elevation` at the base Level's bottom. Run it after LEVELS and before any copy, so it only touches the base scene's own documents. VIEW LEVEL first, since it updates tokens.

```js
const base = game.scenes.get(window.__c.base);
await base.view({level: "defaultLevel0000"});
const out = {};
for (const coll of ["walls", "lights", "tiles", "drawings", "regions", "notes", "sounds"]) {
  const ups = base[coll].filter(d => !d.levels?.size).map(d => ({_id: d.id, levels: ["defaultLevel0000"], ...(coll === "lights" ? {elevation: base.levels.get("defaultLevel0000").elevation.bottom} : {})}));
  if (ups.length) await base.updateEmbeddedDocuments(base[coll].documentName, ups);
  out[coll] = ups.length;
}
const tk = base.tokens.filter(t => !t.level).map(t => ({_id: t.id, level: "defaultLevel0000"}));
if (tk.length) await base.updateEmbeddedDocuments("Token", tk);
out.tokens = tk.length; out
```

**COPY WALLS.** One source scene at a time. Every source scene's only level is also named `defaultLevel0000`, so set `levels` to the target level explicitly on every copy. Never leave it to default.

```js
const base = game.scenes.get(window.__c.base);
const s = game.scenes.getName("<source>"), lid = window.__c.lv["<source>"];
const docs = s.walls.map(w => { const o = w.toObject(); delete o._id; o.levels = [lid]; return o; });
const made = await base.createEmbeddedDocuments("Wall", docs);
made.length + " of " + s.walls.size
```

**WALL SIGNATURE.** Proves the copy matches: a sorted signature of coords, move, sight, light, sound, door, ds and dir, compared against the source. Wall counts alone are not enough. Perceptive's helper walls are left out here and checked by PERCEPTIVE FIX. Run it right after the copy: a door the table has since locked or opened (`ds`), or a wall nudged by hand, shows up as a difference that is not a copy fault, so read the two lists before judging.

```js
const sig = w => JSON.stringify([w.c, w.move, w.sight, w.light, w.sound, w.door, w.ds, w.dir]);
const noP = w => !w.flags?.perceptive?.isPerceptiveWallFlag;
const base = game.scenes.get(window.__c.base);
const s = game.scenes.getName("<source>"), lid = window.__c.lv["<source>"];
const a = s.walls.filter(noP).map(sig), b = base.walls.filter(w => w.levels.has(lid) && noP(w)).map(sig);
({source: a.length, copy: b.length, onlySource: a.filter(x => !b.includes(x)), onlyCopy: b.filter(x => !a.includes(x))})
```

Expect equal counts and two empty lists.

**PERCEPTIVE FIX.** Perceptive gives each door three stacked helper walls (`flags.perceptive.isPerceptiveWallFlag`) and lists their ids in the door's `flags.perceptive.LockPeekingWallIDsFlag`. After COPY WALLS the copied doors point at the source scene's helper ids, Perceptive rebuilds helpers on some levels (orphaning the copies), and it lays diagonal-door helpers as two halves plus one full wall. Per level: delete orphan helpers on rebuilt levels, repoint dangling doors at the copied helpers under them, reset helper coords to the door's coords, then check that the level's wall count equals the source's.

```js
const base = game.scenes.get(window.__c.base);
const out = [];
for (const [name, lid] of Object.entries(window.__c.lv)) {
  const here = base.walls.filter(w => w.levels.has(lid));
  const live = new Set(here.map(w => w.id));
  const helpers = here.filter(w => w.flags?.perceptive?.isPerceptiveWallFlag);
  const doors = here.filter(w => w.flags?.perceptive?.LockPeekingWallIDsFlag?.length);
  const dangling = doors.filter(d => d.flags.perceptive.LockPeekingWallIDsFlag.some(id => !live.has(id)));
  const referenced = new Set(doors.flatMap(d => d.flags.perceptive.LockPeekingWallIDsFlag).filter(id => live.has(id)));
  out.push({level: name, walls: here.length, source: name === "base" ? window.__c.baseWalls : window.__c.srcWalls[name], helpers: helpers.length, dangling: dangling.map(d => d.id), orphans: helpers.filter(h => !referenced.has(h.id)).map(h => h.id)});
}
out
```

Read the printout, then fix each level. Delete the `orphans` (`base.deleteEmbeddedDocuments("Wall", ids)`) on the copied floors where Perceptive rebuilt helpers, and show the user the ids first. Leave the `"base"` level's own helpers alone. For each dangling door, take the three helpers on that level nearest the door's midpoint that no live door references, set the door's `flags.perceptive.LockPeekingWallIDsFlag` to their ids, then set each helper's `c` to the door's `c` (Perceptive lays a diagonal door's helpers as two halves plus one full wall, so nearest-by-midpoint is the match, not equal coords). Re-run until every level shows `walls === source`, no `dangling` and no `orphans`.

**COPY LIGHTS.** Set `elevation` to the level's bottom. Without it a light falls back to whichever level is being viewed.

```js
const base = game.scenes.get(window.__c.base);
const s = game.scenes.getName("<source>"), lid = window.__c.lv["<source>"], bottom = base.levels.get(lid).elevation.bottom;
const docs = s.lights.map(l => { const o = l.toObject(); delete o._id; o.levels = [lid]; o.elevation = bottom; return o; });
(await base.createEmbeddedDocuments("AmbientLight", docs)).length + " of " + s.lights.size
```

**COPY TOKENS.** `level` is the level id, `elevation` is the level's bottom plus the token's old elevation, and `keepId` keeps the ids so combatants stay valid. Strip `_movementHistory` and `_regions`. Run it with the base view on the target level first (VIEW LEVEL).

```js
const base = game.scenes.get(window.__c.base);
const s = game.scenes.getName("<source>"), lid = window.__c.lv["<source>"], bottom = base.levels.get(lid).elevation.bottom;
const docs = s.tokens.map(t => { const o = t.toObject(); delete o._movementHistory; delete o._regions; o.level = lid; o.elevation = (o.elevation ?? 0) + bottom; return o; });
(await base.createEmbeddedDocuments("Token", docs, {keepId: true})).length + " of " + s.tokens.size
```

**RESTORE DELTA.** dnd5e re-rolls HP for unlinked NPC tokens when they are created, so the copy's `delta` can differ from the source's. Diff every unlinked token's `delta` against the source and write the source's values back.

```js
const base = game.scenes.get(window.__c.base);
const s = game.scenes.getName("<source>");
const rows = [];
for (const t of s.tokens.filter(t => !t.actorLink)) {
  const c = base.tokens.get(t.id);
  const d = foundry.utils.diffObject(c.delta.toObject(), t.delta.toObject());
  if (!foundry.utils.isEmpty(d)) { rows.push([t.name, JSON.stringify(d)]); await c.delta.update(t.delta.toObject()); }
}
rows
```

Re-run until it returns `[]`, at most three times: a field that still differs is listed for the user.

**COPY OTHERS.** Tiles, drawings, notes and sounds, and regions that are not stairs, the same way as the walls. Elevation is absolute on the merged scene, so shift each copy up by the level's bottom, the way COPY TOKENS does: a region bounded [0, 9] on floor 2 (20 to 29) would never fire. Skip every stair region, one with a `teleportToken` or `changeLevel` behavior: a teleport points at the source scenes, a Change Level region copied onto a single Level has nowhere to send a token, and step 8 rebuilds both. Other behaviors (toggle behavior, scripts with uuids) may also point at the source scenes: list every copied region's behaviors and tell the user about each one that does, and each region you skip.

```js
const base = game.scenes.get(window.__c.base);
const s = game.scenes.getName("<source>"), lid = window.__c.lv["<source>"], bottom = base.levels.get(lid).elevation.bottom, out = {};
for (const coll of ["tiles", "drawings", "regions", "notes", "sounds"]) {
  const docs = s[coll].filter(d => !(coll === "regions" && d.behaviors.some(b => ["teleportToken", "changeLevel"].includes(b.type)))).map(d => {
    const o = d.toObject(); delete o._id; o.levels = [lid];
    if (coll === "regions") { for (const k of ["bottom", "top"]) if (typeof o.elevation?.[k] === "number") o.elevation[k] += bottom; }
    else if (typeof o.elevation === "number") o.elevation += bottom;
    return o; });
  if (docs.length) out[coll] = (await base.createEmbeddedDocuments(s[coll].documentName, docs)).length + " of " + s[coll].size;
}
out
```

**VIEW LEVEL.** Moving or updating a token through the API throws "Cannot read properties of undefined (reading 'parent')" in `includedInLevel` unless this client is viewing the token's level. View it first.

```js
await game.scenes.get(window.__c.base).view({level: window.__c.lv["<source>"]}); "viewing"
```

**MOVE COMBAT.** A combat cannot change scenes. Make a new Combat on the base scene, with `round` and `turn` set at create time (setting them in an update would re-fire turn-start automation), copy `flags` (automated-conditions-5e stores combatant ids there), create the combatants with `keepId`, check the turn order, and only then delete the old combat. Look for active effects that carry the old combat id first: `game.actors.contents.flatMap(a => a.effects.filter(e => JSON.stringify(e.toObject()).includes("<old combat id>")))` plus the same over the scene's tokens, and tell the user what points at it.

```js
const old = game.combats.get("<old combat id>");
const c = await Combat.create({scene: window.__c.base, active: old.active, round: old.round, turn: old.turn, flags: foundry.utils.deepClone(old.flags)});
await c.createEmbeddedDocuments("Combatant", old.combatants.map(x => ({...x.toObject(), sceneId: window.__c.base})), {keepId: true}); // sceneId decides which scene's token a combatant resolves to
({same: JSON.stringify(c.turns.map(x => x.id)) === JSON.stringify(old.turns.map(x => x.id)), round: [old.round, c.round], turn: [old.turn, c.turn]})
```

**STAIRS.** One core Change Level region per stairway, on both adjacent Levels. A token that walks into it gets a dialog to go up or down, keeps its square, and lands at the destination Level's bottom (`elevation.base`). Use it when the user calls a region stairs, and for a source stair whose two ends sit on the same squares. Name it "NNN Stairs" (NNN is the stairway number). Run its elevation from the lower floor's bottom to the upper floor's bottom with the top included, so a token standing on either floor is inside it. Floors alternate flights, so a middle floor must never get two overlapping stairways: a token inside both gets two dialogs. When the user drew the region, update theirs with the same `levels` and `elevation` instead of creating one, and apply any extra settings they name.

```js
const base = game.scenes.get(window.__c.base);
const lo = window.__c.lv["<lower source>"], hi = window.__c.lv["<upper source>"];
const bot = id => base.levels.get(id).elevation.bottom;
const data = {levels: [lo, hi], elevation: {bottom: bot(lo), top: bot(hi), topInclusive: true}};
const shape = {type: "rectangle", x: 0, y: 0, width: 0, height: 0, rotation: 0, hole: false}; // the stair squares
const [r] = await base.createEmbeddedDocuments("Region", [{name: "001 Stairs", shapes: [shape], ...data}]);
// A region the user drew instead: const r = base.regions.get("<region id>"); await r.update(data);
await r.createEmbeddedDocuments("RegionBehavior", [{type: "changeLevel", system: {movementActions: []}}]); // empty = every movement action
({id: r.id, name: r.name, levels: [...r.levels], elevation: r.toObject().elevation, behaviors: r.behaviors.map(b => b.type)})
```

**TELEPORT STAIRS.** A Teleport Token region pair, one on each adjacent Level. Use it when the user asks for a teleport between two regions, and for a source stair whose two ends sit on different squares: Change Level keeps a token on its square, so it can't carry one to a landing drawn elsewhere. Name the lower floor's region "NNN Stairs ^" and the upper floor's "NNN Stairs v". Settings: placement `relative`, `choice` on, `transition` fade at 1500 ms. Floors alternate flights here too. Core teleport clamps the arriving token's head into the destination region's elevation range (`RegionDocument#clampElevation`), so a region as tall as the floor lands a downward traveller 4 ft up. Give each stair region the elevation range `[floor bottom, floor bottom + 5)`. When the user drew the two regions, update each with its name, `levels` and `elevation` instead of creating them.

```js
const base = game.scenes.get(window.__c.base);
const lo = window.__c.lv["<lower source>"], hi = window.__c.lv["<upper source>"];
const bot = id => base.levels.get(id).elevation.bottom;
const lower = {type: "rectangle", x: 0, y: 0, width: 0, height: 0, rotation: 0, hole: false}, upper = {...lower}; // each end's own squares
const [up, dn] = await base.createEmbeddedDocuments("Region", [
  {name: "001 Stairs ^", levels: [lo], elevation: {bottom: bot(lo), top: bot(lo) + 5}, shapes: [lower]},
  {name: "001 Stairs v", levels: [hi], elevation: {bottom: bot(hi), top: bot(hi) + 5}, shapes: [upper]}]);
const tp = (to) => ({type: "teleportToken", system: {destinations: [to.uuid], placement: "relative", choice: true, transition: {type: "fade", duration: 1500}}});
await up.createEmbeddedDocuments("RegionBehavior", [tp(dn)]); await dn.createEmbeddedDocuments("RegionBehavior", [tp(up)]);
"pair made"
```

## Your Task

### Steps

1. **Take the plan and get the go-ahead.** Name the base scene, every source scene with its floor number, the Level name for each floor, and where below-ground floors sit. Say which source scenes have tokens, a combat or stairs, and whether each stair becomes STAIRS or TELEPORT STAIRS (step 8). Wait for the user's OK before changing anything.
2. **BACKUP.** Run it, and offer the user the JSON downloads before LEVELS, saying a page reload loses the in-memory copy. Foundry stays open: this job only touches scenes through the API.
3. **SIZES.** Stop on any mismatch (see the block).
4. **LEVELS, then BASE TO BASE LEVEL.** Print the Levels and check names, elevations, backgrounds and visibility lists (each Level lists itself and every Level below it) before copying. `window.__c.lv` maps `"base"` and each source scene's name to its level id.
5. **Per source scene, in floor order:**
   - COPY WALLS, then WALL SIGNATURE. Expect equal counts and two empty lists.
   - PERCEPTIVE FIX, until every level reads clean.
   - COPY LIGHTS.
   - VIEW LEVEL, then COPY TOKENS, then RESTORE DELTA until it returns `[]`.
   - COPY OTHERS, then read the behaviors it lists.
6. **Duplicates.** A linked actor that appears on two source scenes becomes two tokens. List them and ask the user which to keep, then delete the other.
7. **Combat.** A combat already on the base scene needs no move. If a source scene has one, run MOVE COMBAT. Check the turn order printed, and delete the old combat only after the user confirms.
8. **Stairs.** Rebuild each stair that COPY OTHERS skipped. Compare the two ends' squares (each source region's `shapes[0]`): the same squares on both floors get STAIRS, different squares get TELEPORT STAIRS. The stair number comes from the digits in the source region's name. When the user draws a region and calls it stairs, run STAIRS on it; when they draw two and ask for a teleport between them, run TELEPORT STAIRS on them. Then test every stairway both ways with a 1x1 and a 2x2 token (`foundryvtt:live-test` covers VIEW LEVEL and how to move a token): the traveller must land on the right floor at that floor's elevation.
   - For STAIRS, PLACE the token beside the region and walk it in with `tok.move([{x, y}])`. The dialog opens only for a move into the region, never for a displacement or a token already inside, and it opens in the mover's tab. Click its Move Up or Move Down button (`button[data-action="yes"]`) there before running POPUPS, which closes every DialogV2.
   - Move tokens between floors through the stairs, or with `tok.move` given both `level` and `elevation`. The Token HUD's Change Level button passes only the Level id (core v14 through 14.370), so the token keeps its old elevation and lands 10 ft under the floor above.
   - Quote elevations to the user as the HUD shows them: the HUD and the token tooltip read relative to the viewed Level's bottom, so a token stored at 10 on a floor whose bottom is 10 shows 0.
9. **Check the whole scene.** View each level and confirm its background, that walls and lights show only on their own floor, and that doors open. Read the console for new errors.
10. **Leave the originals.** Move the source scenes (not the base scene) into a folder named for the job and report. Delete them only on the user's word, after they have walked the new scene.

```js
const f = await Folder.create({name: "<job name> (originals)", type: "Scene"});
for (const id of window.__c.src) await game.scenes.get(id).update({folder: f.id});
"moved"
```

### Guardrails

- Copy placeables with `toObject()`, delete `_id`, and set `levels: [levelId]` every time. Every source scene's only level has the id `defaultLevel0000`, so a document that arrives without `levels` set lands on the base level.
- Never leave a placeable with an empty `levels` set on the base scene.
- Test the Test Player on stairs as `foundryvtt:live-test` describes, in the 127.0.0.1 tab. Keep the GM tab signed in.
- A combat can't change scenes: make a new one. Set `round` and `turn` when you create it.
- Never delete a source scene, a combat or a token the user hasn't confirmed.
- Foundry stays open for this job. A direct file edit of a world needs Foundry closed (`foundryvtt:live-test` CLOSE and START).
- Return plain values from `javascript_tool` (`JSON.stringify`, `toObject()`), never a Foundry document.
- Don't use em dashes.

---
*Source: `%USERPROFILE%\GitHub\claude-skills_and_plugins-homebrew\foundryvtt\skills\condense-scenes-to-levels\SKILL.md`. Edit it there, never an installed copy, then raise `version` in both `foundryvtt/.claude-plugin/plugin.json` and the repo's `.claude-plugin/marketplace.json`.*
