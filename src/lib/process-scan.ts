import { detectCards, rectifyCard } from "./detect-sheet";
import { identifyCard } from "./identify";
import { rotate180 } from "./detect";
import { createEnhancePool, type EnhanceOk } from "./enhance-pool";
import { encodePng } from "./files";
import type { CardIdentity, StudioSettings } from "./types";

export type PreparedCard = {
  image: ImageData;
  filename: string;
  cardIndex: number;
  detectorMethod: string;
  detectorConfidence: number;
  identity?: CardIdentity;
  rotated: boolean;
};

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

export async function prepareScan(source: ImageData, filename: string): Promise<PreparedCard[]> {
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
  for (const det of detections) {
    let image = rectifyCard(source, det);
    const identified = await withTimeout(
      identifyCard(image, filename),
      15000,
      { identity: undefined, rotated: false } as { identity?: CardIdentity; rotated: boolean },
    );
    if (identified.rotated) image = rotate180(image);
    out.push({
      image,
      filename: detections.length > 1 ? `${stem(filename)}-${det.cardIndex + 1}.png` : filename,
      cardIndex: det.cardIndex,
      detectorMethod: det.detectorMethod,
      detectorConfidence: det.confidence,
      identity: identified.identity,
      rotated: identified.rotated,
    });
  }
  return out;
}

function stem(name: string) {
  return name.replace(/\.[^.]+$/, "");
}

export type ProcessedPixels = EnhanceOk & {
  blob: Blob;
  url: string;
};

export async function enhancePrepared(
  image: ImageData,
  settings: StudioSettings,
  pool: ReturnType<typeof createEnhancePool>,
): Promise<ProcessedPixels> {
  const result = await pool.enhance(image, settings, 1);
  const imageData = new ImageData(new Uint8ClampedArray(result.data), result.width, result.height);
  const blob = await encodePng(imageData);
  const url = URL.createObjectURL(blob);
  return { ...result, data: imageData.data, blob, url };
}
