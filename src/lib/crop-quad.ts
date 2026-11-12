import { orderCorners, warpPerspective, type Point, type Quad } from "./geometry";

/** Standard trading-card aspect (short:long) and its landscape inverse. */
export const PORTRAIT_ASPECT = 2.5 / 3.5;
export const LANDSCAPE_ASPECT = 3.5 / 2.5;

/** Relative tolerance around the standard 2.5:3.5 family, including common variants. */
export const ASPECT_TOLERANCE = 0.22;

export const CROP_MARGIN = 0.025; // 2.5% outside all four physical corners

export function isValidCardAspect(width: number, height: number, tolerance = ASPECT_TOLERANCE): boolean {
  return scoreCardAspect(width, height, tolerance).ok;
}

export function scoreCardAspect(
  width: number,
  height: number,
  tolerance = ASPECT_TOLERANCE,
): { ok: boolean; mode: "portrait" | "landscape" | null; error: number; ratio: number } {
  const ratio = width / Math.max(1, height);
  const pErr = Math.abs(ratio - PORTRAIT_ASPECT) / PORTRAIT_ASPECT;
  const lErr = Math.abs(ratio - LANDSCAPE_ASPECT) / LANDSCAPE_ASPECT;
  if (pErr <= lErr && pErr <= tolerance) {
    return { ok: true, mode: "portrait", error: pErr, ratio };
  }
  if (lErr < pErr && lErr <= tolerance) {
    return { ok: true, mode: "landscape", error: lErr, ratio };
  }
  return { ok: false, mode: null, error: Math.min(pErr, lErr), ratio };
}

export function expandQuad(quad: Quad, margin = CROP_MARGIN): Quad {
  const cx = (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4;
  const cy = (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4;
  return orderCorners(
    quad.map((p) => ({
      x: cx + (p.x - cx) * (1 + margin * 2),
      y: cy + (p.y - cy) * (1 + margin * 2),
    })),
  );
}

function luma(data: Uint8ClampedArray, w: number, x: number, y: number) {
  const i = (y * w + x) * 4;
  return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
}

function downsampleLuma(src: ImageData, maxEdge = 280) {
  const scale = Math.min(1, maxEdge / Math.max(src.width, src.height));
  const sw = Math.max(24, Math.round(src.width * scale));
  const sh = Math.max(24, Math.round(src.height * scale));
  const gray = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    const sy = Math.min(src.height - 1, Math.floor(y / scale));
    for (let x = 0; x < sw; x++) {
      const sx = Math.min(src.width - 1, Math.floor(x / scale));
      gray[y * sw + x] = luma(src.data, src.width, sx, sy);
    }
  }
  return { gray, w: sw, h: sh, scale };
}

function median(values: number[]) {
  const a = values.slice().sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)] ?? 0;
}

function borderMedian(gray: Float32Array, w: number, h: number) {
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.04));
  const vals: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < band || y < band || x >= w - band || y >= h - band) {
        vals.push(gray[y * w + x]);
      }
    }
  }
  return median(vals);
}

type Blob = { minX: number; minY: number; maxX: number; maxY: number; area: number; pts: Point[] };

function foregroundBlobs(mask: Uint8Array, w: number, h: number, minArea: number): Blob[] {
  const seen = new Uint8Array(w * h);
  const blobs: Blob[] = [];
  const stack: number[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue;
    stack.length = 0;
    stack.push(i);
    seen[i] = 1;
    let minX = w, minY = h, maxX = 0, maxY = 0, area = 0;
    const pts: Point[] = [];
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w;
      const y = (p / w) | 0;
      area++;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      // Keep a sparse hull seed (border-ish pixels collected later via extremes).
      if (area % 7 === 0) pts.push({ x, y });
      const neigh = [p - 1, p + 1, p - w, p + w];
      for (const n of neigh) {
        if (n < 0 || n >= mask.length || seen[n] || !mask[n]) continue;
        const nx = n % w;
        // Prevent wrap on left/right
        if (Math.abs(nx - x) + Math.abs(((n / w) | 0) - y) !== 1) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    if (area >= minArea) {
      blobs.push({ minX, minY, maxX, maxY, area, pts });
    }
  }
  blobs.sort((a, b) => b.area - a.area);
  return blobs;
}

function extremesQuad(pts: Point[], minX: number, minY: number, maxX: number, maxY: number): Quad {
  if (!pts.length) {
    return orderCorners([
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ]);
  }
  const tl = nearest(pts, minX, minY);
  const tr = nearest(pts, maxX, minY);
  const br = nearest(pts, maxX, maxY);
  const bl = nearest(pts, minX, maxY);
  return orderCorners([tl, tr, br, bl]);
}

function nearest(pts: Point[], x: number, y: number): Point {
  let best = pts[0];
  let d = Infinity;
  for (const p of pts) {
    const v = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (v < d) {
      d = v;
      best = p;
    }
  }
  return best;
}

function minAreaRectQuad(pts: Point[]): Quad | null {
  if (pts.length < 8) return null;
  let mx = 0, my = 0;
  for (const p of pts) {
    mx += p.x;
    my += p.y;
  }
  mx /= pts.length;
  my /= pts.length;
  let cxx = 0, cxy = 0, cyy = 0;
  for (const p of pts) {
    const dx = p.x - mx;
    const dy = p.y - my;
    cxx += dx * dx;
    cxy += dx * dy;
    cyy += dy * dy;
  }
  const n = pts.length;
  cxx /= n;
  cxy /= n;
  cyy /= n;
  const trace = cxx + cyy;
  const det = cxx * cyy - cxy * cxy;
  const disc = Math.sqrt(Math.max(0, trace * trace / 4 - det));
  const l1 = trace / 2 + disc;
  let vx = cxy;
  let vy = l1 - cxx;
  const vlen = Math.hypot(vx, vy) || 1;
  vx /= vlen;
  vy /= vlen;
  const ux = -vy;
  const uy = vx;
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const p of pts) {
    const dx = p.x - mx;
    const dy = p.y - my;
    const u = dx * ux + dy * uy;
    const v = dx * vx + dy * vy;
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  return orderCorners([
    { x: mx + ux * minU + vx * minV, y: my + uy * minU + vy * minV },
    { x: mx + ux * maxU + vx * minV, y: my + uy * maxU + vy * minV },
    { x: mx + ux * maxU + vx * maxV, y: my + uy * maxU + vy * maxV },
    { x: mx + ux * minU + vx * maxV, y: my + uy * minU + vy * maxV },
  ]);
}

function quadSize(quad: Quad) {
  const [tl, tr, br, bl] = quad;
  const w = (Math.hypot(tr.x - tl.x, tr.y - tl.y) + Math.hypot(br.x - bl.x, br.y - bl.y)) / 2;
  const h = (Math.hypot(bl.x - tl.x, bl.y - tl.y) + Math.hypot(br.x - tr.x, br.y - tr.y)) / 2;
  return { w, h, area: w * h };
}

function collectEdgePts(gray: Float32Array, w: number, h: number, thresh: number): Point[] {
  const pts: Point[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = gray[i + 1] - gray[i - 1];
      const gy = gray[i + w] - gray[i - w];
      if (Math.hypot(gx, gy) > thresh) pts.push({ x, y });
    }
  }
  return pts;
}

export type OuterQuadResult = {
  quad: Quad;
  method: "outer_blob" | "min_area" | "edge_extremes" | "full_frame";
  confidence: number;
  margin: number;
  aspect: ReturnType<typeof scoreCardAspect>;
  fallback: boolean;
};

/**
 * Outermost 4-corner card boundary whose aspect is a valid trading-card
 * ratio. Inner nameplates / frames are rejected because they are smaller
 * and usually fail the outer-most + aspect constraint. When no valid
 * quad is found, fall back to the full frame (caller may still deskew).
 */
export function findOuterCardQuad(src: ImageData): OuterQuadResult {
  const { gray, w, h, scale } = downsampleLuma(src, 280);
  const bg = borderMedian(gray, w, h);
  // Foreground: pixels that differ from the scanner-bed / table border.
  const mask = new Uint8Array(w * h);
  const sep = 18;
  for (let i = 0; i < gray.length; i++) {
    mask[i] = Math.abs(gray[i] - bg) > sep ? 1 : 0;
  }
  // Close tiny holes so the card is one blob.
  const closed = new Uint8Array(mask);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (mask[y * w + x]) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) n += mask[(y + dy) * w + (x + dx)];
      }
      if (n >= 5) closed[y * w + x] = 1;
    }
  }

  const minArea = w * h * 0.08;
  const blobs = foregroundBlobs(closed, w, h, minArea);
  const candidates: { quad: Quad; method: OuterQuadResult["method"]; score: number; aspect: ReturnType<typeof scoreCardAspect> }[] = [];

  const consider = (quad: Quad | null, method: OuterQuadResult["method"], areaHint: number) => {
    if (!quad) return;
    const { w: qw, h: qh, area } = quadSize(quad);
    if (qw < 12 || qh < 12) return;
    const aspect = scoreCardAspect(qw, qh);
    if (!aspect.ok) return;
    // Prefer larger (outer) quads, slightly prefer tighter aspect.
    const score = area / (w * h) + 0.15 * (1 - aspect.error) + 0.05 * Math.min(1, areaHint / (w * h));
    candidates.push({ quad, method, score, aspect });
  };

  for (const blob of blobs.slice(0, 6)) {
    const boxW = blob.maxX - blob.minX + 1;
    const boxH = blob.maxY - blob.minY + 1;
    // Axis box (good when the card is already upright).
    consider(
      orderCorners([
        { x: blob.minX, y: blob.minY },
        { x: blob.maxX, y: blob.minY },
        { x: blob.maxX, y: blob.maxY },
        { x: blob.minX, y: blob.maxY },
      ]),
      "outer_blob",
      blob.area,
    );
    const hullPts = edgePtsInBox(gray, w, h, blob, 16);
    consider(extremesQuad(hullPts.length ? hullPts : blob.pts, blob.minX, blob.minY, blob.maxX, blob.maxY), "edge_extremes", blob.area);
    consider(minAreaRectQuad(hullPts.length >= 8 ? hullPts : blob.pts.concat(hullPts)), "min_area", blob.area);
    // Also try slightly inset boxes — only as lower-score options, never preferred over outer.
    void boxW;
    void boxH;
  }

  // Global edge extremes / min-area as a last geometric try.
  const allEdges = collectEdgePts(gray, w, h, 20);
  if (allEdges.length >= 20) {
    let minX = w, minY = h, maxX = 0, maxY = 0;
    for (const p of allEdges) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    consider(extremesQuad(allEdges, minX, minY, maxX, maxY), "edge_extremes", (maxX - minX) * (maxY - minY));
    consider(minAreaRectQuad(allEdges), "min_area", (maxX - minX) * (maxY - minY));
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (best) {
    const scaled = orderCorners(best.quad.map((p) => ({ x: p.x / scale, y: p.y / scale }))) as Quad;
    return {
      quad: scaled,
      method: best.method,
      confidence: Math.min(0.95, 0.55 + best.score),
      margin: CROP_MARGIN,
      aspect: best.aspect,
      fallback: false,
    };
  }

  const full: Quad = [
    { x: 0, y: 0 },
    { x: src.width - 1, y: 0 },
    { x: src.width - 1, y: src.height - 1 },
    { x: 0, y: src.height - 1 },
  ];
  return {
    quad: full,
    method: "full_frame",
    confidence: 0.25,
    margin: 0,
    aspect: scoreCardAspect(src.width, src.height),
    fallback: true,
  };
}

function edgePtsInBox(
  gray: Float32Array,
  w: number,
  h: number,
  blob: Blob,
  thresh: number,
): Point[] {
  const pts: Point[] = [];
  const x0 = Math.max(1, blob.minX);
  const y0 = Math.max(1, blob.minY);
  const x1 = Math.min(w - 2, blob.maxX);
  const y1 = Math.min(h - 2, blob.maxY);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * w + x;
      const gx = gray[i + 1] - gray[i - 1];
      const gy = gray[i + w] - gray[i - w];
      if (Math.hypot(gx, gy) > thresh) pts.push({ x, y });
    }
  }
  return pts;
}

function borderFillColor(src: ImageData): [number, number, number] {
  const { data, width: w, height: h } = src;
  const band = Math.max(1, Math.round(Math.min(w, h) * 0.02));
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= band && y >= band && x < w - band && y < h - band) continue;
      const i = (y * w + x) * 4;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n++;
    }
  }
  const d = Math.max(1, n);
  return [Math.round(r / d), Math.round(g / d), Math.round(b / d)];
}

function padImage(src: ImageData, left: number, top: number, right: number, bottom: number): ImageData {
  const nw = src.width + left + right;
  const nh = src.height + top + bottom;
  const out = new ImageData(nw, nh);
  const [fr, fg, fb] = borderFillColor(src);
  for (let i = 0; i < nw * nh; i++) {
    const p = i * 4;
    out.data[p] = fr;
    out.data[p + 1] = fg;
    out.data[p + 2] = fb;
    out.data[p + 3] = 255;
  }
  for (let y = 0; y < src.height; y++) {
    const si = (y * src.width) * 4;
    const di = ((y + top) * nw + left) * 4;
    out.data.set(src.data.subarray(si, si + src.width * 4), di);
  }
  return out;
}

export function deskewWithMargin(
  src: ImageData,
  found: OuterQuadResult,
  margin = CROP_MARGIN,
): { image: ImageData; quad: Quad; margin: number; outputWidth: number; outputHeight: number } {
  const physical = found.quad;
  const appliedMargin = found.fallback ? 0 : margin;
  const padded = found.fallback ? physical : expandQuad(physical, appliedMargin);
  let work = src;
  let quad: Quad = padded;
  const xs = padded.map((p) => p.x);
  const ys = padded.map((p) => p.y);
  const padL = Math.max(0, Math.ceil(-Math.min(...xs)));
  const padT = Math.max(0, Math.ceil(-Math.min(...ys)));
  const padR = Math.max(0, Math.ceil(Math.max(...xs) - (src.width - 1)));
  const padB = Math.max(0, Math.ceil(Math.max(...ys) - (src.height - 1)));
  if (padL || padT || padR || padB) {
    work = padImage(src, padL, padT, padR, padB);
    quad = orderCorners(padded.map((p) => ({ x: p.x + padL, y: p.y + padT })));
  }
  const { w: pw, h: ph } = quadSize(quad);
  const aspect = scoreCardAspect(pw, ph);
  let outW: number;
  let outH: number;
  if (aspect.mode === "landscape" || (!aspect.ok && pw >= ph)) {
    const target = LANDSCAPE_ASPECT;
    outW = Math.max(32, Math.round(pw));
    outH = Math.max(32, Math.round(outW / target));
  } else {
    const target = PORTRAIT_ASPECT;
    outH = Math.max(32, Math.round(ph));
    outW = Math.max(32, Math.round(outH * target));
  }
  const warped = warpPerspective(work, quad, outW, outH);
  return {
    image: warped ?? src,
    quad: padded,
    margin: appliedMargin,
    outputWidth: warped ? outW : src.width,
    outputHeight: warped ? outH : src.height,
  };
}
