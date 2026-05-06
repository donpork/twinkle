export type CellType = 'normal' | 'super' | 'micro' | 'empty'

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
  lightPos: { x: number; y: number }
  pointerOverSurface: boolean
}
