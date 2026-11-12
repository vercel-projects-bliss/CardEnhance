import type { Rotation } from "./types";

export type OrientationScore = {
  rotation: Rotation;
  score: number;
  horizontalEnergy: number;
  verticalEnergy: number;
  peakiness: number;
  baselineBias: number;
};

export type OrientationResult = {
  rotation: Rotation;
  scores: OrientationScore[];
  /** True only when text reads horizontally AND the oriented frame is wider than tall. */
  isLandscape: boolean;
};

function lumaAt(data: Uint8ClampedArray, w: number, h: number, x: number, y: number) {
  const i = (y * w + x) * 4;
  return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
}

function downsample(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  maxEdge = 240,
): { gray: Float32Array; w: number; h: number } {
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  const sw = Math.max(16, Math.round(w * scale));
  const sh = Math.max(16, Math.round(h * scale));
  const gray = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    const sy = Math.min(h - 1, Math.floor(y / scale));
    for (let x = 0; x < sw; x++) {
      const sx = Math.min(w - 1, Math.floor(x / scale));
      gray[y * sw + x] = lumaAt(data, w, h, sx, sy);
    }
  }
  return { gray, w: sw, h: sh };
}

/** Rotate a luma plane the same way rotateImage rotates pixels. */
export function rotateGray(gray: Float32Array, w: number, h: number, rot: Rotation): {
  gray: Float32Array;
  w: number;
  h: number;
} {
  if (rot === 0) return { gray, w, h };
  if (rot === 180) {
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        out[(h - 1 - y) * w + (w - 1 - x)] = gray[y * w + x];
      }
    }
    return { gray: out, w, h };
  }
  const out = new Float32Array(w * h);
  const dw = h;
  const dh = w;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = rot === 90 ? h - 1 - y : y;
      const dy = rot === 90 ? x : w - 1 - x;
      out[dy * dw + dx] = gray[y * w + x];
    }
  }
  return { gray: out, w: dw, h: dh };
}

function smooth1d(src: Float32Array, radius = 2) {
  const n = src.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    let c = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j >= 0 && j < n) {
        s += src[j];
        c++;
      }
    }
    out[i] = c ? s / c : 0;
  }
  return out;
}

/**
 * Peakiness of a 1-D projection: how strongly it organizes into repeating
 * bands (text lines). Mean-normalized variance of a high-passed profile,
 * plus a mild autocorrelation bonus at typicalline spacing.
 */
export function projectionPeakiness(proj: ArrayLike<number>): number {
  const n = proj.length;
  if (n < 8) return 0;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += proj[i];
  mean /= n;
  const high = new Float32Array(n);
  for (let i = 0; i < n; i++) high[i] = proj[i] - mean;
  const sm = smooth1d(high, Math.max(1, Math.round(n * 0.01)));
  let varSum = 0;
  let abs = 0;
  for (let i = 0; i < n; i++) {
    varSum += sm[i] * sm[i];
    abs += Math.abs(sm[i]);
  }
  const variance = varSum / n;
  const rms = Math.sqrt(Math.max(0, variance));
  // Autocorrelation at lags corresponding to ~2–8% of the axis (typical line pitch).
  let bestAc = 0;
  const lag0 = Math.max(2, Math.round(n * 0.02));
  const lag1 = Math.max(lag0 + 1, Math.round(n * 0.1));
  for (let lag = lag0; lag <= lag1; lag++) {
    let acc = 0;
    let c = 0;
    for (let i = 0; i < n - lag; i++) {
      acc += sm[i] * sm[i + lag];
      c++;
    }
    if (c) bestAc = Math.max(bestAc, acc / c);
  }
  const energy = abs / n;
  if (energy < 1e-6) return 0;
  return rms / (energy + 1e-6) + 0.35 * Math.max(0, bestAc) / (variance + 1e-6);
}

/**
 * Among peaks of the row projection, measure whether the strongest
 * horizontal edge in each line band sits in the lower half (Latin /
 * CJK mixed baselines lean downward vs a 180° flip).
 */
export function baselineBias(rowEdge: ArrayLike<number>, ink: ArrayLike<number>): number {
  const n = rowEdge.length;
  if (n < 16) return 0;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += rowEdge[i];
  mean /= n;
  const peaks: number[] = [];
  for (let i = 2; i < n - 2; i++) {
    if (rowEdge[i] > mean * 1.15 && rowEdge[i] >= rowEdge[i - 1] && rowEdge[i] >= rowEdge[i + 1]) {
      peaks.push(i);
    }
  }
  if (peaks.length < 2) {
    // Fallback: overall ink mass lower vs upper half.
    let upper = 0;
    let lower = 0;
    for (let i = 0; i < n; i++) {
      if (i < n / 2) upper += ink[i];
      else lower += ink[i];
    }
    const tot = upper + lower || 1;
    return (lower - upper) / tot;
  }
  let votes = 0;
  let counted = 0;
  for (let p = 0; p < peaks.length; p++) {
    const y = peaks[p];
    const next = p + 1 < peaks.length ? peaks[p + 1] : Math.min(n - 1, y + Math.round(n * 0.08));
    const prev = p > 0 ? peaks[p - 1] : Math.max(0, y - Math.round(n * 0.08));
    // Band around this peak: compare ink below vs above the peak inside the line.
    const midGap = Math.max(2, Math.round((next - prev) * 0.35));
    let above = 0;
    let below = 0;
    for (let i = Math.max(0, y - midGap); i < y; i++) above += ink[i];
    for (let i = y; i <= Math.min(n - 1, y + midGap); i++) below += ink[i];
    const tot = above + below;
    if (tot > 0) {
      votes += (below - above) / tot;
      counted++;
    }
  }
  return counted ? votes / counted : 0;
}

export function scoreUpright(
  gray: Float32Array,
  srcW: number,
  srcH: number,
  rot: Rotation,
): OrientationScore {
  const rotGray = rotateGray(gray, srcW, srcH, rot);
  const { gray: g, w, h } = rotGray;
  const rowH = new Float32Array(h);
  const colV = new Float32Array(w);
  const rowInk = new Float32Array(h);
  const colInk = new Float32Array(w);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const c = g[y * w + x];
      const r = g[y * w + x + 1];
      const l = g[y * w + x - 1];
      const d = g[(y + 1) * w + x];
      const u = g[(y - 1) * w + x];
      const gx = r - l;
      const gy = d - u;
      // Horizontal text lines produce strong vertical gradients (horizontal edges).
      rowH[y] += Math.abs(gy);
      colV[x] += Math.abs(gx);
      // Dark ink mass: horizontal text organizes into peaky row sums, not columns.
      const ink = Math.max(0, 220 - c);
      rowInk[y] += ink;
      colInk[x] += ink;
    }
  }
  const hPeak = projectionPeakiness(rowH);
  const vPeak = projectionPeakiness(colV);
  const hInk = projectionPeakiness(rowInk);
  const vInk = projectionPeakiness(colInk);
  const peakiness = (hInk - vInk) + 0.45 * (hPeak - vPeak);
  const bias = baselineBias(rowH, rowInk);
  let hEnergy = 0;
  let vEnergy = 0;
  for (let i = 0; i < rowH.length; i++) hEnergy += rowH[i];
  for (let i = 0; i < colV.length; i++) vEnergy += colV[i];
  const energyRatio = (hEnergy - vEnergy) / (hEnergy + vEnergy + 1e-6);
  // Energy ratio keeps wide landscape cards (strong horizontal edges, weaker
  // peakiness on a short axis) from being mistaken for sideways portraits.
  const score = peakiness + 1.15 * energyRatio + 0.22 * bias;
  return {
    rotation: rot,
    score,
    horizontalEnergy: hEnergy,
    verticalEnergy: vEnergy,
    peakiness,
    baselineBias: bias,
  };
}

const ROTATIONS: Rotation[] = [0, 90, 180, 270];

/**
 * Detect the upright rotation of a card scan from text-line geometry.
 * Never uses filename or a raw width>height rule.
 */
export function detectOrientation(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): OrientationResult {
  const { gray, w, h } = downsample(data, width, height, 240);
  const scores = ROTATIONS.map((rot) => scoreUpright(gray, w, h, rot));
  let best = scores[0];
  for (const s of scores) {
    if (s.score > best.score) best = s;
  }
  const ow = best.rotation === 90 || best.rotation === 270 ? height : width;
  const oh = best.rotation === 90 || best.rotation === 270 ? width : height;
  // Landscape only after the card is upright and text already reads horizontally.
  const isLandscape = (best.rotation === 0 || best.rotation === 180) && ow > oh;
  return { rotation: best.rotation, scores, isLandscape };
}

export function composeRotation(a: Rotation, b: Rotation): Rotation {
  return ((((a + b) % 360) + 360) % 360) as Rotation;
}
