import { describe, expect, it } from "vitest";
import {
  CROP_MARGIN,
  expandQuad,
  isValidCardAspect,
  scoreCardAspect,
} from "@/lib/crop-quad";
import type { Quad } from "@/lib/geometry";

describe("card aspect constraint", () => {
  it("accepts standard 2.5:3.5 portrait and 3.5:2.5 landscape", () => {
    expect(isValidCardAspect(250, 350)).toBe(true);
    expect(isValidCardAspect(350, 250)).toBe(true);
    expect(scoreCardAspect(250, 350).mode).toBe("portrait");
    expect(scoreCardAspect(350, 250).mode).toBe("landscape");
  });

  it("accepts nearby standard variants within tolerance", () => {
    expect(isValidCardAspect(63, 88)).toBe(true); // ~2.5:3.5
    expect(isValidCardAspect(240, 336)).toBe(true);
  });

  it("rejects squares and extreme ratios that are not card-like", () => {
    expect(isValidCardAspect(200, 200)).toBe(false);
    expect(isValidCardAspect(100, 400)).toBe(false);
    expect(isValidCardAspect(400, 100)).toBe(false);
    expect(scoreCardAspect(200, 200).ok).toBe(false);
  });
});

describe("expandQuad", () => {
  it("grows all four corners outward by the crop margin, uniformly", () => {
    const quad: Quad = [
      { x: 20, y: 20 },
      { x: 120, y: 20 },
      { x: 120, y: 160 },
      { x: 20, y: 160 },
    ];
    const grown = expandQuad(quad, CROP_MARGIN);
    const cx = 70;
    const cy = 90;
    for (let i = 0; i < 4; i++) {
      const ox = quad[i].x - cx;
      const oy = quad[i].y - cy;
      const gx = grown[i].x - cx;
      const gy = grown[i].y - cy;
      expect(Math.hypot(gx, gy)).toBeGreaterThan(Math.hypot(ox, oy));
      expect(Math.abs(Math.hypot(gx, gy) / Math.hypot(ox, oy) - (1 + CROP_MARGIN * 2))).toBeLessThan(1e-6);
    }
  });

  it("keeps the expanded margin in the 2–3% range of the card size", () => {
    expect(CROP_MARGIN).toBeGreaterThanOrEqual(0.02);
    expect(CROP_MARGIN).toBeLessThanOrEqual(0.03);
  });
});
