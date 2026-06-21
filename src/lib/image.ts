export const MAX_CANVAS_DIM = 8192; // px, max single side
export const MAX_CANVAS_AREA = 16_777_216; // px², iOS/Safari canvas-area ceiling (~16.7 MP)

export function clampToCanvasLimits(
  w: number,
  h: number,
): { width: number; height: number; downscaled: boolean } {
  const sideOver = Math.max(w, h) / MAX_CANVAS_DIM;
  const areaOver = Math.sqrt((w * h) / MAX_CANVAS_AREA);
  const over = Math.max(1, sideOver, areaOver);
  const downscaled = over > 1;
  if (!downscaled) return { width: w, height: h, downscaled: false };
  // FLOOR (not round) so the result is guaranteed to stay within BOTH caps.
  return {
    width: Math.max(1, Math.floor(w / over)),
    height: Math.max(1, Math.floor(h / over)),
    downscaled: true,
  };
}
