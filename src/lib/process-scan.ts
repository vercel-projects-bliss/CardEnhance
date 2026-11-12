import { detectCards } from "./detect-sheet";
import { createEnhancePool, type EnhanceOk } from "./enhance-pool";
import { encodePng, previewBlob } from "./files";
import { cropRect, rotateImage } from "./image-ops";
import { composeRotation, detectOrientation } from "./orient";
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
  cropQuad: Quad | null;
  cropMargin: number | null;
  isLandscape: boolean;
};

function stem(name: string) {
  return name.replace(/\.[^.]+$/, "");
}

/**
 * Orient a scan, split multi-card sheets, then outer-quad crop + deskew
 * each card with a uniform 2–3% margin. Filename is used only for output
 * naming — never for orientation, class, or crop decisions.
 */
export async function prepareScan(
  source: ImageData,
  filename: string,
  extraRotation: Rotation = 0,
): Promise<PreparedCard[]> {
  const auto = detectOrientation(source.data, source.width, source.height);
  const applied = composeRotation(auto.rotation, extraRotation);
  const oriented = rotateImage(source, applied);
  let detections = await detectCards(oriented);
  if (!detections.length) {
    detections = [
      {
        cardIndex: 0,
        confidence: 0.4,
        box: { x: 0, y: 0, w: oriented.width, h: oriented.height },
        polygon: [
          { x: 0, y: 0 },
          { x: oriented.width, y: 0 },
          { x: oriented.width, y: oriented.height },
          { x: 0, y: oriented.height },
        ],
        centroid: { x: oriented.width / 2, y: oriented.height / 2 },
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
      oriented,
      det.box.x - pad,
      det.box.y - pad,
      det.box.x + det.box.w + pad,
      det.box.y + det.box.h + pad,
    );
    // Refine 180° (and occasional residual 90°) on the loose card region.
    const refine = detectOrientation(region.data, region.width, region.height);
    const regionOriented = rotateImage(region, refine.rotation);
    const found = findOuterCardQuad(regionOriented);
    const deskewed = deskewWithMargin(regionOriented, found);
    const finalOrient = detectOrientation(
      deskewed.image.data,
      deskewed.image.width,
      deskewed.image.height,
    );
    const orientationApplied = composeRotation(applied, refine.rotation);
    const s0 = finalOrient.scores.find((s) => s.rotation === 0);
    const sideways = Math.max(
      ...finalOrient.scores.filter((s) => s.rotation === 90 || s.rotation === 270).map((s) => s.score),
    );
    const textHorizontal = (s0?.score ?? 0) >= sideways;
    const isLandscape = deskewed.image.width > deskewed.image.height && textHorizontal;

    out.push({
      image: deskewed.image,
      filename: multi ? `${stem(filename)}-${det.cardIndex + 1}.png` : filename,
      cardIndex: det.cardIndex,
      detectorMethod: det.detectorMethod,
      detectorConfidence: det.confidence,
      rotated: orientationApplied !== 0,
      orientationDetected: auto.rotation,
      orientationApplied,
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
): Promise<ProcessedPixels> {
  const result = await pool.enhance(image, settings, 1);
  const imageData = new ImageData(new Uint8ClampedArray(result.data), result.width, result.height);
  const blob = await encodePng(imageData);
  const preview = await previewBlob(imageData, 360);
  const previewUrl = URL.createObjectURL(preview);
  return { ...result, data: imageData.data, blob, url: previewUrl, previewUrl };
}
