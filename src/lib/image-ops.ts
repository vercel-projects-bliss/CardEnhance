export const PROCESSING_VERSION = "2.0.0";

export function clamp(n: number, min: number, max: number) {
  return n < min ? min : n > max ? max : n;
}

export function luma(r: number, g: number, b: number) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function sanitizeFilename(name: string) {
  const base = name.split(/[/\\]/).pop() ?? "card";
  return base
    .replace(/[^\w.-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 80) || "card";
}

export function identityFilename(parts: Array<string | number | null | undefined>, artifact: string, ext: string) {
  const body = parts
    .map((p) => (p == null ? "" : String(p)))
    .filter(Boolean)
    .map((p) => sanitizeFilename(p))
    .join("_");
  return `${body || "card"}_${artifact}.${ext}`;
}

export function cloneImage(src: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
}

export function rotateImage(src: ImageData, degrees: 0 | 90 | 180 | 270): ImageData {
  const k = ((degrees % 360) + 360) % 360;
  if (k === 0) return cloneImage(src);
  if (k === 180) {
    const out = new ImageData(src.width, src.height);
    const n = src.data.length;
    for (let i = 0; i < n; i += 4) {
      const j = n - 4 - i;
      out.data[i] = src.data[j];
      out.data[i + 1] = src.data[j + 1];
      out.data[i + 2] = src.data[j + 2];
      out.data[i + 3] = src.data[j + 3];
    }
    return out;
  }
  const w = src.width;
  const h = src.height;
  const out = new ImageData(h, w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4;
      const dx = k === 90 ? h - 1 - y : y;
      const dy = k === 90 ? x : w - 1 - x;
      const di = (dy * h + dx) * 4;
      out.data[di] = src.data[si];
      out.data[di + 1] = src.data[si + 1];
      out.data[di + 2] = src.data[si + 2];
      out.data[di + 3] = src.data[si + 3];
    }
  }
  return out;
}

export function cropRect(src: ImageData, x0: number, y0: number, x1: number, y1: number): ImageData {
  const left = Math.max(0, Math.floor(x0));
  const top = Math.max(0, Math.floor(y0));
  const right = Math.min(src.width, Math.ceil(x1));
  const bottom = Math.min(src.height, Math.ceil(y1));
  const cw = Math.max(1, right - left);
  const ch = Math.max(1, bottom - top);
  const out = new ImageData(cw, ch);
  for (let y = 0; y < ch; y++) {
    const srcOff = ((top + y) * src.width + left) * 4;
    out.data.set(src.data.subarray(srcOff, srcOff + cw * 4), y * cw * 4);
  }
  return out;
}

export function resampleImage(src: ImageData, w: number, h: number): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  const tmp = document.createElement("canvas");
  tmp.width = src.width;
  tmp.height = src.height;
  const tctx = tmp.getContext("2d");
  if (!tctx) throw new Error("Canvas unavailable");
  tctx.putImageData(src, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(tmp, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

export async function encodeImage(
  image: ImageData,
  format: "png" | "jpg" | "webp",
  quality = 0.92,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.putImageData(image, 0, 0);
  const mime = format === "png" ? "image/png" : format === "webp" ? "image/webp" : "image/jpeg";
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, quality));
  if (!blob) throw new Error("Encode failed");
  return blob;
}

export function thumbnail(src: ImageData, maxEdge = 220): ImageData {
  const scale = Math.min(1, maxEdge / Math.max(src.width, src.height));
  return resampleImage(src, Math.max(1, Math.round(src.width * scale)), Math.max(1, Math.round(src.height * scale)));
}

export async function imageDataFromBlob(file: Blob, maxEdge = 2800): Promise<ImageData> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return ctx.getImageData(0, 0, w, h);
}
