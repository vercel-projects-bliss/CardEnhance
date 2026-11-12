import { describe, expect, it } from "vitest";
import { detectOrientation, projectionPeakiness, scoreUpright } from "@/lib/orient";
import { rotateImage } from "@/lib/image-ops";

function horizontalTextCard(w = 180, h = 252): ImageData {
  const img = new ImageData(w, h);
  // Light paper
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = 236;
    img.data[i + 1] = 232;
    img.data[i + 2] = 220;
    img.data[i + 3] = 255;
  }
  // Horizontal ink lines (text rows) with irregular letter gaps and a slightly
  // heavier baseline (more mass in the lower part of each stroke).
  const rows = [70, 90, 110, 130, 150, 170, 190].filter((y) => y < h - 6);
  for (const y0 of rows) {
    for (let y = y0; y < y0 + 5 && y < h; y++) {
      const ink = y >= y0 + 3 ? 16 : 48;
      let x = 16;
      while (x < w - 16) {
        const word = 18 + ((x * 3 + y0) % 11);
        const gap = 4 + ((x + y0) % 5);
        for (let k = 0; k < word && x < w - 16; k++, x++) {
          const i = (y * w + x) * 4;
          img.data[i] = ink;
          img.data[i + 1] = ink;
          img.data[i + 2] = ink;
        }
        x += gap;
      }
    }
  }
  return img;
}

describe("projectionPeakiness", () => {
  it("scores a banded (text-line) profile higher than a flat one", () => {
    const flat = Float32Array.from({ length: 80 }, () => 10);
    const banded = Float32Array.from({ length: 80 }, (_, i) => (i % 10 < 2 ? 40 : 4));
    expect(projectionPeakiness(banded)).toBeGreaterThan(projectionPeakiness(flat));
  });
});

describe("detectOrientation", () => {
  it("returns 0 for an already-upright card with horizontal text lines", () => {
    const src = horizontalTextCard();
    const result = detectOrientation(src.data, src.width, src.height);
    expect(result.rotation).toBe(0);
    expect(result.isLandscape).toBe(false);
  });

  it.each([90, 180, 270] as const)("recovers upright from a %s° rotation", (rot) => {
    const src = horizontalTextCard();
    const turned = rotateImage(src, rot);
    const result = detectOrientation(turned.data, turned.width, turned.height);
    // The rotation to apply to make it upright is the inverse of how we turned it.
    const needed = ((360 - rot) % 360) as 0 | 90 | 180 | 270;
    expect(result.rotation).toBe(needed);
  });

  it("does not call a sideways portrait landscape", () => {
    const src = horizontalTextCard(180, 252);
    const sideways = rotateImage(src, 90); // now 252 x 180, width > height
    const result = detectOrientation(sideways.data, sideways.width, sideways.height);
    expect(sideways.width).toBeGreaterThan(sideways.height);
    // After detecting the corrective rotation, landscape is about the upright frame.
    expect(result.rotation === 90 || result.rotation === 270).toBe(true);
    const uprightW = result.rotation === 90 || result.rotation === 270 ? sideways.height : sideways.width;
    const uprightH = result.rotation === 90 || result.rotation === 270 ? sideways.width : sideways.height;
    expect(uprightW).toBeLessThan(uprightH);
    expect(result.isLandscape).toBe(false);
  });

  it("tags landscape only when text is horizontal and width > height", () => {
    const src = horizontalTextCard(280, 200);
    // Paint additional text rows in the upper band so a short canvas still has
    // a dense horizontal line pattern (the default rows start at y=70).
    const w = src.width;
    const h = src.height;
    for (const y0 of [28, 48]) {
      for (let y = y0; y < y0 + 5; y++) {
        const ink = y >= y0 + 3 ? 16 : 48;
        for (let x = 16; x < w - 16; x++) {
          if ((x + y0) % 13 < 3) continue;
          const i = (y * w + x) * 4;
          src.data[i] = ink;
          src.data[i + 1] = ink;
          src.data[i + 2] = ink;
        }
      }
    }
    void h;
    const result = detectOrientation(src.data, src.width, src.height);
    expect(result.rotation).toBe(0);
    expect(src.width).toBeGreaterThan(src.height);
    expect(result.isLandscape).toBe(true);
  });

  it("scoreUpright prefers the upright angle", () => {
    const src = horizontalTextCard();
    // Downsample is internal; score against a gray plane via detectOrientation scores.
    const result = detectOrientation(src.data, src.width, src.height);
    const s0 = result.scores.find((s) => s.rotation === 0)!;
    const s90 = result.scores.find((s) => s.rotation === 90)!;
    expect(s0.score).toBeGreaterThan(s90.score);
    expect(s0.peakiness).toBeGreaterThan(s90.peakiness);
  });
});
