---
name: dom-grid-webgl-alignment
description: >-
  How this project layers a DOM CSS grid over a single p5 WEBGL canvas and keeps
  their coordinate spaces identical: measurement loop, per-cell shader draws,
  track resizing, micro cells, pointer routing, and every non-obvious fix.
  Use when recreating or modifying the grid/canvas alignment in this repo or a new project.
---

# DOM grid + p5 WEBGL canvas alignment

This skill documents every piece of the system that makes a CSS grid overlay sit
pixel-perfectly over a single WebGL canvas, and how cell rects are measured and fed
to the shader each frame.

---

## 1. Layer stack

Three layers share a single `position: relative` root element. All children are
`position: absolute; inset: 0`.

```
z-index 0  ShaderCanvas host div    ← p5 mounts its <canvas> here
z-index 1  .resizable-grid__cells   ← CSS grid, pointer-events: none on container
z-index 3  .resizable-grid__splits  ← drag handles, pointer-events: none on container
```

`pointer-events: none` on the cells and splits containers lets pointer events fall
through to the canvas **except** where individual children explicitly opt back in
(`pointer-events: auto` on `.resizable-grid__cell` and each `.resizable-grid__split`
button).

---

## 2. Shared coordinate origin

Every measurement lives in **"scene space"**: `(0, 0)` = top-left of the root
element, Y axis pointing down.

- **CSS grid** cells are positioned naturally inside the root.
- **p5 canvas** fills the root exactly (canvas = root `clientWidth × clientHeight`).
- **Shader** receives cell rects as `uCellRect = [x, y, w, h]` in scene space.
- **Pointer** events compute `clientX/Y - rootRect.left/top` to produce scene-space
  coordinates, written to `dataRef.current.lightPos`.

Never mix `getBoundingClientRect` values from different elements without subtracting
the root rect's origin first. `getBoundingClientRect` is viewport-relative;
`rootRect.left/top` converts it to scene space.

---

## 3. Measurement loop (`measureAndPushScene`)

After every layout change or resize, React reads the DOM and pushes two rect arrays
into `dataRef`:

- `cellRects` — bounding rect of each grid cell element (the outer box including padding).
- `containerRects` — bounding rect of the **inner surface** the shader draws into:
  - Normal / super cells: the `.resizable-grid__cell-surface` element inside.
  - Micro cells: each `.resizable-grid__micro-cell` element measured individually.

```ts
const rootRect = el.getBoundingClientRect();
const nr = cellEl.getBoundingClientRect();
const cellRect = {
  x: nr.left - rootRect.left,
  y: nr.top  - rootRect.top,
  w: nr.width,
  h: nr.height,
};
```

Measuring the surface/micro elements directly — rather than computing from track
fractions — eliminates subpixel drift between what CSS renders and what the shader
draws. This is the only source of truth for `containerRects`.

`measureAndPushScene` runs in a `useLayoutEffect` whose dependency array includes
`layout`, `w`, `h`, `colFracs`, `rowFracs`, and `cellLabels`. Any of those changing
triggers a re-measurement.

---

## 4. p5 WEBGL per-cell draw

p5 uses an **orthographic** projection so one world unit = one CSS pixel:

```ts
p.ortho(-w * 0.5, w * 0.5, -h * 0.5, h * 0.5, -1000, 1000);
```

p5 WEBGL puts `(0,0)` at canvas center with Y up, so the translation to draw a cell at
scene-space `(c.x, c.y, c.w, c.h)` is:

```ts
p.translate(
  c.x + c.w * 0.5 - p.width  * 0.5,   // scene-space center X → WEBGL X
  c.y + c.h * 0.5 - p.height * 0.5,   // scene-space center Y → WEBGL Y (Y is still flipped in gl_FragCoord)
  0
);
p.plane(c.w, c.h);
```

`p.plane` draws a quad centered at the translated position. The shader reads
`gl_FragCoord` and converts to scene-space UV with a Y-flip:

```glsl
vec2 sceneUV = vec2(
  gl_FragCoord.x / uResolution.x,
  1.0 - gl_FragCoord.y / uResolution.y   // Y-flip: gl_FragCoord.y = 0 is bottom
);
```

Then cell-local UV = `(sceneUV * uResolution - cellOrigin) / cellSize`.

---

## 5. Texture re-bind per cell

p5 calls `shader.unbindTextures()` after every retained-mode draw. This resets all
`sampler2D` uniforms to an empty texture. The fix is to **re-bind every texture
uniform before each `p.plane()` call**:

```ts
sh.setUniform("uBackground", bgLayer);
sh.setUniform("uCubeStrip", cubeStrip ?? bgLayer);
```

Forgetting this causes the second and later cells to sample a black texture.

---

## 6. Cell type definitions (`LayoutCellDef`)

```ts
type LayoutCellDef = {
  id: string;         // "row-col"; micro sub-cells: "row-col-m-0", "row-col-m-1", ...
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  type: "normal" | "super" | "micro" | "empty";
  microCount?: 2 | 3;       // only for micro
  microSplit?: "h" | "v";   // only for micro; flex-row or flex-column
};
```

- **normal** — 1×1, single surface.
- **super** — any span; single surface (bigger visual presence).
- **micro** — 1×1 (or spans), subdivided into 2–3 equal sub-surfaces by CSS flex.
- **empty** — occupies grid space but renders nothing; excluded from `cellRects` and `containerRects`.

The `id` convention must be consistent: `"row-col"` for grid cells, `"row-col-m-i"`
for micro sub-cells. The shader and pointer code both key off this id.

---

## 7. Micro cell subdivision

Micro cells split their interior with a flex container:

```css
.resizable-grid__micro-container {
  display: flex;
  gap: 2px;          /* MICRO_GAP_PX must match this in JS */
}
.resizable-grid__micro--h { flex-direction: row; }
.resizable-grid__micro--v { flex-direction: column; }

.resizable-grid__micro-cell {
  flex: 1 1 0;       /* equal subdivision */
  min-width: 0;      /* prevents sub-cells from enforcing their own minimum */
  min-height: 0;
}
```

The key rule: **`flex: 1 1 0` with `min-width: 0`** (not `min-width: min-content`).
This lets CSS divide the container exactly equally without overflow, matching the JS
measurement of each sub-cell element.

The track-level minimum for a column that contains a horizontal micro cell must be
raised in JS to `count × baseMin + (count − 1) × gapPx` so the column is never
narrower than all sub-cells at minimum:

```ts
function computeColMinima(layout, baseMin) {
  const minima = Array.from({ length: layout.cols }, () => baseMin);
  for (const cell of layout.cells) {
    if (cell.type === "micro" && cell.microSplit === "h" && cell.colSpan === 1) {
      minima[cell.col] = Math.max(
        minima[cell.col],
        cell.microCount * baseMin + (cell.microCount - 1) * MICRO_GAP_PX
      );
    }
  }
  return minima;
}
```

---

## 8. Grid template and track size model

```ts
const gridStyle = {
  gridTemplateColumns: colFracs.map(f => `minmax(min-content, ${f}fr)`).join(" "),
  gridTemplateRows:    rowFracs.map(f => `minmax(min-content, ${f}fr)`).join(" "),
};
```

`minmax(min-content, Nfr)` is the critical form: bare `1fr` is `minmax(0, 1fr)` in
browsers and allows tracks to shrink to zero. The `min-content` floor prevents tracks
from collapsing below their content.

Track fractions are stored as normalized `number[]` (sum ≈ 1). Resize operations
update fracs, then the CSS grid reflows, then `measureAndPushScene` fires via
`useLayoutEffect` to re-measure the new pixel rects.

---

## 9. Track resize math

Drag state is stored in a `useRef<Drag | null>` (not state) so updates don't trigger
re-renders in `pointermove`.

The resize pipeline for one axis:

1. **`applyAxisPixelDelta(widths, i, dPix, minPx)`** — moves the seam between track
   `i` and `i+1`, taking space from the adjacent track first, then cascading outward.
   For negative delta (shrink left), it also cascades to tracks on the left before the
   right to allow moving a corner into a large block.
2. **`renormalizeToSum(widths, totalPx)`** — normalizes after cascade so the sum
   stays exactly equal to the container pixel width (prevents float drift over time).
3. **`enforceTrackBounds(tracksPx, totalPx, minPx, maxFraction)`** — clamps every
   track within `[minPx, totalPx * maxFraction]`, then iterates to redistribute
   overflow/deficit proportionally until the sum is exact.
4. **`applyPerTrackFloor(tracksPx, totalPx, lowerBounds[])`** — after the uniform
   minimum, raises any track still below its per-track lower bound (e.g. micro tracks)
   by taking proportionally from donors above their bound.
5. Convert back to fracs: `tracksPx.map(x => x / totalPx)`.

```ts
const bounded = enforceTrackBounds(
  renormalizeToSum(applyAxisPixelDelta(startWidthsPx, i, delta, minPx), W),
  W, minPx, MAX_TRACK_FRACTION
);
setColFracs(applyPerTrackFloor(bounded, W, colMins).map(x => x / W));
```

---

## 10. Split handle positioning

Handle positions are derived by **measuring the seam element**, not from track fracs,
so the handle sits exactly on the rendered CSS grid line even after subpixel
accumulation:

```ts
// Find the first non-empty, non-spanning cell at this seam boundary and read its edge.
const seam = layout.cells.find(c => c.col === i && c.colSpan === 1 && c.type !== "empty");
if (seam) {
  const seamEl = grid.querySelector(`[data-cell-id="${seam.id}"]`);
  v.push(seamEl.getBoundingClientRect().right - splitsRect.left);
} else {
  v.push(cumFraction * containerWidth);  // fallback when all cells at this col span
}
```

Handle CSS: `left: ${splitV[i]}px` with `transform: translateX(-50%)`. No margin —
the transform-only centering avoids a double-offset bug that appears when combining
`margin-left: -5px` with `left: Xpx`.

---

## 11. Canvas resize

`ShaderCanvas` attaches its own `ResizeObserver` to the host div. When the host
changes size it calls `instance.resizeCanvas(w, h, true)` (the `true` flag tells p5
to also resize the WebGL viewport):

```ts
const ro = new ResizeObserver(() => {
  const w = host.clientWidth;
  const h = host.clientHeight;
  if (w > 0 && h > 0) instance.resizeCanvas(w, h, true);
});
ro.observe(host);
```

`measureAndPushScene` runs separately via `ResizeObserver` on the root element,
updating `box` state → re-measuring cell rects. These are two independent observers
on the same DOM subtree, which is fine.

**Never recreate the p5 instance on resize** — use `resizeCanvas`. Recreating causes
shader recompilation, flickering, and (with StrictMode) a brief duplicate canvas.

---

## 12. p5 lifecycle and HMR

```ts
useEffect(() => {
  const sketch = createGridShaderSketch(dataRef, () => host);
  const instance = new p5(sketch, host);
  const ro = new ResizeObserver(...);
  ro.observe(host);
  return () => {
    ro.disconnect();
    instance.remove();   // MUST call; prevents duplicate canvas on HMR / StrictMode
  };
}, [dataRef]);            // dataRef is stable; dependency array never changes
```

`dataRef` is created with `useRef` in the parent and is structurally stable for the
component lifetime. The sketch closure closes over it once; `draw()` reads
`.current` each frame. No React state setters are called from inside `draw()`.

---

## 13. Pointer routing summary

| Event source | Where handled | What it writes |
|---|---|---|
| `onPointerMove` on root | React (inline) | `dataRef.current.lightPos`, `pointerOverSurface` |
| `onPointerLeave` on root | React (inline) | `lightPos = {x:-1, y:-1}`, `pointerOverSurface = false` |
| `onPointerDown` on cell surface | React (inline) | `rimHoldPointerDown`, `specularSpin`, etc. |
| `onPointerUp` on cell surface | React (inline) | triggers `clearRimHold` / specular orbit commit |
| `window pointerup/pointercancel` | `useEffect` cleanup listener | `clearRimHold` |
| `document pointermove` | added on drag start, removed on drag end | `colFracs` / `rowFracs` via `setState` |

The split handles capture the pointer (`handle.setPointerCapture(e.pointerId)`) and
add document-level `pointermove` + window-level `pointerup/pointercancel` listeners.
They clean up in both `endDrag` (normal) and a `useEffect` cleanup (unmount/HMR).

---

## 14. `overflow: hidden` + explicit `min-width` pattern

`overflow: hidden` on `.resizable-grid__cell` zeroes the browser's automatic
`min-content` minimum, which would otherwise keep tracks from shrinking below content.
The explicit `min-width: max(calc(2 * var(--gutter-x)), min-content)` on the same
element re-establishes the minimum through a CSS property the grid *does* respect for
track sizing, so the JS drag floor and the CSS-rendered minimum stay in sync.

---

## 15. Recreating in a new project — minimum checklist

1. **Root**: `position: relative`. Canvas host and cell grid both `position: absolute; inset: 0`.
2. **Canvas**: `pointer-events: none` on the host div; p5 `pixelDensity(1)`; ortho projection.
3. **Cell grid**: `pointer-events: none` on the container; `pointer-events: auto` on each cell.
4. **Grid template**: use `minmax(min-content, ${f}fr)` not bare `fr`.
5. **Measurement**: always use `getBoundingClientRect` relative to root rect. Measure the inner surface element (not the outer cell), so shader rects match the rounded visual container.
6. **Micro cells**: `flex: 1 1 0; min-width: 0; min-height: 0`. Measure sub-elements directly.
7. **Per-cell draw**: translate to `(cx - canvasW/2, cy - canvasH/2)`, then `p.plane(w, h)`.
8. **Texture re-bind**: set every `sampler2D` uniform before each `p.plane()` call.
9. **p5 cleanup**: always call `p.remove()` in `useEffect` return. Never construct p5 in render.
10. **Resize**: `ResizeObserver → instance.resizeCanvas(w, h, true)`. Never recreate the instance.
11. **Coordinate system**: one origin, one box measurement function (`clientWidth/Height`). Do not mix `clientWidth` (drag math, box state) with `getBoundingClientRect().width` (cell measurement) for the root container size.
