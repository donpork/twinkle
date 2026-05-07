import { useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import p5 from 'p5'
import { createBoidSketch } from './boidSketch'
import type { SceneData } from '../../types/grid'

interface Props {
  dataRef: MutableRefObject<SceneData>
}

export function BoidCanvas({ dataRef }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const sketch = createBoidSketch(dataRef, () => hostRef.current)
    const instance = new p5(sketch, host)

    const ro = new ResizeObserver(() => {
      const w = host.clientWidth
      const h = host.clientHeight
      if (w > 0 && h > 0) instance.resizeCanvas(w, h)
    })
    ro.observe(host)

    return () => {
      ro.disconnect()
      instance.remove()
    }
  }, [dataRef])

  return <div ref={hostRef} className="resizable-grid__boid-host" />
}
