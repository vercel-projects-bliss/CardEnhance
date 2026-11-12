export type StudioSettings = {
  scale: number;
  descratch: number;
  descratchFoilOnly: boolean;
  denoise: number;
  sharpen: number;
  contrast: number;
  adaptive: boolean;
};

export const defaultStudioSettings: StudioSettings = {
  scale: 2,
  descratch: 0.35,
  descratchFoilOnly: false,
  denoise: 0.2,
  sharpen: 0.5,
  contrast: 0.08,
  adaptive: true,
};

export type Rotation = 0 | 90 | 180 | 270;

export type CardClass = "chrome_foil_front" | "matte_paper_front" | "card_back";

export type CardSurfaceProfile =
  | "CARD_BACK"
  | "CHROME_FOIL"
  | "DARK_ACETATE_FOIL"
  | "MATTE_RELIC";

export type AppliedParams = {
  descratch: number;
  denoise: number;
  sharpen: number;
  contrast: number;
  blackPointLiftFix?: number;
  highlightRecovery?: number;
  scale?: number;
};

export type AdaptiveStats = {
  sharpness: number;
  noiseFloor: number;
  specularRatio: number;
  dustSpikes: number;
};

export type QuadCorners = {
  x: number;
  y: number;
}[];

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


export type CardSide = "front" | "back" | "unknown";

export type CropEngine = "yolo26" | "yolo" | "card" | "contour" | null;

export type OcrEngine = "vision" | "ocr" | "filename" | "paddleocr" | "paddleocr-vl";

export type CardIdentity = {
  player: string | null;
  year: number | null;
  manufacturer: string | null;
  set: string | null;
  number: string | null;
  parallel: string | null;
  side: CardSide;
  confidence: number;
  rawText: string;
  engine?: OcrEngine;
};

export type ScanStatus = "idle" | "queued" | "processing" | "completed" | "failed";

export type ChromeFoilMetrics = {
  isChromeFoil: boolean;
  specularRatio: number;
  specularPeakRatio: number;
  metallicContrast: number;
};

export type EnhanceAudit = {
  filename: string;
  inputWidth: number;
  inputHeight: number;
  outputWidth: number;
  outputHeight: number;
  isChromeFoil: boolean;
  specularRatio: number;
  specularPeakRatio: number;
  metallicContrast: number;
  settings: StudioSettings;
  sharpnessBefore: number;
  sharpnessAfter: number;
  sharpnessDelta: number;
  timestamp: string;
  orientationDetected: Rotation;
  orientationApplied: Rotation;
  userRotation: Rotation;
  cropQuad: QuadCorners | null;
  cropMargin: number | null;
  cardClass: CardClass;
  adaptiveStats: AdaptiveStats | null;
  chosenParams: StudioSettings;
  isLandscape: boolean;
  orientationUncertain: boolean;
  ocrWordCount: number;
  profile?: CardSurfaceProfile | null;
  appliedParams?: AppliedParams | null;
  orientationSource?: string | null;
  orientationConfidence?: number | null;
  clipReady?: boolean;
  clipError?: string | null;
  visionBackend?: "wasm" | "webgpu" | null;
};


export type LocalScan = {
  id: string;
  name: string;
  url: string;
  originalUrl: string;
  width: number;
  height: number;
  inputWidth: number;
  inputHeight: number;
  selected: boolean;
  status: ScanStatus;
  error?: string;
  stage?: string;
  sharpnessDelta: number | null;
  sharpnessBefore?: number | null;
  sharpnessAfter?: number | null;
  isChromeFoil?: boolean | null;
  specularRatio?: number | null;
  specularPeakRatio?: number | null;
  metallicContrast?: number | null;
  processedAt?: string | null;
  settingsUsed?: StudioSettings | null;
  sourceId?: string;
  cardIndex?: number;
  userRotation?: Rotation;
  orientationDetected?: Rotation | null;
  orientationApplied?: Rotation | null;
  cropQuad?: QuadCorners | null;
  cropMargin?: number | null;
  cardClass?: CardClass | null;
  adaptiveStats?: AdaptiveStats | null;
  chosenParams?: StudioSettings | null;
  isLandscape?: boolean;
  previewUrl?: string;
  orientationUncertain?: boolean;
  ocrWordCount?: number;
  profile?: CardSurfaceProfile | null;
  appliedParams?: AppliedParams | null;
  orientationSource?: string | null;
  orientationConfidence?: number | null;
  clipReady?: boolean;
  clipError?: string | null;
  visionBackend?: "wasm" | "webgpu" | null;
};

