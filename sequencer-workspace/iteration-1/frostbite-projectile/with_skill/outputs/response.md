# Frostbite Blade -- Custom Sequencer Effect

Nice -- a projectile-into-impact is one of the cleanest effect patterns to build. Before I write code, let me confirm what I'm working with based on your setup:

- **Foundry v13**, DND5e 5.2.5, Sequencer, Midi-QOL, DAE, TimesUp, Portal, **JB2A Patreon** pack
- **Execution context:** Browser console for prototyping (select attacker token, target a victim token, paste into console)
- **What you want:** An icy bolt that shoots from the attacker to the target, followed by a frost/ice burst on impact

That maps directly to the **Projectile + Impact** pattern -- two chained `.effect()` sections in one Sequence.

---

## Step 1: Find the right assets

Before writing any effect code, we need to know what ice/frost assets JB2A actually has. Run these in your browser console to explore:

```js
// What ice-related effects exist?
Sequencer.Database.getPathsUnder("jb2a.ice_shard")
```

```js
// What about ray of frost (classic cold projectile)?
Sequencer.Database.getPathsUnder("jb2a.ray_of_frost")
```

```js
// Impact effects -- look for cold/blue options
Sequencer.Database.getPathsUnder("jb2a.impact")
```

```js
// Also check for breath weapons and ice-themed bursts
Sequencer.Database.getPathsUnder("jb2a.breath_weapons.cold")
```

With the JB2A Patreon pack, you should have access to paths like:

- `jb2a.ray_of_frost` -- a cold beam/bolt, perfect for the projectile
- `jb2a.ice_shard` -- ice shard projectiles (also a good candidate)
- `jb2a.impact.004.blue` -- a solid blue impact burst
- `jb2a.impact.frost` -- if available in your version, a frost-specific impact

Run the discovery commands above to confirm exact paths. The database paths vary slightly between JB2A versions, and I want you working with paths you can verify rather than ones that silently fail.

---

## Step 2: Simplest version -- get something on screen

Select your attacking token on the canvas, then target the victim token (press T and click it, or whatever your targeting keybind is). Then paste this into the browser console:

```js
const caster = canvas.tokens.controlled[0];
const target = game.user.targets.first();

new Sequence()
  .effect()
    .file("jb2a.ray_of_frost")
    .atLocation(caster)
    .stretchTo(target)
  .play();
```

You should see a cold ray stretch from your selected token to the targeted token. If it works, great -- we have the right file path and the token references are valid. If nothing happens, check:

1. Is a token selected? (`canvas.tokens.controlled[0]` should not be undefined)
2. Is a token targeted? (`game.user.targets.first()` should not be undefined)
3. Is the file path valid? (Run the discovery commands from Step 1)

---

## Step 3: Add the impact burst

Now we chain an ice impact that fires right as the bolt arrives. The key is `.waitUntilFinished(-500)` on the projectile -- this starts the impact effect 500ms before the bolt finishes, so the burst overlaps with the bolt's arrival for a snappy feel.

```js
const caster = canvas.tokens.controlled[0];
const target = game.user.targets.first();

new Sequence()
  .effect()
    .file("jb2a.ray_of_frost")
    .atLocation(caster)
    .stretchTo(target)
    .waitUntilFinished(-500)
  .effect()
    .file("jb2a.impact.004.blue")
    .atLocation(target)
    .scaleToObject(1.5)
    .fadeIn(100)
    .fadeOut(300)
  .play();
```

This gives you: icy bolt flies from attacker to target, then a blue impact burst plays on the target. Two effects, one Sequence, clean timing.

---

## Step 4: Polish it up

Now let's add the finishing touches -- better timing, a slight scale punch on the impact, and an icy tint to really sell the frost theme.

```js
const caster = canvas.tokens.controlled[0];
const target = game.user.targets.first();

new Sequence()
  // --- Icy bolt: attacker -> target ---
  .effect()
    .file("jb2a.ray_of_frost")
    .atLocation(caster)
    .stretchTo(target)
    .missed(false)
    .waitUntilFinished(-500)
  // --- Frost impact burst on the target ---
  .effect()
    .file("jb2a.impact.004.blue")
    .atLocation(target)
    .scaleToObject(2)
    .scaleIn(0.4, 200, { ease: "easeOutBack" })
    .fadeIn(100)
    .fadeOut(400)
    .filter("ColorMatrix", { saturate: 0.3, brightness: 1.2 })
    .zIndex(1)
  .play();
```

What changed from Step 3:

- `.missed(false)` -- explicitly marks this as a hit (set to `true` if you want a miss variant where the bolt drifts off-target)
- `.scaleToObject(2)` -- bumped up from 1.5 for a more dramatic burst
- `.scaleIn(0.4, 200, { ease: "easeOutBack" })` -- the impact starts small and punches outward with a slight overshoot, giving it a satisfying "pop"
- `.filter("ColorMatrix", { saturate: 0.3, brightness: 1.2 })` -- desaturates the impact slightly and brightens it, making it look more like cold ice rather than a generic blue flash
- `.zIndex(1)` -- ensures the impact renders above the bolt if they overlap

---

## Alternative: ice shard instead of ray of frost

If you prefer a chunkier, more physical projectile (a shard of ice flying through the air rather than a beam), try swapping the projectile file:

```js
const caster = canvas.tokens.controlled[0];
const target = game.user.targets.first();

new Sequence()
  .effect()
    .file("jb2a.ice_shard")
    .atLocation(caster)
    .stretchTo(target)
    .waitUntilFinished(-500)
  .effect()
    .file("jb2a.impact.004.blue")
    .atLocation(target)
    .scaleToObject(2)
    .scaleIn(0.4, 200, { ease: "easeOutBack" })
    .fadeIn(100)
    .fadeOut(400)
    .filter("ColorMatrix", { saturate: 0.3, brightness: 1.2 })
  .play();
```

Run both versions and see which one feels right for the Frostbite Blade's fantasy. The ray of frost is a continuous beam; the ice shard is a discrete projectile. Either works -- it's an aesthetic call.

---

## Cleanup

If you're testing repeatedly and effects are piling up on the canvas, none of these are persistent (no `.persist()` calls), so they should auto-clean after playing. But if anything looks stuck:

```js
await Sequencer.EffectManager.endAllEffects()
```

That nukes everything (GM only). Use it freely during prototyping.

---

## Next steps

Once you're happy with how this looks in the console, the natural next step is wiring it into the Frostbite Blade item itself so it fires automatically on a hit. That means hooking into Midi-QOL's `midi-qol.AttackRollComplete` workflow -- the effect would fire only when the weapon actually hits, using `workflow.hitTargets` instead of manual targeting. Let me know when you're ready to take it there and I'll write the integration code.
