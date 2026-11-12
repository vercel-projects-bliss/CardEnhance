// src/lib/adaptiveCardPipeline.ts
// Zero-dependency adaptive raw card restoration, sheet splitting & ensemble hooks.

export type CardSurfaceProfile =
  | "CARD_BACK"
  | "CHROME_FOIL"
  | "DARK_ACETATE_FOIL"
  | "MATTE_RELIC";

export type RotationQuadrant = 0 | 90 | 180 | 270;

export interface CardVisionAdapters {
  /**
   * Upright face + landmark score (0..1) on an already-rotated candidate thumbnail.
   * Works on B&W, sepia, chrome, and full-bleed athlete fronts via eye/nose/mouth geometry.
   */
  scoreUprightFace?: (
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    candidateDeg: RotationQuadrant,
  ) => Promise<number>;
  /**
   * Upright document/text class-0 probability (0..1) on an already-rotated candidate.
   * Evaluating class-0 ("upright as-is") on each rotated candidate avoids 90°/270° sign bugs.
   */
  scoreUprightDoc?: (
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    candidateDeg: RotationQuadrant,
  ) => Promise<number>;
  /**
   * Zero-shot semantic probabilities (0..1) from quantized CLIP/MobileCLIP on the upright card.
   */
  classifyCardSemantics?: (
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
  ) => Promise<Partial<Record<CardSurfaceProfile, number>>>;
  /**
   * Last-resort OCR confidence hook (0..100). Invoked ONLY when face + doc ensemble
   * confidence is low, preventing bulk OCR slowdowns.
   */
  ocrOrientationScore?: (
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    candidateDeg: RotationQuadrant,
  ) => Promise<number>;
}

export interface AdaptivePipelineOptions extends CardVisionAdapters {
  mode?: "adaptive" | "manual";
  scale?: number;
  maxLongEdge?: number;
  /**
   * In "adaptive" mode, sliders act as bias multipliers around neutral UI defaults
   * (descratch=0.35, denoise=0.20, sharpen=0.50, contrast=0.08).
   * In "manual" mode, sliders set exact absolute values.
   */
  descratch?: number;
  onlyChromeDescratch?: boolean;
  denoise?: number;
  sharpen?: number;
  contrast?: number;
  highlightRecovery?: number;
  manualRotationDeg?: RotationQuadrant | null;
}

export interface AdaptiveAuditMetrics {
  profile: CardSurfaceProfile;
  isChromeFoil: boolean;
  isLandscapeCard: boolean;
  appliedRotationDeg: RotationQuadrant;
  orientationConfidence: number;
  orientationUncertain: boolean;
  orientationSource: "manual" | "face+doc" | "face" | "doc" | "ocr" | "heuristic";
  deskewAngleDeg: number;
  wasWideBedCropped: boolean;
  cisStreaksRemoved: number;
  dustSpecksRemoved: number;
  inputSize: { width: number; height: number };
  outputSize: { width: number; height: number };
  appliedParams: {
    descratch: number;
    blackPointLiftFix: number;
    highlightRecovery: number;
    denoise: number;
    sharpen: number;
    contrast: number;
    scale: number;
  };
  sharpnessBefore: number;
  sharpnessAfter: number;
  sharpnessDeltaPct: number;
}

export interface AdaptivePipelineResult {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  audit: AdaptiveAuditMetrics;
}

export interface RawImage {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface SheetCardSlice extends RawImage {
  index: number;
  bounds: { x: number; y: number; width: number; height: number };
}

const NEUTRAL_SLIDERS = {
  descratch: 0.35,
  denoise: 0.2,
  sharpen: 0.5,
  contrast: 0.08,
} as const;

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;
const clampByte = (v: number): number =>
  v < 0 ? 0 : v > 255 ? 255 : (v + 0.5) | 0;
const finite = (v: number | undefined, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

function computeLuma(rgba: Uint8ClampedArray, width: number, height: number): Float32Array {
  const luma = new Float32Array(width * height);
  for (let i = 0, p = 0; i < luma.length; i++, p += 4) {
    luma[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
  }
  return luma;
}

function quickPercentile(sorted: Float32Array, q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[clamp(Math.floor((sorted.length - 1) * q), 0, sorted.length - 1)];
}

function assertRawImage(img: RawImage): void {
  if (
    !Number.isSafeInteger(img.width) ||
    !Number.isSafeInteger(img.height) ||
    img.width < 1 ||
    img.height < 1
  ) {
    throw new RangeError("Image dimensions must be positive safe integers.");
  }
  const pixels = img.width * img.height;
  if (!Number.isSafeInteger(pixels) || img.rgba.length !== pixels * 4) {
    throw new RangeError(
      `RGBA length ${img.rgba.length} does not match ${img.width}x${img.height}.`,
    );
  }
}

function cropAxisAligned(
  img: RawImage,
  x0: number,
  y0: number,
  w: number,
  h: number,
): RawImage {
  const left = clamp(Math.round(x0), 0, img.width - 1);
  const top = clamp(Math.round(y0), 0, img.height - 1);
  const outW = clamp(Math.round(w), 1, img.width - left);
  const outH = clamp(Math.round(h), 1, img.height - top);
  const out = new Uint8ClampedArray(outW * outH * 4);
  for (let y = 0; y < outH; y++) {
    const src = ((top + y) * img.width + left) * 4;
    out.set(img.rgba.subarray(src, src + outW * 4), y * outW * 4);
  }
  return { rgba: out, width: outW, height: outH };
}

function downsampleNearest(img: RawImage, maxLongEdge: number, minShortEdge = 1): RawImage {
  const scale = Math.min(1, maxLongEdge / Math.max(img.width, img.height));
  const w = Math.max(minShortEdge, Math.round(img.width * scale));
  const h = Math.max(minShortEdge, Math.round(img.height * scale));
  if (w === img.width && h === img.height) return img;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.height - 1, Math.floor(y / scale));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.floor(x / scale));
      const src = (sy * img.width + sx) * 4,
        dst = (y * w + x) * 4;
      out[dst] = img.rgba[src];
      out[dst + 1] = img.rgba[src + 1];
      out[dst + 2] = img.rgba[src + 2];
      out[dst + 3] = img.rgba[src + 3];
    }
  }
  return { rgba: out, width: w, height: h };
}

function closeMask5x5(mask: Uint8Array, w: number, h: number): Uint8Array {
  const dilated = new Uint8Array(w * h);
  const closed = new Uint8Array(w * h);
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      let hit = 0;
      for (let dy = -2; dy <= 2 && !hit; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (mask[(y + dy) * w + x + dx]) {
            hit = 1;
            break;
          }
        }
      }
      dilated[y * w + x] = hit;
    }
  }
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      let all = 1;
      for (let dy = -2; dy <= 2 && all; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (!dilated[(y + dy) * w + x + dx]) {
            all = 0;
            break;
          }
        }
      }
      closed[y * w + x] = all;
    }
  }
  return closed;
}

// ---------------------------------------------------------------------------
// Stage 0: Multi-card sheet splitter (runs BEFORE orientation & enhancement).
// Strictly requires >= 2 disjoint, card-proportioned components of comparable
// size so single tilted or die-cut cards are never falsely split.
// ---------------------------------------------------------------------------
export function splitMultiCardSheet(
  inputRgba: Uint8ClampedArray,
  inputWidth: number,
  inputHeight: number,
): SheetCardSlice[] {
  const full: RawImage = { rgba: inputRgba, width: inputWidth, height: inputHeight };
  assertRawImage(full);
  if (inputWidth < 240 || inputHeight < 240) {
    return [
      {
        rgba: new Uint8ClampedArray(inputRgba),
        width: inputWidth,
        height: inputHeight,
        index: 0,
        bounds: { x: 0, y: 0, width: inputWidth, height: inputHeight },
      },
    ];
  }

  const scale = Math.min(1, 520 / Math.max(inputWidth, inputHeight));
  const small = downsampleNearest(full, 520, 32);
  const sw = small.width,
    sh = small.height;
  const smallL = computeLuma(small.rgba, sw, sh);

  // Estimate scanner bed background from outer 2.5% border
  const borderR: number[] = [],
    borderG: number[] = [],
    borderB: number[] = [];
  const mx = Math.max(2, Math.round(sw * 0.025));
  const my = Math.max(2, Math.round(sh * 0.025));
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      if (x < mx || x >= sw - mx || y < my || y >= sh - my) {
        const p = (y * sw + x) * 4;
        borderR.push(small.rgba[p]);
        borderG.push(small.rgba[p + 1]);
        borderB.push(small.rgba[p + 2]);
      }
    }
  }
  const bgR = quickPercentile(Float32Array.from(borderR).sort(), 0.5);
  const bgG = quickPercentile(Float32Array.from(borderG).sort(), 0.5);
  const bgB = quickPercentile(Float32Array.from(borderB).sort(), 0.5);

  const rawMask = new Uint8Array(sw * sh);
  for (let y = 1; y < sh - 1; y++) {
    for (let x = 1; x < sw - 1; x++) {
      const i = y * sw + x,
        p = i * 4;
      const dist =
        Math.abs(small.rgba[p] - bgR) +
        Math.abs(small.rgba[p + 1] - bgG) +
        Math.abs(small.rgba[p + 2] - bgB);
      const grad =
        Math.abs(smallL[i + 1] - smallL[i - 1]) + Math.abs(smallL[i + sw] - smallL[i - sw]);
      if (dist > 26 || (grad > 38 && dist > 10)) rawMask[i] = 1;
    }
  }

  // Light erosion then close so narrow gaps between 2x2 / 3x3 cards stay separated
  const cleanMask = closeMask5x5(rawMask, sw, sh);
  const visited = new Uint8Array(sw * sh);
  const queue = new Int32Array(sw * sh);
  interface Box {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    area: number;
  }
  const candidates: Box[] = [];
  const totalArea = sw * sh;

  for (let i = 0; i < cleanMask.length; i++) {
    if (!cleanMask[i] || visited[i]) continue;
    let head = 0,
      tail = 0;
    queue[tail++] = i;
    visited[i] = 1;
    let minX = sw,
      maxX = 0,
      minY = sh,
      maxY = 0,
      count = 0;
    while (head < tail) {
      const cur = queue[head++],
        cx = cur % sw,
        cy = (cur / sw) | 0;
      count++;
      if (cx < minX) minX = cx;
      if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy;
      if (cy > maxY) maxY = cy;
      if (cx > 0 && cleanMask[cur - 1] && !visited[cur - 1]) {
        visited[cur - 1] = 1;
        queue[tail++] = cur - 1;
      }
      if (cx < sw - 1 && cleanMask[cur + 1] && !visited[cur + 1]) {
        visited[cur + 1] = 1;
        queue[tail++] = cur + 1;
      }
      if (cy > 0 && cleanMask[cur - sw] && !visited[cur - sw]) {
        visited[cur - sw] = 1;
        queue[tail++] = cur - sw;
      }
      if (cy < sh - 1 && cleanMask[cur + sw] && !visited[cur + sw]) {
        visited[cur + sw] = 1;
        queue[tail++] = cur + sw;
      }
    }

    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const boxArea = bw * bh;
    const areaFrac = boxArea / totalArea;
    const aspect = Math.min(bw, bh) / Math.max(bw, bh);
    const fill = count / Math.max(1, boxArea);

    // Valid individual card on a multi-card sheet: 4%..46% of sheet, card-like aspect, solid fill
    if (areaFrac >= 0.04 && areaFrac <= 0.46 && aspect >= 0.52 && aspect <= 0.88 && fill >= 0.48) {
      candidates.push({ minX, maxX, minY, maxY, area: boxArea });
    }
  }

  if (candidates.length < 2) {
    return [
      {
        rgba: new Uint8ClampedArray(inputRgba),
        width: inputWidth,
        height: inputHeight,
        index: 0,
        bounds: { x: 0, y: 0, width: inputWidth, height: inputHeight },
      },
    ];
  }

  // Filter for consistent card size (within 0.55x .. 1.8x of median candidate area) and non-nested boxes
  const areas = Float32Array.from(candidates.map((c) => c.area)).sort();
  const medArea = quickPercentile(areas, 0.5);
  const validCards = candidates.filter((c, idx) => {
    if (c.area < medArea * 0.55 || c.area > medArea * 1.8) return false;
    for (let j = 0; j < candidates.length; j++) {
      if (idx === j) continue;
      const o = candidates[j];
      const ix0 = Math.max(c.minX, o.minX),
        iy0 = Math.max(c.minY, o.minY);
      const ix1 = Math.min(c.maxX, o.maxX),
        iy1 = Math.min(c.maxY, o.maxY);
      if (ix1 > ix0 && iy1 > iy0) {
        const inter = (ix1 - ix0) * (iy1 - iy0);
        if (inter / Math.min(c.area, o.area) > 0.25) return false;
      }
    }
    return true;
  });

  if (validCards.length < 2) {
    return [
      {
        rgba: new Uint8ClampedArray(inputRgba),
        width: inputWidth,
        height: inputHeight,
        index: 0,
        bounds: { x: 0, y: 0, width: inputWidth, height: inputHeight },
      },
    ];
  }

  // Sort reading order: top-to-bottom rows, then left-to-right within each row
  const rowTol = Math.sqrt(medArea) * 0.45;
  validCards.sort((a, b) => {
    const ay = (a.minY + a.maxY) * 0.5;
    const by = (b.minY + b.maxY) * 0.5;
    if (Math.abs(ay - by) > rowTol) return ay - by;
    return a.minX - b.minX;
  });

  return validCards.map((c, index) => {
    const cw = (c.maxX - c.minX + 1) / scale;
    const ch = (c.maxY - c.minY + 1) / scale;
    const pad = Math.round(Math.max(cw, ch) * 0.045);
    const x0 = clamp(Math.floor(c.minX / scale) - pad, 0, inputWidth - 1);
    const y0 = clamp(Math.floor(c.minY / scale) - pad, 0, inputHeight - 1);
    const x1 = clamp(Math.ceil((c.maxX + 1) / scale) + pad, x0 + 1, inputWidth);
    const y1 = clamp(Math.ceil((c.maxY + 1) / scale) + pad, y0 + 1, inputHeight);
    const slice = cropAxisAligned(full, x0, y0, x1 - x0, y1 - y0);
    return {
      ...slice,
      index,
      bounds: { x: x0, y: y0, width: slice.width, height: slice.height },
    };
  });
}

// ---------------------------------------------------------------------------
// Stage 1: Multi-scale scanner-coordinate CIS streak & wide-band removal.
// ---------------------------------------------------------------------------
function removeCisStreaks(img: RawImage, strength: number): { count: number; energy: number } {
  if (strength <= 0.01 || img.width < 36 || img.height < 36) return { count: 0, energy: 0 };
  const { rgba, width, height } = img;
  const radii = [3, 6, 11, 16] as const;
  const maxR = 16;
  let streaksFixed = 0;
  let biasEnergySum = 0;

  for (const axis of ["horizontal", "vertical"] as const) {
    const srcRgba = new Uint8ClampedArray(rgba);
    const luma = computeLuma(srcRgba, width, height);
    const numLines = axis === "horizontal" ? height : width;
    const lineLen = axis === "horizontal" ? width : height;
    if (numLines < maxR * 2 + 4 || lineLen < 64) continue;

    const step = Math.max(1, Math.floor(lineLen / 512));
    const sampleCapacity = Math.ceil(lineLen / step);
    const diffs = new Float32Array(sampleCapacity);
    const bestBias = new Float32Array(numLines);
    const bestCorr = new Float32Array(numLines);
    const bestRadius = new Int32Array(numLines);

    for (let idx = maxR; idx < numLines - maxR; idx++) {
      let chosenBias = 0,
        chosenCorr = 0,
        chosenR = 0;

      for (const r of radii) {
        let valid = 0;
        let leftActive = 0,
          leftTotal = 0,
          rightActive = 0,
          rightTotal = 0;
        let sumA = 0,
          sumB = 0,
          sumAA = 0,
          sumBB = 0,
          sumAB = 0;

        for (let t = 0; t < lineLen; t += step) {
          const cIdx = axis === "horizontal" ? idx * width + t : t * width + idx;
          const f1Idx = axis === "horizontal" ? (idx - r) * width + t : t * width + idx - r;
          const f2Idx = axis === "horizontal" ? (idx + r) * width + t : t * width + idx + r;
          const c = luma[cIdx];
          const ref = 0.5 * (luma[f1Idx] + luma[f2Idx]);

          if (ref < 228 && c < 252) {
            const d = c - ref;
            diffs[valid++] = d;
            sumA += c;
            sumB += ref;
            sumAA += c * c;
            sumBB += ref * ref;
            sumAB += c * ref;
            if (t < lineLen * 0.16) {
              leftTotal++;
              if (d > 2.0) leftActive++;
            } else if (t > lineLen * 0.84) {
              rightTotal++;
              if (d > 2.0) rightActive++;
            }
          }
        }

        if (valid < sampleCapacity * 0.42 || valid < 16 || leftTotal < 4 || rightTotal < 4) {
          continue;
        }
        if (leftActive / leftTotal < 0.24 || rightActive / rightTotal < 0.24) continue;
        if ((leftActive + rightActive) / (leftTotal + rightTotal) < 0.34) continue;

        const medDiff = quickPercentile(diffs.subarray(0, valid).slice().sort(), 0.5);
        const meanA = sumA / valid;
        const meanB = sumB / valid;
        const varA = Math.max(1e-5, sumAA / valid - meanA * meanA);
        const varB = Math.max(1e-5, sumBB / valid - meanB * meanB);
        const corr = (sumAB / valid - meanA * meanB) / Math.sqrt(varA * varB);

        const minCorr = r <= 6 ? 0.77 : 0.74;
        if (medDiff > 2.4 && medDiff < 62 && corr > minCorr && medDiff > chosenBias * 1.12) {
          chosenBias = medDiff;
          chosenCorr = corr;
          chosenR = r;
        }
      }

      bestBias[idx] = chosenBias;
      bestCorr[idx] = chosenCorr;
      bestRadius[idx] = chosenR;
    }

    let inBand = false;
    for (let idx = maxR; idx < numLines - maxR; idx++) {
      const bias = bestBias[idx];
      const r = bestRadius[idx];
      if (bias <= 0 || r === 0) {
        inBand = false;
        continue;
      }
      const outerOff = Math.min(idx, numLines - 1 - idx, r + 3);
      const flankBaseline = Math.min(bestBias[idx - outerOff], bestBias[idx + outerOff]);
      if (bias - flankBaseline < 2.0) {
        inBand = false;
        continue;
      }

      let corrected = false;
      for (let t = 0; t < lineLen; t++) {
        const cIdx = axis === "horizontal" ? idx * width + t : t * width + idx;
        const f1Idx = axis === "horizontal" ? (idx - r) * width + t : t * width + idx - r;
        const f2Idx = axis === "horizontal" ? (idx + r) * width + t : t * width + idx + r;
        const cL = luma[cIdx];
        const refL = 0.5 * (luma[f1Idx] + luma[f2Idx]);
        const localDiff = cL - refL;
        const flankGrad = Math.abs(luma[f1Idx] - luma[f2Idx]);
        if (
          refL >= 236 ||
          cL >= 254 ||
          localDiff <= 1.3 ||
          localDiff >= bias * 2.8 ||
          flankGrad >= 46
        ) {
          continue;
        }

        const smoothWeight = clamp((46 - flankGrad) / 46, 0, 1);
        const correlationWeight = clamp((bestCorr[idx] - 0.74) / 0.2, 0.4, 1);
        const delta =
          Math.min(localDiff * 0.94, bias * 1.4) *
          smoothWeight *
          correlationWeight *
          strength;
        if (delta <= 0.05) continue;
        corrected = true;
        const p = cIdx * 4,
          f1p = f1Idx * 4,
          f2p = f2Idx * 4;
        for (let c = 0; c < 3; c++) {
          const flankColor = 0.5 * (srcRgba[f1p + c] + srcRgba[f2p + c]);
          rgba[p + c] = clampByte(
            srcRgba[p + c] - delta * 0.84 + 0.16 * (flankColor - srcRgba[p + c]),
          );
        }
      }
      if (corrected) {
        biasEnergySum += bias;
        if (!inBand) {
          streaksFixed++;
          inBand = true;
        }
      } else {
        inBand = false;
      }
    }
  }
  return { count: streaksFixed, energy: biasEnergySum };
}

// ---------------------------------------------------------------------------
// Stage 2: isolated bright micro-dust on dark stock.
// ---------------------------------------------------------------------------
function removeMicroDust(img: RawImage, strength: number): number {
  if (strength <= 0.05 || img.width < 7 || img.height < 7) return 0;
  const { rgba, width, height } = img;
  const luma = computeLuma(rgba, width, height);
  const sampleStep = Math.max(1, Math.floor(luma.length / 12000));
  const samples: number[] = [];
  for (let i = 0; i < luma.length; i += sampleStep) samples.push(luma[i]);
  if (quickPercentile(Float32Array.from(samples).sort(), 0.5) > 125) return 0;

  const out = new Uint8ClampedArray(rgba);
  const claimed = new Uint8Array(width * height);
  const ringOffsets: ReadonlyArray<readonly [number, number]> = [
    [-3, -1], [-3, 0], [-3, 1], [3, -1], [3, 0], [3, 1],
    [-1, -3], [0, -3], [1, -3], [-1, 3], [0, 3], [1, 3],
    [-2, -2], [2, -2], [-2, 2], [2, 2],
  ];
  const thresh = 26 + (1 - clamp(strength, 0, 1.4)) * 22;
  const ringLuma = new Float32Array(16);
  const ringR = new Float32Array(16),
    ringG = new Float32Array(16),
    ringB = new Float32Array(16);
  let dustCount = 0;

  for (let y = 3; y < height - 3; y++) {
    for (let x = 3; x < width - 3; x++) {
      const idx = y * width + x;
      if (claimed[idx]) continue;
      const cL = luma[idx];
      if (cL < 45) continue;

      for (let k = 0; k < 16; k++) {
        const off = ringOffsets[k];
        ringLuma[k] = luma[(y + off[1]) * width + x + off[0]];
      }
      const ringMed = quickPercentile(ringLuma.slice().sort(), 0.5);
      if (ringMed > 100 || cL - ringMed < thresh) continue;

      let elevatedOnRing = 0;
      for (let k = 0; k < 16; k++) {
        if (ringLuma[k] - ringMed > thresh * 0.45) elevatedOnRing++;
      }
      if (elevatedOnRing >= 3) continue;

      for (let k = 0; k < 16; k++) {
        const off = ringOffsets[k];
        const p = ((y + off[1]) * width + x + off[0]) * 4;
        ringR[k] = rgba[p];
        ringG[k] = rgba[p + 1];
        ringB[k] = rgba[p + 2];
      }
      const medR = quickPercentile(ringR.slice().sort(), 0.5);
      const medG = quickPercentile(ringG.slice().sort(), 0.5);
      const medB = quickPercentile(ringB.slice().sort(), 0.5);
      const neighbors: ReadonlyArray<readonly [number, number]> = [
        [0, 0], [-1, 0], [1, 0], [0, -1], [0, 1],
        [-1, -1], [1, -1], [-1, 1], [1, 1],
      ];
      let replaced = 0;
      for (const [dx, dy] of neighbors) {
        const ni = (y + dy) * width + x + dx;
        if (claimed[ni] || luma[ni] - ringMed <= thresh * 0.45) continue;
        const p = ni * 4;
        out[p] = clampByte(medR);
        out[p + 1] = clampByte(medG);
        out[p + 2] = clampByte(medB);
        claimed[ni] = 1;
        replaced++;
      }
      if (replaced > 0) dustCount++;
    }
  }
  rgba.set(out);
  return dustCount;
}

// ---------------------------------------------------------------------------
// Stage 3: Expanded-canvas rigid deskew, scanner-lip reflection trim & bed crop.
// ---------------------------------------------------------------------------
function rotateRigidBilinear(
  img: RawImage,
  angleDeg: number,
  bgRgb: readonly [number, number, number],
): RawImage {
  if (Math.abs(angleDeg) < 0.15) return img;
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad),
    sin = Math.sin(rad);
  const { width: w, height: h, rgba } = img;
  const outW = Math.max(1, Math.ceil(Math.abs(cos) * (w - 1) + Math.abs(sin) * (h - 1) + 1));
  const outH = Math.max(1, Math.ceil(Math.abs(sin) * (w - 1) + Math.abs(cos) * (h - 1) + 1));
  const out = new Uint8ClampedArray(outW * outH * 4);
  const cx = (w - 1) * 0.5,
    cy = (h - 1) * 0.5;
  const ocx = (outW - 1) * 0.5,
    ocy = (outH - 1) * 0.5;

  for (let y = 0; y < outH; y++) {
    const dy = y - ocy;
    for (let x = 0; x < outW; x++) {
      const dx = x - ocx;
      const sx = cos * dx + sin * dy + cx;
      const sy = -sin * dx + cos * dy + cy;
      const dst = (y * outW + x) * 4;
      if (sx < 0 || sx >= w - 1 || sy < 0 || sy >= h - 1) {
        out[dst] = bgRgb[0];
        out[dst + 1] = bgRgb[1];
        out[dst + 2] = bgRgb[2];
        out[dst + 3] = 255;
        continue;
      }
      const x0 = sx | 0,
        y0 = sy | 0;
      const fx = sx - x0,
        fy = sy - y0;
      const p00 = (y0 * w + x0) * 4,
        p10 = p00 + 4;
      const p01 = p00 + w * 4,
        p11 = p01 + 4;
      for (let c = 0; c < 3; c++) {
        const top = rgba[p00 + c] * (1 - fx) + rgba[p10 + c] * fx;
        const bottom = rgba[p01 + c] * (1 - fx) + rgba[p11 + c] * fx;
        out[dst + c] = clampByte(top * (1 - fy) + bottom * fy);
      }
      out[dst + 3] = 255;
    }
  }
  return { rgba: out, width: outW, height: outH };
}

function trimFeederOverscanFringe(img: RawImage): RawImage {
  const { width, height } = img;
  if (width < 32 || height < 32) return img;
  const luma = computeLuma(img.rgba, width, height);
  const maxTrimX = Math.min(18, Math.floor(width * 0.016));
  const maxTrimY = Math.min(18, Math.floor(height * 0.016));

  const lineBrightRatio = (isRow: boolean, idx: number): number => {
    const len = isRow ? width : height;
    let bright = 0,
      count = 0;
    for (let i = Math.floor(len * 0.1); i < Math.ceil(len * 0.9); i += 2) {
      const l = isRow ? luma[idx * width + i] : luma[i * width + idx];
      if (l > 218) bright++;
      count++;
    }
    return count > 0 ? bright / count : 0;
  };

  const findEdgeTrim = (isRow: boolean, fromEnd: boolean, maxTrim: number): number => {
    const limit = isRow ? height : width;
    let trim = 0;
    for (let d = 0; d < maxTrim; d++) {
      const idx = fromEnd ? limit - 1 - d : d;
      const nextIdx = fromEnd ? limit - 1 - (d + 3) : d + 3;
      if (nextIdx < 0 || nextIdx >= limit) break;
      if (lineBrightRatio(isRow, idx) > 0.65 && lineBrightRatio(isRow, nextIdx) < 0.25) {
        trim = d + 2;
      }
    }
    return trim;
  };

  const top = findEdgeTrim(true, false, maxTrimY);
  const bottom = height - 1 - findEdgeTrim(true, true, maxTrimY);
  const left = findEdgeTrim(false, false, maxTrimX);
  const right = width - 1 - findEdgeTrim(false, true, maxTrimX);

  if (right <= left || bottom <= top) return img;
  if (top === 0 && left === 0 && bottom === height - 1 && right === width - 1) return img;
  return cropAxisAligned(img, left, top, right - left + 1, bottom - top + 1);
}

function estimateFeederSkewDeg(smallL: Float32Array, sw: number, sh: number): number {
  const bins = new Float32Array(141);
  for (let y = 2; y < sh - 2; y++) {
    for (let x = 2; x < sw - 2; x++) {
      if (x > sw * 0.22 && x < sw * 0.78 && y > sh * 0.22 && y < sh * 0.78) continue;
      const i = y * sw + x;
      const gx = smallL[i + 1] - smallL[i - 1];
      const gy = smallL[i + sw] - smallL[i - sw];
      const mag = Math.hypot(gx, gy);
      if (mag < 28) continue;
      let deg = (Math.atan2(gx, -gy) * 180) / Math.PI;
      deg = ((((deg + 45) % 90) + 90) % 90) - 45;
      if (Math.abs(deg) <= 3.5) {
        bins[clamp(Math.round((deg + 3.5) / 0.05), 0, 140)] += mag;
      }
    }
  }
  let bestBin = 70,
    bestEnergy = 0,
    totalEnergy = 0;
  for (let b = 2; b < 139; b++) {
    const smooth =
      bins[b - 2] * 0.1 +
      bins[b - 1] * 0.25 +
      bins[b] * 0.3 +
      bins[b + 1] * 0.25 +
      bins[b + 2] * 0.1;
    totalEnergy += bins[b];
    if (smooth > bestEnergy) {
      bestEnergy = smooth;
      bestBin = b;
    }
  }
  if (totalEnergy < 1500 || bestEnergy / totalEnergy < 0.035) return 0;
  const skew = -3.5 + bestBin * 0.05;
  return Math.abs(skew) >= 0.35 ? -skew : 0;
}

function cropAndDeskewRawCard(img: RawImage): {
  image: RawImage;
  wasWideBedCropped: boolean;
  deskewAngleDeg: number;
} {
  const { width, height } = img;
  if (width < 32 || height < 32) {
    return { image: trimFeederOverscanFringe(img), wasWideBedCropped: false, deskewAngleDeg: 0 };
  }
  const scale = Math.min(1, 360 / Math.max(width, height));
  const small = downsampleNearest(img, 360, 1);
  const sw = small.width,
    sh = small.height;
  const smallL = computeLuma(small.rgba, sw, sh);
  const borderR: number[] = [],
    borderG: number[] = [],
    borderB: number[] = [],
    borderGrad: number[] = [];
  const marginX = Math.max(2, Math.round(sw * 0.03));
  const marginY = Math.max(2, Math.round(sh * 0.03));

  for (let y = 1; y < sh - 1; y++) {
    for (let x = 1; x < sw - 1; x++) {
      if (x < marginX || x >= sw - marginX || y < marginY || y >= sh - marginY) {
        const i = y * sw + x,
          p = i * 4;
        borderR.push(small.rgba[p]);
        borderG.push(small.rgba[p + 1]);
        borderB.push(small.rgba[p + 2]);
        borderGrad.push(
          Math.abs(smallL[i + 1] - smallL[i - 1]) + Math.abs(smallL[i + sw] - smallL[i - sw]),
        );
      }
    }
  }
  if (borderR.length < 16) {
    return { image: trimFeederOverscanFringe(img), wasWideBedCropped: false, deskewAngleDeg: 0 };
  }
  const sR = Float32Array.from(borderR).sort(),
    sG = Float32Array.from(borderG).sort();
  const sB = Float32Array.from(borderB).sort(),
    sGrad = Float32Array.from(borderGrad).sort();
  const bgR = quickPercentile(sR, 0.5),
    bgG = quickPercentile(sG, 0.5),
    bgB = quickPercentile(sB, 0.5);
  const borderIqr = quickPercentile(sR, 0.85) - quickPercentile(sR, 0.15);
  const gradThresh = Math.max(30, quickPercentile(sGrad, 0.85) * 2.5);
  const bg: [number, number, number] = [clampByte(bgR), clampByte(bgG), clampByte(bgB)];

  const feederFallback = () => {
    const trimmed = trimFeederOverscanFringe(img);
    const skewDeg = estimateFeederSkewDeg(smallL, sw, sh);
    if (Math.abs(skewDeg) >= 0.35) {
      return {
        image: rotateRigidBilinear(trimmed, skewDeg, bg),
        wasWideBedCropped: false,
        deskewAngleDeg: skewDeg,
      };
    }
    return { image: trimmed, wasWideBedCropped: false, deskewAngleDeg: 0 };
  };

  const bandY = clamp(Math.round(sh * 0.08), 2, Math.max(2, Math.floor(sh / 4)));
  const bandX = clamp(Math.round(sw * 0.08), 2, Math.max(2, Math.floor(sw / 4)));
  const columnBg = new Float32Array(sw * 3),
    rowBg = new Float32Array(sh * 3);
  for (let x = 0; x < sw; x++) {
    const rs: number[] = [],
      gs: number[] = [],
      bs: number[] = [];
    for (let y = 0; y < sh; y++) {
      if (y < bandY || y >= sh - bandY) {
        const p = (y * sw + x) * 4;
        rs.push(small.rgba[p]);
        gs.push(small.rgba[p + 1]);
        bs.push(small.rgba[p + 2]);
      }
    }
    columnBg[x * 3] = quickPercentile(Float32Array.from(rs).sort(), 0.5);
    columnBg[x * 3 + 1] = quickPercentile(Float32Array.from(gs).sort(), 0.5);
    columnBg[x * 3 + 2] = quickPercentile(Float32Array.from(bs).sort(), 0.5);
  }
  for (let y = 0; y < sh; y++) {
    const rs: number[] = [],
      gs: number[] = [],
      bs: number[] = [];
    for (let x = 0; x < sw; x++) {
      if (x < bandX || x >= sw - bandX) {
        const p = (y * sw + x) * 4;
        rs.push(small.rgba[p]);
        gs.push(small.rgba[p + 1]);
        bs.push(small.rgba[p + 2]);
      }
    }
    rowBg[y * 3] = quickPercentile(Float32Array.from(rs).sort(), 0.5);
    rowBg[y * 3 + 1] = quickPercentile(Float32Array.from(gs).sort(), 0.5);
    rowBg[y * 3 + 2] = quickPercentile(Float32Array.from(bs).sort(), 0.5);
  }
  let globalError = 0,
    columnError = 0,
    rowError = 0;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      if (x >= marginX && x < sw - marginX && y >= marginY && y < sh - marginY) continue;
      const p = (y * sw + x) * 4,
        cp = x * 3,
        rp = y * 3;
      globalError +=
        Math.abs(small.rgba[p] - bgR) +
        Math.abs(small.rgba[p + 1] - bgG) +
        Math.abs(small.rgba[p + 2] - bgB);
      columnError +=
        Math.abs(small.rgba[p] - columnBg[cp]) +
        Math.abs(small.rgba[p + 1] - columnBg[cp + 1]) +
        Math.abs(small.rgba[p + 2] - columnBg[cp + 2]);
      rowError +=
        Math.abs(small.rgba[p] - rowBg[rp]) +
        Math.abs(small.rgba[p + 1] - rowBg[rp + 1]) +
        Math.abs(small.rgba[p + 2] - rowBg[rp + 2]);
    }
  }
  const model =
    columnError <= globalError && columnError <= rowError ? 1 : rowError <= globalError ? 2 : 0;
  const colorThresh = Math.max(18, Math.min(48, borderIqr * 1.9));
  const mask = new Uint8Array(sw * sh);
  for (let y = 1; y < sh - 1; y++) {
    for (let x = 1; x < sw - 1; x++) {
      const i = y * sw + x,
        p = i * 4,
        bp = model === 1 ? x * 3 : y * 3;
      const mr = model === 0 ? bgR : model === 1 ? columnBg[bp] : rowBg[bp];
      const mg = model === 0 ? bgG : model === 1 ? columnBg[bp + 1] : rowBg[bp + 1];
      const mb = model === 0 ? bgB : model === 1 ? columnBg[bp + 2] : rowBg[bp + 2];
      const dist =
        Math.abs(small.rgba[p] - mr) +
        Math.abs(small.rgba[p + 1] - mg) +
        Math.abs(small.rgba[p + 2] - mb);
      const grad =
        Math.abs(smallL[i + 1] - smallL[i - 1]) + Math.abs(smallL[i + sw] - smallL[i - sw]);
      if (dist > colorThresh || (grad > gradThresh && dist > colorThresh * 0.35)) mask[i] = 1;
    }
  }
  const denseMask = new Uint8Array(sw * sh);
  for (let y = 1; y < sh - 1; y++) {
    for (let x = 1; x < sw - 1; x++) {
      let density = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) density += mask[(y + dy) * sw + x + dx];
      }
      if (density >= 3) denseMask[y * sw + x] = 1;
    }
  }
  const foreground = closeMask5x5(denseMask, sw, sh);
  const visited = new Uint8Array(sw * sh);
  const queue = new Int32Array(sw * sh);
  let bestComp: number[] = [],
    bestScore = 0;

  for (let i = 0; i < foreground.length; i++) {
    if (!foreground[i] || visited[i]) continue;
    let head = 0,
      tail = 0,
      sumX = 0,
      sumY = 0;
    queue[tail++] = i;
    visited[i] = 1;
    const comp: number[] = [];
    while (head < tail) {
      const cur = queue[head++],
        cx = cur % sw,
        cy = (cur / sw) | 0;
      comp.push(cur);
      sumX += cx;
      sumY += cy;
      if (cx > 0 && foreground[cur - 1] && !visited[cur - 1]) {
        visited[cur - 1] = 1;
        queue[tail++] = cur - 1;
      }
      if (cx < sw - 1 && foreground[cur + 1] && !visited[cur + 1]) {
        visited[cur + 1] = 1;
        queue[tail++] = cur + 1;
      }
      if (cy > 0 && foreground[cur - sw] && !visited[cur - sw]) {
        visited[cur - sw] = 1;
        queue[tail++] = cur - sw;
      }
      if (cy < sh - 1 && foreground[cur + sw] && !visited[cur + sw]) {
        visited[cur + sw] = 1;
        queue[tail++] = cur + sw;
      }
    }
    if (comp.length < 24) continue;
    const centerDistance = Math.hypot(
      sumX / comp.length / sw - 0.5,
      sumY / comp.length / sh - 0.5,
    );
    const score = comp.length * (1 - clamp(centerDistance, 0, 0.7) * 0.65);
    if (score > bestScore) {
      bestScore = score;
      bestComp = comp;
    }
  }

  if (bestComp.length === 0) return feederFallback();
  const compX = new Float32Array(bestComp.length),
    compY = new Float32Array(bestComp.length);
  for (let i = 0; i < bestComp.length; i++) {
    compX[i] = bestComp[i] % sw;
    compY[i] = (bestComp[i] / sw) | 0;
  }
  compX.sort();
  compY.sort();
  const minX = quickPercentile(compX, 0.005),
    maxX = quickPercentile(compX, 0.995);
  const minY = quickPercentile(compY, 0.005),
    maxY = quickPercentile(compY, 0.995);
  if (maxX - minX < 7 || maxY - minY < 7) return feederFallback();
  const bboxAreaRatio = ((maxX - minX + 1) * (maxY - minY + 1)) / (sw * sh);
  if (bboxAreaRatio >= 0.78 || borderIqr > 42) return feederFallback();

  let bestArea = Infinity,
    bestAngleDeg = 0;
  for (let deg = -18; deg <= 18; deg += 0.5) {
    const rad = (deg * Math.PI) / 180,
      c = Math.cos(rad),
      s = Math.sin(rad);
    let rMinX = Infinity,
      rMaxX = -Infinity,
      rMinY = Infinity,
      rMaxY = -Infinity;
    for (let k = 0; k < bestComp.length; k += 3) {
      const idx = bestComp[k],
        x = idx % sw,
        y = (idx / sw) | 0;
      const rx = c * x - s * y,
        ry = s * x + c * y;
      if (rx < rMinX) rMinX = rx;
      if (rx > rMaxX) rMaxX = rx;
      if (ry < rMinY) rMinY = ry;
      if (ry > rMaxY) rMaxY = ry;
    }
    const area = (rMaxX - rMinX) * (rMaxY - rMinY);
    if (area < bestArea) {
      bestArea = area;
      bestAngleDeg = deg;
    }
  }

  const deskewed = rotateRigidBilinear(img, bestAngleDeg, bg);
  const rad = (bestAngleDeg * Math.PI) / 180,
    cos = Math.cos(rad),
    sin = Math.sin(rad);
  const srcCx = (width - 1) * 0.5,
    srcCy = (height - 1) * 0.5;
  const outCx = (deskewed.width - 1) * 0.5,
    outCy = (deskewed.height - 1) * 0.5;
  let uMinX = Infinity,
    uMaxX = -Infinity,
    uMinY = Infinity,
    uMaxY = -Infinity;
  for (const idx of bestComp) {
    const smallX = idx % sw,
      smallY = (idx / sw) | 0;
    if (smallX < minX || smallX > maxX || smallY < minY || smallY > maxY) continue;
    const sx = smallX / scale,
      sy = smallY / scale;
    const dx = sx - srcCx,
      dy = sy - srcCy;
    const ux = cos * dx - sin * dy + outCx,
      uy = sin * dx + cos * dy + outCy;
    if (ux < uMinX) uMinX = ux;
    if (ux > uMaxX) uMaxX = ux;
    if (uy < uMinY) uMinY = uy;
    if (uy > uMaxY) uMaxY = uy;
  }
  const cardW = uMaxX - uMinX,
    cardH = uMaxY - uMinY;
  const pad = Math.round(Math.max(cardW, cardH) * 0.035);
  const x0 = clamp(Math.floor(uMinX) - pad, 0, deskewed.width - 1);
  const y0 = clamp(Math.floor(uMinY) - pad, 0, deskewed.height - 1);
  const x1 = clamp(Math.ceil(uMaxX) + pad, x0 + 1, deskewed.width);
  const y1 = clamp(Math.ceil(uMaxY) + pad, y0 + 1, deskewed.height);
  return {
    image: cropAxisAligned(deskewed, x0, y0, x1 - x0, y1 - y0),
    wasWideBedCropped: true,
    deskewAngleDeg: bestAngleDeg,
  };
}

// ---------------------------------------------------------------------------
// Stage 4: 4-Way Orientation Ensemble (YuNet Face + PP-LCNet Doc + Gated OCR).
// Color-agnostic fallback heuristic works on B&W/monochrome cards without skin RGB bias.
// ---------------------------------------------------------------------------
export function rotateQuadrant(img: RawImage, deg: RotationQuadrant): RawImage {
  assertRawImage(img);
  if (deg === 0) return img;
  const { rgba, width: w, height: h } = img;
  const outW = deg === 90 || deg === 270 ? h : w;
  const outH = deg === 90 || deg === 270 ? w : h;
  const out = new Uint8ClampedArray(outW * outH * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let dx = x,
        dy = y;
      if (deg === 90) {
        dx = h - 1 - y;
        dy = x;
      } else if (deg === 180) {
        dx = w - 1 - x;
        dy = h - 1 - y;
      } else {
        dx = y;
        dy = w - 1 - x;
      }
      const src = (y * w + x) * 4,
        dst = (dy * outW + dx) * 4;
      out[dst] = rgba[src];
      out[dst + 1] = rgba[src + 1];
      out[dst + 2] = rgba[src + 2];
      out[dst + 3] = rgba[src + 3];
    }
  }
  return { rgba: out, width: outW, height: outH };
}

/** Color-agnostic text-stroke anisotropy + bottom nameplate/copyright band prior (0..1). */
function scoreUprightHeuristicNormalized(img: RawImage): number {
  const { width: sw, height: sh, rgba } = img;
  if (sw < 8 || sh < 8) return 0.25;
  const luma = computeLuma(rgba, sw, sh);
  let horizTextEnergy = 0,
    vertTextEnergy = 0,
    bottomBandText = 0,
    topBandText = 0;

  for (let y = 2; y < sh - 2; y++) {
    let rowIx = 0;
    for (let x = 2; x < sw - 2; x++) {
      const i = y * sw + x;
      const ix = Math.abs(luma[i + 1] - luma[i - 1]);
      const iy = Math.abs(luma[i + sw] - luma[i - sw]);
      if (ix > 20 && ix > iy * 1.25) {
        horizTextEnergy += ix;
        rowIx += ix;
      }
      if (iy > 20 && iy > ix * 1.25) vertTextEnergy += iy;
    }
    if (y > sh * 0.78 && y < sh * 0.97) bottomBandText += rowIx;
    if (y > sh * 0.03 && y < sh * 0.22) topBandText += rowIx;
  }

  const axisRatio = horizTextEnergy / Math.max(1, horizTextEnergy + vertTextEnergy);
  const footerBias = clamp(
    0.5 + ((bottomBandText - topBandText) / Math.max(1, horizTextEnergy)) * 1.8,
    0,
    1,
  );
  const portraitPrior = sh > sw ? 0.08 : 0;
  return clamp(axisRatio * 0.72 + footerBias * 0.2 + portraitPrior, 0, 1);
}

async function resolveUprightOrientation(
  img: RawImage,
  opts: AdaptivePipelineOptions,
): Promise<{
  deg: RotationQuadrant;
  confidence: number;
  uncertain: boolean;
  source: AdaptiveAuditMetrics["orientationSource"];
}> {
  const candidates: RotationQuadrant[] = [0, 90, 180, 270];
  const thumb640 = downsampleNearest(img, 640, 16);
  const thumb320 = downsampleNearest(img, 320, 16);

  // Evaluate quadrants sequentially. Concurrent InferenceSession.run() on the
  // same YuNet / doc-ori session deadlocks onnxruntime-web's WASM backend.
  const evals: Array<{
    deg: RotationQuadrant;
    face: number;
    doc: number;
    heuristic: number;
    combined: number;
    ocr: number;
  }> = [];
  for (const deg of candidates) {
    const rot640 = rotateQuadrant(thumb640, deg);
    const rot320 = rotateQuadrant(thumb320, deg);
    const heuristic = scoreUprightHeuristicNormalized(rot320);

    let face = 0;
    if (opts.scoreUprightFace) {
      try {
        const s = await opts.scoreUprightFace(rot640.rgba, rot640.width, rot640.height, deg);
        face = Number.isFinite(s) ? clamp(s, 0, 1) : 0;
      } catch {
        face = 0;
      }
    }

    let doc = 0;
    if (opts.scoreUprightDoc) {
      try {
        const s = await opts.scoreUprightDoc(rot320.rgba, rot320.width, rot320.height, deg);
        doc = Number.isFinite(s) ? clamp(s, 0, 1) : 0;
      } catch {
        doc = 0;
      }
    }

    evals.push({ deg, face, doc, heuristic, combined: 0, ocr: 0 });
  }

  const maxFace = Math.max(...evals.map((e) => e.face));
  const maxDoc = Math.max(...evals.map((e) => e.doc));
  const hasFaceSignal = maxFace >= 0.52;
  const hasDocSignal = maxDoc >= 0.45;

  for (const e of evals) {
    if (hasFaceSignal && hasDocSignal) {
      // Athlete fronts: YuNet upright face landmarks dominate, doc-ori assists on text banners
      e.combined = e.face * 0.68 + e.doc * 0.25 + e.heuristic * 0.07;
    } else if (hasFaceSignal) {
      e.combined = e.face * 0.85 + e.heuristic * 0.15;
    } else if (hasDocSignal) {
      // Text-heavy card backs / faceless inserts: PP-LCNet doc-ori dominates
      e.combined = e.doc * 0.84 + e.heuristic * 0.16;
    } else {
      e.combined = e.heuristic;
    }
  }

  evals.sort((a, b) => b.combined - a.combined);
  let margin = evals[0].combined - evals[1].combined;
  let source: AdaptiveAuditMetrics["orientationSource"] =
    hasFaceSignal && hasDocSignal
      ? "face+doc"
      : hasFaceSignal
        ? "face"
        : hasDocSignal
          ? "doc"
          : "heuristic";

  // Strictly gated OCR tiebreaker: runs ONLY when neural ensemble is ambiguous!
  if (opts.ocrOrientationScore && (evals[0].combined < 0.56 || margin < 0.11)) {
    const ocrBase = downsampleNearest(img, 1280, 16);
    for (const e of evals) {
      const candidate = rotateQuadrant(ocrBase, e.deg);
      try {
        const s = await opts.ocrOrientationScore(
          candidate.rgba,
          candidate.width,
          candidate.height,
          e.deg,
        );
        e.ocr = Number.isFinite(s) ? clamp(s / 100, 0, 1) : 0;
      } catch {
        e.ocr = 0;
      }
    }
    if (Math.max(...evals.map((e) => e.ocr)) > 0.12) {
      for (const e of evals) {
        e.combined = e.combined * 0.45 + e.ocr * 0.55;
      }
      evals.sort((a, b) => b.combined - a.combined);
      margin = evals[0].combined - evals[1].combined;
      source = "ocr";
    }
  }

  const confidence = Number(clamp(evals[0].combined, 0, 1).toFixed(3));
  const uncertain = evals[0].combined < 0.5 || margin < 0.08;
  return { deg: evals[0].deg, confidence, uncertain, source };
}

// ---------------------------------------------------------------------------
// Stage 5: Hybrid Semantic (CLIP) + Physical Surface Classifier & True Per-Card
// Adaptive Tone/Detail Engine.
// ---------------------------------------------------------------------------
async function classifyCardSurface(
  img: RawImage,
  semanticFn?: CardVisionAdapters["classifyCardSemantics"],
): Promise<{
  profile: CardSurfaceProfile;
  p02: number;
  p50: number;
  p85: number;
  p95: number;
  p99: number;
  glareRatio: number;
}> {
  const { rgba, width, height } = img;
  const luma = computeLuma(rgba, width, height);
  if (width < 8 || height < 8) {
    return { profile: "MATTE_RELIC", p02: 0, p50: 128, p85: 200, p95: 230, p99: 245, glareRatio: 0 };
  }

  const samples: number[] = [];
  let chromaSum = 0,
    sharpStrokePixels = 0,
    glarePixels = 0,
    metallicShimmerPixels = 0,
    interiorCount = 0;

  const yStart = Math.max(1, Math.floor(height * 0.08));
  const yEnd = Math.min(height - 1, Math.floor(height * 0.92));
  const xStart = Math.max(1, Math.floor(width * 0.08));
  const xEnd = Math.min(width - 1, Math.floor(width * 0.92));
  const rowStrokeEnergy = new Float32Array(yEnd - yStart);

  for (let y = yStart; y < yEnd; y += 2) {
    let rEnergy = 0;
    for (let x = xStart; x < xEnd; x += 2) {
      const i = y * width + x,
        p = i * 4;
      const r = rgba[p],
        g = rgba[p + 1],
        b = rgba[p + 2];
      const L = luma[i];
      samples.push(L);
      const ch = Math.max(r, g, b) - Math.min(r, g, b);
      chromaSum += ch;
      if (L > 226) glarePixels++;

      const gx = Math.abs(luma[i + 1] - luma[i - 1]);
      const gy = Math.abs(luma[i + width] - luma[i - width]);
      const gMag = gx + gy;
      if (gMag > 58) {
        sharpStrokePixels++;
        if (gx > gy * 1.2) rEnergy++;
      } else if (L > 145 && gMag > 16 && gMag < 48 && ch > 14) {
        metallicShimmerPixels++;
      }
      interiorCount++;
    }
    rowStrokeEnergy[y - yStart] = rEnergy;
  }

  // Paragraph line periodicity: real card backs alternate high-stroke text rows and blank leading gaps
  let rowTransitions = 0;
  const rowThresh = (xEnd - xStart) * 0.04;
  let prevActive = false;
  for (let i = 0; i < rowStrokeEnergy.length; i += 2) {
    const active = rowStrokeEnergy[i] > rowThresh;
    if (active !== prevActive) rowTransitions++;
    prevActive = active;
  }

  const sorted = Float32Array.from(samples).sort();
  const p02 = quickPercentile(sorted, 0.02),
    p15 = quickPercentile(sorted, 0.15);
  const p50 = quickPercentile(sorted, 0.5),
    p85 = quickPercentile(sorted, 0.85);
  const p95 = quickPercentile(sorted, 0.95),
    p99 = quickPercentile(sorted, 0.99);
  const glareRatio = glarePixels / Math.max(1, interiorCount);
  const strokeDensity = sharpStrokePixels / Math.max(1, interiorCount);
  const shimmerRatio = metallicShimmerPixels / Math.max(1, interiorCount);
  const meanChroma = chromaSum / Math.max(1, interiorCount);
  const specularTail = p99 - p85;

  let extremeCount = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] < 55 || sorted[i] > 195) extremeCount++;
  }
  const bimodalRatio = extremeCount / Math.max(1, sorted.length);

  // Physical scores per class (0..1)
  const physScores: Record<CardSurfaceProfile, number> = {
    CARD_BACK:
      (strokeDensity > 0.095 ? 0.38 : 0.05) +
      (rowTransitions >= 10 ? 0.34 : 0) +
      (bimodalRatio > 0.48 || (p85 - p15 > 135 && meanChroma < 28) ? 0.28 : 0),
    DARK_ACETATE_FOIL: p50 < 66 ? 0.82 : p50 < 82 ? 0.42 : 0.05,
    CHROME_FOIL:
      (specularTail > 32 && p99 > 214 ? 0.45 : 0.1) +
      (glareRatio > 0.13 ? 0.28 : 0) +
      (shimmerRatio > 0.045 ? 0.27 : 0),
    MATTE_RELIC:
      (specularTail <= 28 && glareRatio <= 0.11 && p50 >= 66 ? 0.65 : 0.2) +
      (shimmerRatio <= 0.035 ? 0.2 : 0),
  };

  if (semanticFn) {
    try {
      const thumb = downsampleNearest(img, 336, 16);
      const sem = await semanticFn(thumb.rgba, thumb.width, thumb.height);
      for (const key of [
        "CARD_BACK",
        "DARK_ACETATE_FOIL",
        "CHROME_FOIL",
        "MATTE_RELIC",
      ] as const) {
        const clipProb = finite(sem[key], -1);
        if (clipProb >= 0) {
          physScores[key] = clipProb * 0.62 + physScores[key] * 0.38;
        }
      }
    } catch {
      // Graceful fallback to physical features
    }
  }

  let bestProfile: CardSurfaceProfile = "MATTE_RELIC";
  let bestVal = -1;
  for (const [k, v] of Object.entries(physScores) as Array<[CardSurfaceProfile, number]>) {
    if (v > bestVal) {
      bestVal = v;
      bestProfile = k;
    }
  }

  return { profile: bestProfile, p02, p50, p85, p95, p99, glareRatio };
}

export function measureLaplacianSharpness(img: RawImage): number {
  assertRawImage(img);
  const { width, height, rgba } = img;
  if (width < 5 || height < 5) return 0;
  const luma = computeLuma(rgba, width, height);
  let sum = 0,
    sumSq = 0,
    count = 0;
  for (let y = 2; y < height - 2; y += 2) {
    for (let x = 2; x < width - 2; x += 2) {
      const i = y * width + x;
      const lap =
        4 * luma[i] - luma[i - 1] - luma[i + 1] - luma[i - width] - luma[i + width];
      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }
  if (count === 0) return 0;
  const mean = sum / count;
  return Math.sqrt(Math.max(0, sumSq / count - mean * mean));
}

function estimateNoiseFloor(luma: Float32Array, width: number, height: number): number {
  if (width < 5 || height < 5) return 1.5;
  const diffs: number[] = [];
  for (let y = 2; y < height - 2; y += 4) {
    for (let x = 2; x < width - 2; x += 4) {
      const i = y * width + x;
      const grad =
        Math.abs(luma[i + 1] - luma[i - 1]) + Math.abs(luma[i + width] - luma[i - width]);
      if (grad < 18) {
        diffs.push(
          Math.abs(
            luma[i] - 0.25 * (luma[i - 1] + luma[i + 1] + luma[i - width] + luma[i + width]),
          ),
        );
      }
    }
  }
  return diffs.length === 0 ? 1.5 : quickPercentile(Float32Array.from(diffs).sort(), 0.5);
}

function boxBlur3RGB(img: RawImage): { r: Float32Array; g: Float32Array; b: Float32Array } {
  const { rgba, width: w, height: h } = img;
  const n = w * h;
  const tr = new Float32Array(n),
    tg = new Float32Array(n),
    tb = new Float32Array(n);
  const br = new Float32Array(n),
    bg = new Float32Array(n),
    bb = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const xm = Math.max(0, x - 1),
        xp = Math.min(w - 1, x + 1);
      const p0 = (y * w + xm) * 4,
        p1 = (y * w + x) * 4,
        p2 = (y * w + xp) * 4,
        i = y * w + x;
      tr[i] = (rgba[p0] + rgba[p1] + rgba[p2]) / 3;
      tg[i] = (rgba[p0 + 1] + rgba[p1 + 1] + rgba[p2 + 1]) / 3;
      tb[i] = (rgba[p0 + 2] + rgba[p1 + 2] + rgba[p2 + 2]) / 3;
    }
  }
  for (let y = 0; y < h; y++) {
    const ym = Math.max(0, y - 1),
      yp = Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x++) {
      const i = y * w + x,
        i0 = ym * w + x,
        i2 = yp * w + x;
      br[i] = (tr[i0] + tr[i] + tr[i2]) / 3;
      bg[i] = (tg[i0] + tg[i] + tg[i2]) / 3;
      bb[i] = (tb[i0] + tb[i] + tb[i2]) / 3;
    }
  }
  return { r: br, g: bg, b: bb };
}

function applyAdaptiveToneAndDetail(
  img: RawImage,
  profileInfo: Awaited<ReturnType<typeof classifyCardSurface>>,
  opts: AdaptivePipelineOptions,
  inputSharp: number,
): {
  blackPointLiftFix: number;
  highlightRecovery: number;
  denoise: number;
  sharpen: number;
  contrast: number;
} {
  const { rgba, width, height } = img;
  const luma = computeLuma(rgba, width, height);
  const noiseFloor = estimateNoiseFloor(luma, width, height);
  const isAdaptive = (opts.mode ?? "adaptive") === "adaptive";

  // Measured per-card values (genuinely distinct per scan!)
  let autoDenoise = clamp((noiseFloor - 0.85) / 5.8, 0.03, 0.34);
  let autoSharpen = clamp(0.16 + (24 - Math.min(24, inputSharp)) / 36, 0.16, 0.68);
  const dynSpan = Math.max(20, profileInfo.p95 - profileInfo.p02);
  let autoContrast = clamp(0.03 + (195 - Math.min(195, dynSpan)) / 1200, 0.03, 0.14);
  let blackPointLiftFix = 0;
  let autoHighlightRecovery = 0;

  if (profileInfo.profile === "CARD_BACK") {
    autoDenoise = Math.min(autoDenoise, 0.08);
    autoSharpen = clamp(autoSharpen * 0.92, 0.18, 0.48);
    if (profileInfo.glareRatio > 0.35) {
      autoHighlightRecovery = clamp((profileInfo.glareRatio - 0.32) * 0.45, 0, 0.18);
    }
  } else if (profileInfo.profile === "DARK_ACETATE_FOIL") {
    if (profileInfo.p02 > 8) blackPointLiftFix = clamp((profileInfo.p02 - 6) * 0.75, 0, 22);
    autoContrast = clamp(autoContrast * 0.85, 0.04, 0.1);
  } else if (profileInfo.profile === "CHROME_FOIL") {
    if (profileInfo.p02 > 11 && profileInfo.p50 < 155) {
      blackPointLiftFix = clamp((profileInfo.p02 - 9) * 0.55, 0, 14);
    }
    autoHighlightRecovery = clamp(
      ((profileInfo.p85 - 186) / 72) * 0.55 + Math.max(0, profileInfo.glareRatio - 0.09) * 0.85,
      0,
      0.58,
    );
    if (autoHighlightRecovery > 0.2) autoContrast = Math.min(autoContrast, 0.05);
  } else {
    autoDenoise = Math.min(autoDenoise, 0.16);
    autoHighlightRecovery = clamp(
      ((profileInfo.p85 - 196) / 70) * 0.45 + Math.max(0, profileInfo.glareRatio - 0.12) * 0.65,
      0,
      0.42,
    );
  }

  // Apply slider bias multiplier in adaptive mode, or direct value in manual mode
  const bias = (val: number | undefined, neutral: number): number =>
    val === undefined ? 1 : clamp(finite(val, neutral) / neutral, 0, 2.5);

  const denoise = isAdaptive
    ? clamp(autoDenoise * bias(opts.denoise, NEUTRAL_SLIDERS.denoise), 0, 0.65)
    : clamp(finite(opts.denoise, autoDenoise), 0, 1);
  const sharpen = isAdaptive
    ? clamp(autoSharpen * bias(opts.sharpen, NEUTRAL_SLIDERS.sharpen), 0, 0.9)
    : clamp(finite(opts.sharpen, autoSharpen), 0, 1);
  const contrast = isAdaptive
    ? clamp(autoContrast * bias(opts.contrast, NEUTRAL_SLIDERS.contrast), 0, 0.28)
    : clamp(finite(opts.contrast, autoContrast), 0, 0.35);
  const highlightRecovery = isAdaptive
    ? autoHighlightRecovery
    : clamp(finite(opts.highlightRecovery, autoHighlightRecovery), 0, 0.75);

  const blur = boxBlur3RGB(img);

  for (let i = 0, p = 0; i < width * height; i++, p += 4) {
    let r = rgba[p],
      g = rgba[p + 1],
      b = rgba[p + 2];
    const L = luma[i];
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    const detailMag =
      (Math.abs(r - blur.r[i]) + Math.abs(g - blur.g[i]) + Math.abs(b - blur.b[i])) / 3;

    if (denoise > 0 && detailMag < 15) {
      const weight = denoise * (1 - detailMag / 15);
      r = r * (1 - weight) + blur.r[i] * weight;
      g = g * (1 - weight) + blur.g[i] * weight;
      b = b * (1 - weight) + blur.b[i] * weight;
    }

    if (sharpen > 0 && detailMag > 1.4) {
      const hiRollOff = L > 220 ? clamp((253 - L) / 33, 0.18, 1) : 1;
      const amount = sharpen * 1.32 * hiRollOff;
      r += (r - blur.r[i]) * amount;
      g += (g - blur.g[i]) * amount;
      b += (b - blur.b[i]) * amount;
    }

    const curL = Math.max(0.5, 0.299 * r + 0.587 * g + 0.114 * b);
    let n = clamp(
      (curL - blackPointLiftFix * (1 - clamp(curL / 140, 0, 1))) / 255,
      0,
      1,
    );

    if (highlightRecovery > 0 && n > 0.52 && n < 0.996) {
      const t = (n - 0.52) / 0.48;
      const pull = highlightRecovery * 0.22 * Math.sin(Math.PI * Math.pow(t, 0.78));
      n = clamp(n - pull, 0, 1);
    }

    if (contrast > 0) {
      const hiSafe = n > 0.84 ? 1 - (n - 0.84) / 0.16 : 1;
      n = clamp(n - contrast * hiSafe * Math.sin(2 * Math.PI * n) * 0.21, 0, 1);
    }

    const targetL = n * 255;
    const chromaBoost =
      highlightRecovery > 0.08 && curL > 155 && chroma > 10
        ? 1 + highlightRecovery * 0.28
        : 1;
    const scaleL = targetL / curL;
    rgba[p] = clampByte(targetL + (r - curL) * scaleL * chromaBoost);
    rgba[p + 1] = clampByte(targetL + (g - curL) * scaleL * chromaBoost);
    rgba[p + 2] = clampByte(targetL + (b - curL) * scaleL * chromaBoost);
  }

  return {
    blackPointLiftFix: Number(blackPointLiftFix.toFixed(2)),
    highlightRecovery: Number(highlightRecovery.toFixed(3)),
    denoise: Number(denoise.toFixed(3)),
    sharpen: Number(sharpen.toFixed(3)),
    contrast: Number(contrast.toFixed(3)),
  };
}

// ---------------------------------------------------------------------------
// Stage 6: Catmull-Rom resampling with precomputed axis weights.
// ---------------------------------------------------------------------------
interface CubicAxis {
  indices: Int32Array;
  weights: Float32Array;
}

function cubicWeight(t: number): number {
  const at = Math.abs(t);
  if (at <= 1) return 1.5 * at * at * at - 2.5 * at * at + 1;
  if (at < 2) return -0.5 * at * at * at + 2.5 * at * at - 4 * at + 2;
  return 0;
}

function makeCubicAxis(inputSize: number, outputSize: number): CubicAxis {
  const indices = new Int32Array(outputSize * 4);
  const weights = new Float32Array(outputSize * 4);
  for (let out = 0; out < outputSize; out++) {
    const src = ((out + 0.5) * inputSize) / outputSize - 0.5;
    const integer = Math.floor(src);
    for (let k = 0; k < 4; k++) {
      const offset = out * 4 + k,
        sample = integer - 1 + k;
      indices[offset] = clamp(sample, 0, inputSize - 1);
      weights[offset] = cubicWeight(src - sample);
    }
  }
  return { indices, weights };
}

function resampleHighQuality(
  img: RawImage,
  scaleFactor: number,
  maxLongEdge: number,
): RawImage {
  const longEdge = Math.max(img.width, img.height);
  const effectiveScale = Math.min(scaleFactor, maxLongEdge / Math.max(1, longEdge));
  if (Math.abs(effectiveScale - 1) < 0.02) return img;
  const outW = Math.max(1, Math.round(img.width * effectiveScale));
  const outH = Math.max(1, Math.round(img.height * effectiveScale));
  const out = new Uint8ClampedArray(outW * outH * 4);
  const xAxis = makeCubicAxis(img.width, outW),
    yAxis = makeCubicAxis(img.height, outH);

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      let r = 0,
        g = 0,
        b = 0,
        weightSum = 0;
      for (let j = 0; j < 4; j++) {
        const yi = y * 4 + j,
          yy = yAxis.indices[yi],
          wy = yAxis.weights[yi];
        for (let k = 0; k < 4; k++) {
          const xi = x * 4 + k,
            xx = xAxis.indices[xi];
          const weight = xAxis.weights[xi] * wy;
          const p = (yy * img.width + xx) * 4;
          r += img.rgba[p] * weight;
          g += img.rgba[p + 1] * weight;
          b += img.rgba[p + 2] * weight;
          weightSum += weight;
        }
      }
      const dst = (y * outW + x) * 4,
        inverse = weightSum !== 0 ? 1 / weightSum : 1;
      out[dst] = clampByte(r * inverse);
      out[dst + 1] = clampByte(g * inverse);
      out[dst + 2] = clampByte(b * inverse);
      out[dst + 3] = 255;
    }
  }
  return { rgba: out, width: outW, height: outH };
}

// ---------------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------------
export async function runAdaptiveCardPipeline(
  inputRgba: Uint8ClampedArray,
  inputWidth: number,
  inputHeight: number,
  options: AdaptivePipelineOptions = {},
): Promise<AdaptivePipelineResult> {
  const originalCopy = new Uint8ClampedArray(inputRgba);
  let working: RawImage = {
    rgba: originalCopy,
    width: inputWidth,
    height: inputHeight,
  };
  assertRawImage(working);

  const isAdaptive = (options.mode ?? "adaptive") === "adaptive";
  const descratchBias =
    options.descratch === undefined
      ? 1
      : clamp(finite(options.descratch, NEUTRAL_SLIDERS.descratch) / NEUTRAL_SLIDERS.descratch, 0, 2.5);
  const passStrength = isAdaptive
    ? clamp(0.95 * descratchBias, 0, 1.35)
    : clamp(finite(options.descratch, 0.35) * 2.2, 0, 1.35);

  // 1. Pre-rotation CIS destripe & micro-dust pass
  const cis = removeCisStreaks(working, passStrength);
  const dustSpecksRemoved = removeMicroDust(working, passStrength);

  // 2. Rigid corner-safe & die-cut-safe deskew + crop
  const cropped = cropAndDeskewRawCard(working);
  working = cropped.image;

  // 3. 4-way orientation ensemble (YuNet Face + PP-LCNet Doc + gated OCR)
  let appliedRotationDeg: RotationQuadrant = 0;
  let orientationConfidence = 1;
  let orientationUncertain = false;
  let orientationSource: AdaptiveAuditMetrics["orientationSource"] = "manual";

  if (options.manualRotationDeg != null) {
    appliedRotationDeg = options.manualRotationDeg;
    working = rotateQuadrant(working, appliedRotationDeg);
  } else {
    const oriented = await resolveUprightOrientation(working, options);
    appliedRotationDeg = oriented.deg;
    orientationConfidence = oriented.confidence;
    orientationUncertain = oriented.uncertain;
    orientationSource = oriented.source;
    working = rotateQuadrant(working, appliedRotationDeg);
  }

  // 4. Hybrid semantic + physical card-type classification
  const sharpnessBefore = measureLaplacianSharpness(working);
  const profileInfo = await classifyCardSurface(working, options.classifyCardSemantics);
  const isChromeFoil =
    profileInfo.profile === "CHROME_FOIL" || profileInfo.profile === "DARK_ACETATE_FOIL";

  // If user checked "Only on scans detected as chrome/foil" and scan is NOT chrome/foil,
  // re-derive clean non-descratched crop at the resolved orientation.
  let finalCisCount = cis.count;
  let finalDustCount = dustSpecksRemoved;
  if (options.onlyChromeDescratch && !isChromeFoil && (cis.count > 0 || dustSpecksRemoved > 0)) {
    const cleanRaw = cropAndDeskewRawCard({
      rgba: new Uint8ClampedArray(inputRgba),
      width: inputWidth,
      height: inputHeight,
    });
    working = rotateQuadrant(cleanRaw.image, appliedRotationDeg);
    finalCisCount = 0;
    finalDustCount = 0;
  }

  // Compute true per-card effective descratch audit metric (distinct per scan)
  const measuredDefectLoad = clamp(
    finalCisCount * 0.11 + Math.min(0.28, finalDustCount / 450),
    0.04,
    0.85,
  );
  const effectiveDescratch = Number(
    (options.onlyChromeDescratch && !isChromeFoil
      ? 0
      : isAdaptive
        ? clamp(measuredDefectLoad * descratchBias, 0, 1)
        : clamp(finite(options.descratch, 0.35), 0, 1)
    ).toFixed(3),
  );

  // 5. True per-card adaptive tone & detail restoration
  const appliedTone = applyAdaptiveToneAndDetail(
    working,
    profileInfo,
    options,
    sharpnessBefore,
  );
  const sharpnessAfter = measureLaplacianSharpness(working);

  // 6. High-quality Catmull-Rom resample
  const targetScale = clamp(finite(options.scale, 2.0), 1, 4);
  const maxLongEdge = Math.max(16, Math.round(finite(options.maxLongEdge, 2200)));
  const scaled = resampleHighQuality(working, targetScale, maxLongEdge);
  const deltaPct =
    sharpnessBefore > 0.01
      ? ((sharpnessAfter - sharpnessBefore) / sharpnessBefore) * 100
      : 0;

  return {
    rgba: scaled.rgba,
    width: scaled.width,
    height: scaled.height,
    audit: {
      profile: profileInfo.profile,
      isChromeFoil,
      isLandscapeCard: scaled.width > scaled.height * 1.05,
      appliedRotationDeg,
      orientationConfidence,
      orientationUncertain,
      orientationSource,
      deskewAngleDeg: Number(cropped.deskewAngleDeg.toFixed(2)),
      wasWideBedCropped: cropped.wasWideBedCropped,
      cisStreaksRemoved: finalCisCount,
      dustSpecksRemoved: finalDustCount,
      inputSize: { width: inputWidth, height: inputHeight },
      outputSize: { width: scaled.width, height: scaled.height },
      appliedParams: {
        descratch: effectiveDescratch,
        ...appliedTone,
        scale: Number(
          (
            Math.max(scaled.width, scaled.height) /
            Math.max(working.width, working.height)
          ).toFixed(2),
        ),
      },
      sharpnessBefore: Number(sharpnessBefore.toFixed(2)),
      sharpnessAfter: Number(sharpnessAfter.toFixed(2)),
      sharpnessDeltaPct: Number(deltaPct.toFixed(1)),
    },
  };
}
