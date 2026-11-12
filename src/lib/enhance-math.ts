/**
 * Real pixel math for the batch editor enhance worker.
 * Order: chrome/foil detect → descratch → denoise → sharpen → contrast → scale.
 *
 * Sharpness: Laplacian variance on luminance. The "before" score is taken on
 * the original image resampled to the same output size as the processed
 * result so the comparison is fair (same pixel scale).
 * delta % = (after - before) / before * 100.
 */

import type { AdaptiveStats, CardClass, StudioSettings } from "./types";

export const LONG_EDGE_CAP = 2200;

export type ChromeFoilMetrics = {
  isChromeFoil: boolean;
  specularRatio: number;
  specularPeakRatio: number;
  metallicContrast: number;
};

export type EnhanceResult = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  chromeFoil: ChromeFoilMetrics;
  sharpnessBefore: number;
  sharpnessAfter: number;
  sharpnessDelta: number;
  cardClass?: CardClass;
  adaptiveStats?: AdaptiveStats;
  chosenParams?: StudioSettings;
};

export type EnhanceOptions = {
  cardClass?: CardClass;
  /** Fraction of min(width,height) at the border skipped by descratch (wear/crease protection). */
  edgeProtect?: number;
};

function clamp(n: number, min: number, max: number) {
  return n < min ? min : n > max ? max : n;
}

export function luma(r: number, g: number, b: number) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function saturation(r: number, g: number, b: number) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

function lumaPlane(src: Uint8ClampedArray, w: number, h: number): Float32Array {
  const gray = new Float32Array(w * h);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    gray[p] = luma(src[i], src[i + 1], src[i + 2]) / 255;
  }
  return gray;
}

/** Specular-highlight + metallic-gradient chrome/foil heuristic. */
export function detectChromeFoil(
  src: Uint8ClampedArray,
  w: number,
  h: number,
): ChromeFoilMetrics {
  const gray = lumaPlane(src, w, h);
  const n = w * h;
  let specularPeaks = 0;
  let bright = 0;
  let metallicSum = 0;
  let metallicCount = 0;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      const L = gray[p];
      const i = p * 4;
      const sat = saturation(src[i], src[i + 1], src[i + 2]);
      const isLocalMax =
        L >= gray[p - 1] &&
        L >= gray[p + 1] &&
        L >= gray[p - w] &&
        L >= gray[p + w];

      if (L > 0.85) bright++;
      if (L > 0.92 && sat < 0.22 && isLocalMax) specularPeaks++;

      if (L > 0.72) {
        const gx = gray[p + 1] - gray[p - 1];
        const gy = gray[p + w] - gray[p - w];
        metallicSum += Math.hypot(gx, gy);
        metallicCount++;
      }
    }
  }

  const specularPeakRatio = n > 0 ? specularPeaks / n : 0;
  const specularRatio = bright > 0 ? specularPeaks / Math.max(1, bright) : 0;
  const metallicContrast = metallicCount > 0 ? metallicSum / metallicCount : 0;
  // Highlight sparkle (tight specular peaks) or a strong metallic gradient
  // in bright regions (chrome stock that is mid-tone rather than blown).
  const highlightCue = specularPeakRatio >= 0.00035 && specularRatio >= 0.012;
  const metalCue = metallicContrast >= 0.09 && (specularRatio >= 0.05 || specularPeakRatio >= 0.0001);
  const isChromeFoil = (highlightCue && metallicContrast >= 0.018) || metalCue;

  return { isChromeFoil, specularRatio, specularPeakRatio, metallicContrast };
}

function median9(values: number[]) {
  const a = values.slice().sort((x, y) => x - y);
  return a[4];
}

/**
 * Median-filter pass targeting thin bright/dark hairline scratches.
 * Strength blends the median replacement over the source.
 */
export function descratchPixels(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  strength: number,
  edgeProtect = 0.05,
): Uint8ClampedArray {
  if (strength <= 0) return new Uint8ClampedArray(src);
  const out = new Uint8ClampedArray(src);
  const amt = clamp(strength, 0, 1);
  const band = Math.max(1, Math.round(Math.min(w, h) * clamp(edgeProtect, 0, 0.2)));
  const rs: number[] = new Array(9);
  const gs: number[] = new Array(9);
  const bs: number[] = new Array(9);

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      // Leave a border band untouched so real corner wear, edge whitening, and creases stay visible.
      if (x < band || y < band || x >= w - band || y >= h - band) continue;
      let k = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const j = ((y + dy) * w + (x + dx)) * 4;
          rs[k] = src[j];
          gs[k] = src[j + 1];
          bs[k] = src[j + 2];
          k++;
        }
      }
      const i = (y * w + x) * 4;
      const mr = median9(rs);
      const mg = median9(gs);
      const mb = median9(bs);
      const dev = Math.hypot(src[i] - mr, src[i + 1] - mg, src[i + 2] - mb);

      // 1D medians along thin structures (row / column).
      const row = [src[i - 4], src[i], src[i + 4]].sort((a, b) => a - b)[1];
      const col = [
        src[((y - 1) * w + x) * 4],
        src[i],
        src[((y + 1) * w + x) * 4],
      ].sort((a, b) => a - b)[1];
      const lineDev = Math.max(Math.abs(src[i] - row), Math.abs(src[i] - col));

      if (dev < 18 && lineDev < 16) continue;

      // Thin: few similar outliers in the 3×3, or a 1D streak.
      let neighbors = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const j = ((y + dy) * w + (x + dx)) * 4;
          const nd = Math.hypot(src[j] - mr, src[j + 1] - mg, src[j + 2] - mb);
          if (nd > 16) neighbors++;
        }
      }
      const thin = neighbors <= 3 || lineDev > 22;
      if (!thin) continue;

      out[i] = src[i] * (1 - amt) + mr * amt;
      out[i + 1] = src[i + 1] * (1 - amt) + mg * amt;
      out[i + 2] = src[i + 2] * (1 - amt) + mb * amt;
    }
  }
  return out;
}

/** 3×3 box average blended over the current pixels by `amount`. */
export function denoisePixels(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  amount: number,
): Uint8ClampedArray {
  if (amount <= 0) return new Uint8ClampedArray(src);
  const mix = clamp(amount, 0, 1);
  const out = new Uint8ClampedArray(src);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let rs = 0,
        gs = 0,
        bs = 0,
        n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const j = (yy * w + xx) * 4;
          rs += src[j];
          gs += src[j + 1];
          bs += src[j + 2];
          n++;
        }
      }
      const i = (y * w + x) * 4;
      out[i] = src[i] * (1 - mix) + (rs / n) * mix;
      out[i + 1] = src[i + 1] * (1 - mix) + (gs / n) * mix;
      out[i + 2] = src[i + 2] * (1 - mix) + (bs / n) * mix;
    }
  }
  return out;
}

/** Separable 5-tap Gaussian (radius ~1), kernel [1,4,6,4,1]/16. */
export function gaussianBlur(
  src: Uint8ClampedArray,
  w: number,
  h: number,
): Uint8ClampedArray {
  const tmp = new Uint8ClampedArray(src.length);
  const out = new Uint8ClampedArray(src.length);
  const k = [1, 4, 6, 4, 1];
  const tw = 16;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let rs = 0,
        gs = 0,
        bs = 0;
      for (let i = -2; i <= 2; i++) {
        const xx = clamp(x + i, 0, w - 1);
        const j = (y * w + xx) * 4;
        const wt = k[i + 2];
        rs += src[j] * wt;
        gs += src[j + 1] * wt;
        bs += src[j + 2] * wt;
      }
      const d = (y * w + x) * 4;
      tmp[d] = rs / tw;
      tmp[d + 1] = gs / tw;
      tmp[d + 2] = bs / tw;
      tmp[d + 3] = src[d + 3];
    }
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let rs = 0,
        gs = 0,
        bs = 0;
      for (let i = -2; i <= 2; i++) {
        const yy = clamp(y + i, 0, h - 1);
        const j = (yy * w + x) * 4;
        const wt = k[i + 2];
        rs += tmp[j] * wt;
        gs += tmp[j + 1] * wt;
        bs += tmp[j + 2] * wt;
      }
      const d = (y * w + x) * 4;
      out[d] = rs / tw;
      out[d + 1] = gs / tw;
      out[d + 2] = bs / tw;
      out[d + 3] = src[d + 3];
    }
  }
  return out;
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Unsharp mask. Amount follows the slider. Sharpening is attenuated near
 * saturated highlights (L > 0.92) with a smooth falloff so foil does not halo.
 */
export function unsharpMask(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  amount: number,
): Uint8ClampedArray {
  if (amount <= 0) return new Uint8ClampedArray(src);
  const blurred = gaussianBlur(src, w, h);
  const amt = amount * 1.4;
  const out = new Uint8ClampedArray(src);
  for (let i = 0; i < src.length; i += 4) {
    const L = luma(src[i], src[i + 1], src[i + 2]) / 255;
    const protect = 1 - smoothstep(0.92, 0.995, L);
    const a = amt * protect;
    out[i] = clamp(src[i] + (src[i] - blurred[i]) * a, 0, 255);
    out[i + 1] = clamp(src[i + 1] + (src[i + 1] - blurred[i + 1]) * a, 0, 255);
    out[i + 2] = clamp(src[i + 2] + (src[i + 2] - blurred[i + 2]) * a, 0, 255);
  }
  return out;
}

/** Mid-grey logistic S-curve, strength = slider, with highlight roll-off. */
export function sCurve(x: number, strength: number): number {
  const k = strength * 8;
  if (k <= 1e-6) return x;
  const logistic = (v: number) => 1 / (1 + Math.exp(-k * (v - 0.5)));
  const c0 = logistic(0);
  const c1 = logistic(1);
  const curved = (logistic(x) - c0) / (c1 - c0);
  const roll = smoothstep(0.82, 1, x);
  return curved * (1 - roll) + x * roll;
}

export function contrastCurve(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  strength: number,
): Uint8ClampedArray {
  if (strength <= 0) return new Uint8ClampedArray(src);
  const out = new Uint8ClampedArray(src);
  for (let i = 0; i < src.length; i += 4) {
    out[i] = sCurve(src[i] / 255, strength) * 255;
    out[i + 1] = sCurve(src[i + 1] / 255, strength) * 255;
    out[i + 2] = sCurve(src[i + 2] / 255, strength) * 255;
  }
  return out;
}

/** Laplacian variance of luminance (4-neighbour kernel). */
export function laplacianVariance(
  src: Uint8ClampedArray,
  w: number,
  h: number,
): number {
  const gray = lumaPlane(src, w, h);
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      const v =
        gray[p - 1] + gray[p + 1] + gray[p - w] + gray[p + w] - 4 * gray[p];
      sum += v;
      sum2 += v * v;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return Math.max(0, sum2 / n - mean * mean);
}

export function outputSize(
  width: number,
  height: number,
  scale: number,
  cap = LONG_EDGE_CAP,
): { width: number; height: number } {
  const s = Math.max(1, Math.min(4, scale));
  let w = Math.max(1, Math.round(width * s));
  let h = Math.max(1, Math.round(height * s));
  const edge = Math.max(w, h);
  if (edge > cap) {
    const fit = cap / edge;
    w = Math.max(1, Math.round(w * fit));
    h = Math.max(1, Math.round(h * fit));
  }
  return { width: w, height: h };
}

/**
 * High-quality bilinear resample (used by tests and as a worker fallback).
 * The worker prefers createImageBitmap / OffscreenCanvas with resizeQuality 'high'.
 */
export function resampleBilinear(
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dstW * dstH * 4);
  const xRatio = (srcW - 1) / Math.max(1, dstW - 1);
  const yRatio = (srcH - 1) / Math.max(1, dstH - 1);
  for (let y = 0; y < dstH; y++) {
    const fy = y * yRatio;
    const y0 = Math.floor(fy);
    const y1 = Math.min(srcH - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < dstW; x++) {
      const fx = x * xRatio;
      const x0 = Math.floor(fx);
      const x1 = Math.min(srcW - 1, x0 + 1);
      const tx = fx - x0;
      const i00 = (y0 * srcW + x0) * 4;
      const i10 = (y0 * srcW + x1) * 4;
      const i01 = (y1 * srcW + x0) * 4;
      const i11 = (y1 * srcW + x1) * 4;
      const d = (y * dstW + x) * 4;
      for (let c = 0; c < 4; c++) {
        const v0 = src[i00 + c] * (1 - tx) + src[i10 + c] * tx;
        const v1 = src[i01 + c] * (1 - tx) + src[i11 + c] * tx;
        out[d + c] = v0 * (1 - ty) + v1 * ty;
      }
    }
  }
  return out;
}

export type ScaleFn = (
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
) => Promise<Uint8ClampedArray> | Uint8ClampedArray;

export async function processEnhance(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  settings: StudioSettings,
  scaleFn: ScaleFn = resampleBilinear,
  options: EnhanceOptions = {},
): Promise<EnhanceResult> {
  const original = new Uint8ClampedArray(src);
  const chromeFoil = detectChromeFoil(original, width, height);
  const cardClass = options.cardClass;
  if (cardClass === "card_back") {
    chromeFoil.isChromeFoil = false;
  }

  let data: Uint8ClampedArray = new Uint8ClampedArray(original);
  const descratchAmt = cardClass === "card_back" ? 0 : settings.descratch;
  if (descratchAmt > 0 && (!settings.descratchFoilOnly || chromeFoil.isChromeFoil)) {
    data = descratchPixels(data, width, height, descratchAmt, options.edgeProtect ?? 0.05);
  }
  if (settings.denoise > 0) {
    data = denoisePixels(data, width, height, settings.denoise);
  }
  if (settings.sharpen > 0) {
    data = unsharpMask(data, width, height, settings.sharpen);
  }
  if (settings.contrast > 0) {
    data = contrastCurve(data, width, height, settings.contrast);
  }

  const out = outputSize(width, height, settings.scale);
  let processed: Uint8ClampedArray = data;
  let before: Uint8ClampedArray = original;
  if (out.width !== width || out.height !== height) {
    processed = new Uint8ClampedArray(await scaleFn(data, width, height, out.width, out.height));
    before = new Uint8ClampedArray(await scaleFn(original, width, height, out.width, out.height));
  }

  const sharpnessBefore = laplacianVariance(before, out.width, out.height);
  const sharpnessAfter = laplacianVariance(processed, out.width, out.height);
  const sharpnessDelta =
    sharpnessBefore > 1e-12
      ? ((sharpnessAfter - sharpnessBefore) / sharpnessBefore) * 100
      : 0;

  return {
    data: processed,
    width: out.width,
    height: out.height,
    chromeFoil,
    sharpnessBefore,
    sharpnessAfter,
    sharpnessDelta,
    cardClass,
  };
}
