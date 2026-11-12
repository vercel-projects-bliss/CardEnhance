/**
 * Card locator. YOLO26n (NMS-free) runs on table shots; contour bbox is the
 * fallback. Full-bleed scanner dumps are left alone.
 */

import type { CropEngine } from "./types";
import { yoloCropCard } from "./yolo";

export type { CropEngine };

export type CropResult = {
  image: ImageData;
  cropped: boolean;
  engine: CropEngine;
};

export function rotate180(src: ImageData): ImageData {
  const { width: w, height: h, data } = src;
  const out = new ImageData(w, h);
  const n = data.length;
  for (let i = 0; i < n; i += 4) {
    const j = n - 4 - i;
    out.data[i] = data[j];
    out.data[i + 1] = data[j + 1];
    out.data[i + 2] = data[j + 2];
    out.data[i + 3] = data[j + 3];
  }
  return out;
}

function looksFullBleed(src: ImageData): boolean {
  const { width: W, height: H, data } = src;
  const target = 160;
  const scale = Math.min(1, target / Math.max(W, H));
  const sw = Math.max(12, Math.round(W * scale));
  const sh = Math.max(12, Math.round(H * scale));
  const luma = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    const sy = Math.min(H - 1, Math.floor(y / scale));
    for (let x = 0; x < sw; x++) {
      const sx = Math.min(W - 1, Math.floor(x / scale));
      const i = (sy * W + sx) * 4;
      luma[y * sw + x] = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    }
  }
  const bw = Math.max(2, Math.round(Math.min(sw, sh) * 0.06));
  let bsum = 0;
  let bsum2 = 0;
  let bcount = 0;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      if (y >= bw && y < sh - bw && x >= bw && x < sw - bw) continue;
      const v = luma[y * sw + x];
      bsum += v;
      bsum2 += v * v;
      bcount++;
    }
  }
  if (!bcount) return true;
  const bmean = bsum / bcount;
  const bstd = Math.sqrt(Math.max(0, bsum2 / bcount - bmean * bmean));
  const thresh = Math.max(16, bstd * 1.55 + 10);
  let borderFg = 0;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      if (y >= bw && y < sh - bw && x >= bw && x < sw - bw) continue;
      if (Math.abs(luma[y * sw + x] - bmean) > thresh) borderFg++;
    }
  }
  return borderFg / bcount > 0.45;
}

export function contourCropCard(src: ImageData): CropResult {
  const { width: W, height: H, data } = src;
  if (W < 64 || H < 64) return { image: src, cropped: false, engine: null };

  const target = 200;
  const scale = Math.min(1, target / Math.max(W, H));
  const sw = Math.max(12, Math.round(W * scale));
  const sh = Math.max(12, Math.round(H * scale));
  const luma = new Float32Array(sw * sh);

  for (let y = 0; y < sh; y++) {
    const sy = Math.min(H - 1, Math.floor(y / scale));
    for (let x = 0; x < sw; x++) {
      const sx = Math.min(W - 1, Math.floor(x / scale));
      const i = (sy * W + sx) * 4;
      luma[y * sw + x] = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    }
  }

  const bw = Math.max(2, Math.round(Math.min(sw, sh) * 0.06));
  let bsum = 0;
  let bsum2 = 0;
  let bcount = 0;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      if (y >= bw && y < sh - bw && x >= bw && x < sw - bw) continue;
      const v = luma[y * sw + x];
      bsum += v;
      bsum2 += v * v;
      bcount++;
    }
  }
  if (!bcount) return { image: src, cropped: false, engine: null };

  const bmean = bsum / bcount;
  const bstd = Math.sqrt(Math.max(0, bsum2 / bcount - bmean * bmean));
  const thresh = Math.max(16, bstd * 1.55 + 10);

  const fg = new Uint8Array(sw * sh);
  let borderFg = 0;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const hit = Math.abs(luma[y * sw + x] - bmean) > thresh ? 1 : 0;
      fg[y * sw + x] = hit;
      if (y < bw || y >= sh - bw || x < bw || x >= sw - bw) borderFg += hit;
    }
  }

  if (borderFg / bcount > 0.45) return { image: src, cropped: false, engine: null };

  let minX = sw;
  let minY = sh;
  let maxX = 0;
  let maxY = 0;
  let fgCount = 0;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      if (!fg[y * sw + x]) continue;
      fgCount++;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  const boxW = maxX - minX + 1;
  const boxH = maxY - minY + 1;
  const area = (boxW * boxH) / (sw * sh);
  const fill = fgCount / (sw * sh);
  if (fgCount < 80 || area < 0.12 || area > 0.92 || fill < 0.08) {
    return { image: src, cropped: false, engine: null };
  }

  const padX = Math.round(boxW * 0.03);
  const padY = Math.round(boxH * 0.03);
  minX = Math.max(0, minX - padX);
  minY = Math.max(0, minY - padY);
  maxX = Math.min(sw - 1, maxX + padX);
  maxY = Math.min(sh - 1, maxY + padY);

  const x0 = Math.floor(minX / scale);
  const y0 = Math.floor(minY / scale);
  const x1 = Math.min(W, Math.ceil((maxX + 1) / scale));
  const y1 = Math.min(H, Math.ceil((maxY + 1) / scale));
  const cw = x1 - x0;
  const ch = y1 - y0;
  if (cw < 48 || ch < 48 || cw * ch > W * H * 0.96) {
    return { image: src, cropped: false, engine: null };
  }

  const out = new ImageData(cw, ch);
  for (let y = 0; y < ch; y++) {
    const srcOff = ((y0 + y) * W + x0) * 4;
    out.data.set(data.subarray(srcOff, srcOff + cw * 4), y * cw * 4);
  }
  return { image: out, cropped: true, engine: "contour" };
}

export async function autoCropCard(src: ImageData): Promise<CropResult> {
  if (src.width < 64 || src.height < 64) {
    return { image: src, cropped: false, engine: null };
  }
  const aspect = src.width / src.height;
  // 2.5×3.5 card ratio ≈ 0.71 / 1.40. Skip YOLO on scans that are already a card
  // so the nameplate is not cropped as a "tv" / "book" inset.
  const alreadyCard =
    (aspect >= 0.60 && aspect <= 0.82) || (aspect >= 1.22 && aspect <= 1.67);
  if (looksFullBleed(src)) {
    return { image: src, cropped: false, engine: null };
  }
  if (alreadyCard) {
    return contourCropCard(src);
  }
  const yolo = await yoloCropCard(src);
  if (yolo.cropped) {
    return { image: yolo.image, cropped: true, engine: yolo.engine ?? "yolo26" };
  }
  return contourCropCard(src);
}
