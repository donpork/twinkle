import { useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import p5 from 'p5'
import { createBoidSketch } from './boidSketch'
import type { V02SceneData } from '../../types/grid'

interface Props {
  dataRef: MutableRefObject<V02SceneData>
  active: boolean
}

export function BoidCanvas({ dataRef, active }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const instanceRef = useRef<p5 | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const sketch = createBoidSketch(dataRef, () => hostRef.current)
    const instance = new p5(sketch, host)
    instanceRef.current = instance

    const ro = new ResizeObserver(() => {
      const w = host.clientWidth
      const h = host.clientHeight
      if (w > 0 && h > 0) instance.resizeCanvas(w, h)
    })
    ro.observe(host)

    return () => {
      ro.disconnect()
      instance.remove()
      instanceRef.current = null
    }
  }, [dataRef])

  useEffect(() => {
    const inst = instanceRef.current
    const host = hostRef.current
    if (!inst || !host) return
    if (active) {
      const w = host.clientWidth
      const h = host.clientHeight
      if (w > 0 && h > 0) inst.resizeCanvas(w, h)
      inst.loop()
    }
    else inst.noLoop()
  }, [active])

  return (
    <div
      ref={hostRef}
      className="resizable-grid__boid-host"
      style={active ? undefined : { opacity: 0, visibility: 'hidden' }}
    />
  )
}
