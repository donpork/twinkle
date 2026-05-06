import p5 from 'p5'
import type { MutableRefObject } from 'react'
import type { SceneData } from '../../types/grid'

// ---------------------------------------------------------------------------
// Shader sources
// ---------------------------------------------------------------------------

const VERT_SRC = /* glsl */ `
precision mediump float;
attribute vec3 aPosition;
uniform mat4 uModelViewMatrix;
uniform mat4 uProjectionMatrix;
void main() {
  gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(aPosition, 1.0);
}
`

const FRAG_SRC = /* glsl */ `
precision mediump float;
uniform vec2 uResolution;
uniform vec4 uCellRect;   // x, y, w, h — scene space (origin top-left, Y down)
uniform vec3 uColor;
uniform vec2 uLightPos;   // scene space; (-1, -1) when pointer is off-canvas

void main() {
  // gl_FragCoord.y = 0 is at the bottom; flip to scene space (Y down from top).
  vec2 scenePos = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);

  // Cell-local UV: [0, 1] across cell width and height.
  vec2 cellUV = (scenePos - uCellRect.xy) / uCellRect.zw;

  // Subtle radial vignette.
  float d = length(cellUV - 0.5) * 2.0;
  float vignette = 1.0 - smoothstep(0.45, 1.1, d) * 0.42;

  // Mouse-proximity highlight.
  float highlight = 0.0;
  if (uLightPos.x >= 0.0) {
    float dist = length(scenePos - uLightPos);
    float radius = max(uCellRect.z, uCellRect.w) * 0.55;
    highlight = smoothstep(radius, 0.0, dist) * 0.20;
  }

  vec3 col = clamp(uColor * vignette + highlight, 0.0, 1.0);
  gl_FragColor = vec4(col, 1.0);
}
`

// ---------------------------------------------------------------------------
// Per-cell colors
// ---------------------------------------------------------------------------

export const CELL_COLORS = new Map<string, [number, number, number]>([
  ['0-0', [0.22, 0.42, 0.82]],  // royal blue  — the large super cell
  ['0-2', [0.80, 0.28, 0.20]],  // coral red
  ['1-2', [0.16, 0.70, 0.46]],  // emerald
  ['2-0', [0.82, 0.60, 0.08]],  // amber
  ['2-1', [0.52, 0.18, 0.82]],  // violet
  ['2-2', [0.10, 0.68, 0.80]],  // cyan
])

// ---------------------------------------------------------------------------
// Sketch factory
// ---------------------------------------------------------------------------

export function createGridShaderSketch(
  dataRef: MutableRefObject<SceneData>,
  getHost: () => HTMLElement | null,
) {
  return (p: p5) => {
    let sh: p5.Shader

    p.setup = () => {
      const host = getHost()
      const w = Math.max(host?.clientWidth ?? 640, 1)
      const h = Math.max(host?.clientHeight ?? 480, 1)
      p.createCanvas(w, h, p.WEBGL)
      p.pixelDensity(1)
      p.noStroke()
      sh = p.createShader(VERT_SRC, FRAG_SRC)
    }

    p.draw = () => {
      // Ortho projection: 1 world unit = 1 CSS pixel, origin at canvas centre.
      p.ortho(-p.width * 0.5, p.width * 0.5, -p.height * 0.5, p.height * 0.5, -1000, 1000)
      p.background(14, 14, 22)

      if (!sh) return
      p.shader(sh)
      p.noStroke()

      const { containerRects, lightPos } = dataRef.current

      for (const [id, c] of containerRects) {
        if (c.w <= 0 || c.h <= 0) continue
        const color = CELL_COLORS.get(id) ?? ([0.5, 0.5, 0.5] as [number, number, number])

        sh.setUniform('uResolution', [p.width, p.height])
        sh.setUniform('uCellRect', [c.x, c.y, c.w, c.h])
        sh.setUniform('uColor', color)
        sh.setUniform('uLightPos', [lightPos.x, lightPos.y])

        p.push()
        // Translate scene-space cell centre to p5-WEBGL space (origin = canvas centre).
        p.translate(
          c.x + c.w * 0.5 - p.width * 0.5,
          c.y + c.h * 0.5 - p.height * 0.5,
          0,
        )
        p.plane(c.w, c.h)
        p.pop()
      }
    }
  }
}
