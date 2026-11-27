import { cardCanvasSize, type CardCanvas } from "@/lib/geometry/card-canvas";

export function imageDataFromPixels(pixels: Uint8ClampedArray, width: number, height: number): ImageData {
  const copy = new Uint8ClampedArray(pixels.length);
  copy.set(pixels);
  return new ImageData(copy, width, height);
}

export function canvasFromImageData(data: ImageData): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = data.width;
  canvas.height = data.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.putImageData(data, 0, 0);
  return canvas;
}

export function readImageData(source: CanvasImageSource, width: number, height: number): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(source, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

export function loadImageElement(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not decode that image"));
    };
    image.src = url;
  });
}

export function fitLongEdge(width: number, height: number, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function paintPaddedCard(source: CanvasImageSource, srcWidth: number, srcHeight: number) {
  const spec = cardCanvasSize(srcWidth, srcHeight);
  const canvas = document.createElement("canvas");
  canvas.width = spec.width;
  canvas.height = spec.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, spec.width, spec.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, spec.offsetX, spec.offsetY, spec.scaledWidth, spec.scaledHeight);
  return { canvas, spec };
}

export function downloadCanvas(canvas: HTMLCanvasElement, filename: string) {
  return new Promise<void>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Could not encode PNG"));
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      resolve();
    }, "image/png");
  });
}

export async function canvasToPngBase64(canvas: HTMLCanvasElement): Promise<string> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Could not encode PNG");
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function shrinkJpegBase64(
  source: CanvasImageSource,
  width: number,
  height: number,
  maxChars = 240_000,
): Promise<string> {
  let longEdge = Math.max(width, height);
  let quality = 0.72;
  for (let attempt = 0; attempt < 8; attempt++) {
    const fitted = fitLongEdge(width, height, longEdge);
    const canvas = document.createElement("canvas");
    canvas.width = fitted.width;
    canvas.height = fitted.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.drawImage(source, 0, 0, fitted.width, fitted.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) throw new Error("Could not encode JPEG");
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    const encoded = btoa(binary);
    if (encoded.length <= maxChars) return encoded;
    longEdge = Math.round(longEdge * 0.72);
    quality = Math.max(0.42, quality - 0.08);
  }
  throw new Error("Image is still too large for vision OCR");
}

export function describeCanvas(spec: CardCanvas) {
  return `${spec.width}×${spec.height} · ${spec.binding} binds · margin ${spec.offsetX.toFixed(1)}×${spec.offsetY.toFixed(1)} px`;
}
