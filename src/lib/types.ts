export type OutputFormat = "png" | "jpg" | "webp";

export type DescratchLevel = "off" | "low" | "medium" | "high";

export type ArtifactType =
  | "original"
  | "cropped"
  | "upscaled"
  | "descratched"
  | "upscaled_descratched";

export type StudioSettings = {
  concurrency: 1 | 2 | 3 | 4;
  upscaleScale: 2 | 4;
  descratchLevel: DescratchLevel;
  exportFormat: OutputFormat;
  exportQuality: number;
};

export const defaultStudioSettings: StudioSettings = {
  concurrency: 2,
  upscaleScale: 2,
  descratchLevel: "medium",
  exportFormat: "png",
  exportQuality: 92,
};

export const ARTIFACT_VERSIONS: { key: ArtifactType; label: string }[] = [
  { key: "original", label: "Original" },
  { key: "cropped", label: "Rectified" },
  { key: "upscaled", label: "Upscaled" },
  { key: "descratched", label: "Descratched" },
  { key: "upscaled_descratched", label: "Descratch + Upscale" },
];

export type StoredCard = {
  id: string;
  sourceId: string;
  filename: string;
  player: string | null;
  setName: string | null;
  manufacturer: string | null;
  year: number | null;
  number: string | null;
  parallel: string | null;
  side: string | null;
  engine: string | null;
  detector: string | null;
  status: string;
  createdAt: string | null;
};

export type AuditRow = {
  id: number;
  action: string;
  entityType: string | null;
  entityId: string | null;
  filename: string | null;
  player: string | null;
  createdAt: string | null;
};

export type LibrarySummary = {
  cards: StoredCard[];
  processed: number;
  auditCount: number;
};
