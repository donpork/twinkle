---
name: duplicate-version-runtime
description: Duplicate one runtime version into a new independent version path in this repo. Use when the user asks to clone v02/v03 behavior, split versions, rename a version mode, or keep one version untouched while evolving another.
disable-model-invocation: true
---

# Duplicate Version Runtime

Use this workflow when duplicating a version mode in `ResizableGrid` so runtime logic stays independent and changes remain surgical.

## Scope

- Goal: copy one version's runtime behavior into a new/other version path.
- Keep unrelated versions untouched.
- Prefer UI label changes over internal identifier refactors unless user explicitly asks for internal renaming.

## Required checks before coding

1. Confirm source version and target version.
2. Confirm independence level:
   - Default: runtime independence (separate runtime modules/paths).
   - Shared helpers allowed only if explicitly approved.
3. Confirm whether renaming request is:
   - UI-only labels, or
   - Internal identifiers/types too.

If ambiguous, ask before editing.

## Minimal workflow

1. Identify current routing point:
   - `src/components/ResizableGrid/ResizableGrid.tsx`
   - version branch using `cellVersion`.
2. Duplicate runtime path:
   - For p5 path: `boidSketch.ts` / `BoidCanvas.tsx`.
   - For textmode path: `boidRuntimeV03.ts` / `TextmodeCanvas.tsx`.
3. Keep target runtime independent:
   - No delegation calls to source runtime functions.
   - Copy only what is needed for behavior parity.
4. Wire UI route:
   - Ensure each version mounts its own runtime canvas/component.
5. Thread version-specific controls only when requested:
   - Add field to `src/types/grid.ts` `SceneData` only if the new version needs it.
   - Sync state -> `dataRef.current` in `ResizableGrid.tsx`.
6. Update user-facing labels if requested.

## Current controls panel + parameter map (source of truth)

When duplicating a runtime, account for the current controls in
`src/components/ResizableGrid/ResizableGrid.tsx` and the backing fields in
`src/types/grid.ts` `SceneData`.

- Global section:
  - `edge buffer (px)` -> `deathDist` -> `dataRef.current.deathDistancePx`
  - `min live` -> `minLiveBoids` -> `dataRef.current.minLiveBoids`
  - `debug` -> `showDebug` (UI-only, not in `SceneData`)
- Boids section (currently shown for both `v02` and `brush`):
  - `edge speed x` -> `v02EdgeVelocityMultiplier`
  - `center speed` -> `v02CenterSpeed`
  - `life frames` -> `v02LifeCycleFrames`
  - `stroke width` -> `v02BoidLength`
  - `boid length` -> `v02BoidLineLength`
- Flocking section (currently shown for both `v02` and `brush`):
  - `hash cell` -> `v02HashCellSize`
  - `sep radius` -> `v02SepRadius`
  - `align radius` -> `v02AlignRadius`
  - `cohesion radius` -> `v02CohesionRadius`
  - `sep weight` -> `v02SepWeight`
  - `align weight` -> `v02AlignWeight`
  - `cohesion weight` -> `v02CohesionWeight`

If independence is requested (recommended default when splitting versions):

1. Add target-version fields to `SceneData` (for example `brushBoidLength`,
   `brushSepRadius`, etc).
2. Add separate React state + handlers in `ResizableGrid.tsx` for that version.
3. Show per-version controls with `cellVersion`-gated UI, rather than sharing
   `(cellVersion === 'v02' || cellVersion === 'brush')`.
4. Update target runtime to read only its own version-specific fields.
5. Keep source runtime behavior and fields untouched.

## Guardrails

- Do not refactor unrelated modules.
- Do not rename `cellVersion` enum values unless explicitly requested.
- Do not add speculative abstractions/config layers.
- Remove only dead code created by your own change.

## Verification

Run after edits:

```bash
npx tsc --noEmit
```

Then check diagnostics for touched files.

Expected result:
- Source version behavior unchanged.
- Target version works through its own runtime path.
- No type errors.

