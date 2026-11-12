export type StudioSettings = {
  scale: number;
  descratch: number;
  descratchFoilOnly: boolean;
  denoise: number;
  sharpen: number;
  contrast: number;
};

export const defaultStudioSettings: StudioSettings = {
  scale: 2,
  descratch: 0.35,
  descratchFoilOnly: false,
  denoise: 0.2,
  sharpen: 0.5,
  contrast: 0.08,
};

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
  chromeFoil: boolean | null;
  scratchRemoval: string | null;
  denoise: number | null;
  sharpnessDelta: number | null;
  resIn: string | null;
  resOut: string | null;
};

export type LibrarySummary = {
  cards: StoredCard[];
  processed: number;
  auditCount: number;
};

export type LocalScan = {
  id: string;
  name: string;
  url: string;
  width: number;
  height: number;
  selected: boolean;
  sharpnessDelta: number | null;
};
