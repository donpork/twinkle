import { useRef, useState, useLayoutEffect, useEffect, useCallback } from 'react'
import type { MutableRefObject, PointerEvent as RPointerEvent, ChangeEvent } from 'react'
import { applyAxisPixelDelta, renormalizeToSum, enforceTrackBounds } from './trackMath'
import type { CellRect, LayoutCellDef, SharedSceneData, V02SceneData } from '../../types/grid'
import { ShaderCanvas } from './ShaderCanvas'
import { BoidCanvas } from './BoidCanvas'
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
  const labelRef = useRef<HTMLDivElement>(null)

  // ---- v02 controls ----
  const [v02DeathDist, setV02DeathDist] = useState(3)
  const [v02MinLiveBoids, setV02MinLiveBoids] = useState(100)
  const [v02BoidLength, setV02BoidLength] = useState(1)
  const [v02BoidLineLength, setV02BoidLineLength] = useState(6)
  const [v02EdgeVelocityMultiplier, setV02EdgeVelocityMultiplier] = useState(0.3)
  const [v02HashCellSize, setV02HashCellSize] = useState(44)
  const [v02SepRadius, setV02SepRadius] = useState(18)
  const [v02AlignRadius, setV02AlignRadius] = useState(44)
  const [v02CohesionRadius, setV02CohesionRadius] = useState(44)
  const [v02SepWeight, setV02SepWeight] = useState(1.45)
  const [v02AlignWeight, setV02AlignWeight] = useState(1.0)
  const [v02CohesionWeight, setV02CohesionWeight] = useState(1.0)
  const [v02CenterSpeed, setV02CenterSpeed] = useState(0.03)
  const [v02LifeCycleFrames, setV02LifeCycleFrames] = useState(900)

  const [showDebug, setShowDebug] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [focusRect, setFocusRect] = useState<CellRect | null>(null)

  // ---- Independent runtime data stores — mutated in place, never trigger re-render ----
  const v02DataRef = useRef<V02SceneData>({
    cellRects: new Map(),
    containerRects: new Map(),
    labelRect: null,
    lightPos: { x: -1, y: -1 },
    pointerOverSurface: false,
    pointerDown: false,
    mouseReleasedTick: 0,
    lastDirection: { x: 1, y: 0 },
    invertSpeedProfile: false,
    cellVersion: 'v02',
    deathDistancePx: 3,
    minLiveBoids: 100,
    boidBlurPx: 4,
    v02BoidLength: 1,
    v02BoidLineLength: 6,
    v02EdgeVelocityMultiplier: 0.3,
    v02HashCellSize: 44,
    v02SepRadius: 18,
    v02AlignRadius: 44,
    v02CohesionRadius: 44,
    v02SepWeight: 1.45,
    v02AlignWeight: 1.0,
    v02CohesionWeight: 1.0,
    v02CenterSpeed: 0.03,
    v02LifeCycleFrames: 900,
  })

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

  // Window-level safety reset so pointerDown never stays true after a captured drag release.
  useEffect(() => {
    const reset = () => {
      v02DataRef.current.pointerDown = false
    }
    window.addEventListener('pointerup', reset)
    window.addEventListener('pointercancel', reset)
    return () => {
      window.removeEventListener('pointerup', reset)
      window.removeEventListener('pointercancel', reset)
    }
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
      const seam = layout.cells.find(c => c.col === i && c.colSpan === 1 && c.type !== 'empty')
      const seamEl = seam
        ? cellsEl.querySelector<HTMLElement>(`[data-cell-id="${seam.id}"]`)
        : null
      if (seamEl) {
        newSplitV.push(seamEl.getBoundingClientRect().right - rootRect.left)
      } else {
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

    // --- Push cell and container rects into v02 runtime store ---
    const newCellRects = new Map<string, CellRect>()
    const newContainerRects = new Map<string, CellRect>()
    for (const cell of layout.cells.filter(c => c.type !== 'empty')) {
      const cellEl = cellsEl.querySelector<HTMLElement>(`[data-cell-id="${cell.id}"]`)
      if (!cellEl) continue
      const cr = cellEl.getBoundingClientRect()
      newCellRects.set(cell.id, {
        x: cr.left - rootRect.left,
        y: cr.top - rootRect.top,
        w: cr.width,
        h: cr.height,
      })
      const surfaceEl = cellEl.querySelector<HTMLElement>('.resizable-grid__cell-surface')
      const sr = (surfaceEl ?? cellEl).getBoundingClientRect()
      newContainerRects.set(cell.id, {
        x: sr.left - rootRect.left,
        y: sr.top - rootRect.top,
        w: sr.width,
        h: sr.height,
      })
    }
    v02DataRef.current.cellRects = newCellRects
    v02DataRef.current.containerRects = newContainerRects
    setFocusRect(newContainerRects.get('1-1') ?? null)

    const labelEl = labelRef.current
    if (labelEl) {
      const lr = labelEl.getBoundingClientRect()
      v02DataRef.current.labelRect = {
        x: lr.left - rootRect.left,
        y: lr.top - rootRect.top,
        w: lr.width,
        h: lr.height,
      }
    } else {
      v02DataRef.current.labelRect = null
    }
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
  // Pointer handlers
  // -------------------------------------------------------------------------
  const colTemplate = colFracs.map(f => `minmax(min-content, ${f}fr)`).join(' ')
  const rowTemplate = rowFracs.map(f => `minmax(min-content, ${f}fr)`).join(' ')

  function handlePointerMove(e: RPointerEvent<HTMLDivElement>) {
    const root = rootRef.current
    if (!root) return
    const rect = root.getBoundingClientRect()
    const lightPos = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    v02DataRef.current.lightPos = lightPos
    v02DataRef.current.pointerOverSurface = true

    const target = v02DataRef.current.containerRects.get('1-1')
    if (target) {
      const cx = target.x + target.w * 0.5
      const cy = target.y + target.h * 0.5
      const dx = lightPos.x - cx
      const dy = lightPos.y - cy
      const mag = Math.hypot(dx, dy)
      if (mag > 1) {
        const dir = { x: dx / mag, y: dy / mag }
        v02DataRef.current.lastDirection = dir
      }
    }
  }

  function handlePointerLeave() {
    v02DataRef.current.lightPos = { x: -1, y: -1 }
    v02DataRef.current.pointerOverSurface = false
    v02DataRef.current.pointerDown = false
  }

  const handlePointerDown = useCallback(() => {
    v02DataRef.current.pointerDown = true
  }, [])

  const handlePointerUp = useCallback(() => {
    v02DataRef.current.pointerDown = false
    v02DataRef.current.mouseReleasedTick++
  }, [])

  // -------------------------------------------------------------------------
  // v02 control handlers
  // -------------------------------------------------------------------------
  function handleV02DeathDistChange(e: ChangeEvent<HTMLInputElement>) {
    const v = Math.max(0, Number(e.target.value))
    setV02DeathDist(v)
    v02DataRef.current.deathDistancePx = v
  }

  function handleV02MinLiveChange(e: ChangeEvent<HTMLInputElement>) {
    const v = Math.max(0, Math.floor(Number(e.target.value)))
    setV02MinLiveBoids(v)
    v02DataRef.current.minLiveBoids = v
  }

  function handleV02BoidLengthChange(e: ChangeEvent<HTMLInputElement>) {
    const v = Math.max(1, Number(e.target.value))
    setV02BoidLength(v)
    v02DataRef.current.v02BoidLength = v
  }

  function handleV02BoidLineLengthChange(e: ChangeEvent<HTMLInputElement>) {
    const v = Math.max(1, Number(e.target.value))
    setV02BoidLineLength(v)
    v02DataRef.current.v02BoidLineLength = v
  }

  function handleV02EdgeVelocityMultiplierChange(e: ChangeEvent<HTMLInputElement>) {
    const v = Math.max(0, Number(e.target.value))
    setV02EdgeVelocityMultiplier(v)
    v02DataRef.current.v02EdgeVelocityMultiplier = v
  }

  function handleV02HashCellSizeChange(e: ChangeEvent<HTMLInputElement>) {
    const v = Math.max(1, Math.floor(Number(e.target.value)))
    setV02HashCellSize(v)
    v02DataRef.current.v02HashCellSize = v
  }

  function handleV02SepRadiusChange(e: ChangeEvent<HTMLInputElement>) {
    const v = Math.max(1, Number(e.target.value))
    setV02SepRadius(v)
    v02DataRef.current.v02SepRadius = v
  }

  function handleV02AlignRadiusChange(e: ChangeEvent<HTMLInputElement>) {
    const v = Math.max(1, Number(e.target.value))
    setV02AlignRadius(v)
    v02DataRef.current.v02AlignRadius = v
  }

  function handleV02CohesionRadiusChange(e: ChangeEvent<HTMLInputElement>) {
    const v = Math.max(1, Number(e.target.value))
    setV02CohesionRadius(v)
    v02DataRef.current.v02CohesionRadius = v
  }

  function handleV02SepWeightChange(e: ChangeEvent<HTMLInputElement>) {
    const v = Math.max(0, Number(e.target.value))
    setV02SepWeight(v)
    v02DataRef.current.v02SepWeight = v
  }

  function handleV02AlignWeightChange(e: ChangeEvent<HTMLInputElement>) {
    const v = Math.max(0, Number(e.target.value))
    setV02AlignWeight(v)
    v02DataRef.current.v02AlignWeight = v
  }

  function handleV02CohesionWeightChange(e: ChangeEvent<HTMLInputElement>) {
    const v = Math.max(0, Number(e.target.value))
    setV02CohesionWeight(v)
    v02DataRef.current.v02CohesionWeight = v
  }

  function handleV02CenterSpeedChange(e: ChangeEvent<HTMLInputElement>) {
    const v = Math.max(0, Number(e.target.value))
    setV02CenterSpeed(v)
    v02DataRef.current.v02CenterSpeed = v
  }

  function handleV02LifeCycleFramesChange(e: ChangeEvent<HTMLInputElement>) {
    const v = Math.max(1, Math.floor(Number(e.target.value)))
    setV02LifeCycleFrames(v)
    v02DataRef.current.v02LifeCycleFrames = v
  }

  function handleShowDebugChange(e: ChangeEvent<HTMLInputElement>) {
    setShowDebug(e.target.checked)
  }

  return (
    <div
      ref={rootRef}
      className={`resizable-grid ${showDebug ? 'resizable-grid--debug' : ''}`}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerLeave}
    >
      {/* z-index 0 — p5 canvases */}
      <ShaderCanvas dataRef={v02DataRef as MutableRefObject<SharedSceneData>} active />
      <BoidCanvas dataRef={v02DataRef} active />

      {focusRect ? (
        <div
          className="resizable-grid__boid-blur-layer"
          style={{
            left: focusRect.x,
            top: focusRect.y,
            width: focusRect.w,
            height: focusRect.h,
          }}
        />
      ) : null}
      {focusRect ? (
        <div
          ref={labelRef}
          className="resizable-grid__overlay-label resizable-grid__overlay-label--v02"
          style={{
            left: focusRect.x,
            top: focusRect.y,
            width: focusRect.w,
            height: focusRect.h,
          }}
        >
          R1C1
        </div>
      ) : null}

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

      <button
        type="button"
        className="resizable-grid__controls-toggle"
        onClick={() => setShowControls(v => !v)}
      >
        {showControls ? 'hide controls' : 'show controls'}
      </button>

      {showControls ? (
        <div className="resizable-grid__controls-group">
          <div className="resizable-grid__controls-meta">Preset: {layout.name}</div>

          <div className="resizable-grid__controls-section">
            <div className="resizable-grid__controls-section-title">Global</div>
            <label className="resizable-grid__control-row">
              edge buffer (px)
              <input
                type="number"
                min={0}
                max={300}
                value={v02DeathDist}
                onChange={handleV02DeathDistChange}
              />
            </label>
            <label className="resizable-grid__control-row">
              min live
              <input
                type="number"
                min={0}
                max={10000}
                value={v02MinLiveBoids}
                onChange={handleV02MinLiveChange}
              />
            </label>
            <label className="resizable-grid__control-row resizable-grid__control-row--checkbox">
              debug
              <input
                type="checkbox"
                checked={showDebug}
                onChange={handleShowDebugChange}
              />
            </label>
          </div>

          <div className="resizable-grid__controls-section">
            <div className="resizable-grid__controls-section-title">Boids</div>
            <label className="resizable-grid__control-row">
              edge speed x
              <input
                type="number"
                min={0}
                max={8}
                step={0.05}
                value={v02EdgeVelocityMultiplier}
                onChange={handleV02EdgeVelocityMultiplierChange}
              />
            </label>
            <label className="resizable-grid__control-row">
              center speed
              <input
                type="number"
                min={0}
                max={2}
                step={0.01}
                value={v02CenterSpeed}
                onChange={handleV02CenterSpeedChange}
              />
            </label>
            <label className="resizable-grid__control-row">
              life frames
              <input
                type="number"
                min={1}
                max={20000}
                step={1}
                value={v02LifeCycleFrames}
                onChange={handleV02LifeCycleFramesChange}
              />
            </label>
            <label className="resizable-grid__control-row">
              stroke width
              <input
                type="number"
                min={1}
                max={200}
                step={1}
                value={v02BoidLength}
                onChange={handleV02BoidLengthChange}
              />
            </label>
            <label className="resizable-grid__control-row">
              boid length
              <input
                type="number"
                min={1}
                max={200}
                step={1}
                value={v02BoidLineLength}
                onChange={handleV02BoidLineLengthChange}
              />
            </label>
          </div>

          <div className="resizable-grid__controls-section">
            <div className="resizable-grid__controls-section-title">Flocking</div>
            <label className="resizable-grid__control-row">
              hash cell
              <input
                type="number"
                min={1}
                max={512}
                step={1}
                value={v02HashCellSize}
                onChange={handleV02HashCellSizeChange}
              />
            </label>
            <label className="resizable-grid__control-row">
              sep radius
              <input
                type="number"
                min={1}
                max={500}
                step={1}
                value={v02SepRadius}
                onChange={handleV02SepRadiusChange}
              />
            </label>
            <label className="resizable-grid__control-row">
              align radius
              <input
                type="number"
                min={1}
                max={500}
                step={1}
                value={v02AlignRadius}
                onChange={handleV02AlignRadiusChange}
              />
            </label>
            <label className="resizable-grid__control-row">
              cohesion radius
              <input
                type="number"
                min={1}
                max={500}
                step={1}
                value={v02CohesionRadius}
                onChange={handleV02CohesionRadiusChange}
              />
            </label>
            <label className="resizable-grid__control-row">
              sep weight
              <input
                type="number"
                min={0}
                max={10}
                step={0.05}
                value={v02SepWeight}
                onChange={handleV02SepWeightChange}
              />
            </label>
            <label className="resizable-grid__control-row">
              align weight
              <input
                type="number"
                min={0}
                max={10}
                step={0.05}
                value={v02AlignWeight}
                onChange={handleV02AlignWeightChange}
              />
            </label>
            <label className="resizable-grid__control-row">
              cohesion weight
              <input
                type="number"
                min={0}
                max={10}
                step={0.05}
                value={v02CohesionWeight}
                onChange={handleV02CohesionWeightChange}
              />
            </label>
          </div>
        </div>
      ) : null}
    </div>
  )
}
