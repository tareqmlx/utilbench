import { describe, expect, it } from "vitest";
// NOTE: deliberately does NOT mock "../watermarker" — this exercises the REAL geometry so the
// Y-down anchor inversion (the latent placement bug) is guarded end to end (§12 / §14 step 7).
import { anchorCenter, computeCenters, rotatedHalfExtents } from "../watermarker";

describe("placement wiring (real geometry)", () => {
  it("places a bottom-right single mark at the hand-computed Y-down center", () => {
    // 1000×800 image, a 200×60 (unrotated) mark, 40px margin, no rotation.
    const W = 1000;
    const H = 800;
    const mark = { width: 200, height: 60 };
    const margin = 40;

    const centers = computeCenters(mark, W, H, {
      anchor: "bottom-right",
      layout: "single",
      margin,
      tileGap: 0,
      rotationDeg: 0,
    });

    expect(centers).toHaveLength(1);
    const { hx, hy } = rotatedHalfExtents(mark.width, mark.height, 0);
    // Y-DOWN: bottom-right → cx = W - margin - hx, cy = H - margin - hy.
    const expected = { cx: W - margin - hx, cy: H - margin - hy };
    expect(centers[0]?.cx).toBeCloseTo(expected.cx, 6);
    expect(centers[0]?.cy).toBeCloseTo(expected.cy, 6);
    // Concretely: (1000 - 40 - 100, 800 - 40 - 30) = (860, 730) — a large y is the BOTTOM (Y-down).
    expect(centers[0]?.cx).toBeCloseTo(860, 6);
    expect(centers[0]?.cy).toBeCloseTo(730, 6);
  });

  it("matches anchorCenter directly for the same single-layout config", () => {
    const W = 1000;
    const H = 800;
    const { hx, hy } = rotatedHalfExtents(200, 60, 0);
    const direct = anchorCenter("bottom-right", W, H, hx, hy, 40);
    expect(direct).toEqual({ cx: 860, cy: 730 });
  });
});
