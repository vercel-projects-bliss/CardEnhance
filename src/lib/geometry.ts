import { cropRect } from "./image-ops";

export type Point = { x: number; y: number };

export type Quad = [Point, Point, Point, Point];

export function orderCorners(pts: Point[]): Quad {
  const sorted = [...pts].sort((a, b) => a.y - b.y || a.x - b.x);
  const top = sorted.slice(0, 2).sort((a, b) => a.x - b.x);
  const bottom = sorted.slice(-2).sort((a, b) => a.x - b.x);
  return [top[0], top[1], bottom[1], bottom[0]];
}

function solve8(A: number[][], b: number[]): number[] | null {
  const n = 8;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-8) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const div = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row[n]);
}

export function getPerspectiveTransform(src: Quad, dst: Quad): number[] | null {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const u = dst[i].x;
    const v = dst[i].y;
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
    b.push(v);
  }
  const h = solve8(A, b);
  if (!h) return null;
  return [...h, 1];
}

function invert3(H: number[]): number[] | null {
  const [a, b, c, d, e, f, g, h, i] = H;
  const A = e * i - f * h;
  const B = f * g - d * i;
  const C = d * h - e * g;
  const D = c * h - b * i;
  const E = a * i - c * g;
  const F = b * g - a * h;
  const G = b * f - c * e;
  const Hh = c * d - a * f;
  const I = a * e - b * d;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-10) return null;
  const s = 1 / det;
  return [A * s, D * s, G * s, B * s, E * s, Hh * s, C * s, F * s, I * s];
}

export function warpPerspective(src: ImageData, quad: Quad, dw: number, dh: number): ImageData | null {
  const dst: Quad = [
    { x: 0, y: 0 },
    { x: dw - 1, y: 0 },
    { x: dw - 1, y: dh - 1 },
    { x: 0, y: dh - 1 },
  ];
  const H = getPerspectiveTransform(quad, dst);
  if (!H) return null;
  const inv = invert3(H);
  if (!inv) return null;
  const out = new ImageData(dw, dh);
  const sw = src.width;
  const sh = src.height;
  const s = src.data;
  const o = out.data;
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const X = inv[0] * x + inv[1] * y + inv[2];
      const Y = inv[3] * x + inv[4] * y + inv[5];
      const W = inv[6] * x + inv[7] * y + inv[8];
      const sx = X / W;
      const sy = Y / W;
      if (sx < 0 || sy < 0 || sx >= sw - 1 || sy >= sh - 1) continue;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = i00 + 4;
      const i01 = ((y0 + 1) * sw + x0) * 4;
      const i11 = i01 + 4;
      const di = (y * dw + x) * 4;
      for (let c = 0; c < 3; c++) {
        const v =
          s[i00 + c] * (1 - fx) * (1 - fy) +
          s[i10 + c] * fx * (1 - fy) +
          s[i01 + c] * (1 - fx) * fy +
          s[i11 + c] * fx * fy;
        o[di + c] = v;
      }
      o[di + 3] = 255;
    }
  }
  return out;
}

export type GeometryMethod = "quad" | "minAreaRect" | "axis_box";

/**
 * Full-bleed scans: edge detection lands a few % INSIDE the true card edge,
 * which clips logos/nameplates at the frame. When a detected corner sits within
 * `thresh` (normalized) of a frame corner, the card reaches the frame there —
 * reclaim it. If 3 corners snap to 3 distinct frame corners, the scan is
 * full-bleed and the 4th corner is the 4th frame corner.
 */
export function snapQuadToFrame(quad: Quad, W: number, H: number, thresh = 0.07): Quad {
  const corners: Point[] = [
    { x: 0, y: 0 },
    { x: W, y: 0 },
    { x: W, y: H },
    { x: 0, y: H },
  ];
  const out = quad.map((p) => ({ ...p })) as Quad;
  const snapped = [false, false, false, false];
  for (let i = 0; i < 4; i++) {
    let best = corners[0];
    let bd = Infinity;
    for (const c of corners) {
      const d = ((out[i].x - c.x) / W) ** 2 + ((out[i].y - c.y) / H) ** 2;
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    if (Math.sqrt(bd) <= thresh) {
      out[i] = { ...best };
      snapped[i] = true;
    }
  }
  if (snapped.filter(Boolean).length === 3) {
    const used = new Set(out.filter((_, i) => snapped[i]).map((p) => `${p.x},${p.y}`));
    if (used.size === 3) {
      const missing = corners.filter((c) => !used.has(`${c.x},${c.y}`));
      const idx = snapped.indexOf(false);
      if (missing.length) out[idx] = { ...missing[0] };
    }
  }
  return out;
}

export function recoverQuad(
  src: ImageData,
  box: { x: number; y: number; w: number; h: number },
): { quad: Quad; method: GeometryMethod; confidence: number } {
  const padX = box.w * 0.06;
  const padY = box.h * 0.06;
  const x0 = Math.max(0, box.x - padX);
  const y0 = Math.max(0, box.y - padY);
  const x1 = Math.min(src.width, box.x + box.w + padX);
  const y1 = Math.min(src.height, box.y + box.h + padY);
  const region = cropRect(src, x0, y0, x1, y1);
  const found = findQuad(region);
  if (found) {
    const quad = snapQuadToFrame(found.map((p) => ({ x: p.x + x0, y: p.y + y0 })) as Quad, src.width, src.height);
    const geom = validateQuad(quad, src.width, src.height);
    if (geom.ok) return { quad, method: "quad", confidence: geom.confidence };
  }
  const obb = minAreaRect(region);
  if (obb) {
    const quad = snapQuadToFrame(obb.map((p) => ({ x: p.x + x0, y: p.y + y0 })) as Quad, src.width, src.height);
    const geom = validateQuad(quad, src.width, src.height);
    if (geom.ok) return { quad, method: "minAreaRect", confidence: Math.min(0.62, geom.confidence) };
  }
  return {
    quad: [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ],
    method: "axis_box",
    confidence: 0.35,
  };
}

export function estimateQuadFromBox(
  src: ImageData,
  box: { x: number; y: number; w: number; h: number },
): Quad {
  return recoverQuad(src, box).quad;
}

function findQuad(src: ImageData): Quad | null {
  const W = src.width;
  const H = src.height;
  const target = 140;
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
  const gx = new Float32Array(sw * sh);
  const gy = new Float32Array(sw * sh);
  for (let y = 1; y < sh - 1; y++) {
    for (let x = 1; x < sw - 1; x++) {
      const i = y * sw + x;
      gx[i] = luma[i + 1] - luma[i - 1];
      gy[i] = luma[i + sw] - luma[i - sw];
    }
  }
  const magT = 28;
  const pts: Point[] = [];
  for (let y = 1; y < sh - 1; y++) {
    for (let x = 1; x < sw - 1; x++) {
      const i = y * sw + x;
      if (Math.hypot(gx[i], gy[i]) > magT) pts.push({ x, y });
    }
  }
  if (pts.length < 20) return null;
  let minX = sw, minY = sh, maxX = 0, maxY = 0;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const tl = nearest(pts, minX, minY);
  const tr = nearest(pts, maxX, minY);
  const br = nearest(pts, maxX, maxY);
  const bl = nearest(pts, minX, maxY);
  const quad = orderCorners([tl, tr, br, bl]);
  const area = Math.abs(quad[2].x - quad[0].x) * Math.abs(quad[2].y - quad[0].y);
  if (area < sw * sh * 0.2) return null;
  return quad.map((p) => ({ x: p.x / scale, y: p.y / scale })) as Quad;
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

function minAreaRect(src: ImageData): Quad | null {
  const W = src.width;
  const H = src.height;
  const target = 120;
  const scale = Math.min(1, target / Math.max(W, H));
  const sw = Math.max(8, Math.round(W * scale));
  const sh = Math.max(8, Math.round(H * scale));
  const pts: Point[] = [];
  for (let y = 1; y < sh - 1; y++) {
    const sy = Math.min(H - 1, Math.floor(y / scale));
    for (let x = 1; x < sw - 1; x++) {
      const sx = Math.min(W - 1, Math.floor(x / scale));
      const i = (sy * W + sx) * 4;
      const L = 0.2126 * src.data[i] + 0.7152 * src.data[i + 1] + 0.0722 * src.data[i + 2];
      const i2 = (sy * W + Math.min(W - 1, sx + 1)) * 4;
      const i3 = (Math.min(H - 1, sy + 1) * W + sx) * 4;
      const Lx = 0.2126 * src.data[i2] + 0.7152 * src.data[i2 + 1] + 0.0722 * src.data[i2 + 2];
      const Ly = 0.2126 * src.data[i3] + 0.7152 * src.data[i3 + 1] + 0.0722 * src.data[i3 + 2];
      if (Math.hypot(Lx - L, Ly - L) > 18) pts.push({ x, y });
    }
  }
  if (pts.length < 16) return null;
  let mx = 0;
  let my = 0;
  for (const p of pts) {
    mx += p.x;
    my += p.y;
  }
  mx /= pts.length;
  my /= pts.length;
  let cxx = 0;
  let cxy = 0;
  let cyy = 0;
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
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
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
  const corners = [
    { x: mx + ux * minU + vx * minV, y: my + uy * minU + vy * minV },
    { x: mx + ux * maxU + vx * minV, y: my + uy * maxU + vy * minV },
    { x: mx + ux * maxU + vx * maxV, y: my + uy * maxU + vy * maxV },
    { x: mx + ux * minU + vx * maxV, y: my + uy * minU + vy * maxV },
  ].map((p) => ({ x: p.x / scale, y: p.y / scale }));
  return orderCorners(corners);
}

export function validateQuad(quad: Quad, W: number, H: number): { ok: boolean; confidence: number } {
  const [tl, tr, br, bl] = quad;
  const top = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const bottom = Math.hypot(br.x - bl.x, br.y - bl.y);
  const left = Math.hypot(bl.x - tl.x, bl.y - tl.y);
  const right = Math.hypot(br.x - tr.x, br.y - tr.y);
  if (top < 16 || bottom < 16 || left < 16 || right < 16) return { ok: false, confidence: 0 };
  const ratio = ((top + bottom) / 2) / Math.max(1, (left + right) / 2);
  const portrait = ratio >= 0.5 && ratio <= 0.95;
  const landscape = ratio >= 1.05 && ratio <= 2.1;
  if (!portrait && !landscape) return { ok: false, confidence: 0.2 };
  const inside = quad.every((p) => p.x >= -8 && p.y >= -8 && p.x <= W + 8 && p.y <= H + 8);
  return { ok: inside, confidence: inside ? 0.82 : 0.4 };
}
