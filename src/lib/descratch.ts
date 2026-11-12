import { clamp, luma } from "./image-ops";

export type DescratchLevel = "off" | "low" | "medium" | "high";

export type ScratchMask = {
  mask: Uint8Array;
  coverage: number;
  artifactCount: number;
  confidence: number;
  warnings: string[];
};

const LEVEL: Record<Exclude<DescratchLevel, "off">, { mag: number; radius: number; maxCover: number }> = {
  low: { mag: 42, radius: 1, maxCover: 0.018 },
  medium: { mag: 32, radius: 2, maxCover: 0.03 },
  high: { mag: 24, radius: 3, maxCover: 0.045 },
};

export function buildScratchMask(src: ImageData, level: Exclude<DescratchLevel, "off">): ScratchMask {
  const { width: w, height: h, data } = src;
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; p < w * h; p++, i += 4) gray[p] = luma(data[i], data[i + 1], data[i + 2]);

  const magT = LEVEL[level].mag;
  const raw = new Uint8Array(w * h);
  const insetX = Math.max(4, Math.round(w * 0.04));
  const insetY = Math.max(4, Math.round(h * 0.04));

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (x < insetX || y < insetY || x >= w - insetX || y >= h - insetY) continue;
      const i = y * w + x;
      const gx = gray[i + 1] - gray[i - 1];
      const gy = gray[i + w] - gray[i - w];
      const mag = Math.hypot(gx, gy);
      if (mag < magT) continue;
      const angle = Math.abs(Math.atan2(gy, gx));
      const directional = angle < 0.35 || angle > Math.PI - 0.35 || Math.abs(angle - Math.PI / 2) < 0.28;
      if (!directional) continue;
      let local = 0;
      let n = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          local += gray[(y + dy) * w + (x + dx)];
          n++;
        }
      }
      const mean = local / n;
      const delta = Math.abs(gray[i] - mean);
      if (delta < magT * 0.45) continue;
      raw[i] = 1;
    }
  }

  const mask = new Uint8Array(w * h);
  let artifactCount = 0;
  const seen = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    if (!raw[p] || seen[p]) continue;
    const stack = [p];
    const cells: number[] = [];
    seen[p] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      cells.push(c);
      const cx = c % w;
      const cy = (c / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (!raw[ni] || seen[ni]) continue;
          seen[ni] = 1;
          stack.push(ni);
        }
      }
    }
    const compactness = cells.length;
    if (compactness < 4 || compactness > w * h * 0.012) continue;
    let minX = w, minY = h, maxX = 0, maxY = 0;
    for (const c of cells) {
      const x = c % w;
      const y = (c / w) | 0;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const aspect = bw / Math.max(1, bh);
    const fill = compactness / (bw * bh);
    const thinLine = (aspect > 6 || aspect < 1 / 6) && fill < 0.45;
    const speckle = compactness <= 18 && fill > 0.35;
    if (!thinLine && !speckle) continue;
    artifactCount++;
    for (const c of cells) mask[c] = 1;
  }

  let hits = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) hits++;
  const coverage = hits / mask.length;
  const warnings: string[] = [];
  if (coverage > LEVEL[level].maxCover) warnings.push("Scratch mask too large — artwork preserved");
  const confidence = artifactCount === 0 ? 0.2 : clamp(1 - coverage * 18, 0.35, 0.95);
  return { mask, coverage, artifactCount, confidence, warnings };
}

export function validateScratchMask(mask: ScratchMask, level: Exclude<DescratchLevel, "off">) {
  if (mask.coverage > LEVEL[level].maxCover) {
    return { ok: false as const, reason: "Scratch mask too large — artwork preserved" };
  }
  if (mask.artifactCount === 0) {
    return { ok: false as const, reason: "No scanner artifacts" };
  }
  return { ok: true as const };
}

export function descratchCard(src: ImageData, mask: ScratchMask, level: Exclude<DescratchLevel, "off">): ImageData {
  const r = LEVEL[level].radius;
  const { width: w, height: h, data } = src;
  const out = new ImageData(new Uint8ClampedArray(data), w, h);
  const m = mask.mask;
  for (let pass = 0; pass < 2; pass++) {
    const snap = new Uint8ClampedArray(out.data);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (!m[p]) continue;
        let rs = 0, gs = 0, bs = 0, wt = 0;
        for (let dy = -r * 2; dy <= r * 2; dy++) {
          for (let dx = -r * 2; dx <= r * 2; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const np = ny * w + nx;
            if (m[np] && pass === 0) continue;
            const dist = Math.hypot(dx, dy) || 0.5;
            const weight = 1 / (1 + dist);
            const i = np * 4;
            rs += snap[i] * weight;
            gs += snap[i + 1] * weight;
            bs += snap[i + 2] * weight;
            wt += weight;
          }
        }
        if (wt < 0.001) continue;
        const i = p * 4;
        out.data[i] = rs / wt;
        out.data[i + 1] = gs / wt;
        out.data[i + 2] = bs / wt;
      }
    }
  }
  return out;
}
