import { describe, expect, it } from "vitest";
import {
  classifyCard,
  histogramBimodality,
  mapAdaptiveParams,
  measureAdaptiveStats,
  textEdgeDensity,
} from "@/lib/classify";
import { defaultStudioSettings } from "@/lib/types";

function canvas(w: number, h: number, fill: (x: number, y: number, i: number, d: Uint8ClampedArray) => void) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      fill(x, y, i, data);
      data[i + 3] = 255;
    }
  }
  return { data, w, h };
}

function cardBack() {
  // High-contrast monochrome back: cream paper + dense dark text lines, bimodal.
  return canvas(200, 280, (x, y, i, d) => {
    const paper = 230;
    const inText = y > 24 && y < 256 && x > 16 && x < 184 && y % 8 < 3 && x % 5 !== 0;
    const v = inText ? 22 : paper;
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
  });
}

function matteFront() {
  // Soft color photo-like front, low text density, unimodal mid tones.
  return canvas(200, 280, (x, y, i, d) => {
    d[i] = 80 + Math.round(40 * Math.sin(x / 18) + 20 * Math.cos(y / 22));
    d[i + 1] = 110 + Math.round(30 * Math.cos(x / 14));
    d[i + 2] = 70 + Math.round(25 * Math.sin(y / 16));
  });
}

function chromeFront() {
  // Colorful field, mid-tone metallic sheen, and tight low-sat specular peaks.
  return canvas(200, 280, (x, y, i, d) => {
    d[i] = 40 + (x % 40);
    d[i + 1] = 30 + (y % 50);
    d[i + 2] = 90 + ((x + y) % 30);
    if (y > 80 && y < 170) {
      const sheen = 200 + Math.round(45 * Math.sin(x / 6));
      d[i] = sheen;
      d[i + 1] = sheen;
      d[i + 2] = Math.min(255, sheen + 8);
    }
    if ((x * 13 + y * 7) % 29 === 0 && x > 8 && y > 8 && x < 192 && y < 272) {
      d[i] = 252;
      d[i + 1] = 252;
      d[i + 2] = 250;
    }
  });
}

describe("classifier", () => {
  it("scores a text-dense bimodal ink histogram as a back cue", () => {
    const back = cardBack();
    const gray = new Float32Array(back.w * back.h);
    for (let p = 0; p < gray.length; p++) gray[p] = back.data[p * 4];
    const { bimodality } = histogramBimodality(gray);
    const text = textEdgeDensity(gray, back.w, back.h);
    expect(bimodality).toBeGreaterThan(0.3);
    expect(text).toBeGreaterThan(0.05);
  });

  it("labels a dense monochrome text card as CARD BACK, never chrome", () => {
    const back = cardBack();
    const result = classifyCard(back.data, back.w, back.h);
    expect(result.cardClass).toBe("card_back");
  });

  it("labels a soft color photo-like card as MATTE / PAPER FRONT", () => {
    const front = matteFront();
    const result = classifyCard(front.data, front.w, front.h);
    expect(result.cardClass).toBe("matte_paper_front");
  });

  it("labels a specular highlight card as CHROME / FOIL FRONT", () => {
    const foil = chromeFront();
    const result = classifyCard(foil.data, foil.w, foil.h);
    expect(result.cardClass).toBe("chrome_foil_front");
  });
});

describe("adaptive param mapping", () => {
  it("keeps descratch near zero on card backs so fine text stays sharp", () => {
    const back = cardBack();
    const stats = measureAdaptiveStats(back.data, back.w, back.h);
    const chosen = mapAdaptiveParams(stats, "card_back", { ...defaultStudioSettings, adaptive: true });
    expect(chosen.descratch).toBeLessThanOrEqual(0.08);
  });

  it("raises sharpen on a soft scan and denoise on a noisy one", () => {
    const soft = canvas(120, 168, (x, y, i, d) => {
      const v = 120 + Math.round(8 * Math.sin(x / 40) + 8 * Math.cos(y / 40));
      d[i] = v;
      d[i + 1] = v;
      d[i + 2] = v;
    });
    const noisy = canvas(120, 168, (x, y, i, d) => {
      // Salt-and-pepper in otherwise flat mid-grey (scanner noise).
      const spike = (x * 13 + y * 29) % 11 === 0 ? ((x * 7 + y) % 2 === 0 ? 90 : -90) : 0;
      const v = 120 + spike;
      d[i] = v;
      d[i + 1] = v;
      d[i + 2] = v;
    });
    const softStats = measureAdaptiveStats(soft.data, soft.w, soft.h);
    const noisyStats = measureAdaptiveStats(noisy.data, noisy.w, noisy.h);
    const softParams = mapAdaptiveParams(softStats, "matte_paper_front", defaultStudioSettings);
    const noisyParams = mapAdaptiveParams(noisyStats, "matte_paper_front", defaultStudioSettings);
    expect(softParams.sharpen).toBeGreaterThan(0.3);
    expect(noisyParams.denoise).toBeGreaterThan(0.1);
  });

  it("treats sliders as a bias around the adaptive base", () => {
    const front = matteFront();
    const stats = measureAdaptiveStats(front.data, front.w, front.h);
    const base = mapAdaptiveParams(stats, "matte_paper_front", defaultStudioSettings);
    const biased = mapAdaptiveParams(stats, "matte_paper_front", {
      ...defaultStudioSettings,
      sharpen: defaultStudioSettings.sharpen + 0.2,
    });
    expect(biased.sharpen).toBeGreaterThan(base.sharpen - 1e-9);
    expect(Math.abs(biased.sharpen - base.sharpen - 0.2)).toBeLessThan(1e-6);
  });

  it("uses the sliders absolutely when adaptive is off", () => {
    const stats = { sharpness: 40, noiseFloor: 4, specularRatio: 0, dustSpikes: 0 };
    const sliders = { ...defaultStudioSettings, adaptive: false, sharpen: 0.11, denoise: 0.22 };
    const chosen = mapAdaptiveParams(stats, "matte_paper_front", sliders);
    expect(chosen.sharpen).toBe(0.11);
    expect(chosen.denoise).toBe(0.22);
    expect(chosen.adaptive).toBe(false);
  });
});


describe("classifier OCR and photo-front guards", () => {
  it("treats a foil-looking layout with many OCR words as a CARD BACK", () => {
    const foil = chromeFront();
    const result = classifyCard(foil.data, foil.w, foil.h, { ocrWordCount: 18 });
    expect(result.cardClass).toBe("card_back");
  });

  it("does not tag a colorful photo-like front as a card back when OCR is sparse", () => {
    const front = matteFront();
    const result = classifyCard(front.data, front.w, front.h, { ocrWordCount: 2 });
    expect(result.cardClass).toBe("matte_paper_front");
  });

  it("still labels a dense monochrome text card as CARD BACK without OCR", () => {
    const back = cardBack();
    const result = classifyCard(back.data, back.w, back.h);
    expect(result.cardClass).toBe("card_back");
  });
});
