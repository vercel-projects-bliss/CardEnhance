import { detectChromeFoil, laplacianVariance, luma } from "./enhance-math";
import type { AdaptiveStats, CardClass, StudioSettings } from "./types";
import { defaultStudioSettings } from "./types";

function lumaPlane255(data: Uint8ClampedArray, w: number, h: number): Float32Array {
  const gray = new Float32Array(w * h);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    gray[p] = luma(data[i], data[i + 1], data[i + 2]);
  }
  return gray;
}

export type ClassifyStats = {
  textEdgeDensity: number;
  bimodality: number;
  meanSaturation: number;
  inkValley: number;
};

export type ClassifyResult = {
  cardClass: CardClass;
  stats: ClassifyStats;
};

function downsample(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  maxEdge = 280,
): { data: Uint8ClampedArray; w: number; h: number } {
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  if (scale >= 0.999) return { data, w, h };
  const sw = Math.max(24, Math.round(w * scale));
  const sh = Math.max(24, Math.round(h * scale));
  const out = new Uint8ClampedArray(sw * sh * 4);
  for (let y = 0; y < sh; y++) {
    const sy = Math.min(h - 1, Math.floor(y / scale));
    for (let x = 0; x < sw; x++) {
      const sx = Math.min(w - 1, Math.floor(x / scale));
      const si = (sy * w + sx) * 4;
      const di = (y * sw + x) * 4;
      out[di] = data[si];
      out[di + 1] = data[si + 1];
      out[di + 2] = data[si + 2];
      out[di + 3] = 255;
    }
  }
  return { data: out, w: sw, h: sh };
}

function saturation(r: number, g: number, b: number) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

/**
 * Smooth 256-bin luma histogram, then score bimodality as the depth of the
 * valley between the two strongest modes (typical ink + paper on a card back).
 */
export function histogramBimodality(gray: Float32Array): { bimodality: number; valley: number } {
  const bins = new Float32Array(256);
  for (let i = 0; i < gray.length; i++) {
    const b = Math.max(0, Math.min(255, Math.round(gray[i])));
    bins[b] += 1;
  }
  const n = gray.length || 1;
  for (let i = 0; i < 256; i++) bins[i] /= n;
  const sm = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    let s = 0, c = 0;
    for (let k = -4; k <= 4; k++) {
      const j = i + k;
      if (j >= 0 && j < 256) {
        s += bins[j];
        c++;
      }
    }
    sm[i] = s / c;
  }
  // Find two modes separated by at least 40 gray levels.
  let m1 = 0, m2 = 0, v1 = -1, v2 = -1;
  for (let i = 0; i < 256; i++) {
    if (sm[i] > v1) {
      v2 = v1;
      m2 = m1;
      v1 = sm[i];
      m1 = i;
    } else if (sm[i] > v2 && Math.abs(i - m1) >= 40) {
      v2 = sm[i];
      m2 = i;
    }
  }
  if (v2 <= 0 || Math.abs(m1 - m2) < 40) return { bimodality: 0, valley: 0 };
  const lo = Math.min(m1, m2);
  const hi = Math.max(m1, m2);
  let valley = sm[lo];
  let valleyAt = lo;
  for (let i = lo; i <= hi; i++) {
    if (sm[i] < valley) {
      valley = sm[i];
      valleyAt = i;
    }
  }
  const peak = Math.min(v1, v2);
  const depth = peak > 1e-9 ? Math.max(0, 1 - valley / peak) : 0;
  const separation = (hi - lo) / 255;
  return { bimodality: depth * (0.5 + 0.5 * separation), valley: valleyAt };
}

/**
 * Fraction of pixels that look like thin text strokes: mid-strength
 * gradient, locally elongated (anisotropic), not a long crease or border.
 */
export function textEdgeDensity(gray: Float32Array, w: number, h: number): number {
  if (w < 8 || h < 8) return 0;
  let hits = 0;
  let considered = 0;
  const margin = Math.max(2, Math.round(Math.min(w, h) * 0.04));
  for (let y = margin; y < h - margin; y++) {
    for (let x = margin; x < w - margin; x++) {
      const i = y * w + x;
      const gx = gray[i + 1] - gray[i - 1];
      const gy = gray[i + w] - gray[i - w];
      const mag = Math.hypot(gx, gy);
      considered++;
      // Text strokes: anisotropic edges of any contrast, ignoring the
      // already-cropped border. Anisotropy rejects large photo blobs.
      if (mag > 10) {
        const aniso = Math.abs(Math.abs(gx) - Math.abs(gy)) / (mag + 1e-6);
        if (aniso > 0.2) hits++;
      }
    }
  }
  return considered ? hits / considered : 0;
}

export function classifyCard(data: Uint8ClampedArray, width: number, height: number): ClassifyResult {
  const ds = downsample(data, width, height, 280);
  const gray = lumaPlane255(ds.data, ds.w, ds.h);
  const { bimodality, valley } = histogramBimodality(gray);
  const text = textEdgeDensity(gray, ds.w, ds.h);
  let sat = 0;
  const n = ds.w * ds.h;
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    sat += saturation(ds.data[p], ds.data[p + 1], ds.data[p + 2]);
  }
  sat /= n || 1;
  const stats: ClassifyStats = {
    textEdgeDensity: text,
    bimodality,
    meanSaturation: sat,
    inkValley: valley,
  };
  // Card backs: dense text-like edges AND a bimodal ink/paper histogram.
  // High-contrast monochrome backs must never be tagged chrome.
  const backCue = (text >= 0.06 && bimodality >= 0.32) || (text >= 0.1 && bimodality >= 0.2);
  const monoBack = sat < 0.22 && bimodality >= 0.35 && text >= 0.045;
  if (backCue || monoBack) {
    return { cardClass: "card_back", stats };
  }
  const chrome = detectChromeFoil(ds.data, ds.w, ds.h);
  if (chrome.isChromeFoil) {
    return { cardClass: "chrome_foil_front", stats };
  }
  return { cardClass: "matte_paper_front", stats };
}

export function measureAdaptiveStats(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): AdaptiveStats {
  const ds = downsample(data, width, height, 320);
  const sharpness = laplacianVariance(ds.data, ds.w, ds.h);
  const gray = lumaPlane255(ds.data, ds.w, ds.h);
  // Noise floor: MAD of a high-pass in locally flat regions (low gradient).
  const residuals: number[] = [];
  for (let y = 1; y < ds.h - 1; y++) {
    for (let x = 1; x < ds.w - 1; x++) {
      const i = y * ds.w + x;
      const gx = gray[i + 1] - gray[i - 1];
      const gy = gray[i + ds.w] - gray[i - ds.w];
      if (Math.hypot(gx, gy) < 28) {
        const lap =
          gray[i - 1] + gray[i + 1] + gray[i - ds.w] + gray[i + ds.w] - 4 * gray[i];
        residuals.push(Math.abs(lap));
      }
    }
  }
  residuals.sort((a, b) => a - b);
  const mid = residuals[Math.floor(residuals.length / 2)] ?? 0;
  const deviations = residuals.map((v) => Math.abs(v - mid)).sort((a, b) => a - b);
  const noiseFloor = deviations[Math.floor(deviations.length / 2)] ?? 0;

  const chrome = detectChromeFoil(ds.data, ds.w, ds.h);

  // Dust spikes: thin isolated extrema that differ strongly from the 3x3 median.
  let dustSpikes = 0;
  const considered = Math.max(1, (ds.w - 2) * (ds.h - 2));
  for (let y = 1; y < ds.h - 1; y++) {
    for (let x = 1; x < ds.w - 1; x++) {
      const vals: number[] = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) vals.push(gray[(y + dy) * ds.w + (x + dx)]);
      }
      const center = vals[4];
      vals.sort((a, b) => a - b);
      const med = vals[4];
      const jump = Math.abs(center - med);
      if (jump > 28) dustSpikes++;
    }
  }

  return {
    sharpness,
    noiseFloor,
    specularRatio: chrome.specularRatio,
    dustSpikes: dustSpikes / considered,
  };
}

function clamp01(n: number) {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Map measured scan stats + card class onto enhancement knobs.
 * Slider values are a bias around these bases (default sliders = no bias).
 * Backs skip heavy median descratch so fine text stays sharp.
 * Only scanner dust / sensor softness is targeted — not wear or creases.
 */
export function mapAdaptiveParams(
  stats: AdaptiveStats,
  cardClass: CardClass,
  sliders: StudioSettings,
): StudioSettings {
  const sharpRef = 180; // typical mid-sharpness on the 0–255 luma Laplacian scale used here
  const softness = clamp01(1 - stats.sharpness / sharpRef);
  const noise = clamp01(stats.noiseFloor / 4);
  const dust = clamp01(stats.dustSpikes / 0.004);

  let descratch = 0.12 + 0.45 * dust;
  let denoise = 0.08 + 0.4 * noise + 0.3 * dust;
  let sharpen = 0.25 + 0.55 * softness;
  let contrast = 0.05 + 0.06 * softness;

  if (cardClass === "card_back") {
    // Protect fine printed text: no heavy median descratch, modest sharpen.
    descratch = Math.min(descratch, 0.08);
    denoise = Math.min(denoise, 0.18);
    sharpen = Math.min(0.45, 0.2 + 0.35 * softness);
    contrast = Math.min(contrast, 0.08);
  } else if (cardClass === "chrome_foil_front") {
    // Don't smear specular grain; light descratch only on real dust.
    descratch = Math.min(descratch, 0.22 + 0.2 * dust);
    denoise = Math.min(denoise, 0.16);
    sharpen = Math.min(sharpen, 0.42);
    contrast = Math.min(contrast, 0.07);
  } else {
    descratch = Math.min(0.55, descratch);
    sharpen = Math.min(0.7, sharpen);
  }

  if (sliders.adaptive === false) {
    return { ...sliders };
  }

  // Bias: default slider means "use adaptive as-is"; deviations add/subtract.
  const bias = (value: number, def: number) => value - def;
  return {
    scale: sliders.scale,
    descratch: clamp01(descratch + bias(sliders.descratch, defaultStudioSettings.descratch)),
    descratchFoilOnly: sliders.descratchFoilOnly,
    denoise: clamp01(denoise + bias(sliders.denoise, defaultStudioSettings.denoise)),
    sharpen: clamp01(sharpen + bias(sliders.sharpen, defaultStudioSettings.sharpen)),
    contrast: clamp01(contrast + bias(sliders.contrast, defaultStudioSettings.contrast)),
    adaptive: true,
  };
}

export function classLabel(cardClass: CardClass): string {
  if (cardClass === "chrome_foil_front") return "CHROME / FOIL FRONT";
  if (cardClass === "card_back") return "CARD BACK";
  return "MATTE / PAPER FRONT";
}
