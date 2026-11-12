import { sanitizeFilename } from "./image-ops";

export const MAX_UPLOAD_BYTES = 80 * 1024 * 1024;
export const MAX_DIMENSION = 12000;
export const MIN_DIMENSION = 32;

const MAGIC: Array<{ mime: string; test: (b: Uint8Array) => boolean }> = [
  { mime: "image/jpeg", test: (b) => b.length > 2 && b[0] === 0xff && b[1] === 0xd8 },
  { mime: "image/png", test: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: "image/webp", test: (b) => b.length > 12 && b[0] === 0x52 && b[8] === 0x57 && b[9] === 0x45 },
  { mime: "image/bmp", test: (b) => b.length > 2 && b[0] === 0x42 && b[1] === 0x4d },
  { mime: "image/gif", test: (b) => b.length > 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 },
  { mime: "application/zip", test: (b) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b },
];

export type ValidatedUpload = {
  ok: true;
  filename: string;
  mime: string;
  bytes: ArrayBuffer;
  width: number;
  height: number;
};

export type RejectedUpload = {
  ok: false;
  filename: string;
  error: string;
};

export async function validateUploadedImage(
  fileBytes: ArrayBuffer,
  filename: string,
  mimeType: string,
): Promise<ValidatedUpload | RejectedUpload> {
  const safeName = sanitizeFilename(filename);
  if (fileBytes.byteLength < 32) {
    return { ok: false, filename: safeName, error: "Corrupted image" };
  }
  if (fileBytes.byteLength > MAX_UPLOAD_BYTES) {
    return { ok: false, filename: safeName, error: "Unsupported image" };
  }
  const head = new Uint8Array(fileBytes.slice(0, 16));
  const magic = MAGIC.find((m) => m.test(head));
  if (!magic) {
    return { ok: false, filename: safeName, error: "Unsupported image" };
  }
  if (magic.mime === "application/zip") {
    return { ok: false, filename: safeName, error: "Unsupported image" };
  }
  try {
    const blob = new Blob([fileBytes], { type: magic.mime || mimeType });
    const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" } as ImageBitmapOptions);
    const width = bitmap.width;
    const height = bitmap.height;
    bitmap.close();
    if (width < MIN_DIMENSION || height < MIN_DIMENSION) {
      return { ok: false, filename: safeName, error: "Corrupted image" };
    }
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      return { ok: false, filename: safeName, error: "Unsupported image" };
    }
    return {
      ok: true,
      filename: safeName,
      mime: magic.mime,
      bytes: fileBytes,
      width,
      height,
    };
  } catch {
    return { ok: false, filename: safeName, error: "Corrupted image" };
  }
}
