import { useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import p5 from 'p5'
import { createGridShaderSketch } from './gridShader'
import type { SceneData } from '../../types/grid'

interface Props {
  dataRef: MutableRefObject<SceneData>
}

export function ShaderCanvas({ dataRef }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const sketch = createGridShaderSketch(dataRef, () => hostRef.current)
    const instance = new p5(sketch, host)

    // Resize canvas whenever the host div changes size.
    // Never recreate the p5 instance — use resizeCanvas to avoid shader recompilation.
    const ro = new ResizeObserver(() => {
      const w = host.clientWidth
      const h = host.clientHeight
      if (w > 0 && h > 0) instance.resizeCanvas(w, h, true)
    })
    ro.observe(host)

    return () => {
      ro.disconnect()
      instance.remove()
    }
  }, [dataRef]) // dataRef is stable for the component lifetime

  return <div ref={hostRef} className="resizable-grid__canvas-host" />
}
