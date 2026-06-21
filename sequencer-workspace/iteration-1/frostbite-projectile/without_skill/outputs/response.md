# Frostbite Blade -- Sequencer Visual Effect

## Overview

This effect fires an icy projectile from the attacker to the target, then plays a frost impact burst on the target when it arrives. It uses the Sequencer module API with JB2A Patreon assets.

## Prerequisites

| Requirement | Notes |
|---|---|
| FoundryVTT v13 | Tested against v13.351+ |
| Sequencer module | Must be installed and active |
| JB2A Patreon asset pack | Premium pack required for the asset paths below |

## How to use

1. **Select** your attacker token on the canvas (click it so it has the selection border).
2. **Target** the enemy token (hover over it and press `T`, or whatever your targeting key is).
3. Open the browser console (`F12` --> Console tab).
4. Paste the script below and press Enter.

## The Script

```js
// ── Frostbite Blade: Icy Projectile + Frost Impact ──

// Grab the selected (attacker) and targeted (victim) tokens
const attacker = canvas.tokens.controlled[0];
const target = game.user.targets.first();

if (!attacker) {
  ui.notifications.error("Frostbite Blade: Select your attacker token first.");
  throw new Error("No token selected");
}
if (!target) {
  ui.notifications.error("Frostbite Blade: Target an enemy token first (hover + T).");
  throw new Error("No token targeted");
}

new Sequence()

  // ── 1. Icy bolt: attacker --> target ──
  .effect()
    .file("jb2a.ray_of_frost.blue")
    .atLocation(attacker)
    .stretchTo(target)
    .waitUntilFinished(-500)   // start the impact slightly before the bolt ends

  // ── 2. Frost impact burst on the target ──
  .effect()
    .file("jb2a.impact.frost.blue.01")
    .atLocation(target)
    .scaleToObject(2)          // scale up so it visually covers the token

  .play();
```

## What each piece does

### Token acquisition

```js
const attacker = canvas.tokens.controlled[0];
const target = game.user.targets.first();
```

- `canvas.tokens.controlled` is the array of tokens you currently have selected. We grab the first one.
- `game.user.targets` is a Set of tokens you have targeted. `.first()` pulls the first entry.
- The two guard-clauses after these lines pop a Foundry notification and bail out early if either is missing, so you get clear feedback instead of a silent failure.

### The Sequence

**`new Sequence()`** creates a Sequencer animation chain. Each `.effect()` call adds a new visual to the timeline.

**Effect 1 -- The icy bolt:**

```js
.effect()
  .file("jb2a.ray_of_frost.blue")
  .atLocation(attacker)
  .stretchTo(target)
  .waitUntilFinished(-500)
```

- `.file("jb2a.ray_of_frost.blue")` -- Uses the JB2A Ray of Frost animation in blue. This is a ranged projectile-style beam that looks like a streak of ice/frost.
- `.atLocation(attacker)` -- The animation originates at the attacker token.
- `.stretchTo(target)` -- The animation stretches across the canvas to reach the target token. Sequencer handles rotation and distance automatically.
- `.waitUntilFinished(-500)` -- Tells Sequencer to hold the timeline here until this effect is nearly done, but overlap the next effect by 500 ms. This creates a smooth transition where the impact starts just as the bolt arrives, rather than a jarring gap between the two.

**Effect 2 -- The frost impact:**

```js
.effect()
  .file("jb2a.impact.frost.blue.01")
  .atLocation(target)
  .scaleToObject(2)
```

- `.file("jb2a.impact.frost.blue.01")` -- A frost/ice burst impact animation from JB2A.
- `.atLocation(target)` -- Centered on the target token.
- `.scaleToObject(2)` -- Scales the impact animation to 2x the token's size, which gives a satisfying visual "explosion" of frost around the hit. Adjust the multiplier up or down to taste.

**`.play()`** kicks off the full sequence.

## Customization ideas

### Change the projectile color

JB2A ships Ray of Frost in several color variants. Replace the file path:

```js
.file("jb2a.ray_of_frost.blue")     // default
.file("jb2a.ray_of_frost.purple")   // purple variant
```

### Add a sound effect

Insert a `.sound()` section before or after an `.effect()`:

```js
new Sequence()
  .sound()
    .file("path/to/ice-whoosh.ogg")
    .volume(0.5)
  .effect()
    .file("jb2a.ray_of_frost.blue")
    .atLocation(attacker)
    .stretchTo(target)
    .waitUntilFinished(-500)
  .effect()
    .file("jb2a.impact.frost.blue.01")
    .atLocation(target)
    .scaleToObject(2)
  .play();
```

### Slow the projectile down

Add `.playbackRate(0.7)` to the bolt effect to make the icy beam travel more slowly for a heavier feel.

### Leave a lingering frost aura on the target

Add a third effect with `.persist()` to leave a visual on the target until manually removed:

```js
  // after the impact effect, add:
  .effect()
    .file("jb2a.markers.snowflake.blue.02")
    .atLocation(target)
    .scaleToObject(1.5)
    .persist()
    .name("frostbite-blade-marker")   // name it so you can remove it later
```

Remove it later from the console with:

```js
Sequencer.EffectManager.endEffects({ name: "frostbite-blade-marker" });
```

## Integrating into a macro or item

Once you are happy with the effect from the console, you can paste the same script into:

- **A Foundry macro** (Hotbar --> Create Macro --> Script type) so you can trigger it with one click.
- **A Midi-QOL `onUse` macro** attached to the Frostbite Blade weapon item, so it fires automatically on every hit. In that context you would pull attacker/target from the Midi workflow arguments instead of from selection/targeting.
