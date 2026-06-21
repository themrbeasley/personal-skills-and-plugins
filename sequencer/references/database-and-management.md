# Database, Management, and Utilities

## Sequencer Database (`Sequencer.Database`)

The database is how asset packs (like JB2A) register their effects for easy lookup. Using database paths instead of file paths means macros survive asset reorganization.

### `Sequencer.Database.registerEntries(moduleName, entries)`
Register a collection of effects/sounds under a module name. Called in the `sequencerReady` hook:

```js
Hooks.on("sequencerReady", () => {
  Sequencer.Database.registerEntries("my_module", {
    effects: {
      laser: {
        red: "path/to/red_laser.webm",
        blue: "path/to/blue_laser.webm"
      }
    }
  });
});
```

For macros (not modules), skip the hook and call directly.

### `Sequencer.Database.getEntry(path)`
Look up a database path. Returns a `SequencerFile`, an array of them, or `false`.

```js
Sequencer.Database.getEntry("jb2a.fireball.beam.orange")
```

### `Sequencer.Database.getPathsUnder(path)`
**The discovery method.** Returns an array of keys available beneath a path. Use this to explore what's available:

```js
Sequencer.Database.getPathsUnder("jb2a")
// → ["melee", "ranged", "spell", "impact", ...]

Sequencer.Database.getPathsUnder("jb2a.impact")
// → ["001", "002", "003", "004", ...]

Sequencer.Database.getPathsUnder("jb2a.impact.004")
// → ["blue", "dark_red", "green", ...]
```

This is the primary way to find assets. Drill down from general → specific.

### `Sequencer.Database.getAllFileEntries(moduleName)`
Get all registered file paths for a module as a flat string array.

### `Sequencer.Database.validateEntries(moduleName)`
Verify all registered paths exist on disk. Useful for checking asset installation.

### Database Viewer
```js
Sequencer.DatabaseViewer.show()
```
Opens a UI with tree and list views for browsing, previewing, and copying database paths.

### Advanced database features

**Range-finding**: Define distance variants and Sequencer picks the best match:
```js
fire_bolt: {
  dark_red: {
    "05ft": "path/to/05ft.webm",
    "30ft": "path/to/30ft.webm",
    "60ft": "path/to/60ft.webm",
    "90ft": "path/to/90ft.webm"
  }
}
```
When used with `.stretchTo()`, Sequencer automatically selects the appropriate range variant.

**Templates** (`_templates`): Define grid sizes and padding for consistent asset behavior.

**Internal loops** (`_markers`): Define loop start/end times within a single file, avoiding the need to split animations.

**Time ranges** (`_timeRange`): Extract specific portions of a file: `_timeRange: [startMs, endMs]`.

**Timestamps** (`_timestamps`): Array of millisecond values that fire the `sequencerEffectTimestamp` hook during playback.

**Flipbooks** (`_flipbook`): Set `_flipbook: true` to bundle image frames into an animation. Control speed with `_fps` (default 24).

**Spritesheets**: Reference a JSON manifest pointing to a packed sprite atlas. Uses PIXI.js format with optional `frameRate`.

---

## Effect Manager (`Sequencer.EffectManager`)

Manages effects on the canvas — finding them, ending them, and showing the management UI.

### `Sequencer.EffectManager.show()`
Opens the Effect Manager UI. GMs can see and end all effects; players can only end their own.

### `Sequencer.EffectManager.getEffects(filters)`
Find effects matching criteria. Returns an array of CanvasEffect objects.

Filters:
- `name`: string, supports wildcards (`"fireball_*"`, `"*test*"`)
- `object`: PlaceableObject or its ID
- `source`: source object, document, or UUID
- `target`: target object, document, or UUID
- `sceneId`: defaults to current scene
- `origin`: from `.origin()` method

```js
// All effects named "my_aura"
Sequencer.EffectManager.getEffects({ name: "my_aura" })

// Named effects on a specific token
Sequencer.EffectManager.getEffects({ name: "my_aura", object: token })

// Wildcard search
Sequencer.EffectManager.getEffects({ name: "*buff*" })
```

### `Sequencer.EffectManager.endEffects(filters)`
End effects matching criteria. Same filter options as `getEffects`, plus:
- `effects`: specific CanvasEffect or effect ID

```js
await Sequencer.EffectManager.endEffects({ name: "my_aura" })
await Sequencer.EffectManager.endEffects({ name: "my_aura", object: token })
await Sequencer.EffectManager.endEffects({ origin: item.uuid })
```

You can only end effects you created, unless you're a GM.

### `Sequencer.EffectManager.endAllEffects(sceneId)`
End every effect on a scene. GM only. Defaults to current scene.

```js
await Sequencer.EffectManager.endAllEffects()
```

---

## Sound Manager (`Sequencer.SoundManager`)

Same pattern as Effect Manager but for sounds.

### `Sequencer.SoundManager.show()`
Opens the Sound Manager UI.

### `Sequencer.SoundManager.getSounds(filters)`
Filters: `name` (wildcards), `sounds`, `sceneId`, `origin`.

### `Sequencer.SoundManager.endSounds(filters)`
End matching sounds. Same restrictions — own sounds only unless GM.

### `Sequencer.SoundManager.endAllSounds(sceneId)`
End all sounds on a scene. GM only.

---

## Preloader (`Sequencer.Preloader`)

Cache files on clients for faster playback. Use with caution — not every client has unlimited bandwidth.

### `Sequencer.Preloader.preloadForClients(files, showProgressBar)`
Preload on all connected clients.
- `files`: string, array of strings, database path, or array of database paths
- `showProgressBar`: boolean, shows a progress bar on each client

### `Sequencer.Preloader.preload(files, showProgressBar)`
Preload on the local client only.

---

## Presets (`Sequencer.Presets`)

Reusable configurations applied via `.preset()` in any section.

### `Sequencer.Presets.add(name, fn, overwrite)`
Register a preset:

```js
Sequencer.Presets.add("pulse", (effect, args) => {
  return effect
    .loopProperty("spriteContainer", "scale.x", {
      from: 0.9, to: 1.1,
      duration: args?.duration ?? 1000,
      pingPong: true, ease: "easeInOutSine"
    })
    .loopProperty("spriteContainer", "scale.y", {
      from: 0.9, to: 1.1,
      duration: args?.duration ?? 1000,
      pingPong: true, ease: "easeInOutSine"
    });
});
```

### `Sequencer.Presets.getAll()`
Returns all registered presets.

### `Sequencer.Presets.get(name, exactMatch)`
Get a specific preset function. Set `exactMatch` to true to prevent fallback to less-specific names.

### Using presets
```js
new Sequence()
  .effect()
    .file("jb2a.braziers.blue.bordered.01.05x05ft")
    .atLocation(token)
    .preset("pulse")
    .persist()
  .play()
```

---

## Helpers (`Sequencer.Helpers`)

Utility functions.

| Method | Description |
|---|---|
| `await Sequencer.Helpers.wait(ms)` | Pause execution |
| `Sequencer.Helpers.clamp(value, min, max)` | Constrain a number |
| `Sequencer.Helpers.interpolate(p1, p2, t, ease)` | Interpolate between two values |
| `Sequencer.Helpers.random_float_between(min, max)` | Random decimal |
| `Sequencer.Helpers.random_int_between(min, max)` | Random integer |
| `Sequencer.Helpers.shuffle_array(array)` | Shuffled copy |
| `Sequencer.Helpers.random_array_element(array, recurse)` | Random pick |
| `Sequencer.Helpers.random_object_element(object, recurse)` | Random property value |
| `Sequencer.Helpers.make_array_unique(array)` | Deduplicate |

---

## Section Manager (`Sequencer.SectionManager`)

For creating custom section types. Advanced — only relevant if building a module that extends Sequencer.

### `Sequencer.SectionManager.registerSection(moduleName, name, Class)`
Register a custom section class. The class must extend `Sequencer.BaseSection`, have a constructor calling `super(inSequence)`, and define an `async run()` method. All methods should return `this` for chaining.

---

## Hooks

Hooks Sequencer fires during its lifecycle:

| Hook | When | Parameters |
|---|---|---|
| `sequencerReady` | Sequencer finished setup, ready for database registrations | — |
| `sequencerEffectManagerReady` | All effects loaded on the current scene | — |
| `createSequencerSequence` | A Sequence begins playback | — |
| `endedSequencerSequence` | A Sequence finishes | — |
| `preCreateSequencerEffect` | Before an effect section runs | `effectData` |
| `endedSequencerEffect` | An effect finishes playing | `effectData` |
| `sequencerEffectTimestamp` | Effect reaches a defined timestamp | `CanvasEffect, SequencerFile` |
| `preCreateSequencerSound` | Before a sound section runs | `soundData` |
| `createSequencerSound` | A sound is created on canvas | `soundData` |
| `endedSequencerSound` | A sound finishes playing | `soundData` |

Register with standard Foundry pattern:
```js
Hooks.on("sequencerReady", () => { /* ... */ });
```
