import p5 from 'p5'
import type { MutableRefObject } from 'react'
import type { SceneData } from '../../types/grid'
import kochiMinchoFontUrl from '../../../assets/kochi-mincho-subst.ttf'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INITIAL_BOIDS = 80
const MAX_BOIDS_HARD = 5000
const SPAWN_BATCH_PER_FRAME = 48
const SPAWN_JITTER_ANGLE = 0.45
const SPAWN_SPEED_BASE = 1.25
const MAX_SPEED_BASE = 2.8
const MAX_FORCE_BASE = 0.075
const MIN_SPEED_SCALE = 0.03
const SEP_RADIUS = 18
const SEP_WEIGHT = 1.45
const ALIGN_RADIUS = 44
const ALIGN_WEIGHT = 1.0
const COHESION_RADIUS = 44
const COHESION_WEIGHT = 1.0
const FLOW_WEIGHT = 0.95
const MOUSE_REPEL_RADIUS = 88
const MOUSE_REPEL_FORCE = 3.4
const MOUSE_REPEL_GROWTH_PER_FRAME = 0.03
const MOUSE_REPEL_CAP_MULTIPLIER = 3.2
const LINE_MIN_LEN = 9.0
const LINE_SPEED_LEN_SCALE = 3.9
const LINE_WEIGHT = 1.3
const HASH_CELL_SIZE = 44
const MAX_NEIGHBORS_PER_BOID = 36
const CELL_LABEL = 'R1C1'

const GREEN_RGB: [number, number, number] = [152, 239, 104]
const GREEN_HIGH_CHROMA_RGB: [number, number, number] = [118, 250, 62]
const BLUE_RGB: [number, number, number] = [45, 20, 195]
const PURPLE_RGB: [number, number, number] = [69, 24, 168]
const PINK_RGB: [number, number, number] = [192, 85, 189]
const RED_RGB: [number, number, number] = [154, 53, 22]

const LABEL_REPEL_PADDING = 18
const LABEL_REPEL_FORCE = 0.95

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
}

// ---------------------------------------------------------------------------
// Pill SDF — mirrors the fragment shader capsule formula.
// Returns < 0 inside, 0 at edge, > 0 outside.
// ---------------------------------------------------------------------------

function pillSDF(
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function limitMag(vx: number, vy: number, max: number): [number, number] {
  const mag = Math.hypot(vx, vy)
  if (mag > max) { const s = max / mag; return [vx * s, vy * s] }
  return [vx, vy]
}

function setMag(vx: number, vy: number, mag: number): [number, number] {
  const m = Math.hypot(vx, vy)
  if (m < 0.001) return [0, 0]
  const s = mag / m
  return [vx * s, vy * s]
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp01(t)
}

function blendRGB(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t)),
  ]
}

function rotate(vx: number, vy: number, angle: number): [number, number] {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return [vx * c - vy * s, vx * s + vy * c]
}

function randomPointInPill(cx: number, cy: number, cw: number, ch: number): { x: number; y: number } {
  for (let i = 0; i < 24; i++) {
    const x = cx + Math.random() * cw
    const y = cy + Math.random() * ch
    if (pillSDF(x, y, cx, cy, cw, ch) <= 0) return { x, y }
  }
  return { x: cx + cw * 0.5, y: cy + ch * 0.5 }
}

function makeDirectionalBoid(x: number, y: number, dirX: number, dirY: number): Boid {
  const [nx, ny] = setMag(dirX, dirY, 1)
  const signedAngle = (Math.random() * 2 - 1) * SPAWN_JITTER_ANGLE
  const [rx, ry] = rotate(nx || 1, ny || 0, signedAngle)
  const speed = SPAWN_SPEED_BASE * (0.7 + Math.random() * 0.6)
  return {
    x, y, vx: rx * speed, vy: ry * speed, ax: 0, ay: 0,
    sepStrength: 0, alignStrength: 0, cohesionStrength: 0,
  }
}

function initBoids(cx: number, cy: number, cw: number, ch: number, dirX: number, dirY: number): Boid[] {
  const boids: Boid[] = []
  for (let i = 0; i < INITIAL_BOIDS; i++) {
    const pt = randomPointInPill(cx, cy, cw, ch)
    boids.push(makeDirectionalBoid(pt.x, pt.y, dirX, dirY))
  }
  return boids
}

function pointerSpeedScale(
  lx: number, ly: number,
  cx: number, cy: number, cw: number, ch: number,
  invert: boolean,
): number {
  if (lx < 0 || ly < 0) return 1
  const centerX = cx + cw * 0.5
  const centerY = cy + ch * 0.5
  const centerEdgeDist = Math.max(-pillSDF(centerX, centerY, cx, cy, cw, ch), 1)
  const centerDist = Math.hypot(lx - centerX, ly - centerY)
  const u = clamp01(centerDist / centerEdgeDist)
  const raw = invert ? 1 - u : u
  const eased = raw * raw * (3 - 2 * raw)
  return MIN_SPEED_SCALE + (1 - MIN_SPEED_SCALE) * eased
}

function hashCell(x: number, y: number): string {
  return `${Math.floor(x / HASH_CELL_SIZE)},${Math.floor(y / HASH_CELL_SIZE)}`
}

function buildSpatialHash(boids: Boid[]): Map<string, number[]> {
  const buckets = new Map<string, number[]>()
  for (let i = 0; i < boids.length; i++) {
    const b = boids[i]
    const key = hashCell(b.x, b.y)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(i)
    else buckets.set(key, [i])
  }
  return buckets
}

function flockAndFilter(
  boids: Boid[],
  cx: number, cy: number, cw: number, ch: number,
  dirX: number, dirY: number,
  speedScale: number,
  lx: number, ly: number,
  pointerDown: boolean,
  mouseDownFrames: number,
  deathDistancePx: number,
  labelBoundary: { x: number; y: number; w: number; h: number } | null,
): Boid[] {
  const hasPointer = lx >= 0
  const maxSpeed = Math.max(0.02, MAX_SPEED_BASE * speedScale)
  const maxForce = MAX_FORCE_BASE * (0.22 + 0.78 * speedScale)
  const n = boids.length
  const sepR2 = SEP_RADIUS * SEP_RADIUS
  const alignR2 = ALIGN_RADIUS * ALIGN_RADIUS
  const cohesionR2 = COHESION_RADIUS * COHESION_RADIUS
  const buckets = buildSpatialHash(boids)
  const [flowVX, flowVY] = setMag(dirX, dirY, maxSpeed)
  const mouseRepelScale = Math.min(
    1 + mouseDownFrames * MOUSE_REPEL_GROWTH_PER_FRAME,
    MOUSE_REPEL_CAP_MULTIPLIER,
  )

  for (const b of boids) { b.ax = 0; b.ay = 0 }

  for (let i = 0; i < n; i++) {
    const b = boids[i]

    let sepX = 0, sepY = 0, sepCnt = 0
    let algnVX = 0, algnVY = 0, algnCnt = 0
    let coheX = 0, coheY = 0, coheCnt = 0

    const bx = Math.floor(b.x / HASH_CELL_SIZE)
    const by = Math.floor(b.y / HASH_CELL_SIZE)
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
            sepX += (dx / d) / d
            sepY += (dy / d) / d
            sepCnt++
          }
          if (distSq < alignR2) {
            algnVX += o.vx; algnVY += o.vy; algnCnt++
          }
          if (distSq < cohesionR2) {
            coheX += o.x; coheY += o.y; coheCnt++
          }

          neighborWork++
          if (neighborWork >= MAX_NEIGHBORS_PER_BOID) break neighborLoop
        }
      }
    }

    if (sepCnt > 0) {
      const [sx, sy] = setMag(sepX / sepCnt, sepY / sepCnt, maxSpeed)
      const [fx, fy] = limitMag(sx - b.vx, sy - b.vy, maxForce)
      b.ax += fx * SEP_WEIGHT
      b.ay += fy * SEP_WEIGHT
    }
    if (algnCnt > 0) {
      const [ax2, ay2] = setMag(algnVX / algnCnt, algnVY / algnCnt, maxSpeed)
      const [fx, fy] = limitMag(ax2 - b.vx, ay2 - b.vy, maxForce)
      b.ax += fx * ALIGN_WEIGHT
      b.ay += fy * ALIGN_WEIGHT
    }
    if (coheCnt > 0) {
      const tx = coheX / coheCnt - b.x
      const ty = coheY / coheCnt - b.y
      const [tx2, ty2] = setMag(tx, ty, maxSpeed)
      const [fx, fy] = limitMag(tx2 - b.vx, ty2 - b.vy, maxForce)
      b.ax += fx * COHESION_WEIGHT
      b.ay += fy * COHESION_WEIGHT
    }

    b.sepStrength = clamp01(sepCnt / 6)
    b.alignStrength = clamp01(algnCnt / 7)
    b.cohesionStrength = clamp01(coheCnt / 7)

    // Directional flow
    {
      const [fx, fy] = limitMag(flowVX - b.vx, flowVY - b.vy, maxForce)
      b.ax += fx * FLOW_WEIGHT
      b.ay += fy * FLOW_WEIGHT
    }

    // Mouse-down circular repulsion
    if (hasPointer && pointerDown) {
      const dx = b.x - lx
      const dy = b.y - ly
      const dist = Math.hypot(dx, dy)
      if (dist < MOUSE_REPEL_RADIUS && dist > 0.1) {
        const strength = (1 - dist / MOUSE_REPEL_RADIUS) * MOUSE_REPEL_FORCE * mouseRepelScale
        b.ax += (dx / dist) * strength
        b.ay += (dy / dist) * strength
      }
    }

    if (labelBoundary) {
      const sdf = pillSDF(b.x, b.y, labelBoundary.x, labelBoundary.y, labelBoundary.w, labelBoundary.h)
      if (sdf < LABEL_REPEL_PADDING) {
        const e = 0.6
        const gx = pillSDF(b.x + e, b.y, labelBoundary.x, labelBoundary.y, labelBoundary.w, labelBoundary.h)
          - pillSDF(b.x - e, b.y, labelBoundary.x, labelBoundary.y, labelBoundary.w, labelBoundary.h)
        const gy = pillSDF(b.x, b.y + e, labelBoundary.x, labelBoundary.y, labelBoundary.w, labelBoundary.h)
          - pillSDF(b.x, b.y - e, labelBoundary.x, labelBoundary.y, labelBoundary.w, labelBoundary.h)
        const gMag = Math.hypot(gx, gy)
        if (gMag > 0.00001) {
          const strength = (1 - clamp01(sdf / LABEL_REPEL_PADDING)) * LABEL_REPEL_FORCE
          b.ax += (gx / gMag) * strength
          b.ay += (gy / gMag) * strength
        }
      }
    }
  }

  const alive: Boid[] = []
  for (const b of boids) {
    b.vx += b.ax
    b.vy += b.ay
    ;[b.vx, b.vy] = limitMag(b.vx, b.vy, maxSpeed)
    b.x += b.vx
    b.y += b.vy
    if (pillSDF(b.x, b.y, cx, cy, cw, ch) <= deathDistancePx) {
      alive.push(b)
    }
  }
  return alive
}

// ---------------------------------------------------------------------------
// Draw — 2D canvas, scene-space coords map directly (no centering offset)
// ---------------------------------------------------------------------------

function drawAllBoids(p: p5, boids: Boid[]) {
  p.strokeWeight(LINE_WEIGHT)
  p.noFill()
  for (const b of boids) {
    const speed = Math.hypot(b.vx, b.vy)
    const lineLen = LINE_MIN_LEN + speed * LINE_SPEED_LEN_SCALE
    const ux = speed > 0.001 ? b.vx / speed : 1
    const uy = speed > 0.001 ? b.vy / speed : 0
    const hx = ux * lineLen * 0.5
    const hy = uy * lineLen * 0.5
    const speed01 = clamp01(speed / MAX_SPEED_BASE)
    const accel01 = clamp01(Math.hypot(b.ax, b.ay) / (MAX_FORCE_BASE * 6.5))
    const cohesionTone = clamp01(b.cohesionStrength * (1 - 0.55 * accel01))
    const propScores = [
      { key: 'velocity', score: speed01 },
      { key: 'cohesion', score: cohesionTone },
      { key: 'separation', score: b.sepStrength },
      { key: 'alignment', score: b.alignStrength },
    ].sort((a, b2) => b2.score - a.score)

    const dominant = propScores[0]
    let color: [number, number, number]
    if (dominant.key === 'velocity') {
      color = blendRGB(PURPLE_RGB, GREEN_RGB, speed01)
    } else if (dominant.key === 'cohesion') {
      color = cohesionTone < 0.45 ? GREEN_RGB : GREEN_HIGH_CHROMA_RGB
    } else if (dominant.key === 'separation') {
      color = PINK_RGB
    } else {
      color = blendRGB(RED_RGB, BLUE_RGB, b.alignStrength)
    }

    p.stroke(color[0], color[1], color[2], 228)
    p.line(b.x - hx, b.y - hy, b.x + hx, b.y + hy)
  }
}

function getLabelBoundary(p: p5, x: number, y: number, w: number, h: number, font: p5.Font | null) {
  const size = Math.max(16, Math.min(34, Math.min(w, h) * 0.2))
  if (font) p.textFont(font)
  p.textSize(size)
  const textW = p.textWidth(CELL_LABEL)
  const textH = size * 0.95
  const padX = 18
  const padY = 12
  const bw = textW + padX * 2
  const bh = textH + padY * 2
  return {
    x: x + w * 0.5 - bw * 0.5,
    y: y + h * 0.5 - bh * 0.5,
    w: bw,
    h: bh,
  }
}

function spawnUpToMinimum(
  boids: Boid[],
  minLiveBoids: number,
  cx: number, cy: number, cw: number, ch: number,
  dirX: number, dirY: number,
) {
  const target = Math.min(Math.max(0, Math.floor(minLiveBoids)), MAX_BOIDS_HARD)
  if (boids.length >= target) return
  const toAdd = Math.min(SPAWN_BATCH_PER_FRAME, target - boids.length)
  for (let i = 0; i < toAdd; i++) {
    const pt = randomPointInPill(cx, cy, cw, ch)
    boids.push(makeDirectionalBoid(pt.x, pt.y, dirX, dirY))
  }
}

// ---------------------------------------------------------------------------
// Sketch factory — 2D canvas, transparent background, renders above cells
// ---------------------------------------------------------------------------

export function createBoidSketch(
  dataRef: MutableRefObject<SceneData>,
  getHost: () => HTMLElement | null,
) {
  return (p: p5) => {
    let boids: Boid[] = []
    let initialized = false
    let labelFont: p5.Font | null = null
    let mouseDownFrames = 0

    p.setup = () => {
      const host = getHost()
      const w = Math.max(host?.clientWidth ?? 640, 1)
      const h = Math.max(host?.clientHeight ?? 480, 1)
      p.createCanvas(w, h)
      p.pixelDensity(1)
      p.noLoop()
      p.loop()
      void p.loadFont(kochiMinchoFontUrl).then((font) => {
        labelFont = font
      })
    }

    p.draw = () => {
      p.clear()

      const {
        containerRects,
        lightPos,
        pointerDown,
        deathDistancePx,
        minLiveBoids,
        lastDirection,
        invertSpeedProfile,
      } = dataRef.current

      const cell11 = containerRects.get('1-1')
      if (!cell11 || cell11.w <= 0 || cell11.h <= 0) return

      if (pointerDown) mouseDownFrames++
      else mouseDownFrames = 0

      if (!initialized) {
        boids = initBoids(cell11.x, cell11.y, cell11.w, cell11.h, lastDirection.x, lastDirection.y)
        initialized = true
      }

      const speedScale = pointerSpeedScale(
        lightPos.x, lightPos.y,
        cell11.x, cell11.y, cell11.w, cell11.h,
        invertSpeedProfile,
      )
      const labelBoundary = getLabelBoundary(p, cell11.x, cell11.y, cell11.w, cell11.h, labelFont)

      boids = flockAndFilter(
        boids,
        cell11.x, cell11.y, cell11.w, cell11.h,
        lastDirection.x, lastDirection.y,
        speedScale,
        lightPos.x, lightPos.y,
        pointerDown,
        mouseDownFrames,
        deathDistancePx,
        labelBoundary,
      )

      spawnUpToMinimum(
        boids,
        minLiveBoids,
        cell11.x, cell11.y, cell11.w, cell11.h,
        lastDirection.x, lastDirection.y,
      )

      drawAllBoids(p, boids)
    }
  }
}
