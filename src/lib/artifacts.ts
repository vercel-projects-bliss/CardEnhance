import { PROCESSING_VERSION, encodeImage } from "./image-ops";

export type ArtifactType = "original" | "cropped" | "upscaled" | "descratched" | "upscaled_descratched";

export type ArtifactMeta = {
  id: string;
  cardId: string;
  sourceId: string;
  artifactType: ArtifactType;
  parentArtifact: string | null;
  createdAt: number;
  processingVersion: string;
  width: number;
  height: number;
  usedRealSr?: boolean;
  upscaleScale?: 2 | 4;
  upscaleModel?: string;
  upscaleMethod?: "realesrgan" | "interpolation";
  descratchLevel?: string;
  descratchAlgorithm?: string;
  maskCoverage?: number;
  warnings: string[];
};

type Recorded = ArtifactMeta & { blob: Blob; url: string };

const mem = new Map<string, Recorded>();
const byCard = new Map<string, string[]>();

export function storeArtifact(meta: Omit<ArtifactMeta, "createdAt" | "processingVersion"> & { blob: Blob }): ArtifactMeta {
  const full: ArtifactMeta = {
    ...meta,
    createdAt: Date.now(),
    processingVersion: PROCESSING_VERSION,
    warnings: meta.warnings ?? [],
  };
  const url = URL.createObjectURL(meta.blob);
  mem.set(full.id, { ...full, blob: meta.blob, url });
  const list = byCard.get(full.cardId) ?? [];
  list.push(full.id);
  byCard.set(full.cardId, list);
  return full;
}

export function getArtifact(id: string): (ArtifactMeta & { url: string; blob: Blob }) | null {
  return mem.get(id) ?? null;
}

export function getArtifactUrl(id: string | null | undefined): string | null {
  if (!id) return null;
  return mem.get(id)?.url ?? null;
}

export function listCardArtifacts(cardId: string): ArtifactMeta[] {
  return (byCard.get(cardId) ?? []).map((id) => mem.get(id)!).filter(Boolean);
}

export function artifactOfType(cardId: string, type: ArtifactType): (ArtifactMeta & { url: string; blob: Blob }) | null {
  const ids = byCard.get(cardId) ?? [];
  for (let i = ids.length - 1; i >= 0; i--) {
    const rec = mem.get(ids[i]);
    if (rec?.artifactType === type) return rec;
  }
  return null;
}

export async function createDerivedArtifact(opts: {
  cardId: string;
  sourceId: string;
  artifactType: ArtifactType;
  parentArtifact: string | null;
  image: ImageData;
  extra?: Partial<ArtifactMeta>;
  format?: "png" | "jpg" | "webp";
}): Promise<ArtifactMeta> {
  const blob = await encodeImage(opts.image, opts.format ?? "png", 0.95);
  return storeArtifact({
    id: crypto.randomUUID(),
    cardId: opts.cardId,
    sourceId: opts.sourceId,
    artifactType: opts.artifactType,
    parentArtifact: opts.parentArtifact,
    width: opts.image.width,
    height: opts.image.height,
    warnings: opts.extra?.warnings ?? [],
    usedRealSr: opts.extra?.usedRealSr,
    upscaleScale: opts.extra?.upscaleScale,
    upscaleModel: opts.extra?.upscaleModel,
    upscaleMethod: opts.extra?.upscaleMethod,
    descratchLevel: opts.extra?.descratchLevel,
    descratchAlgorithm: opts.extra?.descratchAlgorithm,
    maskCoverage: opts.extra?.maskCoverage,
    blob,
  });
}

export function revokeCard(cardId: string) {
  for (const id of byCard.get(cardId) ?? []) {
    const rec = mem.get(id);
    if (rec) URL.revokeObjectURL(rec.url);
    mem.delete(id);
  }
  byCard.delete(cardId);
}
