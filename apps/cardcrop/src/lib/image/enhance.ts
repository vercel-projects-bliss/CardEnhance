import type { EnhancementSettings } from "@/lib/cards/types";

const MAX_EDGE = 2200;

export type EnhanceResult = {
  width: number;
  height: number;
  buffer: ArrayBuffer;
  blemishCount: number;
};

function clamp(n: number, min: number, max: number) {
  return n < min ? min : n > max ? max : n;
}

function luma(r: number, g: number, b: number) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function boxBlur(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  radius: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length);
  const tmp = new Uint8ClampedArray(src.length);
  const r = Math.max(1, Math.round(radius));

  for (let y = 0; y < h; y++) {
    let rs = 0,
      gs = 0,
      bs = 0,
      count = 0;
    const row = y * w * 4;
    for (let x = -r; x <= r; x++) {
      const xx = clamp(x, 0, w - 1);
      const i = row + xx * 4;
      rs += src[i];
      gs += src[i + 1];
      bs += src[i + 2];
      count++;
    }
    for (let x = 0; x < w; x++) {
      const i = row + x * 4;
      tmp[i] = rs / count;
      tmp[i + 1] = gs / count;
      tmp[i + 2] = bs / count;
      tmp[i + 3] = src[i + 3];
      const x0 = x - r;
      const x1 = x + r + 1;
      if (x0 >= 0) {
        const j = row + x0 * 4;
        rs -= src[j];
        gs -= src[j + 1];
        bs -= src[j + 2];
        count--;
      }
      if (x1 < w) {
        const j = row + x1 * 4;
        rs += src[j];
        gs += src[j + 1];
        bs += src[j + 2];
        count++;
      }
    }
  }

  for (let x = 0; x < w; x++) {
    let rs = 0,
      gs = 0,
      bs = 0,
      count = 0;
    for (let y = -r; y <= r; y++) {
      const yy = clamp(y, 0, h - 1);
      const i = (yy * w + x) * 4;
      rs += tmp[i];
      gs += tmp[i + 1];
      bs += tmp[i + 2];
      count++;
    }
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      out[i] = rs / count;
      out[i + 1] = gs / count;
      out[i + 2] = bs / count;
      out[i + 3] = tmp[i + 3];
      const y0 = y - r;
      const y1 = y + r + 1;
      if (y0 >= 0) {
        const j = (y0 * w + x) * 4;
        rs -= tmp[j];
        gs -= tmp[j + 1];
        bs -= tmp[j + 2];
        count--;
      }
      if (y1 < h) {
        const j = (y1 * w + x) * 4;
        rs += tmp[j];
        gs += tmp[j + 1];
        bs += tmp[j + 2];
        count++;
      }
    }
  }
  return out;
}

function isHoloPixel(r: number, g: number, b: number) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  if (sat < 0.42 || max < 90) return false;
  return (g > r && b > r * 0.7) || (b > g && r > g * 0.7);
}

export function processPixels(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  settings: EnhancementSettings,
): { data: Uint8ClampedArray; blemishCount: number } {
  const orig = new Uint8ClampedArray(src);
  const data = new Uint8ClampedArray(src);
  let blemishCount = 0;

  if (settings.blemishRemoval) {
    const thresh = 28 + (1 - settings.blemishSensitivity) * 48;
    const blurred = boxBlur(data, w, h, 2);
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i],
        g = data[i + 1],
        b = data[i + 2];
      if (settings.preserveHolographic && isHoloPixel(r, g, b)) continue;
      const dr = r - blurred[i];
      const dg = g - blurred[i + 1];
      const db = b - blurred[i + 2];
      const mag = Math.sqrt(dr * dr + dg * dg + db * db);
      if (mag > thresh) {
        data[i] = blurred[i];
        data[i + 1] = blurred[i + 1];
        data[i + 2] = blurred[i + 2];
        blemishCount++;
      }
    }
  }

  if (settings.descratch) {
    const thresh = 20 + (1 - settings.blemishSensitivity) * 28;
    const blurred = boxBlur(data, w, h, 1);
    const outlier = new Uint8Array(w * h);
    for (let p = 0, i = 0; p < w * h; p++, i += 4) {
      if (settings.preserveHolographic && isHoloPixel(data[i], data[i + 1], data[i + 2])) continue;
      const dr = data[i] - blurred[i];
      const dg = data[i + 1] - blurred[i + 1];
      const db = data[i + 2] - blurred[i + 2];
      if (Math.sqrt(dr * dr + dg * dg + db * db) > thresh) outlier[p] = 1;
    }
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        if (!outlier[p]) continue;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            n += outlier[(y + dy) * w + (x + dx)];
          }
        }
        if (n <= 5) {
          const i = p * 4;
          data[i] = blurred[i];
          data[i + 1] = blurred[i + 1];
          data[i + 2] = blurred[i + 2];
          blemishCount++;
        }
      }
    }
  }

  if (settings.noiseReduction) {
    const radius = 1 + Math.round(settings.noiseReductionStrength * 2);
    const blurred = boxBlur(data, w, h, radius);
    const mix = settings.noiseReductionStrength * 0.65;
    for (let i = 0; i < data.length; i += 4) {
      if (settings.preserveHolographic && isHoloPixel(data[i], data[i + 1], data[i + 2]))
        continue;
      data[i] = data[i] * (1 - mix) + blurred[i] * mix;
      data[i + 1] = data[i + 1] * (1 - mix) + blurred[i + 1] * mix;
      data[i + 2] = data[i + 2] * (1 - mix) + blurred[i + 2] * mix;
    }
  }

  if (settings.colorCorrection) {
    const temp = settings.colorTemperature;
    const sat = settings.saturation;
    for (let i = 0; i < data.length; i += 4) {
      let r = data[i];
      let g = data[i + 1];
      let b = data[i + 2];
      r = clamp(r + temp * 28, 0, 255);
      b = clamp(b - temp * 28, 0, 255);
      const y = luma(r, g, b);
      r = clamp(y + (r - y) * sat, 0, 255);
      g = clamp(y + (g - y) * sat, 0, 255);
      b = clamp(y + (b - y) * sat, 0, 255);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
    }
  }

  if (settings.contrastEnhancement) {
    const c = 1 + settings.contrastAmount * 0.85;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = clamp((data[i] - 128) * c + 128, 0, 255);
      data[i + 1] = clamp((data[i + 1] - 128) * c + 128, 0, 255);
      data[i + 2] = clamp((data[i + 2] - 128) * c + 128, 0, 255);
    }
  }

  if (settings.sharpening) {
    const blurred = boxBlur(data, w, h, 1);
    const amt = settings.sharpeningAmount * 1.35;
    for (let i = 0; i < data.length; i += 4) {
      if (settings.preserveHolographic && isHoloPixel(orig[i], orig[i + 1], orig[i + 2]))
        continue;
      data[i] = clamp(data[i] + (data[i] - blurred[i]) * amt, 0, 255);
      data[i + 1] = clamp(data[i + 1] + (data[i + 1] - blurred[i + 1]) * amt, 0, 255);
      data[i + 2] = clamp(data[i + 2] + (data[i + 2] - blurred[i + 2]) * amt, 0, 255);
    }
  }

  if (settings.preserveHolographic) {
    for (let i = 0; i < data.length; i += 4) {
      if (!isHoloPixel(orig[i], orig[i + 1], orig[i + 2])) continue;
      data[i] = orig[i] * 0.72 + data[i] * 0.28;
      data[i + 1] = orig[i + 1] * 0.72 + data[i + 1] * 0.28;
      data[i + 2] = orig[i + 2] * 0.72 + data[i + 2] * 0.28;
    }
  }

  return { data, blemishCount };
}

export function fitMaxEdge(w: number, h: number) {
  const edge = Math.max(w, h);
  if (edge <= MAX_EDGE) return { w, h, scale: 1 };
  const scale = MAX_EDGE / edge;
  return { w: Math.round(w * scale), h: Math.round(h * scale), scale };
}
