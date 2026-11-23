import { detectCardBoxes, type YoloBox } from "./yolo";
import { recoverQuad, warpPerspective, type Quad, type GeometryMethod } from "./geometry";
import { cropRect } from "./image-ops";
import { contourCropCard } from "./detect";

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
    const aspect = boxW / Math.max(1, boxH);
    const portrait = aspect >= 0.5 && aspect <= 0.9;
    if (n < 40 || area < 0.02 || area > 0.7 || !portrait) continue;
    boxes.push({
      x: minX / scale,
      y: minY / scale,
      w: boxW / scale,
      h: boxH / scale,
    });
  }
  return boxes;
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
  const aspect = source.width / source.height;
  const already =
    (aspect >= 0.58 && aspect <= 0.85) || (aspect >= 1.18 && aspect <= 1.72);
  if (already && boxes.length > 1) {
    boxes = [...boxes].sort((a, b) => b.w * b.h - a.w * a.h).slice(0, 1);
  }
  if (boxes.length < 2 && !already) {
    const blobs = contourBlobs(source);
    if (blobs.length > boxes.length) {
      boxes = blobs.map((b) => ({ ...b, score: 0.55, method: "contour" as const }));
    }
  }
  if (boxes.length === 0) {
    if (already) {
      boxes = [
        {
          x: 0,
          y: 0,
          w: source.width,
          h: source.height,
          score: 0.7,
          method: "fullframe",
        },
      ];
    } else {
      const crop = contourCropCard(source);
      boxes = [
        {
          x: 0,
          y: 0,
          w: crop.image.width === source.width ? source.width : source.width,
          h: source.height,
          score: crop.cropped ? 0.5 : 0.4,
          method: crop.cropped ? "contour" : "fullframe",
        },
      ];
    }
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
  const { box, polygon } = detection;
  const avgW = (Math.hypot(polygon[1].x - polygon[0].x, polygon[1].y - polygon[0].y) +
    Math.hypot(polygon[2].x - polygon[3].x, polygon[2].y - polygon[3].y)) / 2;
  const avgH = (Math.hypot(polygon[3].x - polygon[0].x, polygon[3].y - polygon[0].y) +
    Math.hypot(polygon[2].x - polygon[1].x, polygon[2].y - polygon[1].y)) / 2;
  let dw = Math.round(avgW);
  let dh = Math.round(avgH);
  const aspect = dw / Math.max(1, dh);
  if (aspect > 0.55 && aspect < 0.9) {
    dh = Math.round(dw / 0.714);
  }
  dw = Math.max(80, Math.min(1800, dw));
  dh = Math.max(110, Math.min(2500, dh));
  const warped = warpPerspective(source, polygon, dw, dh);
  if (warped) return warped;
  return cropRect(source, box.x, box.y, box.x + box.w, box.y + box.h);
}
