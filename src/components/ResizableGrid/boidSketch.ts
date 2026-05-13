import p5 from 'p5'
import type { MutableRefObject } from 'react'
import type { SceneData } from '../../types/grid'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INITIAL_BOIDS = 80
const MAX_BOIDS_HARD = 10000
const SPAWN_BATCH_PER_FRAME = 48
const SPAWN_JITTER_ANGLE = 0.45
const SPAWN_SPEED_BASE = 1.25
const MAX_SPEED_BASE = 2.8
const MAX_FORCE_BASE = 0.075
const FLOW_WEIGHT = 0.95
const MOUSE_REPEL_RADIUS = 88
const MOUSE_REPEL_FORCE = 3.4
const MOUSE_REPEL_GROWTH_PER_FRAME = 0.03
const MOUSE_REPEL_CAP_MULTIPLIER = 3.2
const MOUSE_REPEL_RADIUS_GROWTH_PER_FRAME = 1.4
const MOUSE_REPEL_RADIUS_CAP_MULTIPLIER = 2.8
const V01_COLOR_SMOOTH_ALPHA = 0.16
const V02_FIXED_SPEED = MAX_SPEED_BASE * 0.96
const MAX_NEIGHBORS_PER_BOID = 36


const V02_POST_VERT_SRC = /* glsl */ `
precision mediump float;
attribute vec3 aPosition;
attribute vec2 aTexCoord;
varying vec2 vTexCoord;
uniform mat4 uModelViewMatrix;
uniform mat4 uProjectionMatrix;
void main() {
  vTexCoord = aTexCoord;
  gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(aPosition, 1.0);
}
`

const V02_SATURATE_SRC = /* glsl */ `
#ifndef FNC_SATURATE
#define FNC_SATURATE
float saturate(float x) { return clamp(x, 0.0, 1.0); }
#endif
`

const V02_CAPSULE_SDF_SRC = /* glsl */ `
${V02_SATURATE_SRC}
#ifndef FNC_CAPSULESDF
#define FNC_CAPSULESDF
float capsuleSDF(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a;
  vec3 ba = b - a;
  float h = saturate(dot(pa, ba) / dot(ba, ba));
  return length(pa - ba * h) - r;
}
#endif
`

const V02_BOX_SDF_SRC = /* glsl */ `
#ifndef FNC_BOXSDF
#define FNC_BOXSDF
float boxSDF(vec3 p, vec3 b) {
  vec3 d = abs(p) - b;
  return min(max(d.x, max(d.y, d.z)), 0.0) + length(max(d, 0.0));
}
#endif
`

const V02_POST_FRAG_SRC = /* glsl */ `
precision mediump float;
uniform sampler2D uBoidTex;
uniform vec2 uResolution;
uniform vec4 uCellRect;
uniform vec4 uLabelRect;
uniform float uBlurPx;
varying vec2 vTexCoord;

${V02_CAPSULE_SDF_SRC}
${V02_BOX_SDF_SRC}

void main() {
  vec2 uv = vTexCoord;
  vec2 texel = vec2(max(0.0, uBlurPx)) / uResolution;
  vec4 c0 = texture2D(uBoidTex, uv);
  vec4 c1 = texture2D(uBoidTex, uv + vec2(texel.x, 0.0));
  vec4 c2 = texture2D(uBoidTex, uv - vec2(texel.x, 0.0));
  vec4 c3 = texture2D(uBoidTex, uv + vec2(0.0, texel.y));
  vec4 c4 = texture2D(uBoidTex, uv - vec2(0.0, texel.y));
  vec4 blurred = c0 * 0.40 + (c1 + c2 + c3 + c4) * 0.15;

  vec2 scenePos = uv * uResolution;
  float radius = min(uCellRect.z * 0.5, uCellRect.w * 0.5);
  vec3 a = vec3(uCellRect.x + radius, uCellRect.y + uCellRect.w * 0.5, 0.0);
  vec3 b = vec3(uCellRect.x + uCellRect.z - radius, uCellRect.y + uCellRect.w * 0.5, 0.0);
  float sdf = capsuleSDF(vec3(scenePos, 0.0), a, b, radius);
  float mask = 1.0 - smoothstep(0.0, 2.0, sdf);

  if (uLabelRect.z > 0.0 && uLabelRect.w > 0.0) {
    vec2 labelCenter = uLabelRect.xy + uLabelRect.zw * 0.5;
    float labelSdf = boxSDF(vec3(scenePos - labelCenter, 0.0), vec3(uLabelRect.zw * 0.5, 1.0));
    float keep = smoothstep(-3.0, 9.0, labelSdf);
    blurred.a *= keep;
  }

  vec4 outCol = blurred * mask;
  if (outCol.a <= 0.001) discard;
  gl_FragColor = outCol;
}
`

// ---------------------------------------------------------------------------
// Boid type
// ---------------------------------------------------------------------------

interface Boid {
  x: number; y: number
  vx: number; vy: number
  ax: number; ay: number
  age: number
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

function v02Clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

function v02Lerp(a: number, b: number, t: number): number {
  return a + (b - a) * v02Clamp01(t)
}

function v02LimitMag(vx: number, vy: number, max: number): [number, number] {
  const mag = Math.hypot(vx, vy)
  if (mag > max) { const s = max / mag; return [vx * s, vy * s] }
  return [vx, vy]
}

function v02SetMag(vx: number, vy: number, mag: number): [number, number] {
  const m = Math.hypot(vx, vy)
  if (m < 0.001) return [0, 0]
  const s = mag / m
  return [vx * s, vy * s]
}

function v02Rotate(vx: number, vy: number, angle: number): [number, number] {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return [vx * c - vy * s, vx * s + vy * c]
}

function v02PillSDF(
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

function v02HashCell(x: number, y: number, hashCellSize: number): string {
  return `${Math.floor(x / hashCellSize)},${Math.floor(y / hashCellSize)}`
}

function v02RandomPointInPill(cx: number, cy: number, cw: number, ch: number): { x: number; y: number } {
  for (let i = 0; i < 24; i++) {
    const x = cx + Math.random() * cw
    const y = cy + Math.random() * ch
    if (v02PillSDF(x, y, cx, cy, cw, ch) <= 0) return { x, y }
  }
  return { x: cx + cw * 0.5, y: cy + ch * 0.5 }
}

function v02MakeDirectionalBoid(x: number, y: number, dirX: number, dirY: number): Boid {
  const [nx, ny] = v02SetMag(dirX, dirY, 1)
  const signedAngle = (Math.random() * 2 - 1) * SPAWN_JITTER_ANGLE
  const [rx, ry] = v02Rotate(nx || 1, ny || 0, signedAngle)
  const speed = SPAWN_SPEED_BASE * (0.7 + Math.random() * 0.6)
  return {
    x, y, vx: rx * speed, vy: ry * speed, ax: 0, ay: 0, age: 0,
    sepStrength: 0, alignStrength: 0, cohesionStrength: 0,
    colorR: -1, colorG: -1, colorB: -1,
  }
}

function v02HsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const hue = ((h % 360) + 360) % 360
  const c = v * s
  const x = c * (1 - Math.abs((hue / 60) % 2 - 1))
  const m = v - c
  let rp = 0, gp = 0, bp = 0
  if (hue < 60) [rp, gp, bp] = [c, x, 0]
  else if (hue < 120) [rp, gp, bp] = [x, c, 0]
  else if (hue < 180) [rp, gp, bp] = [0, c, x]
  else if (hue < 240) [rp, gp, bp] = [0, x, c]
  else if (hue < 300) [rp, gp, bp] = [x, 0, c]
  else [rp, gp, bp] = [c, 0, x]
  return [
    Math.round((rp + m) * 255),
    Math.round((gp + m) * 255),
    Math.round((bp + m) * 255),
  ]
}

function v02InitBoids(cx: number, cy: number, cw: number, ch: number, dirX: number, dirY: number): Boid[] {
  const boids: Boid[] = []
  for (let i = 0; i < INITIAL_BOIDS; i++) {
    const pt = v02RandomPointInPill(cx, cy, cw, ch)
    boids.push(v02MakeDirectionalBoid(pt.x, pt.y, dirX, dirY))
  }
  return boids
}

function v02PointerSpeedScale(
  lx: number, ly: number,
  cx: number, cy: number, cw: number, ch: number,
  invert: boolean,
  edgeVelocityMultiplier: number,
  centerSpeedScale: number,
): number {
  if (lx < 0 || ly < 0) return 1
  const centerX = cx + cw * 0.5
  const centerY = cy + ch * 0.5
  const centerEdgeDist = Math.max(-v02PillSDF(centerX, centerY, cx, cy, cw, ch), 1)
  const centerDist = Math.hypot(lx - centerX, ly - centerY)
  const u = v02Clamp01(centerDist / centerEdgeDist)
  const raw = invert ? 1 - u : u
  const eased = raw * raw * (3 - 2 * raw)
  const mul = Math.max(0, edgeVelocityMultiplier)
  const baseCenterSpeed = v02Clamp01(centerSpeedScale)
  return baseCenterSpeed + (1 - baseCenterSpeed) * eased * mul
}

function v02BuildSpatialHash(boids: Boid[], hashCellSize: number): Map<string, number[]> {
  const buckets = new Map<string, number[]>()
  for (let i = 0; i < boids.length; i++) {
    const b = boids[i]
    const key = v02HashCell(b.x, b.y, hashCellSize)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(i)
    else buckets.set(key, [i])
  }
  return buckets
}

function v02FlockAndFilter(
  boids: Boid[],
  cx: number, cy: number, cw: number, ch: number,
  dirX: number, dirY: number,
  speedScale: number,
  lx: number, ly: number,
  pointerDown: boolean,
  mouseDownFrames: number,
  deathDistancePx: number,
  lifeCycleFrames: number,
  hashCellSize: number,
  sepRadius: number,
  alignRadius: number,
  cohesionRadius: number,
  sepWeight: number,
  alignWeight: number,
  cohesionWeight: number,
): Boid[] {
  const hasPointer = lx >= 0
  const safeHashCellSize = Math.max(1, hashCellSize)
  const safeLifeCycleFrames = Math.max(1, Math.floor(lifeCycleFrames))
  const safeSepRadius = Math.max(1, sepRadius)
  const safeAlignRadius = Math.max(1, alignRadius)
  const safeCohesionRadius = Math.max(1, cohesionRadius)
  const safeSepWeight = Math.max(0, sepWeight)
  const safeAlignWeight = Math.max(0, alignWeight)
  const safeCohesionWeight = Math.max(0, cohesionWeight)
  const maxSpeed = Math.max(0.02, MAX_SPEED_BASE * speedScale)
  const maxForce = MAX_FORCE_BASE * (0.22 + 0.78 * speedScale)
  const n = boids.length
  const sepR2 = safeSepRadius * safeSepRadius
  const alignR2 = safeAlignRadius * safeAlignRadius
  const cohesionR2 = safeCohesionRadius * safeCohesionRadius
  const buckets = v02BuildSpatialHash(boids, safeHashCellSize)
  const [flowVX, flowVY] = v02SetMag(dirX, dirY, maxSpeed)
  const mouseRepelScale = Math.min(
    1 + mouseDownFrames * MOUSE_REPEL_GROWTH_PER_FRAME,
    MOUSE_REPEL_CAP_MULTIPLIER,
  )
  const mouseRepelRadius = Math.min(
    MOUSE_REPEL_RADIUS + mouseDownFrames * MOUSE_REPEL_RADIUS_GROWTH_PER_FRAME,
    MOUSE_REPEL_RADIUS * MOUSE_REPEL_RADIUS_CAP_MULTIPLIER,
  )

  for (const b of boids) { b.ax = 0; b.ay = 0 }

  for (let i = 0; i < n; i++) {
    const b = boids[i]

    let sepX = 0, sepY = 0, sepCnt = 0
    let algnVX = 0, algnVY = 0, algnCnt = 0
    let coheX = 0, coheY = 0, coheCnt = 0

    const bx = Math.floor(b.x / safeHashCellSize)
    const by = Math.floor(b.y / safeHashCellSize)
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
      const [sx, sy] = v02SetMag(sepX / sepCnt, sepY / sepCnt, maxSpeed)
      const [fx, fy] = v02LimitMag(sx - b.vx, sy - b.vy, maxForce)
      b.ax += fx * safeSepWeight
      b.ay += fy * safeSepWeight
    }
    if (algnCnt > 0) {
      const [ax2, ay2] = v02SetMag(algnVX / algnCnt, algnVY / algnCnt, maxSpeed)
      const [fx, fy] = v02LimitMag(ax2 - b.vx, ay2 - b.vy, maxForce)
      b.ax += fx * safeAlignWeight
      b.ay += fy * safeAlignWeight
    }
    if (coheCnt > 0) {
      const tx = coheX / coheCnt - b.x
      const ty = coheY / coheCnt - b.y
      const [tx2, ty2] = v02SetMag(tx, ty, maxSpeed)
      const [fx, fy] = v02LimitMag(tx2 - b.vx, ty2 - b.vy, maxForce)
      b.ax += fx * safeCohesionWeight
      b.ay += fy * safeCohesionWeight
    }

    b.sepStrength = v02Clamp01(sepCnt / 6)
    b.alignStrength = v02Clamp01(algnCnt / 7)
    b.cohesionStrength = v02Clamp01(coheCnt / 7)

    {
      const [fx, fy] = v02LimitMag(flowVX - b.vx, flowVY - b.vy, maxForce)
      b.ax += fx * FLOW_WEIGHT
      b.ay += fy * FLOW_WEIGHT
    }

    if (hasPointer && pointerDown) {
      const dx = b.x - lx
      const dy = b.y - ly
      const dist = Math.hypot(dx, dy)
      if (dist < mouseRepelRadius && dist > 0.1) {
        const strength = (1 - dist / mouseRepelRadius) * MOUSE_REPEL_FORCE * mouseRepelScale
        b.ax += (dx / dist) * strength
        b.ay += (dy / dist) * strength
      }
    }
  }

  const alive: Boid[] = []
  for (const b of boids) {
    b.vx += b.ax
    b.vy += b.ay
    ;[b.vx, b.vy] = v02LimitMag(b.vx, b.vy, maxSpeed)
    ;[b.vx, b.vy] = v02SetMag(b.vx, b.vy, V02_FIXED_SPEED * speedScale)
    b.x += b.vx
    b.y += b.vy
    b.age += 1
    if (v02PillSDF(b.x, b.y, cx, cy, cw, ch) <= deathDistancePx && b.age <= safeLifeCycleFrames) {
      alive.push(b)
    }
  }
  return alive
}

function v02DrawAllBoids(
  g: p5 | p5.Graphics,
  boids: Boid[],
  v02BoidLength: number,
  v02BoidLineLength: number,
) {
  g.strokeWeight(Math.max(1, v02BoidLength))
  g.noFill()
  const safeLineLength = Math.max(1, v02BoidLineLength)
  for (const b of boids) {
    const speed = Math.hypot(b.vx, b.vy)
    const lineLen = Math.max(1, speed * safeLineLength)
    const ux = speed > 0.001 ? b.vx / speed : 1
    const uy = speed > 0.001 ? b.vy / speed : 0
    const hx = ux * lineLen * 0.5
    const hy = uy * lineLen * 0.5
    const speed01 = v02Clamp01(speed / MAX_SPEED_BASE)
    const angle = Math.atan2(b.vy, b.vx)
    const directionHue = ((angle + Math.PI) / (Math.PI * 2)) * 360
    const value = 0.5 + 0.5 * speed01
    const targetColor = v02HsvToRgb(directionHue, 0.82, value)

    if (b.colorR < 0) {
      b.colorR = targetColor[0]
      b.colorG = targetColor[1]
      b.colorB = targetColor[2]
    } else {
      b.colorR = v02Lerp(b.colorR, targetColor[0], V01_COLOR_SMOOTH_ALPHA)
      b.colorG = v02Lerp(b.colorG, targetColor[1], V01_COLOR_SMOOTH_ALPHA)
      b.colorB = v02Lerp(b.colorB, targetColor[2], V01_COLOR_SMOOTH_ALPHA)
    }
    const color: [number, number, number] = [
      Math.round(b.colorR),
      Math.round(b.colorG),
      Math.round(b.colorB),
    ]

    g.stroke(color[0], color[1], color[2], 236)
    g.line(b.x - hx, b.y - hy, b.x + hx, b.y + hy)
  }
}

function v02SpawnUpToMinimum(
  boids: Boid[],
  minLiveBoids: number,
  cx: number, cy: number, cw: number, ch: number,
  dirX: number, dirY: number,
) {
  const target = Math.min(Math.max(0, Math.floor(minLiveBoids)), MAX_BOIDS_HARD)
  if (boids.length >= target) return
  const toAdd = Math.min(SPAWN_BATCH_PER_FRAME, target - boids.length)
  for (let i = 0; i < toAdd; i++) {
    const pt = v02RandomPointInPill(cx, cy, cw, ch)
    boids.push(v02MakeDirectionalBoid(pt.x, pt.y, dirX, dirY))
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
    let v02Boids: Boid[] = []
    let v02Initialized = false
    let boidBuffer: p5.Graphics | null = null
    let boidPostShaderV02: p5.Shader | null = null
    let v02MouseDownFrames = 0

    function ensureBoidBuffer(w: number, h: number) {
      if (boidBuffer && boidBuffer.width === w && boidBuffer.height === h) return
      boidBuffer = p.createGraphics(w, h)
      boidBuffer.pixelDensity(1)
      boidBuffer.noSmooth()
    }

    p.setup = () => {
      const host = getHost()
      const w = Math.max(host?.clientWidth ?? 640, 1)
      const h = Math.max(host?.clientHeight ?? 480, 1)
      p.createCanvas(w, h, p.WEBGL)
      p.pixelDensity(1)
      p.noStroke()
      boidPostShaderV02 = p.createShader(V02_POST_VERT_SRC, V02_POST_FRAG_SRC)
      ensureBoidBuffer(w, h)
    }

    p.draw = () => {
      if (!boidPostShaderV02) return

      const {
        containerRects,
        lightPos,
        pointerDown,
        deathDistancePx,
        minLiveBoids,
        v02BoidLength,
        v02BoidLineLength,
        v02EdgeVelocityMultiplier,
        v02CenterSpeed,
        v02LifeCycleFrames,
        v02HashCellSize,
        v02SepRadius,
        v02AlignRadius,
        v02CohesionRadius,
        v02SepWeight,
        v02AlignWeight,
        v02CohesionWeight,
        labelRect,
        lastDirection,
        invertSpeedProfile,
      } = dataRef.current

      const cell11 = containerRects.get('1-1')
      if (!cell11 || cell11.w <= 0 || cell11.h <= 0) return
      ensureBoidBuffer(p.width, p.height)
      if (!boidBuffer) return

      if (pointerDown) v02MouseDownFrames++
      else v02MouseDownFrames = 0

      if (!v02Initialized) {
        v02Boids = v02InitBoids(cell11.x, cell11.y, cell11.w, cell11.h, lastDirection.x, lastDirection.y)
        v02Initialized = true
      }

      const v02SpeedScale = v02PointerSpeedScale(
        lightPos.x, lightPos.y,
        cell11.x, cell11.y, cell11.w, cell11.h,
        invertSpeedProfile,
        v02EdgeVelocityMultiplier,
        v02CenterSpeed,
      )

      v02Boids = v02FlockAndFilter(
        v02Boids,
        cell11.x, cell11.y, cell11.w, cell11.h,
        lastDirection.x, lastDirection.y,
        v02SpeedScale,
        lightPos.x, lightPos.y,
        pointerDown,
        v02MouseDownFrames,
        deathDistancePx,
        v02LifeCycleFrames,
        v02HashCellSize,
        v02SepRadius,
        v02AlignRadius,
        v02CohesionRadius,
        v02SepWeight,
        v02AlignWeight,
        v02CohesionWeight,
      )

      v02SpawnUpToMinimum(
        v02Boids,
        minLiveBoids,
        cell11.x, cell11.y, cell11.w, cell11.h,
        lastDirection.x, lastDirection.y,
      )

      boidBuffer.clear()
      v02DrawAllBoids(boidBuffer, v02Boids, v02BoidLength, v02BoidLineLength)

      p.clear()
      p.shader(boidPostShaderV02)
      boidPostShaderV02.setUniform('uBoidTex', boidBuffer)
      boidPostShaderV02.setUniform('uResolution', [p.width, p.height])
      boidPostShaderV02.setUniform('uCellRect', [cell11.x, cell11.y, cell11.w, cell11.h])
      if (labelRect && labelRect.w > 0 && labelRect.h > 0) {
        boidPostShaderV02.setUniform('uLabelRect', [labelRect.x, labelRect.y, labelRect.w, labelRect.h])
      } else {
        boidPostShaderV02.setUniform('uLabelRect', [-1, -1, 0, 0])
      }
      boidPostShaderV02.setUniform('uBlurPx', 0)
      p.plane(p.width, p.height)
    }
  }
}
