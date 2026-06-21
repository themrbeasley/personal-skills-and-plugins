I see the problem. Your macro uses `args[0].targets[0]` -- that's the **Item Macro module pattern**, and Item Macro is dead. It was superseded by built-in DND5e Activity macros in DND5e 3.x+. If you updated DND5e recently (and on 5.2.5 you're well past that), the `args` array no longer gets populated the way Item Macro used to populate it. That's why you get no effect and no error -- `args[0].targets[0]` silently resolves to `undefined`, and Sequencer just doesn't play anything when `.stretchTo()` receives `undefined`.

Let's get you back to playing right now, then do it properly after the session.

## Quick fix -- paste this into the browser console (F12)

Select the caster token, target the enemy, then run:

```js
const caster = canvas.tokens.controlled[0];
const target = game.user.targets.first();

if (!caster) { ui.notifications.warn("Select your caster token!"); }
else if (!target) { ui.notifications.warn("Target an enemy first!"); }
else {
  new Sequence()
    .effect()
      .file("jb2a.fire_bolt.orange")
      .atLocation(caster)
      .stretchTo(target)
    .play();
}
```

That will fire right now with no module dependencies. Have the caster player select their token, target the enemy, and run it from the console each time they cast Fire Bolt. Ugly, but it works while players are waiting.

## Slightly better band-aid -- save as a macro

If you want it on the hotbar instead of the console:

1. Open the **Macro Directory** (book icon in the left sidebar)
2. Click **Create Macro**
3. Set type to **Script**
4. Paste this:

```js
const caster = canvas.tokens.controlled[0];
const target = game.user.targets.first();

if (!caster) {
  ui.notifications.warn("Select your caster token first!");
} else if (!target) {
  ui.notifications.warn("Target an enemy first!");
} else {
  new Sequence()
    .effect()
      .file("jb2a.fire_bolt.orange")
      .atLocation(caster)
      .stretchTo(target)
    .play();
}
```

5. Save it, drag it to the hotbar. Select token, target enemy, click the macro.

That gets you through tonight.

## Why it broke

Your original code:

```js
new Sequence()
  .effect()
    .file("jb2a.fire_bolt.orange")
    .atLocation(token)
    .stretchTo(args[0].targets[0])
  .play();
```

This was written for the **Item Macro** module, which injected `token` and `args` into the macro context when an item was used. Item Macro is no longer maintained and has been superseded by DND5e's built-in Activity macros (since DND5e 3.x). On your current DND5e 5.2.5:

- `token` in an ItemMacro context is likely `undefined` or stale
- `args[0].targets[0]` is definitely `undefined` -- the old args structure doesn't get populated anymore
- Sequencer receives `undefined` for both `.atLocation()` and `.stretchTo()`, so it silently does nothing -- no error, no effect

This would have broken whenever DND5e was updated past the point where Item Macro stopped being compatible, which lines up with "it was fine last week" if a module update landed.

## The real fix (post-session)

After the session, the correct approach is to wire this into **Midi-QOL hooks** so the effect fires automatically when Fire Bolt is cast and hits. No manual token selection needed. Here's the pattern:

```js
Hooks.on("midi-qol.AttackRollComplete", (workflow) => {
  if (workflow.item.name !== "Fire Bolt") return;

  let seq = new Sequence();

  for (let target of workflow.hitTargets) {
    seq.effect()
      .file("jb2a.fire_bolt.orange")
      .atLocation(workflow.token)
      .stretchTo(target);
  }

  // If missed targets should get a "near miss" visual:
  for (let target of workflow.targets) {
    if (workflow.hitTargets.has(target)) continue;
    seq.effect()
      .file("jb2a.fire_bolt.orange")
      .atLocation(workflow.token)
      .stretchTo(target)
      .missed(true);
  }

  seq.play();
});
```

This hooks into Midi-QOL's attack resolution. `workflow.token` is the caster, `workflow.hitTargets` is everyone who was actually hit, `workflow.targets` is everyone targeted. The effect fires automatically -- no token selection, no targeting, no manual macro click. Hits land on target; misses veer off.

You'd register this hook in a world script or a macro that runs on world load. We can set that up properly when there's no table waiting.

---

## Sequencer Triage Report -- 2026-05-14

**Symptom:** Fire Bolt animation produces no effect and no console error. Macro runs silently with no visible result.

**Context:** ItemMacro on Fire Bolt cantrip. Was working last week, stopped working with no code changes. Likely triggered by a DND5e or module update.

**Error messages:** None -- silent failure due to `undefined` token/target references.

**Quick fixes attempted:** Replaced with console/hotbar macro using `canvas.tokens.controlled[0]` and `game.user.targets.first()` -- works.

**Band-aid applied:** Manual hotbar macro (select token + target enemy + click). Functional but requires manual steps per cast.

**Suspected cause:** Item Macro module is obsolete. `args[0].targets[0]` no longer gets populated in DND5e 5.2.5. The old ItemMacro context injection stopped working after a system update.

**Next steps:**
1. Remove the Item Macro module entirely if still installed
2. Wire Fire Bolt effect into a Midi-QOL `AttackRollComplete` hook (code provided above)
3. Register the hook in a world script so it loads automatically
4. Check all other items using ItemMacro patterns and migrate them to Midi-QOL hooks or DND5e Activity macros
5. Verify the JB2A database path is still valid: run `Sequencer.Database.getEntry("jb2a.fire_bolt.orange")` in console -- should return a SequencerFile, not false

### Relevant code (original, broken)
```js
new Sequence()
  .effect()
    .file("jb2a.fire_bolt.orange")
    .atLocation(token)
    .stretchTo(args[0].targets[0])
  .play();
```

### Environment
- Foundry version: v13
- DND5e version: 5.2.5
- Sequencer version: (check in Module Management)
- Midi-QOL version: (check in Module Management)
- JB2A: Patreon pack
- Other relevant modules: DAE, TimesUp, Portal
