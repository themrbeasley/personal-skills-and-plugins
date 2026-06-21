# Troubleshooting and Debugging

## Quick diagnostic checklist

When something isn't working, check these in order:

1. **Is the file path valid?** Open the Sequencer Database Viewer (`Sequencer.DatabaseViewer.show()`) and search for the path. If the path isn't there, it won't play.
2. **Is the token reference valid?** `canvas.tokens.controlled[0]` returns `undefined` if no token is selected. `game.user.targets.first()` returns `undefined` if nothing is targeted.
3. **Is the effect actually playing but invisible?** Check scale (too small), opacity (set to 0), layer (below tiles and hidden), or `.forUsers()` filtering out your user.
4. **Is there a console error?** F12 → Console tab. Sequencer errors are descriptive.
5. **Is the effect persisting when it shouldn't?** Check for stray `.persist()` calls. Clean up: `Sequencer.EffectManager.endEffects({ name: "..." })`.

---

## Common errors and fixes

### "No file found" / Effect doesn't play (no error)

**Cause:** Wrong database path or file path.

**Fix:** Verify the path exists:
```js
Sequencer.Database.getEntry("jb2a.fireball.beam.orange")
// Returns SequencerFile if valid, false if not

// If unsure, drill down:
Sequencer.Database.getPathsUnder("jb2a.fireball")
// Shows available sub-paths
```

**Common path mistakes:**
- `jb2a_patreon` in the path instead of `jb2a` (database paths use the registered module name, not the folder name)
- Typos in color names: `"jb2a.impact.004.darkred"` vs `"jb2a.impact.004.dark_red"` — check with `getPathsUnder()`
- Using file system paths (`modules/jb2a_patreon/...`) instead of database paths (`jb2a....`) — database paths are shorter and survive reorganization

### Effect plays but nothing visible

**Cause (most likely):** Scale too small, wrong position, or rendered below other layers.

**Diagnose:**
```js
// Check if the effect exists on canvas
Sequencer.EffectManager.getEffects({ name: "test" })
// If it returns results, the effect exists but isn't visible where you expect
```

**Fixes:**
- Add `.scale(3)` temporarily to make it huge and visible, then dial back
- Remove `.belowTokens()` and `.belowTiles()` temporarily
- Add `.aboveLighting()` in case fog of war is hiding it
- Check `.opacity()` — a value of 0 is invisible

### Token reference is undefined

**Cause:** No token selected/targeted when the code runs.

**Symptom:** No error, but the effect doesn't play (or plays at coordinates 0,0 in the top-left corner).

**Fix:** Always validate before using:
```js
const token = canvas.tokens.controlled[0];
if (!token) {
  ui.notifications.warn("Select a token first!");
  return;
}

const target = game.user.targets.first();
if (!target) {
  ui.notifications.warn("Target a token first!");
  return;
}
```

### Persistent effect won't go away

**Cause:** The effect was created with `.persist()` but no `.name()`, or the name doesn't match what you're trying to end.

**Fix:**
```js
// See all active effects
Sequencer.EffectManager.getEffects({})
// Each result has .data.name — check what names exist

// End by name
await Sequencer.EffectManager.endEffects({ name: "stuck_effect" })

// End all effects on a token
await Sequencer.EffectManager.endEffects({ object: token })

// Nuclear option (GM only)
await Sequencer.EffectManager.endAllEffects()
```

### Effect plays at wrong position / orientation

**Cause:** Anchor point, offset, or rotation mismatch.

**Debug approach:**
```js
// Strip the effect to bare minimum positioning
new Sequence()
  .effect()
    .file("jb2a.impact.004.blue")
    .atLocation(token)
    .persist()
    .name("debug_position")
  .play();
// If this lands correctly, re-add options one at a time
```

**Common position issues:**
- `.stretchTo()` without `.atLocation()` — needs both a start and end point
- `.attachTo()` with the wrong `align` option — try `{ align: "center" }` explicitly
- `.offset()` in pixels when you meant grid units — add `{ gridUnits: true }`
- `.anchor()` changing the pivot point unintentionally — `0.5` is center, `0` is top-left

### `.waitUntilFinished()` seems to hang

**Cause:** The effect it's waiting on has `.persist()` — persistent effects never "finish," so the sequence waits forever.

**Fix:** Remove `.persist()` from the effect being waited on, or use a specific `.duration()` instead. If you need the effect to persist AND the sequence to continue, use `.waitUntilFinished(-X)` with a negative offset to continue early, or split into two separate Sequences.

### Effect only plays for me / doesn't play for players

**Cause:** `.locally()` is set, or `.forUsers()` is filtering.

**Check:** Remove `.locally()` and `.forUsers()` and see if all players see it. Also check that the file path is accessible to all clients — if you're referencing a local file path instead of a database path, other clients may not have the file.

### Midi-QOL hook not firing

**Cause:** Wrong hook name, or the workflow condition isn't met.

**Debug:**
```js
// Test that hooks fire at all
Hooks.on("midi-qol.AttackRollComplete", (workflow) => {
  console.log("Hook fired!", workflow.item.name, workflow.hitTargets.size);
});
// Then use the item and check the console
```

**Common issues:**
- Hook name typo — the names are case-sensitive
- Filtering by wrong item name — `workflow.item.name` must match exactly
- Using `workflow.targets` when you mean `workflow.hitTargets` — targets is everyone targeted, hitTargets is only those actually hit

### DAE macro not triggering Sequencer effect

**Cause:** The macro name in the Active Effect doesn't match, or `args` aren't being parsed correctly.

**Debug:**
```js
// Add logging at the top of the DAE macro
console.log("DAE macro fired, args:", args);
// args[0] is "on" or "off"
// args[args.length - 1] is the Active Effect UUID
```

**Common issues:**
- Macro name in Active Effect doesn't exactly match the macro in the Macro Directory
- Using `lastArg` (old convention) instead of `args[args.length - 1]`
- Token ID from `args[1]` returns null because the token isn't on the current scene

---

## Debugging techniques

### The isolation method

When a complex sequence doesn't work, isolate the problem:

1. Comment out everything except the first section
2. Does it work? Add the second section back
3. Repeat until you find the section that breaks it
4. Within that section, strip to minimum (`.file()` + `.atLocation()`) and re-add methods one at a time

### Console logging for sequences

```js
// Log what Sequencer is actually doing
Hooks.on("preCreateSequencerEffect", (data) => {
  console.log("Sequencer creating effect:", data);
});

Hooks.on("endedSequencerEffect", (data) => {
  console.log("Sequencer effect ended:", data);
});
```

### Verify database paths interactively

```js
// Full drill-down from top level
Sequencer.Database.getPathsUnder("jb2a")
// → ["melee", "ranged", "spell", "impact", "explosion", ...]

Sequencer.Database.getPathsUnder("jb2a.impact")
// → ["001", "002", "003", "004", ...]

Sequencer.Database.getPathsUnder("jb2a.impact.004")
// → ["blue", "dark_red", "green", ...]

// Confirm the final path resolves
Sequencer.Database.getEntry("jb2a.impact.004.blue")
// Should return a SequencerFile object, not false
```

### Testing effects safely

Always name test effects so they can be cleaned up:
```js
new Sequence()
  .effect()
    .file("jb2a.impact.004.blue")
    .atLocation(canvas.tokens.controlled[0])
    .persist()
    .name("TEST_delete_me")
  .play();

// Clean up
await Sequencer.EffectManager.endEffects({ name: "TEST_delete_me" });
```

---

## Obsolete module translation guide

Community documentation, forum posts, and macro compendiums frequently reference modules that no longer exist or have been superseded. When you encounter these patterns — whether in code the user pastes, examples found online, or your own training data — translate to the modern equivalent.

### Item Macro → DND5e Activity Macros

**Dead pattern:**
```js
// Item Macro module — allowed running a macro when an item was used
// Stored macro code directly on the item
// args[0] contained a workflow-like object
```

**Modern replacement:** DND5e 3.x+ has built-in Activity macros. The item's Activities tab can reference a macro. Midi-QOL hooks are the other option for reacting to item use.

**Key differences:**
- Activity macros receive structured context (actor, token, item) — not the old `args` array
- Midi-QOL hooks provide `workflow` with `.token`, `.targets`, `.hitTargets`
- No module installation needed — it's built into the system

### Warpgate → Portal

**Dead pattern:**
```js
// Warpgate — token spawning and mutation
await warpgate.spawn("Actor Name", updates, callbacks, options);
await warpgate.mutate(token, updates, callbacks, options);
await warpgate.revert(token);
```

**Modern replacement:** Portal module handles token spawning. For mutations (temporary stat changes), use Active Effects via DAE.

**If someone shares a macro using `warpgate.spawn()`:** Translate to Portal's spawn API. The concepts are similar (pick a location, spawn a token with modifications) but the API is different.

### Old `args` patterns

**Dead pattern:**
```js
// Old ItemMacro / early DAE convention
let tactor = args[0].actor;
let ttoken = args[0].token;
let itemData = args[0].itemData;
```

**Modern replacement for Midi-QOL hooks:**
```js
Hooks.on("midi-qol.RollComplete", (workflow) => {
  let actor = workflow.actor;
  let token = workflow.token;
  let item = workflow.item;
});
```

**Modern replacement for DAE macros:**
```js
// args[0] is "on" or "off"
// args[1] is the token ID
// args[args.length - 1] is the Active Effect UUID
if (args[0] === "on") {
  const token = canvas.tokens.get(args[1]);
  // apply effect
}
```

### Red flags in pasted code

If the user pastes code containing any of these, flag it immediately:
- `ItemMacro` or `itemMacro` — dead module
- `warpgate.spawn` or `warpgate.mutate` — dead module
- `args[0].itemData` — old ItemMacro convention
- `game.macros.getName("X").execute(args)` — old pattern for item-triggered macros
- `DAE.setFlag` / `DAE.unsetFlag` — may still work but check if the newer DAE API has changed

---

## Triage report template

When something breaks during a session and there's no time for a proper fix, create this report. The user can point the skill at it in a later session for deep debugging.

```markdown
## Sequencer Triage Report — [date]

**Symptom:** [what broke — be specific: "fire bolt effect plays at 0,0 instead of on the target"]
**Context:** [what was happening: spell cast, item used, scene loaded, Active Effect applied, etc.]
**Error messages:** [exact console errors, if any — copy/paste from F12 console]
**Quick fixes attempted:** [what was tried, what happened when each was tried]
**Band-aid applied:** [what workaround is in place, e.g. "disabled the macro, using basic dice rolling"]
**Suspected cause:** [best guess — "token reference is stale after scene change", "database path changed after JB2A update", etc.]
**Next steps:** [what to investigate when there's time — specific things to check, not vague "debug more"]

### Relevant code
[paste the macro or hook code that was running when it broke]

### Environment
- Foundry version:
- DND5e version:
- Sequencer version:
- Midi-QOL version:
- Browser:
- Any recent module updates:
```
