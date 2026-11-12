import { detectCardBoxes, type YoloBox } from "./yolo";
import { recoverQuad, type Quad, type GeometryMethod } from "./geometry";
import { cropRect } from "./image-ops";
import { deskewWithMargin, findOuterCardQuad, isValidCardAspect } from "./crop-quad";

export type CardDetection = {
  cardIndex: number;
  confidence: number;
  box: { x: number; y: number; w: number; h: number };
  polygon: Quad;
  centroid: { x: number; y: number };
  detectorMethod: "yolo26" | "yolo" | "card" | "contour" | "fullframe";
  warnings: string[];
  geometryConfidence: number;
  geometryMethod: GeometryMethod;
};

function sortReadingOrder<T extends { x: number; y: number; h: number }>(items: T[]): T[] {
  const rowH = items.reduce((s, i) => s + i.h, 0) / Math.max(1, items.length);
  const rowTol = Math.max(24, rowH * 0.45);
  return [...items].sort((a, b) => {
    if (Math.abs(a.y - b.y) > rowTol) return a.y - b.y;
    return a.x - b.x;
  });
}

function contourBlobs(src: ImageData): Array<{ x: number; y: number; w: number; h: number }> {
  const W = src.width;
  const H = src.height;
  const target = 220;
  const scale = Math.min(1, target / Math.max(W, H));
  const sw = Math.max(12, Math.round(W * scale));
  const sh = Math.max(12, Math.round(H * scale));
  const luma = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    const sy = Math.min(H - 1, Math.floor(y / scale));
    for (let x = 0; x < sw; x++) {
      const sx = Math.min(W - 1, Math.floor(x / scale));
      const i = (sy * W + sx) * 4;
      luma[y * sw + x] = 0.2126 * src.data[i] + 0.7152 * src.data[i + 1] + 0.0722 * src.data[i + 2];
    }
  }
  let bsum = 0;
  let bcount = 0;
  const bw = Math.max(2, Math.round(Math.min(sw, sh) * 0.05));
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      if (y >= bw && y < sh - bw && x >= bw && x < sw - bw) continue;
      bsum += luma[y * sw + x];
      bcount++;
    }
  }
  const bmean = bsum / Math.max(1, bcount);
  const fg = new Uint8Array(sw * sh);
  for (let i = 0; i < luma.length; i++) fg[i] = Math.abs(luma[i] - bmean) > 22 ? 1 : 0;
  const seen = new Uint8Array(sw * sh);
  const boxes: Array<{ x: number; y: number; w: number; h: number }> = [];
  for (let p = 0; p < fg.length; p++) {
    if (!fg[p] || seen[p]) continue;
    const stack = [p];
    seen[p] = 1;
    let minX = sw, minY = sh, maxX = 0, maxY = 0, n = 0;
    while (stack.length) {
      const c = stack.pop()!;
      n++;
      const x = c % sw;
      const y = (c / sw) | 0;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= sw || ny >= sh) continue;
          const ni = ny * sw + nx;
          if (!fg[ni] || seen[ni]) continue;
          seen[ni] = 1;
          stack.push(ni);
        }
      }
    }
    const boxW = maxX - minX + 1;
    const boxH = maxY - minY + 1;
    const area = (boxW * boxH) / (sw * sh);
    if (n < 40 || area < 0.02) continue;
    if (!isValidCardAspect(boxW, boxH)) continue;
    boxes.push({
      x: minX / scale,
      y: minY / scale,
      w: boxW / scale,
      h: boxH / scale,
    });
  }
  return boxes;
}


function nmsBoxes<T extends { x: number; y: number; w: number; h: number; score: number }>(
  boxes: T[],
  iouThresh = 0.55,
): T[] {
  const sorted = [...boxes].sort((a, b) => b.score - a.score);
  const kept: T[] = [];
  const iou = (a: T, b: T) => {
    const x0 = Math.max(a.x, b.x);
    const y0 = Math.max(a.y, b.y);
    const x1 = Math.min(a.x + a.w, b.x + b.w);
    const y1 = Math.min(a.y + a.h, b.y + b.h);
    const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
    const union = a.w * a.h + b.w * b.h - inter;
    return union > 0 ? inter / union : 0;
  };
  for (const box of sorted) {
    if (kept.some((k) => iou(k, box) > iouThresh)) continue;
    kept.push(box);
  }
  return kept;
}

export async function detectCards(source: ImageData): Promise<CardDetection[]> {
  const yolo = await detectCardBoxes(source);
  let boxes: Array<{ x: number; y: number; w: number; h: number; score: number; method: CardDetection["detectorMethod"] }> = yolo.boxes.map(
    (b: YoloBox) => ({
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h,
      score: b.score,
      method: (yolo.engine ?? "yolo") as CardDetection["detectorMethod"],
    }),
  );
  const blobs = contourBlobs(source).map((b) => ({
    ...b,
    score: 0.55,
    method: "contour" as const,
  }));
  // Merge YOLO + contour candidates, then decide sheet vs single card.
  // Never skip crop on a "already a card" area shortcut — even a 60–90%
  // fill still needs outer-quad deskew and a uniform margin.
  const merged = nmsBoxes([...boxes, ...blobs], 0.55);
  const area = source.width * source.height;
  const distinct = merged.filter((b) => {
    const frac = (b.w * b.h) / area;
    return frac >= 0.03 && frac <= 0.72 && isValidCardAspect(b.w, b.h);
  });
  if (distinct.length >= 2) {
    boxes = distinct;
  } else {
    // Single-card scan: use the full frame so the outer-quad crop can find
    // the true boundary. A tiny inner YOLO/nameplate box must not win.
    boxes = [
      {
        x: 0,
        y: 0,
        w: source.width,
        h: source.height,
        score: 0.7,
        method: "fullframe" as const,
      },
    ];
  }

  const ordered = sortReadingOrder(boxes);
  return ordered.map((box, index) => {
    const recovered = recoverQuad(source, box);
    return {
      cardIndex: index,
      confidence: box.score,
      box: { x: box.x, y: box.y, w: box.w, h: box.h },
      polygon: recovered.quad,
      centroid: { x: box.x + box.w / 2, y: box.y + box.h / 2 },
      detectorMethod: box.method,
      warnings: recovered.method === "axis_box" ? ["Geometry weak — axis crop used"] : recovered.method === "minAreaRect" ? ["minAreaRect fallback"] : [],
      geometryConfidence: recovered.confidence,
      geometryMethod: recovered.method,
    };
  });
}

export function rectifyCard(source: ImageData, detection: CardDetection): ImageData {
  const pad = Math.round(Math.min(detection.box.w, detection.box.h) * 0.06);
  const region = cropRect(
    source,
    detection.box.x - pad,
    detection.box.y - pad,
    detection.box.x + detection.box.w + pad,
    detection.box.y + detection.box.h + pad,
  );
  const found = findOuterCardQuad(region);
  return deskewWithMargin(region, found).image;
}
