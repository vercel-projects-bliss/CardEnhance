import JSZip from "jszip";

const IMAGE_RE = /\.(jpe?g|png|webp|bmp|tif{1,2})$/i;
const MAX_ZIP_IMAGE_ENTRIES = 200;
const MAX_ZIP_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;

type ZipEntryWithSize = {
  _data?: { uncompressedSize?: number };
};

export async function expandFiles(files: File[]): Promise<File[]> {
  const out: File[] = [];
  for (const file of files) {
    const isZip =
      file.type === "application/zip" ||
      file.type === "application/x-zip-compressed" ||
      file.name.toLowerCase().endsWith(".zip");
    if (!isZip) {
      out.push(file);
      continue;
    }
    const zip = await JSZip.loadAsync(file);
    const entries = Object.values(zip.files).filter((entry) => !entry.dir && IMAGE_RE.test(entry.name));
    if (entries.length > MAX_ZIP_IMAGE_ENTRIES) {
      throw new Error(`Archive contains too many images (maximum ${MAX_ZIP_IMAGE_ENTRIES})`);
    }
    const expectedBytes = entries.reduce((total, entry) => {
      const size = (entry as unknown as ZipEntryWithSize)._data?.uncompressedSize;
      return total + (typeof size === "number" && Number.isFinite(size) ? size : 0);
    }, 0);
    if (expectedBytes > MAX_ZIP_UNCOMPRESSED_BYTES) {
      throw new Error("Archive expands beyond the 256 MB processing limit");
    }
    let expandedBytes = 0;
    for (const entry of entries) {
      const blob = await entry.async("blob");
      expandedBytes += blob.size;
      if (expandedBytes > MAX_ZIP_UNCOMPRESSED_BYTES) {
        throw new Error("Archive expands beyond the 256 MB processing limit");
      }
      const name = entry.name.split("/").pop() ?? entry.name;
      const type = blob.type || guessType(name);
      out.push(new File([blob], name, { type }));
    }
  }
  return out;
}

function guessType(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "bmp") return "image/bmp";
  if (ext === "tif" || ext === "tiff") return "image/tiff";
  return "application/octet-stream";
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function zipBlobs(files: { name: string; blob: Blob }[], zipName: string) {
  const zip = new JSZip();
  for (const file of files) zip.file(file.name, file.blob);
  const blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(blob, zipName);
}

export async function imageDataFromBlob(file: Blob): Promise<ImageData> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export async function encodePng(image: ImageData): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.putImageData(image, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("PNG encode failed");
  return blob;
}

export async function previewBlob(image: ImageData, maxEdge = 360): Promise<Blob> {
  const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
  const w = Math.max(1, Math.round(image.width * scale));
  const h = Math.max(1, Math.round(image.height * scale));
  const canvas = typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement("canvas"), { width: w, height: h });
  const ctx = (canvas as OffscreenCanvas | HTMLCanvasElement).getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  const srcCanvas = typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(image.width, image.height)
    : Object.assign(document.createElement("canvas"), { width: image.width, height: image.height });
  const sctx = (srcCanvas as OffscreenCanvas | HTMLCanvasElement).getContext("2d");
  if (!sctx) throw new Error("Canvas unavailable");
  (sctx as CanvasRenderingContext2D).putImageData(image, 0, 0);
  (ctx as CanvasRenderingContext2D).imageSmoothingEnabled = true;
  (ctx as CanvasRenderingContext2D).imageSmoothingQuality = "high";
  (ctx as CanvasRenderingContext2D).drawImage(srcCanvas as CanvasImageSource, 0, 0, w, h);
  if ("convertToBlob" in canvas) {
    return (canvas as OffscreenCanvas).convertToBlob({ type: "image/jpeg", quality: 0.72 });
  }
  return new Promise((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("preview blob failed"))),
      "image/jpeg",
      0.72,
    );
  });
}

export function revokeUrl(url?: string | null) {
  if (url && url.startsWith("blob:")) URL.revokeObjectURL(url);
}
