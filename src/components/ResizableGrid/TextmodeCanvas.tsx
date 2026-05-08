import { useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { createV03Sketch } from './boidRuntimeV03'
import type { SceneData } from '../../types/grid'

interface Props {
  dataRef: MutableRefObject<SceneData>
}

export function TextmodeCanvas({ dataRef }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const cleanup = createV03Sketch(dataRef, host)
    return cleanup
  }, [dataRef])

  return <div ref={hostRef} className="resizable-grid__boid-host resizable-grid__boid-host--v03" />
}
