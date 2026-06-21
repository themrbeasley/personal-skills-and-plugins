# Effect Recipes

Six archetypes cover the vast majority of custom effects. Start from the closest recipe and modify — don't build from scratch.

## 1. Projectile (A → B)

A visual that stretches from a source to a target. Beams, bolts, rays, thrown weapons.

```js
// Simplest version — beam from caster to target
const caster = canvas.tokens.controlled[0];
const target = game.user.targets.first();

new Sequence()
  .effect()
    .file("jb2a.eldritch_blast.purple")
    .atLocation(caster)
    .stretchTo(target)
  .play();
```

```js
// Full version — projectile with impact on hit
const caster = canvas.tokens.controlled[0];
const target = game.user.targets.first();

new Sequence()
  .effect()
    .file("jb2a.eldritch_blast.purple")
    .atLocation(caster)
    .stretchTo(target)
    .missed(false)
    .waitUntilFinished(-500)
  .effect()
    .file("jb2a.impact.004.purple")
    .atLocation(target)
    .scaleToObject(1.5)
    .fadeIn(100)
    .fadeOut(300)
  .play();
```

```js
// Miss variant — offset the landing
new Sequence()
  .effect()
    .file("jb2a.eldritch_blast.purple")
    .atLocation(caster)
    .stretchTo(target)
    .missed(true)
  .play();
```

**Key methods:** `.stretchTo()` does the heavy lifting — it stretches and rotates the effect from `.atLocation()` to the target. `.waitUntilFinished(-500)` starts the impact slightly before the projectile finishes for a snappy feel.

**Common mistake:** Using `.moveTowards()` instead of `.stretchTo()`. `.moveTowards()` moves an effect like a token; `.stretchTo()` stretches a beam/bolt visual between two points. For projectiles, you almost always want `.stretchTo()`.

---

## 2. Impact (at a point)

An effect that plays at a single location. Explosions, hits, ground cracks, splashes.

```js
// Simplest version
const target = game.user.targets.first();

new Sequence()
  .effect()
    .file("jb2a.impact.ground_crack.orange.01")
    .atLocation(target)
    .scale(0.5)
  .play();
```

```js
// Full version — impact with sound and screen shake
const target = game.user.targets.first();

new Sequence()
  .effect()
    .file("jb2a.impact.ground_crack.orange.01")
    .atLocation(target)
    .scale(0.8)
    .belowTokens()
    .fadeIn(100)
  .effect()
    .file("jb2a.explosion.01.orange")
    .atLocation(target)
    .scaleToObject(2)
    .fadeIn(100)
    .fadeOut(500)
  .sound()
    .file("modules/soundfxlibrary/Combat/Melee/sword-hit-1.wav")
    .volume(0.6)
  .play();
```

**Key methods:** `.atLocation()` places it. `.scaleToObject()` sizes relative to the target token. `.belowTokens()` puts ground cracks under the token layer.

**Common mistake:** Forgetting `.scale()` or `.scaleToObject()` — many JB2A effects are large at default scale. Always check the visual size.

---

## 3. Aura / Persistent Buff

An effect that attaches to a token and stays until removed. Buffs, debuffs, auras, concentration indicators.

```js
// Simplest version — glowing aura
const token = canvas.tokens.controlled[0];

new Sequence()
  .effect()
    .file("jb2a.extras.tmfx.border.circle.inpulse.01.normal")
    .attachTo(token)
    .scaleToObject(1.8)
    .persist()
    .name("my_aura")
    .fadeIn(500)
    .fadeOut(500)
  .play();
```

```js
// Full version — pulsing aura with tint
const token = canvas.tokens.controlled[0];

new Sequence()
  .effect()
    .file("jb2a.extras.tmfx.border.circle.inpulse.01.normal")
    .attachTo(token, { followRotation: false })
    .scaleToObject(2)
    .persist()
    .name("bless_aura")
    .fadeIn(800)
    .fadeOut(800)
    .tint("#FFD700")
    .opacity(0.7)
    .belowTokens()
    .loopProperty("spriteContainer", "scale.x", {
      from: 0.95, to: 1.05,
      duration: 1500,
      pingPong: true,
      ease: "easeInOutSine"
    })
    .loopProperty("spriteContainer", "scale.y", {
      from: 0.95, to: 1.05,
      duration: 1500,
      pingPong: true,
      ease: "easeInOutSine"
    })
  .play();
```

```js
// Remove it later
await Sequencer.EffectManager.endEffects({ name: "bless_aura" });

// Or remove only from a specific token
await Sequencer.EffectManager.endEffects({ name: "bless_aura", object: token });
```

**Critical rule:** Always pair `.persist()` with `.name("something")`. Without a name, you can't end the effect later except by nuking everything.

**Key methods:** `.attachTo()` makes it follow the token. `.persist()` keeps it on the canvas. `.loopProperty()` creates ongoing animation. `followRotation: false` prevents the aura from rotating when the token rotates.

**DAE integration pattern** — tie the visual to an Active Effect so it auto-removes:

```js
// In a DAE macro (receives args from the Active Effect)
if (args[0] === "on") {
  const token = canvas.tokens.get(args[1]);
  new Sequence()
    .effect()
      .file("jb2a.extras.tmfx.border.circle.inpulse.01.normal")
      .attachTo(token)
      .scaleToObject(2)
      .persist()
      .name(`${args[args.length - 1]}_aura`)
      .origin(args[args.length - 1])
      .fadeIn(500)
      .fadeOut(500)
    .play();
}

if (args[0] === "off") {
  await Sequencer.EffectManager.endEffects({ origin: args[args.length - 1] });
}
```

---

## 4. Teleport / Movement

Combines token animation with visual effects. The token physically moves; the effects dress it up.

```js
// Simplest version — fade out, teleport, fade in
const token = canvas.tokens.controlled[0];
const destination = game.user.targets.first();

new Sequence()
  .animation()
    .on(token)
    .fadeOut(500)
  .animation()
    .on(token)
    .teleportTo(destination)
    .delay(500)
  .animation()
    .on(token)
    .fadeIn(500)
    .delay(500)
  .play();
```

```js
// Full version — misty step with VFX
const token = canvas.tokens.controlled[0];
const destination = game.user.targets.first();

new Sequence()
  // Departure effect
  .effect()
    .file("jb2a.misty_step.01.blue")
    .atLocation(token)
    .scaleToObject(2)
    .waitUntilFinished(-1000)
  // Hide and move the token
  .animation()
    .on(token)
    .fadeOut(200)
  .animation()
    .on(token)
    .teleportTo(destination)
    .delay(200)
  // Arrival effect
  .effect()
    .file("jb2a.misty_step.02.blue")
    .atLocation(destination)
    .scaleToObject(2)
  .animation()
    .on(token)
    .fadeIn(500)
    .delay(200)
  .play();
```

**Key methods:** `.animation()` operates on existing tokens/tiles. `.teleportTo()` is instant relocation. `.fadeOut()` / `.fadeIn()` on animation sections control the token's opacity.

**Common mistake:** Using `.effect().moveTowards()` when you mean `.animation().moveTowards()`. Effects create new visuals; animations move existing objects. For token movement, use `.animation()`.

---

## 5. Area Effect

Effect placed at a location sized to cover an area. Fireball ground scorch, spirit guardians circle, zone of truth.

```js
// Simplest version — ground effect at crosshair location
const location = await Sequencer.Crosshair.show({
  t: "circle",
  distance: 20,
  gridHighlight: true,
  snap: { position: "CENTER" }
});
if (!location) return;

new Sequence()
  .effect()
    .file("jb2a.ground_cracks.orange.01")
    .atLocation(location)
    .size(
      { width: canvas.grid.size * 8, height: canvas.grid.size * 8 },
      { gridUnits: false }
    )
    .belowTokens()
    .fadeIn(500)
    .duration(5000)
    .fadeOut(1000)
  .play();
```

```js
// Full version — fireball: beam, explosion, persistent scorch
const caster = canvas.tokens.controlled[0];
const location = await Sequencer.Crosshair.show({
  t: "circle",
  distance: 20,
  gridHighlight: true,
  snap: { position: "CENTER" },
  location: {
    obj: caster,
    limitMaxRange: 150,
    showRange: true,
    wallBehavior: Sequencer.Crosshair.PLACEMENT_RESTRICTIONS.LINE_OF_SIGHT
  }
});
if (!location) return;

new Sequence()
  // Beam from caster to target area
  .effect()
    .file("jb2a.fireball.beam.orange")
    .atLocation(caster)
    .stretchTo(location)
    .waitUntilFinished(-500)
  // Explosion
  .effect()
    .file("jb2a.explosion.01.orange")
    .atLocation(location)
    .scale(1.5)
    .fadeIn(100)
    .waitUntilFinished(-1000)
  // Ground scorch that lingers
  .effect()
    .file("jb2a.ground_cracks.orange.01")
    .atLocation(location)
    .size(
      { width: canvas.grid.size * 8, height: canvas.grid.size * 8 },
      { gridUnits: false }
    )
    .belowTokens()
    .fadeIn(300)
    .duration(10000)
    .fadeOut(2000)
    .opacity(0.6)
  .play();
```

**Key methods:** `.size()` sets the area dimensions. The crosshair system handles user targeting. `.belowTokens()` keeps ground effects under tokens. `.waitUntilFinished()` chains the beam → explosion → scorch.

**Sizing tip:** For a 20-foot radius effect on a standard 5-foot grid, the diameter is 40 feet = 8 squares. Size in pixels: `canvas.grid.size * 8`. Alternatively, use `{ gridUnits: true }` and pass the size in grid units directly.

---

## 6. Screen-Space Effect

Fixed to the viewport, not the canvas. Fullscreen flashes, vignettes, UI overlays.

```js
// Simplest version — red flash on damage
new Sequence()
  .effect()
    .file("jb2a.extras.tmfx.outpulse.circle.01.fast")
    .screenSpace()
    .screenSpaceAnchor(0.5)
    .opacity(0.4)
    .tint("#FF0000")
    .duration(800)
    .fadeIn(100)
    .fadeOut(500)
  .play();
```

```js
// Full version — dramatic divine intervention overlay
new Sequence()
  .effect()
    .file("jb2a.extras.tmfx.border.circle.inpulse.01.normal")
    .screenSpace()
    .screenSpaceAboveUI(true)
    .screenSpaceAnchor(0.5)
    .screenSpaceScale({ fitX: true, fitY: true })
    .opacity(0.6)
    .tint("#FFD700")
    .duration(3000)
    .fadeIn(500)
    .fadeOut(1000)
    .loopProperty("spriteContainer", "scale.x", {
      from: 0.9, to: 1.1,
      duration: 1000,
      pingPong: true
    })
    .loopProperty("spriteContainer", "scale.y", {
      from: 0.9, to: 1.1,
      duration: 1000,
      pingPong: true
    })
  .play();
```

**Key methods:** `.screenSpace()` switches from world coordinates to viewport coordinates. `.screenSpaceAnchor(0.5)` centers it. `.screenSpaceAboveUI(true)` renders above Foundry's interface. `.screenSpaceScale({ fitX: true })` stretches to screen width.

**Use sparingly.** Screen-space effects are dramatic but intrusive. Reserve for big moments — critical hits, divine intervention, TPK-level events.

---

## Combining recipes

Most real effects combine multiple archetypes. A Guiding Bolt is a projectile (recipe 1) + impact (recipe 2) + persistent target glow (recipe 3). Chain them with `.waitUntilFinished()`:

```js
const caster = canvas.tokens.controlled[0];
const target = game.user.targets.first();

new Sequence()
  // Projectile
  .effect()
    .file("jb2a.guiding_bolt.02.blueyellow")
    .atLocation(caster)
    .stretchTo(target)
    .waitUntilFinished(-500)
  // Impact flash
  .effect()
    .file("jb2a.impact.004.blueyellow")
    .atLocation(target)
    .scaleToObject(1.5)
  // Persistent glow (the "advantage on next attack" visual)
  .effect()
    .file("jb2a.extras.tmfx.outpulse.circle.02.normal")
    .attachTo(target)
    .scaleToObject(1.5)
    .persist()
    .name("guiding_bolt_glow")
    .tint("#4488FF")
    .opacity(0.6)
    .fadeIn(500)
    .fadeOut(500)
  .play();

// Clean up the glow when the condition ends:
// await Sequencer.EffectManager.endEffects({ name: "guiding_bolt_glow", object: target })
```

---

## Iterating on multiple targets

When an effect hits multiple targets (e.g., all tokens hit by an attack), loop and add sections to a single Sequence:

```js
const caster = canvas.tokens.controlled[0];
const targets = Array.from(game.user.targets);

let seq = new Sequence();

for (const target of targets) {
  seq.effect()
    .file("jb2a.chain_lightning.primary.blue")
    .atLocation(caster)
    .stretchTo(target)
    .waitUntilFinished(-300)
  .effect()
    .file("jb2a.impact.004.blue")
    .atLocation(target)
    .scaleToObject(1.5);
}

seq.play();
```

Build one Sequence, add sections in a loop, call `.play()` once. Don't create a new Sequence per target.
