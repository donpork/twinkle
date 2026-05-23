export type CellType = 'normal' | 'super' | 'micro' | 'empty'
export type CellVersion = 'v02'

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

/** Fields written by the shared DOM/pointer collector into every version store. */
export interface SharedSceneData {
  cellRects: Map<string, CellRect>
  containerRects: Map<string, CellRect>
  lightPos: { x: number; y: number }
  themeSeedHex: string
  pillBgHex: string
  pointerOverSurface: boolean
  pointerDown: boolean
  mouseReleasedTick: number
  lastDirection: { x: number; y: number }
  invertSpeedProfile: boolean
  cellVersion: CellVersion
}

/** Runtime data store for the v02 (boids) version. */
export interface V02SceneData extends SharedSceneData {
  labelRect: CellRect | null
  deathDistancePx: number
  minLiveBoids: number
  boidBlurPx: number
  v02BoidLength: number
  v02BoidLineLength: number
  v02EdgeVelocityMultiplier: number
  v02SepRadius: number
  v02AlignRadius: number
  v02CohesionRadius: number
  v02SepWeight: number
  v02AlignWeight: number
  v02CohesionWeight: number
  v02CenterSpeed: number
  v02LifeCycleFrames: number
  /** When true, `lastDirection` tracks cursor vs cell center (boid flow + spawns). When false, that direction is frozen. */
  v02FlowFollowsPointer: boolean
  /** When true, boid speed scale stays fixed at `v02CenterSpeed` regardless of cursor distance. */
  v02ConstantSpeedAtCenter: boolean
  /** Clockwise heading in degrees used when constant speed mode drives boid direction. 0° points up. */
  v02ConstantDirectionDeg: number
  // Mouse kinematics — written each pointermove by the React layer
  mouseRawVelX: number
  mouseRawVelY: number
  // Mouse influence radii and weights
  mouseAlignRadius: number
  mouseAttractRadius: number
  mouseAlignWeight: number
  mouseAttractWeight: number
  mouseAccelSensitivity: number
  mouseMinSpeed: number
  /** Time in seconds for perturbation memory to fade from 1 → 0 (higher = slower fade, longer trail). */
  mouseDecayRate: number
  /** Lerp factor used when proximityFraction is moving downward (higher clears proximity memory faster). */
  mouseProximityLerpDown: number
}

