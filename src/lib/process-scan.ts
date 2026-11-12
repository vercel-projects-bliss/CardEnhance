import { detectCards } from "./detect-sheet";
import { createEnhancePool, type EnhanceOk } from "./enhance-pool";
import { encodePng, previewBlob } from "./files";
import { cropRect, rotateImage } from "./image-ops";
import { composeRotation } from "./orient";
import { detectOrientationAsync, refine180 } from "./orient-async";
import { deskewWithMargin, findOuterCardQuad } from "./crop-quad";
import type { Quad } from "./geometry";
import type { Rotation, StudioSettings } from "./types";

export type PreparedCard = {
  image: ImageData;
  filename: string;
  cardIndex: number;
  detectorMethod: string;
  detectorConfidence: number;
  identity?: undefined;
  rotated: boolean;
  orientationDetected: Rotation;
  orientationApplied: Rotation;
  orientationUncertain: boolean;
  ocrWordCount: number;
  cropQuad: Quad | null;
  cropMargin: number | null;
  isLandscape: boolean;
};

function stem(name: string) {
  return name.replace(/\.[^.]+$/, "");
}

/**
 * Split multi-card sheets first (no page-level 90° guess), then orient each
 * card with OCR+projection, then outer-quad crop + deskew. Filename is used
 * only for output naming.
 */
export async function prepareScan(
  source: ImageData,
  filename: string,
  extraRotation: Rotation = 0,
): Promise<PreparedCard[]> {
  let detections = await detectCards(source);
  if (!detections.length) {
    detections = [
      {
        cardIndex: 0,
        confidence: 0.4,
        box: { x: 0, y: 0, w: source.width, h: source.height },
        polygon: [
          { x: 0, y: 0 },
          { x: source.width, y: 0 },
          { x: source.width, y: source.height },
          { x: 0, y: source.height },
        ],
        centroid: { x: source.width / 2, y: source.height / 2 },
        detectorMethod: "fullframe",
        warnings: [],
        geometryConfidence: 0.4,
        geometryMethod: "axis_box",
      },
    ];
  }

  const out: PreparedCard[] = [];
  const multi = detections.length > 1;
  for (const det of detections) {
    const pad = Math.round(Math.min(det.box.w, det.box.h) * 0.06);
    const region = cropRect(
      source,
      det.box.x - pad,
      det.box.y - pad,
      det.box.x + det.box.w + pad,
      det.box.y + det.box.h + pad,
    );
    const auto = await detectOrientationAsync(region);
    const applied = composeRotation(auto.rotation, extraRotation);
    const oriented = rotateImage(region, applied);
    const found = findOuterCardQuad(oriented);
    let deskewed = deskewWithMargin(oriented, found);

    // 0↔180 only — never a 90/270 refine that undoes a confident first pass.
    const flip = await refine180(deskewed.image, auto);
    if (flip.rotation === 180) {
      deskewed = { ...deskewed, image: rotateImage(deskewed.image, 180) };
    }
    const orientationApplied = composeRotation(applied, flip.rotation);

    const textHorizontal = !flip.uncertain || auto.source !== "fallback";
    // Landscape only if the *oriented* card is wider than tall and we believe
    // the text already reads horizontally (we just oriented it).
    const isLandscape =
      deskewed.image.width > deskewed.image.height &&
      (flip.ocrWordCount >= 2 || auto.ocrWordCount >= 2 || auto.source === "agreed" || auto.source === "ocr") &&
      !flip.uncertain;

    out.push({
      image: deskewed.image,
      filename: multi ? `${stem(filename)}-${det.cardIndex + 1}.png` : filename,
      cardIndex: det.cardIndex,
      detectorMethod: det.detectorMethod,
      detectorConfidence: det.confidence,
      rotated: orientationApplied !== 0,
      orientationDetected: auto.rotation,
      orientationApplied,
      orientationUncertain: auto.uncertain && flip.rotation === 0,
      ocrWordCount: flip.ocrWordCount,
      cropQuad: deskewed.quad,
      cropMargin: deskewed.margin,
      isLandscape,
    });
  }
  return out;
}

export type ProcessedPixels = EnhanceOk & {
  blob: Blob;
  url: string;
  previewUrl: string;
};

export async function enhancePrepared(
  image: ImageData,
  settings: StudioSettings,
  pool: ReturnType<typeof createEnhancePool>,
  ocrWordCount = 0,
): Promise<ProcessedPixels> {
  const result = await pool.enhance(image, settings, 1, ocrWordCount);
  const imageData = new ImageData(new Uint8ClampedArray(result.data), result.width, result.height);
  const blob = await encodePng(imageData);
  const preview = await previewBlob(imageData, 360);
  const previewUrl = URL.createObjectURL(preview);
  return { ...result, data: imageData.data, blob, url: previewUrl, previewUrl };
}
