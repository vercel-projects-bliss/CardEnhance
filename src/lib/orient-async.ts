import { rotateImage } from "./image-ops";
import {
  combineOrientationSignals,
  type CombinedOrientation,
  type OcrRotationScore,
} from "./ocr-score";
import { detectOrientation, type OrientationResult } from "./orient";
import { ocrDetectOrientation, scoreRotationImage } from "./tess-pool";
import type { Rotation } from "./types";

const ROTATIONS: Rotation[] = [0, 90, 180, 270];

export type AsyncOrientation = CombinedOrientation & {
  projection: OrientationResult;
  osd: { degrees: Rotation; confidence: number } | null;
  /** Winning OCR word count, useful as a classifier prior. */
  ocrWordCount: number;
};

function downscaleImage(src: ImageData, maxEdge = 900): ImageData {
  const scale = Math.min(1, maxEdge / Math.max(src.width, src.height));
  if (scale >= 0.999) return src;
  const w = Math.max(16, Math.round(src.width * scale));
  const h = Math.max(16, Math.round(src.height * scale));
  // Bilinear via canvas — nearest-neighbor at ~400px destroyed body text
  // and left OCR with too few valid words to beat a wrong projection.
  const srcCanvas = (() => {
    if (typeof OffscreenCanvas !== "undefined") {
      const c = new OffscreenCanvas(src.width, src.height);
      const ctx = c.getContext("2d");
      if (!ctx) throw new Error("canvas");
      ctx.putImageData(src, 0, 0);
      return c;
    }
    const c = document.createElement("canvas");
    c.width = src.width;
    c.height = src.height;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.putImageData(src, 0, 0);
    return c;
  })();
  if (typeof OffscreenCanvas !== "undefined") {
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(srcCanvas as OffscreenCanvas, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  }
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(srcCanvas as HTMLCanvasElement, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

function imageToCanvas(image: ImageData): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== "undefined") {
    const c = new OffscreenCanvas(image.width, image.height);
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.putImageData(image, 0, 0);
    return c;
  }
  const c = document.createElement("canvas");
  c.width = image.width;
  c.height = image.height;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.putImageData(image, 0, 0);
  return c;
}

async function canvasToBlob(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Blob> {
  if ("convertToBlob" in canvas) {
    return (canvas as OffscreenCanvas).convertToBlob({ type: "image/png" });
  }
  return new Promise((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob(
      (b) => (b ? resolve(b) : reject(new Error("blob"))),
      "image/png",
    );
  });
}

/**
 * Full orientation: projection profiles + Tesseract OSD + per-rotation OCR
 * on a downscaled copy. Never uses the filename.
 *
 * 90/270 refine is not applied on top of a confident result — if the first
 * pass is decided, only a 0↔180 OCR confirmation is allowed after crop.
 */
export async function detectOrientationAsync(src: ImageData): Promise<AsyncOrientation> {
  const small = downscaleImage(src, 900);
  const projection = detectOrientation(src.data, src.width, src.height);

  let osd: AsyncOrientation["osd"] = null;
  const ocr: OcrRotationScore[] = [];

  if (typeof window !== "undefined") {
    try {
      const uprightBlob = await canvasToBlob(imageToCanvas(small));
      osd = await ocrDetectOrientation(uprightBlob);
    } catch {
      osd = null;
    }

    // Always score all four rotations on the downscaled card. Skipping an
    // axis when projection is overconfident is how a correct 90/270 lost.
    for (const rot of ROTATIONS) {
      try {
        const turned = rotateImage(small, rot);
        const blob = await canvasToBlob(imageToCanvas(turned));
        // scoreRotationImage labels the *already-rotated* image as rotation 0
        // from Tesseract's view; we want the score for applying `rot` to src.
        const scored = await scoreRotationImage(blob, rot);
        ocr.push(scored);
      } catch {
        ocr.push({ rotation: rot, wordCount: 0, meanConfidence: 0, score: 0, text: "" });
      }
    }
  }

  // If OSD is confident, add it as a synthetic high-scoring OCR vote.
  if (osd && osd.confidence >= 2) {
    const existing = ocr.find((s) => s.rotation === osd!.degrees);
    if (existing) {
      existing.score += Math.min(1.2, osd.confidence / 8);
    } else {
      ocr.push({
        rotation: osd.degrees,
        wordCount: Math.max(3, Math.round(osd.confidence)),
        meanConfidence: Math.min(90, 40 + osd.confidence * 5),
        score: Math.min(1.2, osd.confidence / 8),
        text: "",
      });
    }
  }

  const combined = combineOrientationSignals(
    projection.scores.map((s) => ({ rotation: s.rotation, score: s.score })),
    ocr,
  );

  const winnerOcr = ocr.find((s) => s.rotation === combined.rotation);
  return {
    ...combined,
    projection,
    osd,
    ocrWordCount: winnerOcr?.wordCount ?? 0,
  };
}

/**
 * After a tight crop, only consider a 180° flip — never a 90/270 that
 * would undo a confident first pass (the previous refine bug).
 */
export async function refine180(
  cropped: ImageData,
  current: AsyncOrientation,
): Promise<{ rotation: Rotation; uncertain: boolean; ocrWordCount: number }> {
  if (typeof window === "undefined") {
    return { rotation: 0, uncertain: current.uncertain, ocrWordCount: current.ocrWordCount };
  }
  const small = downscaleImage(cropped, 900);
  try {
    const s0 = await scoreRotationImage(await canvasToBlob(imageToCanvas(small)), 0);
    const turned = rotateImage(small, 180);
    const s180 = await scoreRotationImage(await canvasToBlob(imageToCanvas(turned)), 180);
    const better180 = s180.wordCount >= 3 && s180.score >= s0.score * 1.2 && s180.score - s0.score >= 0.1;
    if (better180) {
      return { rotation: 180, uncertain: false, ocrWordCount: s180.wordCount };
    }
    return { rotation: 0, uncertain: current.uncertain && s0.wordCount < 2, ocrWordCount: Math.max(s0.wordCount, current.ocrWordCount) };
  } catch {
    return { rotation: 0, uncertain: current.uncertain, ocrWordCount: current.ocrWordCount };
  }
}

export function isLandscapeAfter(
  width: number,
  height: number,
  textHorizontal: boolean,
): boolean {
  return width > height && textHorizontal;
}
