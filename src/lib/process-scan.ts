import type { AdaptiveAuditMetrics, RotationQuadrant } from "./adaptiveCardPipeline";
import { createEnhancePool } from "./enhance-pool";
import { encodePng, previewBlob } from "./files";
import { cropRect } from "./image-ops";
import { composeRotation } from "./orient";
import type { CardClass, Rotation, StudioSettings } from "./types";

export type PipelineCard = {
  image: ImageData;
  sourceCrop: ImageData;
  filename: string;
  cardIndex: number;
  bounds: { x: number; y: number; width: number; height: number };
  audit: AdaptiveAuditMetrics;
};

function stem(name: string) {
  return name.replace(/\.[^.]+$/, "");
}

export function profileToCardClass(profile: AdaptiveAuditMetrics["profile"]): CardClass {
  if (profile === "CARD_BACK") return "card_back";
  if (profile === "MATTE_RELIC") return "matte_paper_front";
  return "chrome_foil_front";
}

export function profileLabel(profile: AdaptiveAuditMetrics["profile"]): string {
  if (profile === "CARD_BACK") return "CARD BACK";
  if (profile === "CHROME_FOIL") return "CHROME / FOIL";
  if (profile === "DARK_ACETATE_FOIL") return "DARK ACETATE";
  return "MATTE / RELIC";
}

/**
 * Route an upload through sheet.enhance (splits 1x2/2x2/2x3/3x3 first, then
 * orients and restores each card). Known singles / already-split tiles use
 * card.enhance so a child is not re-split out of the parent sheet.
 */
export async function processSource(
  source: ImageData,
  filename: string,
  settings: StudioSettings,
  pool: ReturnType<typeof createEnhancePool>,
  options: {
    mode: "sheet" | "card";
    manualRotationDeg?: Rotation | null;
  },
): Promise<PipelineCard[]> {
  const manual = (options.manualRotationDeg ?? null) as RotationQuadrant | null;
  if (options.mode === "card") {
    const result = await pool.cardEnhance(source, settings, manual);
    return [
      {
        image: result.image,
        sourceCrop: source,
        filename,
        cardIndex: 0,
        bounds: { x: 0, y: 0, width: source.width, height: source.height },
        audit: result.audit,
      },
    ];
  }

  const cards = await pool.sheetEnhance(source, settings, manual);
  const multi = cards.length > 1;
  return cards.map((card) => {
    const crop = cropRect(
      source,
      card.bounds.x,
      card.bounds.y,
      card.bounds.x + card.bounds.width,
      card.bounds.y + card.bounds.height,
    );
    return {
      image: card.image,
      sourceCrop: crop,
      filename: multi ? `${stem(filename)}-${card.index + 1}.png` : filename,
      cardIndex: card.index,
      bounds: card.bounds,
      audit: card.audit,
    };
  });
}

export function composedManualRotation(
  autoDetected: Rotation | null | undefined,
  userRotation: Rotation | null | undefined,
): Rotation | null {
  const user = (userRotation ?? 0) as Rotation;
  if (user === 0) return null;
  return composeRotation((autoDetected ?? 0) as Rotation, user);
}

export type ProcessedPixels = {
  blob: Blob;
  url: string;
  previewUrl: string;
  width: number;
  height: number;
  audit: AdaptiveAuditMetrics;
};

export async function encodeProcessed(image: ImageData, audit: AdaptiveAuditMetrics): Promise<ProcessedPixels> {
  const blob = await encodePng(image);
  const preview = await previewBlob(image, 360);
  const previewUrl = URL.createObjectURL(preview);
  return { blob, url: previewUrl, previewUrl, width: image.width, height: image.height, audit };
}
