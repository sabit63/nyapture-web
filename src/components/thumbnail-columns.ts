/** Prefer readable widths, then choose the column count closest to 280px. */
export function automaticThumbnailColumns(width: number, gap: number): number {
  let best = 1
  let bestScore = Infinity
  for (let columns = 1; columns <= 10; columns++) {
    const cardWidth = (width - gap * (columns - 1)) / columns
    const outsideRange = Math.max(240 - cardWidth, 0, cardWidth - 320)
    const score = outsideRange * 1000 + Math.abs(cardWidth - 280)
    if (score < bestScore) { best = columns; bestScore = score }
  }
  return best
}
