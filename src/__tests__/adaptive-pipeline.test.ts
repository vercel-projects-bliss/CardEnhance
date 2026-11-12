import { describe, expect, it } from "vitest";
import { splitMultiCardSheet } from "@/lib/adaptiveCardPipeline";
import { profileToCardClass, profileLabel } from "@/lib/process-scan";

function solid(w: number, h: number, r = 20, g = 20, b = 20) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = 255;
  }
  return { rgba, w, h };
}

function pasteCard(
  canvas: Uint8ClampedArray,
  cw: number,
  ch: number,
  x: number,
  y: number,
  w: number,
  h: number,
  color: [number, number, number],
) {
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const i = ((y + yy) * cw + (x + xx)) * 4;
      canvas[i] = color[0];
      canvas[i + 1] = color[1];
      canvas[i + 2] = color[2];
      canvas[i + 3] = 255;
    }
  }
}

describe("splitMultiCardSheet", () => {
  it("returns a single slice for one card on a dark bed (no false split)", () => {
    const { rgba, w, h } = solid(800, 1100, 18, 18, 20);
    pasteCard(rgba, w, h, 220, 200, 360, 504, [200, 40, 40]);
    const slices = splitMultiCardSheet(rgba, w, h);
    expect(slices.length).toBe(1);
    expect(slices[0].width).toBe(w);
  });

  it("splits a 2x2 of disjoint card-proportioned tiles", () => {
    const { rgba, w, h } = solid(1000, 1400, 16, 16, 18);
    const cw = 360,
      ch = 504,
      gap = 48,
      ox = 80,
      oy = 80;
    const colors: [number, number, number][] = [
      [220, 30, 30],
      [30, 180, 40],
      [40, 40, 210],
      [200, 200, 40],
    ];
    let k = 0;
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 2; col++) {
        pasteCard(rgba, w, h, ox + col * (cw + gap), oy + row * (ch + gap), cw, ch, colors[k++]);
      }
    }
    const slices = splitMultiCardSheet(rgba, w, h);
    expect(slices.length).toBe(4);
  });
});

describe("profile mapping", () => {
  it("maps the four surface profiles onto the three Studio class badges", () => {
    expect(profileToCardClass("CARD_BACK")).toBe("card_back");
    expect(profileToCardClass("CHROME_FOIL")).toBe("chrome_foil_front");
    expect(profileToCardClass("DARK_ACETATE_FOIL")).toBe("chrome_foil_front");
    expect(profileToCardClass("MATTE_RELIC")).toBe("matte_paper_front");
    expect(profileLabel("DARK_ACETATE_FOIL")).toBe("DARK ACETATE");
  });
});
