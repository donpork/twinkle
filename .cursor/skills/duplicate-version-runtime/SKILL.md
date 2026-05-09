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

