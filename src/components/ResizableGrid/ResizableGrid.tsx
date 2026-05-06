import { useRef, useState, useLayoutEffect, useEffect } from 'react'
import type { PointerEvent as RPointerEvent } from 'react'
import { applyAxisPixelDelta, renormalizeToSum, enforceTrackBounds } from './trackMath'
import type { LayoutCellDef } from '../../types/grid'
import './ResizableGrid.css'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_TRACK_PX = 60
const MAX_TRACK_FRACTION = 0.5

type Preset = {
  name: string
  rows: number
  cols: number
  cells: Array<LayoutCellDef & { microCount?: 2 | 3; microSplit?: 'h' | 'v' }>
}

const PRESET_FIXED: Preset = {
  name: 'Fixed',
  rows: 4,
  cols: 4,
  cells: [
    { id: '1-1', row: 1, col: 1, rowSpan: 2, colSpan: 2, type: 'super' },
  ],
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DragState {
  kind: 'col' | 'row' | 'corner'
  colIdx?: number
  rowIdx?: number
  startPx: number
  startY?: number
  startTracksPx: number[]
  startRowsPx?: number[]
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ResizableGrid() {
  const layout = PRESET_FIXED
  const ROWS = layout.rows
  const COLS = layout.cols

  // Track fractions (normalised, sum ≈ 1).
  const [colFracs, setColFracs] = useState<number[]>(Array.from({ length: COLS }, () => 1 / COLS))
  const [rowFracs, setRowFracs] = useState<number[]>(Array.from({ length: ROWS }, () => 1 / ROWS))

  // Container size — triggers re-measurement when it changes.
  const [box, setBox] = useState({ w: 0, h: 0 })

  // Measured seam pixel positions (for split handle placement).
  const [splitV, setSplitV] = useState<number[]>([])
  const [splitH, setSplitH] = useState<number[]>([])

  // DOM refs
  const rootRef = useRef<HTMLDivElement>(null)
  const cellsRef = useRef<HTMLDivElement>(null)

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
  // Measurement loop — tracks split handle seam positions.
  // -------------------------------------------------------------------------
  useLayoutEffect(() => {
    const root = rootRef.current
    const cellsEl = cellsRef.current
    if (!root || !cellsEl) return

    const rootRect = root.getBoundingClientRect()

    // --- Split handle positions (measured from seam cell edges) ---
    const newSplitV: number[] = []
    for (let i = 0; i < COLS - 1; i++) {
      // Find a non-spanning, non-empty cell at this column that we can measure.
      const seam = layout.cells.find(c => c.col === i && c.colSpan === 1 && c.type !== 'empty')
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
      const seam = layout.cells.find(c => c.row === i && c.rowSpan === 1 && c.type !== 'empty')
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
  }, [colFracs, rowFracs, box, COLS, ROWS, layout.cells])

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
    if (axis === 'col') {
      dragRef.current = {
        kind: 'col',
        colIdx: seamIdx,
        startPx: e.clientX,
        startTracksPx: fracs.map(f => f * total),
      }
    } else {
      dragRef.current = {
        kind: 'row',
        rowIdx: seamIdx,
        startPx: e.clientY,
        startTracksPx: fracs.map(f => f * total),
      }
    }
  }

  function moveDrag(e: RPointerEvent<HTMLButtonElement>, axis: 'col' | 'row', seamIdx: number) {
    const drag = dragRef.current
    if (!drag) return
    const root = rootRef.current
    if (!root) return

    const isCol = drag.kind === 'col' && axis === 'col' && drag.colIdx === seamIdx
    const isRow = drag.kind === 'row' && axis === 'row' && drag.rowIdx === seamIdx
    if (!isCol && !isRow) return

    const total = axis === 'col' ? root.clientWidth : root.clientHeight
    const cursor = axis === 'col' ? e.clientX : e.clientY
    const delta = cursor - drag.startPx

    const newPx = enforceTrackBounds(
      renormalizeToSum(
        applyAxisPixelDelta([...drag.startTracksPx], seamIdx, delta, MIN_TRACK_PX),
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

  function startCornerDrag(e: RPointerEvent<HTMLButtonElement>, colIdx: number, rowIdx: number) {
    e.currentTarget.setPointerCapture(e.pointerId)
    const root = rootRef.current
    if (!root) return
    dragRef.current = {
      kind: 'corner',
      colIdx,
      rowIdx,
      startPx: e.clientX,
      startY: e.clientY,
      startTracksPx: colFracs.map(f => f * root.clientWidth),
      startRowsPx: rowFracs.map(f => f * root.clientHeight),
    }
  }

  function moveCornerDrag(e: RPointerEvent<HTMLButtonElement>, colIdx: number, rowIdx: number) {
    const drag = dragRef.current
    const root = rootRef.current
    if (!drag || !root) return
    if (drag.kind !== 'corner' || drag.colIdx !== colIdx || drag.rowIdx !== rowIdx) return

    const width = root.clientWidth
    const height = root.clientHeight
    const deltaX = e.clientX - drag.startPx
    const deltaY = e.clientY - (drag.startY ?? e.clientY)

    const nextCols = enforceTrackBounds(
      renormalizeToSum(
        applyAxisPixelDelta([...drag.startTracksPx], colIdx, deltaX, MIN_TRACK_PX),
        width,
      ),
      width,
      MIN_TRACK_PX,
      MAX_TRACK_FRACTION,
    )
    const nextRows = enforceTrackBounds(
      renormalizeToSum(
        applyAxisPixelDelta([...(drag.startRowsPx ?? [])], rowIdx, deltaY, MIN_TRACK_PX),
        height,
      ),
      height,
      MIN_TRACK_PX,
      MAX_TRACK_FRACTION,
    )

    setColFracs(nextCols.map(v => v / width))
    setRowFracs(nextRows.map(v => v / height))
  }

  function endDrag(e: RPointerEvent<HTMLButtonElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
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
    >
      {/* z-index 1 — CSS grid cells (pointer-events: none on container) */}
      <div
        ref={cellsRef}
        className="resizable-grid__cells"
        style={{ gridTemplateColumns: colTemplate, gridTemplateRows: rowTemplate }}
      >
        {layout.cells.filter(c => c.type !== 'empty').map(cell => (
          <div
            key={cell.id}
            data-cell-id={cell.id}
            className="resizable-grid__cell"
            style={{
              gridColumn: `${cell.col + 1} / span ${cell.colSpan}`,
              gridRow: `${cell.row + 1} / span ${cell.rowSpan}`,
            }}
          >
            <div className="resizable-grid__cell-chrome">
              {cell.type === 'micro' ? (
                <div className={`resizable-grid__micro-container resizable-grid__micro--${cell.microSplit ?? 'h'}`}>
                  {Array.from({ length: cell.microCount ?? 2 }, (_, i) => (
                    <div key={`${cell.id}-m-${i}`} className="resizable-grid__micro-cell">
                      <div className="resizable-grid__cell-surface">
                        <span className="resizable-grid__cell-text">{cell.id}.{i + 1}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="resizable-grid__cell-surface">
                  <span className="resizable-grid__cell-text">{cell.id}</span>
                </div>
              )}
            </div>
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
        {Array.from({ length: COLS - 1 }, (_, i) =>
          Array.from({ length: ROWS - 1 }, (_, j) => (
            <button
              key={`corner-${i}-${j}`}
              className="resizable-grid__split resizable-grid__split--corner"
              style={{ left: splitV[i] ?? 0, top: splitH[j] ?? 0 }}
              onPointerDown={e => startCornerDrag(e, i, j)}
              onPointerMove={e => moveCornerDrag(e, i, j)}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              aria-label={`Resize corner ${i + 1}-${j + 1}`}
            >
              <span className="resizable-grid__split-plus" aria-hidden>+</span>
            </button>
          )),
        )}
      </div>
      <div className="resizable-grid__preset-badge">Preset: {layout.name}</div>
    </div>
  )
}
