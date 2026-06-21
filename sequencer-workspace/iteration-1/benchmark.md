# Sequencer Skill -- Iteration 1 Benchmark

**Model**: claude-sonnet-4-20250514
**Date**: 2026-05-14
**Evals**: frostbite-projectile, bless-persistent-aura, fire-bolt-triage (1 run each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|-----------|---------------|-------|
| Pass Rate | 95.3% +/- 8.2% | 72.3% +/- 38.1% | **+23.0%** |
| Time | 83.9s +/- 1.2s | 74.5s +/- 18.6s | +9.4s |
| Tokens | 56,352 +/- 442 | 39,890 +/- 1,341 | +16,462 |

## Per-Eval Breakdown

| Eval | With Skill | Without Skill | Delta |
|------|-----------|---------------|-------|
| frostbite-projectile | 6/7 (86%) | 7/7 (100%) | -14% |
| bless-persistent-aura | 8/8 (100%) | 7/8 (88%) | +12% |
| fire-bolt-triage | 7/7 (100%) | 2/7 (29%) | **+71%** |

## Key Observations

1. Fire-bolt triage is the killer eval. The skill identifies ItemMacro as dead and provides migration guidance. Without it, the model patches an obsolete module.
2. Frostbite baseline wins on null-checks. The skill should instruct null-checking in console prototypes.
3. Bless shows technique depth via .loopProperty() vs relying on self-animating assets.
4. Token cost is +41% due to loading skill + references. Time overhead is modest (+9.4s).
5. With-skill variance is low (8.2% stddev) vs without-skill (38.1% stddev). The skill stabilizes output quality.