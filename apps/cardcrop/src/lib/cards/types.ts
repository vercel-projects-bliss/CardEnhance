export type OutputFormat = "png" | "jpg" | "webp";

export type JobStatus = "queued" | "processing" | "completed" | "failed";

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

export type EnhancementSettings = {
  blemishRemoval: boolean;
  blemishSensitivity: number;
  descratch: boolean;
  sharpening: boolean;
  sharpeningAmount: number;
  colorCorrection: boolean;
  colorTemperature: number;
  saturation: number;
  contrastEnhancement: boolean;
  contrastAmount: number;
  noiseReduction: boolean;
  noiseReductionStrength: number;
  upscaling: boolean;
  upscaleFactor: 1 | 2 | 4;
  preserveHolographic: boolean;
  autoCrop: boolean;
  identifyCards: boolean;
  visionOcr: boolean;
  cnnRestore: boolean;
  concurrency: 1 | 2 | 3 | 4;
  outputFormat: OutputFormat;
  outputQuality: number;
};

export const defaultSettings: EnhancementSettings = {
  blemishRemoval: true,
  blemishSensitivity: 0.7,
  descratch: true,
  sharpening: true,
  sharpeningAmount: 0.5,
  colorCorrection: true,
  colorTemperature: 0,
  saturation: 1,
  contrastEnhancement: true,
  contrastAmount: 0.3,
  noiseReduction: true,
  noiseReductionStrength: 0.45,
  upscaling: false,
  upscaleFactor: 2,
  preserveHolographic: true,
  autoCrop: true,
  identifyCards: true,
  visionOcr: true,
  cnnRestore: false,
  concurrency: 1,
  outputFormat: "png",
  outputQuality: 92,
};

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const DEFAULT_MAX_IMAGE_BYTES = 4_000_000;

export type ServiceStatus = {
  configured: boolean;
  ready: boolean;
  maxBytes: number;
  mode?: "paired" | "unpaired";
  generator?: string;
  device?: string;
  checkpointEpoch?: number;
  detail?: string;
};
