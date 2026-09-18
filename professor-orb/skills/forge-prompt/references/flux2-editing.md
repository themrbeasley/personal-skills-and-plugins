# FLUX.2 Image Editing Reference

Source: Black Forest Labs documentation, `docs.bfl.ai/guides/usecases_editing_clothing_tryon`

Prompt craft for editing an image that already exists rather than generating one from nothing. The governing difference: an edit prompt must say what stays as loudly as it says what changes, because anything left unspecified is a candidate for the model to reinvent. Check this against the live guide when results stop matching what it describes.

---

## The edit frame

Three parts, all required: the **change** (what becomes different), the **preservation** (what must survive untouched), and the **context** (scene and pose continuity). Omitting the preservation clause is the single most common cause of an edit that alters things you did not ask it to.

Written out, the frame opens on the image and the change, then names what survives:

```
Edit image [1]: <the change>. Preserve exactly: <everything the edit could disturb, by visible property>.
```

Context goes in whichever clause it belongs to: a new setting is part of the change, an unchanged pose is part of what is preserved. The subject is whoever is in image [1], so the prompt refers to it through the image and by what it looks like.

## Preservation language

Name the things that must survive, specifically, by their visible properties. Working patterns from the source guide:
- "keeping all lace embroidery details white and fully visible"
- "preserve the original fabric texture, transparency, patterns, highlights, and natural folds"
- "Keep [subject's] pose"

The rule generalized: for every attribute the edit could plausibly disturb (texture, transparency, pattern, highlight, fold, pose, lighting direction, background), either change it deliberately or preserve it explicitly.

## Input images

An edit prompt is written against the inputs the DM's edit workflow takes. One is the default: the image being edited is `image [1]`, and anything else the edit needs (a garment, a setting, a region to change) is described in words. When the DM says an edit takes more inputs, number them `image [2]` onward and state the role each one plays: which supplies the garment, which the subject, which the setting.

## Color control in edits

Hex codes work the same as in generation and matter more here, because "recolor the dress blue" against an existing image invites drift. Bind the code to the specific garment or object.

## Compound edits

Outfit plus scene changes in a single prompt work when each element is specified separately and the preservation clause still covers everything not being changed.

## Known gap

The source guide publishes no troubleshooting section. When an edit fails, the highest-yield first move is to add preservation language for whatever drifted, then re-run.
