export type RgbColor = {
  r: number
  g: number
  b: number
}

export type HctColor = {
  h: number
  c: number
  t: number
}

export type StoredColor = {
  name: string
  rgb: RgbColor
  hct: HctColor
}

// HCT values computed with @material/material-color-utilities.
export const MATERIAL_HCT_PALETTE: StoredColor[] = [
  {
    name: 'Sienna',
    rgb: { r: 53, g: 29, b: 26 },
    hct: { h: 26, c: 15, t: 14 },
  },
  {
    name: 'Sky Blue',
    rgb: { r: 175, g: 187, b: 195 },
    hct: { h: 231, c: 11, t: 75 },
  },
]
