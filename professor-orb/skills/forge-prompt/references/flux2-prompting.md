# FLUX.2 Prompting Reference

Source: Black Forest Labs documentation, `docs.bfl.ai/guides/prompting_guide_flux2`

Model-specific prompt craft for FLUX.2 generation from scratch. This file is the reason the forge-prompt skill exists as its own component: this material goes stale when the model does, and isolating it here means refreshing it is a bounded task rather than an audit of a skill about read-aloud prose. Check it against the live guide when results stop matching what it describes. This file covers prompt text. Generator settings live in ComfyUI and are the DM's, not this skill's.

---

## Core principles

1. FLUX.2 does not support negative prompts. Describe what you want, not what you do not want. Replace an exclusion with a positive specification: "sharp focus" rather than "no blur."
2. Word order carries weight. Elements placed early receive more attention from the model.
3. Describe positively throughout.

## Prompt anatomy

The four-part frame: **Subject** (the main focus), **Action** (what it does, or its pose), **Style** (medium, artistic approach, aesthetic), **Context** (setting, lighting, time, mood, atmosphere).

## Length bands

| Band | Words | Use |
|---|---|---|
| Short | 10 to 30 | Quick concept exploration |
| Medium | 30 to 80 | Ideal for most work |
| Long | 80 plus | Complex scenes needing detailed specification |

## Photorealistic style

Reference specific eras, cameras, lenses, and film stocks. Examples: "shot on Sony A7IV," "80s vintage photo," "Kodak Portra 400."

## Typography and text rendering

- Put the literal text in quotation marks: the text 'OPEN' appears in red neon.
- Specify placement relative to other elements.
- Describe the font: serif, bold, handwritten.
- Give colors as hex codes when brand or palette consistency matters.

## Hex color prompting

- Signal a color with the keyword "color" or "hex" immediately before the code.
- Associate each hex code with a specific object rather than placing it vaguely.
- For gradients, specify both the start and end color so the transition is defined.

## JSON structured prompting

When to use: production workflows, automation, complex multi-subject scenes, and consistent iteration across a series.
Base schema keys: `scene`, `subjects` (each with `description`, `position`, `action`), `style`, `color_palette`, `lighting`, `mood`, `background`, `composition`, `camera` (with `angle`, `lens`, `depth_of_field`).

## Series and sequential consistency

Repeat detailed, identical character descriptions across every panel or frame. Consistency comes from repetition of the description, not from the model remembering.

## Multi-language

Prompting in the native language of the content being depicted often produces more culturally authentic results.

## Prompt upsampling

Automatically expands a basic prompt with detail while preserving the original intent.
