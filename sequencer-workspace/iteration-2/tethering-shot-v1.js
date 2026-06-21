// ============================================================
// TETHERING SHOT — Iteration 1
// Paste this entire block into Foundry's F12 console (Ctrl+Shift+I)
//
// BEFORE RUNNING:
//   1. Have TEST HERO, TEST PLAYER, and TEST NPC on the scene
//   2. Select TEST HERO (the bowman)
//   3. Target both TEST PLAYER and TEST NPC (hold T and click each)
//   4. Use the Tethering Shot activity on the longbow normally
//   5. The hook fires after Midi-QOL resolves the workflow
//
// TO CLEAN UP (if chains persist or you want to reset):
//   Sequencer.EffectManager.endEffects({ name: "tethering_chain*" })
//   canvas.tokens.placeables.forEach(t => {
//     t.actor?.effects.filter(e => e.name === "Tethering Shot - Chained")
//       .forEach(e => e.delete());
//   });
// ============================================================

(async () => {
  // --- Cleanup previous registration ---
  if (window._tetheringHookId) {
    Hooks.off("midi-qol.RollComplete", window._tetheringHookId);
    console.log("Tethering Shot: removed previous hook");
  }
  if (window._tetheringCleanupId) {
    Hooks.off("deleteActiveEffect", window._tetheringCleanupId);
    console.log("Tethering Shot: removed previous cleanup hook");
  }

  // --- Discover chain-like JB2A assets ---
  // Log options so we can pick a better one if needed
  const candidates = [
    "jb2a.energy_beam",
    "jb2a.chain_lightning",
    "jb2a.lightning_bolt",
    "jb2a.binding",
    "jb2a.entangle",
    "jb2a.web"
  ];
  console.log("=== JB2A Asset Discovery for chain effects ===");
  for (const path of candidates) {
    const entries = Sequencer.Database.getPathsUnder(path);
    if (entries.length) console.log(`${path}:`, entries);
  }

  // Default asset — energy beam gives a nice tethered look when tinted
  // CHANGE THIS if you find a better match in the discovery log above
  const CHAIN_FILE = "jb2a.chain_lightning.primary.blue";

  // --- Configuration ---
  const SAVE_DC = 16;
  const SAVE_ABILITY = "str";
  const DURATION_ROUNDS = 10; // 1 minute

  // --- Main hook: fires after Midi-QOL finishes the full workflow ---
  window._tetheringHookId = Hooks.on("midi-qol.RollComplete", async (workflow) => {
    // Match on item or activity name — log what we see so we can fix the match
    const itemName = workflow.item?.name;
    const activityName = workflow.activity?.name;
    console.log(`Tethering Shot hook: item="${itemName}", activity="${activityName}"`);

    const isTethering = itemName === "Tethering Shot" ||
                        activityName === "Tethering Shot";
    if (!isTethering) return;

    console.log("Tethering Shot: matched! Processing...");

    // Check for a hit on the primary target
    if (!workflow.hitTargets?.size) {
      ui.notifications.warn("Tethering Shot: Attack missed — no chains.");
      return;
    }

    // Get the two targets — user must have both targeted before the attack
    const targets = Array.from(game.user.targets);
    if (targets.length < 2) {
      ui.notifications.warn(
        `Tethering Shot: Need 2 targets selected, found ${targets.length}. ` +
        `Target both creatures before using the activity.`
      );
      return;
    }
    const [target1, target2] = targets;
    console.log(`Tethering Shot: targets are ${target1.name} and ${target2.name}`);

    // --- Roll STR saves for both targets ---
    // DND5e 5.2.5 save API — this may need adjustment
    // Trying the most common patterns; errors here tell us the right API
    let roll1, roll2;
    try {
      // Pattern A: DND5e 3.x+ rollAbilitySave
      roll1 = await target1.actor.rollAbilitySave(SAVE_ABILITY, {
        targetValue: SAVE_DC,
        chatMessage: true,
        fastForward: true
      });
      roll2 = await target2.actor.rollAbilitySave(SAVE_ABILITY, {
        targetValue: SAVE_DC,
        chatMessage: true,
        fastForward: true
      });
    } catch (e1) {
      console.warn("Tethering Shot: rollAbilitySave failed, trying rollSavingThrow", e1);
      try {
        // Pattern B: newer API
        roll1 = await target1.actor.rollSavingThrow({ ability: SAVE_ABILITY });
        roll2 = await target2.actor.rollSavingThrow({ ability: SAVE_ABILITY });
      } catch (e2) {
        console.error("Tethering Shot: Could not roll saves. API mismatch.", e2);
        ui.notifications.error("Tethering Shot: Save roll API failed — check F12 console.");
        return;
      }
    }

    // Extract totals — the roll object structure varies by version
    const total1 = roll1?.total ?? roll1?.roll?.total ?? roll1?._total;
    const total2 = roll2?.total ?? roll2?.roll?.total ?? roll2?._total;
    console.log(`Tethering Shot saves: ${target1.name}=${total1}, ${target2.name}=${total2} (DC ${SAVE_DC})`);

    const fail1 = total1 < SAVE_DC;
    const fail2 = total2 < SAVE_DC;

    if (!fail1 || !fail2) {
      const saved = [];
      if (!fail1) saved.push(target1.name);
      if (!fail2) saved.push(target2.name);
      ui.notifications.info(
        `Tethering Shot: ${saved.join(" and ")} resisted! Both must fail for chains to bind.`
      );
      return;
    }

    // --- Both failed! Apply the chain ---
    const groupId = `${target1.id}_${target2.id}`;
    const effectName = `tethering_chain_${groupId}`;

    console.log("Tethering Shot: Both failed! Playing chain effect...");

    new Sequence()
      .effect()
        .file(CHAIN_FILE)
        .attachTo(target1)
        .stretchTo(target2, { attachTo: true })
        .persist()
        .name(effectName)
        .fadeIn(500)
        .fadeOut(500)
        .opacity(0.8)
        .tint("#8855DD")
      .play();

    // --- Apply Active Effects for speed halving ---
    for (const target of [target1, target2]) {
      const other = target === target1 ? target2 : target1;
      await target.actor.createEmbeddedDocuments("ActiveEffect", [{
        name: "Tethering Shot - Chained",
        icon: "icons/magic/control/debuff-chains-ropes-purple.webp",
        duration: {
          rounds: DURATION_ROUNDS,
          startRound: game.combat?.round ?? 0,
          startTurn: game.combat?.turn ?? 0
        },
        changes: [
          // Halve all movement — may need adjustment for DND5e 5.2.5 schema
          {
            key: "system.attributes.movement.walk",
            mode: CONST.ACTIVE_EFFECT_MODES.MULTIPLY,
            value: "0.5",
            priority: 25
          },
          {
            key: "system.attributes.movement.fly",
            mode: CONST.ACTIVE_EFFECT_MODES.MULTIPLY,
            value: "0.5",
            priority: 25
          },
          {
            key: "system.attributes.movement.swim",
            mode: CONST.ACTIVE_EFFECT_MODES.MULTIPLY,
            value: "0.5",
            priority: 25
          }
        ],
        flags: {
          "tethering-shot": {
            linkedTokenId: other.id,
            effectGroup: groupId,
            sequencerEffect: effectName
          }
        }
      }]);
    }

    ui.notifications.info(
      `Spectral chains bind ${target1.name} and ${target2.name}! ` +
      `Speed halved. Chains last ${DURATION_ROUNDS} rounds or until broken.`
    );
  });

  // --- Cleanup hook: when an AE is deleted, remove the chain + paired AE ---
  window._tetheringCleanupId = Hooks.on("deleteActiveEffect", async (effect, options, userId) => {
    if (effect.name !== "Tethering Shot - Chained") return;
    const flags = effect.flags?.["tethering-shot"];
    if (!flags) return;

    console.log(`Tethering Shot: cleaning up chain group ${flags.effectGroup}`);

    // End the Sequencer visual
    await Sequencer.EffectManager.endEffects({ name: flags.sequencerEffect });

    // Remove the other target's AE (if it still exists)
    const linkedToken = canvas.tokens.get(flags.linkedTokenId);
    if (linkedToken?.actor) {
      const linkedAE = linkedToken.actor.effects.find(e =>
        e.name === "Tethering Shot - Chained" &&
        e.flags?.["tethering-shot"]?.effectGroup === flags.effectGroup
      );
      if (linkedAE) {
        console.log(`Tethering Shot: removing paired AE from ${linkedToken.name}`);
        await linkedAE.delete();
      }
    }

    ui.notifications.info("The spectral chains shatter and fade!");
  });

  // --- Done ---
  console.log("========================================");
  console.log("Tethering Shot automation is ACTIVE");
  console.log("Target 2 creatures, then use Tethering Shot");
  console.log("Check the JB2A asset discovery log above");
  console.log("========================================");
  ui.notifications.info("Tethering Shot automation ready!");
})();
