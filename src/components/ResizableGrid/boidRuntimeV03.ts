import type { MutableRefObject } from 'react'
import { textmode } from 'textmode.js'
import type { Textmodifier } from 'textmode.js'
import type { SceneData } from '../../types/grid'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const V03_INITIAL_BOIDS = 80
const V03_MAX_BOIDS_HARD = 10000
const V03_SPAWN_BATCH_PER_FRAME = 48
const V03_SPAWN_JITTER_ANGLE = 0.45
const V03_SPAWN_SPEED_BASE = 1.25
const V03_MAX_SPEED_BASE = 2.8
const V03_MAX_FORCE_BASE = 0.075
const V03_MIN_SPEED_SCALE = 0.03
const V03_SEP_RADIUS = 18
const V03_SEP_WEIGHT = 1.45
const V03_ALIGN_RADIUS = 44
const V03_ALIGN_WEIGHT = 1.0
const V03_COHESION_RADIUS = 44
const V03_COHESION_WEIGHT = 1.0
const V03_FLOW_WEIGHT = 0.95
const V03_MOUSE_REPEL_RADIUS = 88
const V03_MOUSE_REPEL_FORCE = 3.4
const V03_MOUSE_REPEL_GROWTH_PER_FRAME = 0.03
const V03_MOUSE_REPEL_CAP_MULTIPLIER = 3.2
const V03_MOUSE_REPEL_RADIUS_GROWTH_PER_FRAME = 1.4
const V03_MOUSE_REPEL_RADIUS_CAP_MULTIPLIER = 2.8
const V03_FIXED_SPEED = V03_MAX_SPEED_BASE * 0.96
const V03_HASH_CELL_SIZE = 44
const V03_MAX_NEIGHBORS_PER_BOID = 36
const V03_FONT_SIZE = 8

// ---------------------------------------------------------------------------
// Boid type
// ---------------------------------------------------------------------------
interface Boid {
  x: number; y: number
  vx: number; vy: number
  ax: number; ay: number
  sepStrength: number
  alignStrength: number
  cohesionStrength: number
  colorR: number
  colorG: number
  colorB: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function v03Clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

function v03LimitMag(vx: number, vy: number, max: number): [number, number] {
  const mag = Math.hypot(vx, vy)
  if (mag > max) { const s = max / mag; return [vx * s, vy * s] }
  return [vx, vy]
}

function v03SetMag(vx: number, vy: number, mag: number): [number, number] {
  const m = Math.hypot(vx, vy)
  if (m < 0.001) return [0, 0]
  return [vx * (mag / m), vy * (mag / m)]
}

function v03Rotate(vx: number, vy: number, angle: number): [number, number] {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return [vx * c - vy * s, vx * s + vy * c]
}

function v03PillSDF(
  x: number, y: number,
  cx: number, cy: number, cw: number, ch: number,
): number {
  const halfW = cw * 0.5
  const halfH = ch * 0.5
  const radius = Math.min(halfW, halfH)
  const dx = Math.abs(x - (cx + halfW)) - (halfW - radius)
  const dy = Math.abs(y - (cy + halfH)) - (halfH - radius)
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - radius
}

function v03HashCell(x: number, y: number): string {
  return `${Math.floor(x / V03_HASH_CELL_SIZE)},${Math.floor(y / V03_HASH_CELL_SIZE)}`
}

function v03RandomPointInPill(cx: number, cy: number, cw: number, ch: number): { x: number; y: number } {
  for (let i = 0; i < 24; i++) {
    const x = cx + Math.random() * cw
    const y = cy + Math.random() * ch
    if (v03PillSDF(x, y, cx, cy, cw, ch) <= 0) return { x, y }
  }
  return { x: cx + cw * 0.5, y: cy + ch * 0.5 }
}

function v03MakeDirectionalBoid(x: number, y: number, dirX: number, dirY: number): Boid {
  const [nx, ny] = v03SetMag(dirX, dirY, 1)
  const signedAngle = (Math.random() * 2 - 1) * V03_SPAWN_JITTER_ANGLE
  const [rx, ry] = v03Rotate(nx || 1, ny || 0, signedAngle)
  const speed = V03_SPAWN_SPEED_BASE * (0.7 + Math.random() * 0.6)
  return {
    x, y, vx: rx * speed, vy: ry * speed, ax: 0, ay: 0,
    sepStrength: 0, alignStrength: 0, cohesionStrength: 0,
    colorR: -1, colorG: -1, colorB: -1,
  }
}

function v03InitBoids(cx: number, cy: number, cw: number, ch: number, dirX: number, dirY: number): Boid[] {
  const boids: Boid[] = []
  for (let i = 0; i < V03_INITIAL_BOIDS; i++) {
    const pt = v03RandomPointInPill(cx, cy, cw, ch)
    boids.push(v03MakeDirectionalBoid(pt.x, pt.y, dirX, dirY))
  }
  return boids
}

function v03PointerSpeedScale(
  lx: number, ly: number,
  cx: number, cy: number, cw: number, ch: number,
  invert: boolean,
): number {
  if (lx < 0 || ly < 0) return 1
  const centerX = cx + cw * 0.5
  const centerY = cy + ch * 0.5
  const centerEdgeDist = Math.max(-v03PillSDF(centerX, centerY, cx, cy, cw, ch), 1)
  const centerDist = Math.hypot(lx - centerX, ly - centerY)
  const u = v03Clamp01(centerDist / centerEdgeDist)
  const raw = invert ? 1 - u : u
  const eased = raw * raw * (3 - 2 * raw)
  return V03_MIN_SPEED_SCALE + (1 - V03_MIN_SPEED_SCALE) * eased
}

function v03BuildSpatialHash(boids: Boid[]): Map<string, number[]> {
  const buckets = new Map<string, number[]>()
  for (let i = 0; i < boids.length; i++) {
    const b = boids[i]
    const key = v03HashCell(b.x, b.y)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(i)
    else buckets.set(key, [i])
  }
  return buckets
}

function v03FlockAndFilter(
  boids: Boid[],
  cx: number, cy: number, cw: number, ch: number,
  dirX: number, dirY: number,
  speedScale: number,
  lx: number, ly: number,
  pointerDown: boolean,
  mouseDownFrames: number,
  deathDistancePx: number,
): Boid[] {
  const hasPointer = lx >= 0
  const maxSpeed = Math.max(0.02, V03_MAX_SPEED_BASE * speedScale)
  const maxForce = V03_MAX_FORCE_BASE * (0.22 + 0.78 * speedScale)
  const n = boids.length
  const sepR2 = V03_SEP_RADIUS * V03_SEP_RADIUS
  const alignR2 = V03_ALIGN_RADIUS * V03_ALIGN_RADIUS
  const cohesionR2 = V03_COHESION_RADIUS * V03_COHESION_RADIUS
  const buckets = v03BuildSpatialHash(boids)
  const [flowVX, flowVY] = v03SetMag(dirX, dirY, maxSpeed)
  const mouseRepelScale = Math.min(
    1 + mouseDownFrames * V03_MOUSE_REPEL_GROWTH_PER_FRAME,
    V03_MOUSE_REPEL_CAP_MULTIPLIER,
  )
  const mouseRepelRadius = Math.min(
    V03_MOUSE_REPEL_RADIUS + mouseDownFrames * V03_MOUSE_REPEL_RADIUS_GROWTH_PER_FRAME,
    V03_MOUSE_REPEL_RADIUS * V03_MOUSE_REPEL_RADIUS_CAP_MULTIPLIER,
  )

  for (const b of boids) { b.ax = 0; b.ay = 0 }

  for (let i = 0; i < n; i++) {
    const b = boids[i]
    let sepX = 0, sepY = 0, sepCnt = 0
    let algnVX = 0, algnVY = 0, algnCnt = 0
    let coheX = 0, coheY = 0, coheCnt = 0

    const bx = Math.floor(b.x / V03_HASH_CELL_SIZE)
    const by = Math.floor(b.y / V03_HASH_CELL_SIZE)
    let neighborWork = 0
    neighborLoop: for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const bucket = buckets.get(`${bx + ox},${by + oy}`)
        if (!bucket) continue
        for (const j of bucket) {
          if (i === j) continue
          const o = boids[j]
          const dx = b.x - o.x
          const dy = b.y - o.y
          const distSq = dx * dx + dy * dy
          if (distSq < sepR2 && distSq > 0) {
            const d = Math.sqrt(distSq)
            sepX += (dx / d) / d; sepY += (dy / d) / d; sepCnt++
          }
          if (distSq < alignR2) { algnVX += o.vx; algnVY += o.vy; algnCnt++ }
          if (distSq < cohesionR2) { coheX += o.x; coheY += o.y; coheCnt++ }
          neighborWork++
          if (neighborWork >= V03_MAX_NEIGHBORS_PER_BOID) break neighborLoop
        }
      }
    }

    if (sepCnt > 0) {
      const [sx, sy] = v03SetMag(sepX / sepCnt, sepY / sepCnt, maxSpeed)
      const [fx, fy] = v03LimitMag(sx - b.vx, sy - b.vy, maxForce)
      b.ax += fx * V03_SEP_WEIGHT; b.ay += fy * V03_SEP_WEIGHT
    }
    if (algnCnt > 0) {
      const [ax2, ay2] = v03SetMag(algnVX / algnCnt, algnVY / algnCnt, maxSpeed)
      const [fx, fy] = v03LimitMag(ax2 - b.vx, ay2 - b.vy, maxForce)
      b.ax += fx * V03_ALIGN_WEIGHT; b.ay += fy * V03_ALIGN_WEIGHT
    }
    if (coheCnt > 0) {
      const tx = coheX / coheCnt - b.x
      const ty = coheY / coheCnt - b.y
      const [tx2, ty2] = v03SetMag(tx, ty, maxSpeed)
      const [fx, fy] = v03LimitMag(tx2 - b.vx, ty2 - b.vy, maxForce)
      b.ax += fx * V03_COHESION_WEIGHT; b.ay += fy * V03_COHESION_WEIGHT
    }

    b.sepStrength = v03Clamp01(sepCnt / 6)
    b.alignStrength = v03Clamp01(algnCnt / 7)
    b.cohesionStrength = v03Clamp01(coheCnt / 7)

    {
      const [fx, fy] = v03LimitMag(flowVX - b.vx, flowVY - b.vy, maxForce)
      b.ax += fx * V03_FLOW_WEIGHT; b.ay += fy * V03_FLOW_WEIGHT
    }

    if (hasPointer && pointerDown) {
      const dx = b.x - lx
      const dy = b.y - ly
      const dist = Math.hypot(dx, dy)
      if (dist < mouseRepelRadius && dist > 0.1) {
        const strength = (1 - dist / mouseRepelRadius) * V03_MOUSE_REPEL_FORCE * mouseRepelScale
        b.ax += (dx / dist) * strength
        b.ay += (dy / dist) * strength
      }
    }
  }

  const alive: Boid[] = []
  for (const b of boids) {
    b.vx += b.ax
    b.vy += b.ay
    ;[b.vx, b.vy] = v03LimitMag(b.vx, b.vy, maxSpeed)
    ;[b.vx, b.vy] = v03SetMag(b.vx, b.vy, V03_FIXED_SPEED * speedScale)
    b.x += b.vx
    b.y += b.vy
    if (v03PillSDF(b.x, b.y, cx, cy, cw, ch) <= deathDistancePx) alive.push(b)
  }
  return alive
}

// 8-direction ASCII character based on velocity angle
const DIR_CHARS = ['-', '/', '|', '\\', '-', '/', '|', '\\'] as const
function v03DirChar(angle: number): string {
  const idx = ((Math.round(((angle + Math.PI) / (Math.PI * 2)) * 8) % 8) + 8) % 8
  return DIR_CHARS[idx]
}

function v03DrawAllBoids(t: Textmodifier, boids: Boid[], v03BoidSize: number) {
  const grid = t.grid
  if (!grid) return
  const cw = grid.cellWidth
  const ch = grid.cellHeight
  const halfCols = grid.cols / 2
  const halfRows = grid.rows / 2
  // grid.offsetX/Y is the centering margin in px when canvas size isn't an exact multiple of fontSize
  const ox = grid.offsetX
  const oy = grid.offsetY

  t.cellColor(0, 0, 0, 0)

  const size = Math.max(1, Math.floor(v03BoidSize))

  for (const b of boids) {
    const angle = Math.atan2(b.vy, b.vx)

    // Boid coords are in viewport pixels, same origin as the textmode canvas.
    // Convert to textmode centered grid coords: subtract centering offset, divide by cell size, shift by half-grid.
    const gx = Math.round((b.x - ox) / cw - halfCols)
    const gy = Math.round((b.y - oy) / ch - halfRows)

    t.push()
    t.translate(gx, gy)
    t.charColor(255, 255, 255, 236)
    t.char(v03DirChar(angle))
    if (size === 1) t.point()
    else t.rect(size, size)
    t.pop()
  }
}

function v03SpawnUpToMinimum(
  boids: Boid[],
  minLiveBoids: number,
  cx: number, cy: number, cw: number, ch: number,
  dirX: number, dirY: number,
) {
  const target = Math.min(Math.max(0, Math.floor(minLiveBoids)), V03_MAX_BOIDS_HARD)
  if (boids.length >= target) return
  const toAdd = Math.min(V03_SPAWN_BATCH_PER_FRAME, target - boids.length)
  for (let i = 0; i < toAdd; i++) {
    const pt = v03RandomPointInPill(cx, cy, cw, ch)
    boids.push(v03MakeDirectionalBoid(pt.x, pt.y, dirX, dirY))
  }
}

// ---------------------------------------------------------------------------
// Public factory — returns cleanup function
// ---------------------------------------------------------------------------
export function createV03Sketch(
  dataRef: MutableRefObject<SceneData>,
  host: HTMLElement,
): () => void {
  const w = Math.max(host.clientWidth, 1)
  const h = Math.max(host.clientHeight, 1)

  const t = textmode.create({ width: w, height: h, fontSize: V03_FONT_SIZE, frameRate: 60 })

  t.canvas.style.position = 'absolute'
  t.canvas.style.inset = '0'
  host.appendChild(t.canvas)

  let boids: Boid[] = []
  let initialized = false
  let mouseDownFrames = 0

  t.draw(() => {
    const {
      containerRects,
      lightPos,
      pointerDown,
      deathDistancePx,
      minLiveBoids,
      v03BoidSize,
      lastDirection,
      invertSpeedProfile,
    } = dataRef.current

    const cell = containerRects.get('1-1')
    if (!cell || cell.w <= 0 || cell.h <= 0) {
      t.clear()
      return
    }

    if (pointerDown) mouseDownFrames++
    else mouseDownFrames = 0

    if (!initialized) {
      boids = v03InitBoids(cell.x, cell.y, cell.w, cell.h, lastDirection.x, lastDirection.y)
      initialized = true
    }

    const speedScale = v03PointerSpeedScale(
      lightPos.x, lightPos.y,
      cell.x, cell.y, cell.w, cell.h,
      invertSpeedProfile,
    )

    boids = v03FlockAndFilter(
      boids,
      cell.x, cell.y, cell.w, cell.h,
      lastDirection.x, lastDirection.y,
      speedScale,
      lightPos.x, lightPos.y,
      pointerDown,
      mouseDownFrames,
      deathDistancePx,
    )

    v03SpawnUpToMinimum(boids, minLiveBoids, cell.x, cell.y, cell.w, cell.h, lastDirection.x, lastDirection.y)

    t.clear()
    v03DrawAllBoids(t, boids, v03BoidSize)
  })

  const ro = new ResizeObserver(() => {
    const rw = host.clientWidth
    const rh = host.clientHeight
    if (rw > 0 && rh > 0) t.resizeCanvas(rw, rh)
  })
  ro.observe(host)

  return () => {
    ro.disconnect()
    t.destroy()
  }
}
