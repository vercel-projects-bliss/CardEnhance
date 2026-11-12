/** Contrast, invert, and JPEG encode for OCR / vision. */

/** Contrast, invert, and JPEG encode for OCR / vision. */

export function contrastGray(src: ImageData): ImageData {
  const { width, height, data } = src;
  const n = width * height;
  const luma = new Uint8Array(n);
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const y = Math.round(0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]);
    luma[i] = y;
    hist[y] += 1;
  }
  const loCount = Math.max(1, Math.floor(n * 0.05));
  const hiCount = Math.max(1, Math.floor(n * 0.95));
  let acc = 0;
  let lo = 0;
  let hi = 255;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= loCount && lo === 0) lo = v;
    if (acc >= hiCount) {
      hi = v;
      break;
    }
  }
  const span = Math.max(16, hi - lo);
  const out = new ImageData(width, height);
  for (let i = 0; i < n; i++) {
    let v = Math.round(((luma[i] - lo) / span) * 255);
    if (v < 0) v = 0;
    else if (v > 255) v = 255;
    const o = i * 4;
    out.data[o] = v;
    out.data[o + 1] = v;
    out.data[o + 2] = v;
    out.data[o + 3] = 255;
  }
  return out;
}

export function unsharp(src: ImageData, amount = 0.65): ImageData {
  const { width: w, height: h, data } = src;
  const out = new ImageData(w, h);
  const o = out.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let s = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          s += data[(yy * w + xx) * 4];
          n += 1;
        }
      }
      const blur = s / n;
      let v = data[i] + (data[i] - blur) * amount;
      if (v < 0) v = 0;
      else if (v > 255) v = 255;
      o[i] = v;
      o[i + 1] = v;
      o[i + 2] = v;
      o[i + 3] = 255;
    }
  }
  return out;
}

export function invertRgb(src: ImageData): ImageData {
  const out = new ImageData(src.width, src.height);
  const d = src.data;
  const o = out.data;
  for (let i = 0; i < d.length; i += 4) {
    o[i] = 255 - d[i];
    o[i + 1] = 255 - d[i + 1];
    o[i + 2] = 255 - d[i + 2];
    o[i + 3] = 255;
  }
  return out;
}

export function cropBand(src: ImageData, y0f: number, y1f: number): ImageData {
  const y0 = Math.max(0, Math.floor(src.height * y0f));
  const y1 = Math.min(src.height, Math.ceil(src.height * y1f));
  const ch = Math.max(8, y1 - y0);
  const cw = src.width;
  const out = new ImageData(cw, ch);
  const row = cw * 4;
  out.data.set(src.data.subarray(y0 * row, (y0 + ch) * row));
  return out;
}

export function encodeJpeg(src: ImageData, maxEdge = 720, quality = 0.82): Promise<string> {
  const edge = Math.max(src.width, src.height);
  const scale = edge > maxEdge ? maxEdge / edge : 1;
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
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
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("JPEG encode failed"));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("JPEG read failed"));
        reader.readAsDataURL(blob);
      },
      "image/jpeg",
      quality,
    );
  });
}

export function dataUrlToBase64(dataUrl: string) {
  const i = dataUrl.indexOf(",");
  return i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
}
