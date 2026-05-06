import { useRef, useState, useLayoutEffect, useEffect } from 'react'
import type { MutableRefObject, PointerEvent as RPointerEvent } from 'react'
import { ShaderCanvas } from './ShaderCanvas'
import { applyAxisPixelDelta, renormalizeToSum, enforceTrackBounds } from './trackMath'
import type { LayoutCellDef, SceneData, CellRect } from '../../types/grid'
import './ResizableGrid.css'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROWS = 3
const COLS = 3
const MIN_TRACK_PX = 60
const MAX_TRACK_FRACTION = 0.78

/**
 * Asymmetric 3×3 layout:
 *  ┌──────────────┬───────┐
 *  │  0-0 (2×2)   │  0-2  │
 *  │              ├───────┤
 *  │              │  1-2  │
 *  ├───────┬──────┴───────┤  ← wrong: let me redo
 *  │  2-0  │  2-1  │  2-2 │
 *  └───────┴───────┴──────┘
 */
const LAYOUT: LayoutCellDef[] = [
  { id: '0-0', row: 0, col: 0, rowSpan: 2, colSpan: 2, type: 'super' },
  { id: '0-2', row: 0, col: 2, rowSpan: 1, colSpan: 1, type: 'super' },
  { id: '1-2', row: 1, col: 2, rowSpan: 1, colSpan: 1, type: 'super' },
  { id: '2-0', row: 2, col: 0, rowSpan: 1, colSpan: 1, type: 'super' },
  { id: '2-1', row: 2, col: 1, rowSpan: 1, colSpan: 1, type: 'super' },
  { id: '2-2', row: 2, col: 2, rowSpan: 1, colSpan: 1, type: 'super' },
]

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DragState {
  axis: 'col' | 'row'
  seamIdx: number
  startPx: number
  startTracksPx: number[]
}

function initSceneData(): SceneData {
  return {
    cellRects: new Map<string, CellRect>(),
    containerRects: new Map<string, CellRect>(),
    lightPos: { x: -1, y: -1 },
    pointerOverSurface: false,
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ResizableGrid() {
  // Track fractions (normalised, sum ≈ 1).
  const [colFracs, setColFracs] = useState<number[]>([0.38, 0.27, 0.35])
  const [rowFracs, setRowFracs] = useState<number[]>([0.37, 0.33, 0.30])

  // Container size — triggers re-measurement when it changes.
  const [box, setBox] = useState({ w: 0, h: 0 })

  // Measured seam pixel positions (for split handle placement).
  const [splitV, setSplitV] = useState<number[]>([])
  const [splitH, setSplitH] = useState<number[]>([])

  // DOM refs
  const rootRef = useRef<HTMLDivElement>(null)
  const cellsRef = useRef<HTMLDivElement>(null)

  // Shared scene data read by the p5 sketch each frame (no re-renders).
  const dataRef = useRef<SceneData>(initSceneData()) as MutableRefObject<SceneData>

  // Active drag state (stored in ref to avoid re-renders during pointermove).
  const dragRef = useRef<DragState | null>(null)

  // -------------------------------------------------------------------------
  // Root ResizeObserver — updates `box` so the layoutEffect re-runs.
  // -------------------------------------------------------------------------
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const ro = new ResizeObserver(() => {
      setBox({ w: root.clientWidth, h: root.clientHeight })
    })
    ro.observe(root)
    return () => ro.disconnect()
  }, [])

  // Clear drag state on unmount / HMR.
  useEffect(() => {
    return () => { dragRef.current = null }
  }, [])

  // -------------------------------------------------------------------------
  // Measurement loop — runs after every layout change.
  //
  // Reads the DOM to populate dataRef (for p5) and split handle positions
  // (for React). Runs in useLayoutEffect so values are ready before paint.
  // -------------------------------------------------------------------------
  useLayoutEffect(() => {
    const root = rootRef.current
    const cellsEl = cellsRef.current
    if (!root || !cellsEl) return

    const rootRect = root.getBoundingClientRect()

    // --- Cell / container rects for the shader ---
    const newCellRects = new Map<string, CellRect>()
    const newContainerRects = new Map<string, CellRect>()

    for (const cell of LAYOUT) {
      if (cell.type === 'empty') continue
      const cellEl = cellsEl.querySelector<HTMLElement>(`[data-cell-id="${cell.id}"]`)
      if (!cellEl) continue

      const cr = cellEl.getBoundingClientRect()
      newCellRects.set(cell.id, {
        x: cr.left - rootRect.left,
        y: cr.top - rootRect.top,
        w: cr.width,
        h: cr.height,
      })

      // Measure the inner surface — the authoritative rect the shader draws into.
      const surfaceEl = cellEl.querySelector<HTMLElement>('.resizable-grid__cell-surface')
      const sr = (surfaceEl ?? cellEl).getBoundingClientRect()
      newContainerRects.set(cell.id, {
        x: sr.left - rootRect.left,
        y: sr.top - rootRect.top,
        w: sr.width,
        h: sr.height,
      })
    }

    dataRef.current.cellRects = newCellRects
    dataRef.current.containerRects = newContainerRects

    // --- Split handle positions (measured from seam cell edges) ---
    const newSplitV: number[] = []
    for (let i = 0; i < COLS - 1; i++) {
      // Find a non-spanning, non-empty cell at this column that we can measure.
      const seam = LAYOUT.find(c => c.col === i && c.colSpan === 1 && c.type !== 'empty')
      const seamEl = seam
        ? cellsEl.querySelector<HTMLElement>(`[data-cell-id="${seam.id}"]`)
        : null
      if (seamEl) {
        newSplitV.push(seamEl.getBoundingClientRect().right - rootRect.left)
      } else {
        // Fallback: derive from cumulative fractions.
        const cum = colFracs.slice(0, i + 1).reduce((a, b) => a + b, 0)
        newSplitV.push(cum * root.clientWidth)
      }
    }

    const newSplitH: number[] = []
    for (let i = 0; i < ROWS - 1; i++) {
      const seam = LAYOUT.find(c => c.row === i && c.rowSpan === 1 && c.type !== 'empty')
      const seamEl = seam
        ? cellsEl.querySelector<HTMLElement>(`[data-cell-id="${seam.id}"]`)
        : null
      if (seamEl) {
        newSplitH.push(seamEl.getBoundingClientRect().bottom - rootRect.top)
      } else {
        const cum = rowFracs.slice(0, i + 1).reduce((a, b) => a + b, 0)
        newSplitH.push(cum * root.clientHeight)
      }
    }

    setSplitV(newSplitV)
    setSplitH(newSplitH)
  }, [colFracs, rowFracs, box])

  // -------------------------------------------------------------------------
  // Pointer routing
  // -------------------------------------------------------------------------
  function handleRootPointerMove(e: RPointerEvent<HTMLDivElement>) {
    const root = rootRef.current
    if (!root) return
    const rect = root.getBoundingClientRect()
    dataRef.current.lightPos = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    }
  }

  function handleRootPointerLeave() {
    dataRef.current.lightPos = { x: -1, y: -1 }
  }

  // -------------------------------------------------------------------------
  // Drag-to-resize
  // -------------------------------------------------------------------------
  function startDrag(
    e: RPointerEvent<HTMLButtonElement>,
    axis: 'col' | 'row',
    seamIdx: number,
  ) {
    e.currentTarget.setPointerCapture(e.pointerId)
    const root = rootRef.current
    if (!root) return
    const total = axis === 'col' ? root.clientWidth : root.clientHeight
    const fracs = axis === 'col' ? colFracs : rowFracs
    dragRef.current = {
      axis,
      seamIdx,
      startPx: axis === 'col' ? e.clientX : e.clientY,
      startTracksPx: fracs.map(f => f * total),
    }
  }

  function moveDrag(e: RPointerEvent<HTMLButtonElement>, axis: 'col' | 'row', seamIdx: number) {
    const drag = dragRef.current
    if (!drag || drag.axis !== axis || drag.seamIdx !== seamIdx) return
    const root = rootRef.current
    if (!root) return

    const total = axis === 'col' ? root.clientWidth : root.clientHeight
    const cursor = axis === 'col' ? e.clientX : e.clientY
    const delta = cursor - drag.startPx

    const newPx = enforceTrackBounds(
      renormalizeToSum(
        applyAxisPixelDelta([...drag.startTracksPx], drag.seamIdx, delta, MIN_TRACK_PX),
        total,
      ),
      total,
      MIN_TRACK_PX,
      MAX_TRACK_FRACTION,
    )

    const newFracs = newPx.map(x => x / total)
    if (axis === 'col') setColFracs(newFracs)
    else setRowFracs(newFracs)
  }

  function endDrag(e: RPointerEvent<HTMLButtonElement>) {
    e.currentTarget.releasePointerCapture(e.pointerId)
    dragRef.current = null
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  const colTemplate = colFracs.map(f => `minmax(min-content, ${f}fr)`).join(' ')
  const rowTemplate = rowFracs.map(f => `minmax(min-content, ${f}fr)`).join(' ')

  return (
    <div
      ref={rootRef}
      className="resizable-grid"
      onPointerMove={handleRootPointerMove}
      onPointerLeave={handleRootPointerLeave}
    >
      {/* z-index 0 — p5 WebGL canvas */}
      <ShaderCanvas dataRef={dataRef} />

      {/* z-index 1 — CSS grid cells (pointer-events: none on container) */}
      <div
        ref={cellsRef}
        className="resizable-grid__cells"
        style={{ gridTemplateColumns: colTemplate, gridTemplateRows: rowTemplate }}
      >
        {LAYOUT.filter(c => c.type !== 'empty').map(cell => (
          <div
            key={cell.id}
            data-cell-id={cell.id}
            className="resizable-grid__cell"
            style={{
              gridColumn: `${cell.col + 1} / span ${cell.colSpan}`,
              gridRow: `${cell.row + 1} / span ${cell.rowSpan}`,
            }}
          >
            <div className="resizable-grid__cell-surface" />
          </div>
        ))}
      </div>

      {/* z-index 3 — drag handles (pointer-events: none on container) */}
      <div className="resizable-grid__splits">
        {Array.from({ length: COLS - 1 }, (_, i) => (
          <button
            key={`v-${i}`}
            className="resizable-grid__split resizable-grid__split--v"
            style={{ left: splitV[i] ?? 0 }}
            onPointerDown={e => startDrag(e, 'col', i)}
            onPointerMove={e => moveDrag(e, 'col', i)}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            aria-label={`Resize column ${i + 1}`}
          />
        ))}
        {Array.from({ length: ROWS - 1 }, (_, i) => (
          <button
            key={`h-${i}`}
            className="resizable-grid__split resizable-grid__split--h"
            style={{ top: splitH[i] ?? 0 }}
            onPointerDown={e => startDrag(e, 'row', i)}
            onPointerMove={e => moveDrag(e, 'row', i)}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            aria-label={`Resize row ${i + 1}`}
          />
        ))}
      </div>
    </div>
  )
}
