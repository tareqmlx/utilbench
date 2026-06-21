import { describe, expect, it } from "vitest";
import { MAX_CANVAS_AREA, MAX_CANVAS_DIM, clampToCanvasLimits } from "../image";

describe("clampToCanvasLimits", () => {
  it("returns dims unchanged when within both caps", () => {
    const r = clampToCanvasLimits(1024, 768);
    expect(r).toEqual({ width: 1024, height: 768, downscaled: false });
  });

  it("leaves a dimension exactly at MAX_CANVAS_DIM untouched", () => {
    const r = clampToCanvasLimits(MAX_CANVAS_DIM, 1);
    expect(r).toEqual({ width: MAX_CANVAS_DIM, height: 1, downscaled: false });
  });

  it("downscales when one side exceeds MAX_CANVAS_DIM, preserving aspect", () => {
    const w = MAX_CANVAS_DIM * 2; // 16384
    const h = 1000;
    const r = clampToCanvasLimits(w, h);
    expect(r.downscaled).toBe(true);
    expect(Math.max(r.width, r.height)).toBeLessThanOrEqual(MAX_CANVAS_DIM);
    expect(r.width * r.height).toBeLessThanOrEqual(MAX_CANVAS_AREA);
    // aspect ratio preserved within rounding tolerance
    expect(r.width / r.height).toBeCloseTo(w / h, 1);
    // side-cap dominated: scale by 2 → 8192 × 500
    expect(r.width).toBe(MAX_CANVAS_DIM);
    expect(r.height).toBe(500);
  });

  it("area-cap regression: 9000×3000 stays within BOTH caps via floor (not round)", () => {
    // 9000×3000 = 27,000,000 px² > MAX_CANVAS_AREA. Rounding each side up
    // independently yields 7094×2365 = 16,777,310 > 16,777,216. Floor must win.
    const r = clampToCanvasLimits(9000, 3000);
    expect(r.downscaled).toBe(true);
    expect(r.width * r.height).toBeLessThanOrEqual(MAX_CANVAS_AREA);
    expect(Math.max(r.width, r.height)).toBeLessThanOrEqual(MAX_CANVAS_DIM);
    expect(r.width / r.height).toBeCloseTo(9000 / 3000, 1);
    // floored result: 7094 × 2364 = 16,770,216 ≤ cap (height floored down from
    // the 2365 that rounding would have produced, which is what kept it under).
    expect(r.width).toBe(7094);
    expect(r.height).toBe(2364);
  });

  it("downscales a huge square input by area", () => {
    const r = clampToCanvasLimits(5000, 5000); // 25 MP > area cap
    expect(r.downscaled).toBe(true);
    expect(r.width * r.height).toBeLessThanOrEqual(MAX_CANVAS_AREA);
    expect(Math.max(r.width, r.height)).toBeLessThanOrEqual(MAX_CANVAS_DIM);
    expect(r.width).toBe(r.height); // square stays square (with floor)
  });

  it("leaves a tiny 1×1 input unchanged", () => {
    const r = clampToCanvasLimits(1, 1);
    expect(r).toEqual({ width: 1, height: 1, downscaled: false });
  });
});
