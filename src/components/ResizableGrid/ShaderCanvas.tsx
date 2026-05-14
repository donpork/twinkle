import { useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import p5 from 'p5'
import { createGridShaderSketch } from './gridShader'
import type { SharedSceneData } from '../../types/grid'

interface Props {
  dataRef: MutableRefObject<SharedSceneData>
  active: boolean
}

export function ShaderCanvas({ dataRef, active }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const instanceRef = useRef<p5 | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const sketch = createGridShaderSketch(dataRef, () => hostRef.current)
    const instance = new p5(sketch, host)
    instanceRef.current = instance

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
      instanceRef.current = null
    }
  }, [dataRef]) // dataRef is stable for the component lifetime

  useEffect(() => {
    const inst = instanceRef.current
    const host = hostRef.current
    if (!inst || !host) return
    if (active) {
      const w = host.clientWidth
      const h = host.clientHeight
      if (w > 0 && h > 0) inst.resizeCanvas(w, h, true)
      inst.loop()
    }
    else inst.noLoop()
  }, [active])

  return (
    <div
      ref={hostRef}
      className="resizable-grid__canvas-host"
      style={active ? undefined : { opacity: 0, visibility: 'hidden' }}
    />
  )
}
