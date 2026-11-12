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

function downscaleImage(src: ImageData, maxEdge = 400): ImageData {
  const scale = Math.min(1, maxEdge / Math.max(src.width, src.height));
  if (scale >= 0.999) return src;
  const w = Math.max(16, Math.round(src.width * scale));
  const h = Math.max(16, Math.round(src.height * scale));
  const out = new ImageData(w, h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(src.height - 1, Math.floor(y / scale));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(src.width - 1, Math.floor(x / scale));
      const si = (sy * src.width + sx) * 4;
      const di = (y * w + x) * 4;
      out.data[di] = src.data[si];
      out.data[di + 1] = src.data[si + 1];
      out.data[di + 2] = src.data[si + 2];
      out.data[di + 3] = 255;
    }
  }
  return out;
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
  const small = downscaleImage(src, 400);
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

    // Prefer OCR on the two orientations of the winning projection axis,
    // plus the other axis' best if the margin is thin — always at least
    // the projection winner and its 180 counterpart.
    const axis = projection.rotation === 90 || projection.rotation === 270 ? 90 : 0;
    const primary: Rotation[] = axis === 0 ? [0, 180] : [90, 270];
    const s0 = projection.scores.find((s) => s.rotation === 0)?.score ?? 0;
    const s90 = projection.scores.find((s) => s.rotation === 90)?.score ?? 0;
    const s180 = projection.scores.find((s) => s.rotation === 180)?.score ?? 0;
    const s270 = projection.scores.find((s) => s.rotation === 270)?.score ?? 0;
    const axisMargin = Math.abs(Math.max(s0, s180) - Math.max(s90, s270));
    const toRun: Rotation[] = [...primary];
    if (axisMargin < 0.35) {
      for (const r of ROTATIONS) if (!toRun.includes(r)) toRun.push(r);
    } else {
      // Still recognize the opposite-axis winner once — cheap insurance.
      const other = axis === 0
        ? (s90 >= s270 ? 90 : 270)
        : (s0 >= s180 ? 0 : 180);
      if (!toRun.includes(other as Rotation)) toRun.push(other as Rotation);
    }

    for (const rot of toRun) {
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
  const small = downscaleImage(cropped, 400);
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
