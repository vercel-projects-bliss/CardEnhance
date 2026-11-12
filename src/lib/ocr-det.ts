/**
 * PP-OCRv5 mobile text detector (DBNet heatmap).
 * Finds line boxes so Tesseract can read each line at PSM 7.
 * Recognition stays with Tesseract + Grok vision — PP-OCR rec fails on foil type.
 */

import { createSession, getOrt, withTimeout, type OrtSession } from "./ort";

export type TextBox = { x: number; y: number; w: number; h: number; score: number };

const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];
const LIMIT = 736;
const STRIDE = 32;
const THRESH = 0.3;
const DILATE_X = 9;

let sessionReady: Promise<OrtSession | null> | null = null;
let detDisabled = false;

async function getSession() {
  if (detDisabled) return null;
  if (!sessionReady) {
    sessionReady = (async () => {
      try {
        return await createSession(`${window.location.origin}/ocr/ppocrv5_det.onnx`, 20000);
      } catch {
        detDisabled = true;
        return null;
      }
    })();
  }
  return sessionReady;
}

function resizeDet(src: ImageData): { tensor: Float32Array; dw: number; dh: number } {
  const { width: W, height: H } = src;
  const scale = Math.min(1, LIMIT / Math.max(W, H));
  let dw = Math.max(STRIDE, Math.round(W * scale));
  let dh = Math.max(STRIDE, Math.round(H * scale));
  dw = Math.max(STRIDE, Math.ceil(dw / STRIDE) * STRIDE);
  dh = Math.max(STRIDE, Math.ceil(dh / STRIDE) * STRIDE);
  const canvas = document.createElement("canvas");
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  const tmp = document.createElement("canvas");
  tmp.width = W;
  tmp.height = H;
  const tctx = tmp.getContext("2d");
  if (!tctx) throw new Error("Canvas unavailable");
  tctx.putImageData(src, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(tmp, 0, 0, dw, dh);
  const pix = ctx.getImageData(0, 0, dw, dh).data;
  const tensor = new Float32Array(3 * dw * dh);
  const plane = dw * dh;
  for (let i = 0; i < plane; i++) {
    tensor[i] = (pix[i * 4] / 255 - MEAN[0]) / STD[0];
    tensor[plane + i] = (pix[i * 4 + 1] / 255 - MEAN[1]) / STD[1];
    tensor[2 * plane + i] = (pix[i * 4 + 2] / 255 - MEAN[2]) / STD[2];
  }
  return { tensor, dw, dh };
}

function find(parent: Int32Array, a: number) {
  while (parent[a] !== a) {
    parent[a] = parent[parent[a]];
    a = parent[a];
  }
  return a;
}

function boxesFromHeatmap(pred: Float32Array, dw: number, dh: number, srcW: number, srcH: number): TextBox[] {
  const n = dw * dh;
  const mask = new Uint8Array(n);
  const half = Math.floor(DILATE_X / 2);
  for (let y = 0; y < dh; y++) {
    const row = y * dw;
    for (let x = 0; x < dw; x++) {
      let hit = 0;
      const x0 = Math.max(0, x - half);
      const x1 = Math.min(dw - 1, x + half);
      for (let k = x0; k <= x1; k++) {
        if (pred[row + k] > THRESH) {
          hit = 1;
          break;
        }
      }
      mask[row + x] = hit;
    }
  }

  const labels = new Int32Array(n);
  const parent = new Int32Array(n + 1);
  let lid = 0;
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const i = y * dw + x;
      if (!mask[i]) continue;
      const left = x ? labels[i - 1] : 0;
      const up = y ? labels[i - dw] : 0;
      if (left && up) {
        labels[i] = left;
        const ra = find(parent, left);
        const rb = find(parent, up);
        if (ra !== rb) parent[rb] = ra;
      } else if (left) {
        labels[i] = left;
      } else if (up) {
        labels[i] = up;
      } else {
        lid += 1;
        parent[lid] = lid;
        labels[i] = lid;
      }
    }
  }

  const stats = new Map<number, { x0: number; y0: number; x1: number; y1: number; s: number; c: number }>();
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const lab = labels[y * dw + x];
      if (!lab) continue;
      const r = find(parent, lab);
      let g = stats.get(r);
      if (!g) {
        g = { x0: x, y0: y, x1: x, y1: y, s: pred[y * dw + x], c: 1 };
        stats.set(r, g);
      } else {
        if (x < g.x0) g.x0 = x;
        if (y < g.y0) g.y0 = y;
        if (x > g.x1) g.x1 = x;
        if (y > g.y1) g.y1 = y;
        g.s += pred[y * dw + x];
        g.c += 1;
      }
    }
  }

  const sx = srcW / dw;
  const sy = srcH / dh;
  const boxes: TextBox[] = [];
  for (const g of stats.values()) {
    if (g.c < 24) continue;
    const score = g.s / g.c;
    if (score < 0.38) continue;
    const bw = g.x1 - g.x0 + 1;
    const bh = g.y1 - g.y0 + 1;
    if (bw * bh < 40) continue;
    const cx = (g.x0 + g.x1) / 2;
    const cy = (g.y0 + g.y1) / 2;
    const w = bw * 1.7;
    const h = bh * 1.4;
    const x = Math.max(0, (cx - w / 2) * sx);
    const y = Math.max(0, (cy - h / 2) * sy);
    boxes.push({
      x,
      y,
      w: Math.min(srcW - x, w * sx),
      h: Math.min(srcH - y, h * sy),
      score,
    });
  }
  boxes.sort((a, b) => a.y - b.y || a.x - b.x);
  return boxes.slice(0, 14);
}

export function cropTextBox(src: ImageData, box: TextBox): ImageData {
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(src.width, Math.ceil(box.x + box.w));
  const y1 = Math.min(src.height, Math.ceil(box.y + box.h));
  const cw = x1 - x0;
  const ch = y1 - y0;
  if (cw < 8 || ch < 8) return src;
  const out = new ImageData(cw, ch);
  for (let y = 0; y < ch; y++) {
    const srcOff = ((y0 + y) * src.width + x0) * 4;
    out.data.set(src.data.subarray(srcOff, srcOff + cw * 4), y * cw * 4);
  }
  return out;
}

export async function detectTextBoxes(src: ImageData): Promise<TextBox[]> {
  if (typeof window === "undefined" || detDisabled) return [];
  if (src.width < 64 || src.height < 64) return [];
  try {
    const session = await getSession();
    if (!session) return [];
    const { tensor, dw, dh } = resizeDet(src);
    const ort = await getOrt();
    const input = new ort.Tensor("float32", tensor, [1, 3, dh, dw]);
    const feeds: Record<string, unknown> = {};
    feeds[session.inputNames[0] ?? "x"] = input;
    const result = await withTimeout(session.run(feeds), 6000, "OCR det timed out");
    const outName = session.outputNames[0] ?? Object.keys(result)[0];
    const output = outName ? result[outName] : undefined;
    if (!output) return [];
    const data = output.data as Float32Array;
    const dims = output.dims;
    let oh = dh;
    let ow = dw;
    if (dims.length === 4) {
      oh = dims[2] ?? dh;
      ow = dims[3] ?? dw;
    } else if (dims.length === 3) {
      oh = dims[1] ?? dh;
      ow = dims[2] ?? dw;
    } else if (dims.length === 2) {
      oh = dims[0] ?? dh;
      ow = dims[1] ?? dw;
    }
    return boxesFromHeatmap(data, ow, oh, src.width, src.height);
  } catch {
    detDisabled = true;
    return [];
  }
}
