import p5 from 'p5'
import type { MutableRefObject } from 'react'
import type { SharedSceneData } from '../../types/grid'
import { argbFromHex, blueFromArgb, greenFromArgb, redFromArgb } from '@material/material-color-utilities'

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

const PILL_EDGE_MARGIN_PX = 3

const FRAG_SRC = /* glsl */ `
precision mediump float;
uniform vec2 uResolution;
uniform vec4 uCellRect;   // x, y, w, h — scene space (origin top-left, Y down)
uniform vec3 uColor;
uniform vec2 uLightPos;   // scene space; (-1, -1) when pointer is off-canvas
uniform float uBlurPx;    // fast local blur radius in pixels

vec4 shadePillAt(vec2 scenePos) {
  // Pill mask (capsule SDF) in cell-local pixels.
  vec2 localPos = scenePos - uCellRect.xy;
  vec2 halfSize = uCellRect.zw * 0.5;
  vec2 centered = localPos - halfSize;
  float radius = min(halfSize.x, halfSize.y);
  vec2 q = abs(centered) - (halfSize - vec2(radius));
  float sdf = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;

  // Softened edge keeps the blur from looking clipped.
  float mask = 1.0 - smoothstep(-1.2, 2.0, sdf);
  if (mask <= 0.0) return vec4(0.0);

  vec3 col = clamp(uColor, 0.0, 1.0);
  return vec4(col, mask);
}

void main() {
  // gl_FragCoord.y = 0 is at the bottom; flip to scene space (Y down from top).
  vec2 scenePos = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);

  // Fast 5-tap cross blur constrained to the generated pill shading.
  vec2 ox = vec2(uBlurPx, 0.0);
  vec2 oy = vec2(0.0, uBlurPx);
  vec4 c0 = shadePillAt(scenePos);
  vec4 c1 = shadePillAt(scenePos + ox);
  vec4 c2 = shadePillAt(scenePos - ox);
  vec4 c3 = shadePillAt(scenePos + oy);
  vec4 c4 = shadePillAt(scenePos - oy);
  vec4 col = c0 * 0.40 + (c1 + c2 + c3 + c4) * 0.15;

  if (col.a <= 0.001) discard;
  gl_FragColor = col;
}
`

// ---------------------------------------------------------------------------
// Sketch factory — cell background fills only
// ---------------------------------------------------------------------------

export function createGridShaderSketch(
  dataRef: MutableRefObject<SharedSceneData>,
  getHost: () => HTMLElement | null,
) {
  return (p: p5) => {
    let sh: p5.Shader
    const blurPx = 0

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
      p.ortho(-p.width * 0.5, p.width * 0.5, -p.height * 0.5, p.height * 0.5, -1000, 1000)
      p.background(0, 0, 0)

      if (!sh) return
      p.shader(sh)
      p.noStroke()

      const { containerRects, lightPos, pillBgHex } = dataRef.current
      const bgArgb = argbFromHex(pillBgHex)
      const bgColor: [number, number, number] = [
        redFromArgb(bgArgb) / 255,
        greenFromArgb(bgArgb) / 255,
        blueFromArgb(bgArgb) / 255,
      ]

      for (const c of containerRects.values()) {
        if (c.w <= 0 || c.h <= 0) continue

        sh.setUniform('uResolution', [p.width, p.height])
        sh.setUniform('uCellRect', [c.x, c.y, c.w, c.h])
        sh.setUniform('uColor', bgColor)
        sh.setUniform('uLightPos', [lightPos.x, lightPos.y])
        sh.setUniform('uBlurPx', blurPx)

        p.push()
        p.translate(
          c.x + c.w * 0.5 - p.width * 0.5,
          c.y + c.h * 0.5 - p.height * 0.5,
          0,
        )
        p.plane(c.w + PILL_EDGE_MARGIN_PX * 2, c.h + PILL_EDGE_MARGIN_PX * 2)
        p.pop()
      }
    }
  }
}
