// src/workers/enhance.worker.ts
/// <reference lib="webworker" />

import {
  runAdaptiveCardPipeline,
  splitMultiCardSheet,
  type AdaptiveAuditMetrics,
  type AdaptivePipelineOptions,
  type CardVisionAdapters,
} from "../lib/adaptiveCardPipeline";
import {
  createOnnxCardVisionAdapters,
  getOnnxVisionStatus,
  type OnnxVisionModelUrls,
} from "../lib/onnxCardVision";

export type EnhanceWorkerRequestId = string | number;
export type EnhanceWorkerOptions = Omit<AdaptivePipelineOptions, keyof CardVisionAdapters>;

export type EnhanceWorkerRequest =
  | {
      type: "card.initModels";
      id: EnhanceWorkerRequestId;
      urls?: OnnxVisionModelUrls;
    }
  | {
      type: "card.enhance";
      id: EnhanceWorkerRequestId;
      image: ImageData;
      options?: EnhanceWorkerOptions;
    }
  | {
      type: "sheet.enhance";
      id: EnhanceWorkerRequestId;
      image: ImageData;
      options?: EnhanceWorkerOptions;
    };

export interface SheetCardOutput {
  index: number;
  bounds: { x: number; y: number; width: number; height: number };
  image: ImageData;
  audit: AdaptiveAuditMetrics;
}

export type EnhanceWorkerResponse =
  | { type: "card.initModels.ready"; id: EnhanceWorkerRequestId }
  | {
      type: "card.enhance.result";
      id: EnhanceWorkerRequestId;
      image: ImageData;
      audit: AdaptiveAuditMetrics;
    }
  | {
      type: "sheet.enhance.result";
      id: EnhanceWorkerRequestId;
      cards: SheetCardOutput[];
    }
  | {
      type: "card.enhance.error";
      id: EnhanceWorkerRequestId;
      error: { name: string; message: string };
    };

const workerScope = self as unknown as DedicatedWorkerGlobalScope;
let visionAdapters: CardVisionAdapters = {};
let initPromise: Promise<void> | null = null;

/** Optional hook to register main's existing OCR tiebreaker inside the worker. */
export function setEnhanceWorkerDependencies(extra: Partial<CardVisionAdapters>): void {
  visionAdapters = { ...visionAdapters, ...extra };
}

async function ensureModelsLoaded(urls?: OnnxVisionModelUrls): Promise<void> {
  if (!initPromise) {
    initPromise = createOnnxCardVisionAdapters(urls)
      .then((loaded) => {
        // Keep any explicitly injected adapters (e.g. ocrOrientationScore) while adding ONNX models
        visionAdapters = { ...loaded, ...visionAdapters };
      })
      .catch(() => {
        // Offline / blocked CDN fallback: pipeline still runs deterministic heuristics cleanly
      });
  }
  await initPromise;
}


function stampVisionStatus(audit: AdaptiveAuditMetrics): AdaptiveAuditMetrics {
  const status = getOnnxVisionStatus();
  audit.clipReady = status.clip;
  audit.clipError = status.clipError;
  audit.visionBackend = status.backend;
  return audit;
}

async function handleMessage(request: EnhanceWorkerRequest): Promise<void> {
  try {
    if (!request || typeof request !== "object") {
      throw new TypeError("Invalid worker request.");
    }

    if (request.type === "card.initModels") {
      await ensureModelsLoaded(request.urls);
      const ready: EnhanceWorkerResponse = {
        type: "card.initModels.ready",
        id: request.id,
      };
      workerScope.postMessage(ready);
      return;
    }

    if (!request.image || !(request.image.data instanceof Uint8ClampedArray)) {
      throw new TypeError("request.image must be ImageData.");
    }

    await ensureModelsLoaded();

    if (request.type === "card.enhance") {
      const result = await runAdaptiveCardPipeline(
        request.image.data,
        request.image.width,
        request.image.height,
        { ...request.options, ...visionAdapters },
      );
      const pixels = new Uint8ClampedArray(result.rgba) as Uint8ClampedArray<ArrayBuffer>;
      const image = new ImageData(pixels, result.width, result.height);
      const response: EnhanceWorkerResponse = {
        type: "card.enhance.result",
        id: request.id,
        image,
        audit: stampVisionStatus(result.audit),
      };
      workerScope.postMessage(response, [image.data.buffer]);
      return;
    }

    if (request.type === "sheet.enhance") {
      // 1. Split 1x2 / 2x2 / 2x3 / 3x3 flatbed sheets into individual card crops FIRST
      const slices = splitMultiCardSheet(
        request.image.data,
        request.image.width,
        request.image.height,
      );

      const cards: SheetCardOutput[] = [];
      const transferables: ArrayBuffer[] = [];

      // 2. Orient, classify, and adaptively restore each split card independently
      for (const slice of slices) {
        const result = await runAdaptiveCardPipeline(
          slice.rgba,
          slice.width,
          slice.height,
          { ...request.options, ...visionAdapters },
        );
        const pixels = new Uint8ClampedArray(result.rgba) as Uint8ClampedArray<ArrayBuffer>;
        const image = new ImageData(pixels, result.width, result.height);
        cards.push({
          index: slice.index,
          bounds: slice.bounds,
          image,
          audit: stampVisionStatus(result.audit),
        });
        transferables.push(image.data.buffer);
      }

      const response: EnhanceWorkerResponse = {
        type: "sheet.enhance.result",
        id: request.id,
        cards,
      };
      workerScope.postMessage(response, transferables);
      return;
    }

    throw new TypeError("Unsupported worker request type.");
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    const reqId =
      request && typeof request === "object" && "id" in request ? request.id : "unknown";
    const response: EnhanceWorkerResponse = {
      type: "card.enhance.error",
      id: reqId,
      error: { name: error.name, message: error.message },
    };
    workerScope.postMessage(response);
  }
}

// Serialize jobs inside each worker instance to cap peak WebGPU/WASM memory on 100+ card batches
let queue: Promise<void> = Promise.resolve();
workerScope.onmessage = (event: MessageEvent<EnhanceWorkerRequest>): void => {
  queue = queue.then(() => handleMessage(event.data));
};
