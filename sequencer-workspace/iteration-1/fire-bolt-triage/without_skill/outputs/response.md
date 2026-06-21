# Fire Bolt Animation Triage

## Quick Diagnosis

Your macro code is syntactically fine. The "silent failure" pattern -- no animation AND no console error -- points to one of a few specific causes. Here they are ranked by likelihood given your stack (Foundry v13, DND5e 5.2.5, Midi-QOL, Sequencer, JB2A Patreon).

---

## Most Likely Cause: Midi-QOL / ItemMacro Hook Change

Foundry v13 and recent Midi-QOL updates changed how ItemMacro scripts receive their arguments. The variable `args[0].targets[0]` may now be undefined or structured differently, which would cause Sequencer to silently skip the effect (Sequencer does not throw when a location resolves to nothing -- it just plays nothing).

### Immediate Fix (get your game moving now)

Replace your ItemMacro with this version that adds defensive checks and uses the current Midi-QOL argument structure:

```javascript
// Fire Bolt -- ItemMacro (postAttackRoll or postDamageRoll)
const lastArg = args[args.length - 1];

// Try multiple ways to get the target token
let targetToken;

// Method 1: Midi-QOL workflow targets (current v13 pattern)
if (lastArg?.targets?.length > 0) {
  targetToken = lastArg.targets[0].object ?? lastArg.targets[0];
}

// Method 2: game.user.targets fallback
if (!targetToken) {
  const userTargets = Array.from(game.user.targets);
  if (userTargets.length > 0) {
    targetToken = userTargets[0];
  }
}

// Method 3: args[0] direct (legacy pattern)
if (!targetToken && args[0]?.targets?.[0]) {
  targetToken = args[0].targets[0].object ?? args[0].targets[0];
}

if (!targetToken) {
  ui.notifications.warn("Fire Bolt: No target found for animation.");
} else {
  new Sequence()
    .effect()
      .file("jb2a.fire_bolt.orange")
      .atLocation(token)
      .stretchTo(targetToken)
    .play();
}
```

### Why this works

- `args[args.length - 1]` is the standard way to get the Midi-QOL workflow data regardless of which hook phase you are in.
- The `.object` accessor handles cases where Midi-QOL passes a token document rather than a token placeable (Sequencer needs the placeable for positioning).
- The `game.user.targets` fallback catches cases where the workflow arguments are empty but the user still has a target selected.
- The `ui.notifications.warn` replaces the silent failure with a visible message if something is still wrong.

---

## Other Possible Causes (check if the above does not fix it)

### 1. Sequencer Module Updated and Broke Compatibility

Check: Open the console (F12) and type:
```javascript
Sequencer.Database.getEntry("jb2a.fire_bolt.orange")
```
- If it returns `undefined`, JB2A's database entries did not register. Try: **Settings > Manage Modules** and toggle Sequencer and JB2A off, save, then toggle them back on and reload.

### 2. The `token` Variable Is Not Defined

In Foundry v13, the implicit `token` variable in ItemMacro depends on the macro execution context. If Midi-QOL changed which hook fires your macro, `token` might be undefined.

Check by adding this at the top of your macro:
```javascript
console.log("token:", token);
console.log("args:", JSON.stringify(args, null, 2));
```

If `token` is undefined, replace `token` with:
```javascript
const sourceToken = canvas.tokens.get(lastArg.tokenId);
```
Then use `sourceToken` in `.atLocation(sourceToken)`.

### 3. JB2A Asset Path Changed

The JB2A Patreon module occasionally renames database keys between versions. If `Sequencer.Database.getEntry("jb2a.fire_bolt.orange")` returns nothing, try:
```javascript
// Check what fire_bolt entries exist
Sequencer.Database.getPathsUnder("jb2a.fire_bolt")
```
The path may have changed to something like `jb2a.ranged.fire_bolt.orange` or `jb2a.fire_bolt.orange.01`.

### 4. ItemMacro Execution Phase

If your ItemMacro is set to run at a phase where the attack has not resolved targets yet, `targets` will be empty. In Midi-QOL settings, ensure the macro runs at **postAttackRoll** or later (not preAttackRoll).

---

## Full Robust Version (for after the session)

Once the game is over, consider this more complete version:

```javascript
// Fire Bolt -- robust ItemMacro for Foundry v13 + Midi-QOL + Sequencer + JB2A
const lastArg = args[args.length - 1];

// Resolve source token
const sourceToken = token ?? canvas.tokens.get(lastArg.tokenId);
if (!sourceToken) {
  console.warn("Fire Bolt macro: could not resolve source token");
  return;
}

// Resolve target token
let targetToken;
if (lastArg?.targets?.length > 0) {
  const t = lastArg.targets[0];
  targetToken = t.object ?? canvas.tokens.get(t.id ?? t._id ?? t.document?.id);
} else {
  const userTargets = Array.from(game.user.targets);
  if (userTargets.length > 0) targetToken = userTargets[0];
}

if (!targetToken) {
  ui.notifications.warn("Fire Bolt: No target token found.");
  return;
}

// Verify JB2A asset exists
const assetPath = "jb2a.fire_bolt.orange";
const entry = Sequencer.Database.getEntry(assetPath);
if (!entry) {
  ui.notifications.warn(`Fire Bolt: Asset "${assetPath}" not found in Sequencer DB.`);
  console.warn("Available fire_bolt paths:", Sequencer.Database.getPathsUnder("jb2a.fire_bolt"));
  return;
}

// Play the animation
new Sequence()
  .effect()
    .file(assetPath)
    .atLocation(sourceToken)
    .stretchTo(targetToken)
    .missed(lastArg.hitTargets?.size === 0)
  .play();
```

This version also adds a `.missed()` call so the bolt veers off on a miss -- a nice visual touch.

---

## 30-Second Action Plan

1. Open the Fire Bolt item, go to the ItemMacro tab.
2. Paste the "Immediate Fix" code above.
3. Save. Target a token. Cast Fire Bolt.
4. If it still does not fire, open the console (F12) and check for any output -- the warn/log messages will tell you exactly which link in the chain is broken.
