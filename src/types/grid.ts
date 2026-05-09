export type CellType = 'normal' | 'super' | 'micro' | 'empty'
export type CellVersion = 'v02' | 'v03'

export interface LayoutCellDef {
  id: string
  row: number
  col: number
  rowSpan: number
  colSpan: number
  type: CellType
}

export interface CellRect {
  x: number
  y: number
  w: number
  h: number
}

export interface SceneData {
  cellRects: Map<string, CellRect>
  containerRects: Map<string, CellRect>
  labelRect: CellRect | null
  lightPos: { x: number; y: number }
  pointerOverSurface: boolean
  pointerDown: boolean
  mouseReleasedTick: number
  deathDistancePx: number
  minLiveBoids: number
  boidBlurPx: number
  v02BoidLength: number
  v02BoidLineLength: number
  v02EdgeVelocityMultiplier: number
  v02HashCellSize: number
  v02SepRadius: number
  v02AlignRadius: number
  v02CohesionRadius: number
  v02SepWeight: number
  v02AlignWeight: number
  v02CohesionWeight: number
  v02CenterSpeed: number
  v02LifeCycleFrames: number
  v03BoidSize: number
  lastDirection: { x: number; y: number }
  invertSpeedProfile: boolean
  cellVersion: CellVersion
}
