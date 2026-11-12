import { describe, expect, it } from "vitest";
import {
  contrastCurve,
  laplacianVariance,
  sCurve,
  unsharpMask,
} from "../lib/enhance-math";

function solid(w: number, h: number, r: number, g: number, b: number) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return data;
}

/** Mid-grey field with a sharp 2px plus sign — edge energy for Laplacian / unsharp. */
function edged(w = 64, h = 64) {
  const data = solid(w, h, 110, 110, 110);
  for (let x = 0; x < w; x++) {
    for (let t = -1; t <= 1; t++) {
      const y = ((h / 2) | 0) + t;
      const i = (y * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 230;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let t = -1; t <= 1; t++) {
      const x = ((w / 2) | 0) + t;
      const i = (y * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 230;
    }
  }
  return data;
}

describe("laplacianVariance", () => {
  it("is ~0 on a flat field and higher on a sharp edge", () => {
    const flat = laplacianVariance(solid(48, 48, 128, 128, 128), 48, 48);
    const sharp = laplacianVariance(edged(48, 48), 48, 48);
    expect(flat).toBeLessThan(1e-6);
    expect(sharp).toBeGreaterThan(flat + 0.001);
  });
});

describe("sCurve", () => {
  it("is identity at 0 strength and leaves mid-grey almost mid", () => {
    expect(sCurve(0.2, 0)).toBeCloseTo(0.2, 8);
    expect(sCurve(0.5, 0.08)).toBeCloseTo(0.5, 5);
  });

  it("darkens shadows and lifts highlights at mid-grey, with highlight roll-off", () => {
    expect(sCurve(0.25, 0.4)).toBeLessThan(0.25);
    expect(sCurve(0.75, 0.4)).toBeGreaterThan(0.75);
    // Roll-off: 0.99 stays close to itself rather than clipping to 1.
    expect(sCurve(0.99, 0.4)).toBeLessThan(0.999);
    expect(sCurve(0.99, 0.4)).toBeGreaterThan(0.97);
    expect(sCurve(0, 0.5)).toBeCloseTo(0, 5);
    expect(sCurve(1, 0.5)).toBeCloseTo(1, 5);
  });
});

describe("unsharpMask", () => {
  it("raises Laplacian variance on a synthetic edge without clipping highlights", () => {
    const src = edged(64, 64);
    // Plant a saturated specular peak.
    src[(8 * 64 + 8) * 4] = 255;
    src[(8 * 64 + 8) * 4 + 1] = 255;
    src[(8 * 64 + 8) * 4 + 2] = 255;

    const before = laplacianVariance(src, 64, 64);
    const out = unsharpMask(src, 64, 64, 0.5);
    const after = laplacianVariance(out, 64, 64);
    expect(after).toBeGreaterThan(before);

    const hi = (8 * 64 + 8) * 4;
    expect(out[hi]).toBeLessThanOrEqual(255);
    expect(out[hi + 1]).toBeLessThanOrEqual(255);
    expect(out[hi + 2]).toBeLessThanOrEqual(255);
    // Highlight protection: the peak should not be pushed past the source.
    expect(out[hi]).toBeLessThanOrEqual(src[hi]);
  });
});

describe("contrastCurve", () => {
  it("applies the S-curve per channel", () => {
    const src = solid(8, 8, 64, 64, 64);
    const out = contrastCurve(src, 8, 8, 0.4);
    expect(out[0]).toBeLessThan(64);
  });
});

import { processEnhance } from "../lib/enhance-math";
import { defaultStudioSettings } from "../lib/types";

describe("processEnhance sharpness floor", () => {
  it("does not leave a sharp scan much softer than the resampled input", async () => {
    const w = 96;
    const h = 128;
    const data = edged(w, h);
    const result = await processEnhance(data, w, h, {
      ...defaultStudioSettings,
      adaptive: false,
      denoise: 0.85,
      sharpen: 0.2,
      scale: 1,
    });
    expect(result.sharpnessAfter).toBeGreaterThanOrEqual(result.sharpnessBefore * 0.98);
    expect(result.sharpnessDelta).toBeGreaterThanOrEqual(-5);
  });
});
