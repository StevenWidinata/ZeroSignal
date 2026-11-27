/** Where Ping hangs: pure geometry, so it can be tested without a page. */

export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** How far into a free gap he sits (0 = its left end, 1 = its right end). */
export const GAP_BIAS = 0.72;
export const GAP_MARGIN = 16;

/**
 * Find a spot in the header row: the widest horizontal gap between the
 * header's items (within `band` vertically) that fits Ping plus a margin on
 * each side. Returns his left edge relative to `row.left`, or null when the
 * row is too crowded.
 */
export function freeSpot(row: { left: number; right: number }, items: Box[], band: { top: number; bottom: number }, width: number, margin = GAP_MARGIN): number | null {
  const blocking = items
    .filter((b) => b.bottom > band.top && b.top < band.bottom && b.right > b.left)
    .sort((a, b) => a.left - b.left);
  let best: { left: number; size: number } | null = null;
  let cursor = row.left;
  const consider = (end: number) => {
    const size = end - cursor;
    if (size >= width + margin * 2 && (!best || size > best.size)) best = { left: cursor, size };
  };
  for (const b of blocking) {
    consider(Math.min(b.left, row.right));
    cursor = Math.max(cursor, b.right);
  }
  consider(row.right);
  if (!best) return null;
  const { left, size } = best as { left: number; size: number };
  const room = size - margin * 2 - width;
  return Math.round(left + margin + room * GAP_BIAS - row.left);
}
