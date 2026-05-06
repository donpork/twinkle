/**
 * Move the seam between track i and i+1 by dPix pixels.
 * Positive dPix: track i expands, takes space from i+1 then cascades right.
 * Negative dPix: track i shrinks (cascades leftward), i+1 grows.
 */
export function applyAxisPixelDelta(
  widthsPx: number[],
  i: number,
  dPix: number,
  minPx: number,
): number[] {
  const px = [...widthsPx]

  if (dPix > 0) {
    let remaining = dPix
    for (let j = i + 1; j < px.length && remaining > 0; j++) {
      const take = Math.min(remaining, Math.max(0, px[j] - minPx))
      px[i] += take
      px[j] -= take
      remaining -= take
    }
  } else {
    let remaining = -dPix
    for (let j = i; j >= 0 && remaining > 0; j--) {
      const take = Math.min(remaining, Math.max(0, px[j] - minPx))
      px[i + 1] += take
      px[j] -= take
      remaining -= take
    }
  }

  return px
}

/** Scale widths so their sum equals totalPx, preserving ratios. */
export function renormalizeToSum(widthsPx: number[], totalPx: number): number[] {
  const sum = widthsPx.reduce((a, b) => a + b, 0)
  if (sum === 0) return widthsPx.map(() => totalPx / widthsPx.length)
  return widthsPx.map(w => (w / sum) * totalPx)
}

/**
 * Clamp every track to [minPx, totalPx * maxFraction], then iteratively
 * redistribute the deficit/surplus so the sum stays exactly totalPx.
 */
export function enforceTrackBounds(
  widthsPx: number[],
  totalPx: number,
  minPx: number,
  maxFraction: number,
): number[] {
  const maxPx = totalPx * maxFraction
  let px = widthsPx.map(w => Math.max(minPx, Math.min(maxPx, w)))

  for (let iter = 0; iter < 8; iter++) {
    const diff = totalPx - px.reduce((a, b) => a + b, 0)
    if (Math.abs(diff) < 0.1) break
    const adjustable = px.filter(w => w > minPx && w < maxPx).length
    if (adjustable === 0) break
    const perTrack = diff / adjustable
    px = px.map(w =>
      w > minPx && w < maxPx ? Math.max(minPx, Math.min(maxPx, w + perTrack)) : w,
    )
  }

  return px
}
