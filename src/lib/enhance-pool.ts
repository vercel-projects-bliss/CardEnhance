import type { AdaptiveAuditMetrics, AdaptivePipelineOptions } from "./adaptiveCardPipeline";
import type { EnhanceWorkerRequest, EnhanceWorkerResponse, SheetCardOutput } from "../workers/enhance.worker";
import type { StudioSettings } from "./types";

export type SheetEnhanceCard = SheetCardOutput;

function spawnEnhanceWorker() {
  return new Worker(new URL("../workers/enhance.worker.ts", import.meta.url), {
    type: "module",
  });
}

function settingsToOptions(
  settings: StudioSettings,
  manualRotationDeg?: AdaptivePipelineOptions["manualRotationDeg"],
): AdaptivePipelineOptions {
  return {
    mode: settings.adaptive ? "adaptive" : "manual",
    scale: settings.scale,
    descratch: settings.descratch,
    onlyChromeDescratch: settings.descratchFoilOnly,
    denoise: settings.denoise,
    sharpen: settings.sharpen,
    contrast: settings.contrast,
    manualRotationDeg: manualRotationDeg ?? null,
  };
}

function requestId(): string {
  return crypto.randomUUID();
}

function postAndWait(
  worker: Worker,
  request: EnhanceWorkerRequest,
  transfer: Transferable[] = [],
  timeoutMs = 300000,
): Promise<EnhanceWorkerResponse> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      reject(new Error("Enhance timed out"));
    }, timeoutMs);
    const onMessage = (event: MessageEvent<EnhanceWorkerResponse>) => {
      if (!event.data || event.data.id !== request.id) return;
      clearTimeout(timer);
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      if (event.data.type === "card.enhance.error") {
        reject(new Error(event.data.error.message));
        return;
      }
      resolve(event.data);
    };
    const onError = (err: ErrorEvent) => {
      clearTimeout(timer);
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      reject(err.error ?? new Error(err.message));
    };
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.postMessage(request, transfer);
  });
}

function cloneImage(image: ImageData): { image: ImageData; buffer: ArrayBuffer } {
  const copy = new Uint8ClampedArray(image.data);
  return {
    image: new ImageData(copy, image.width, image.height),
    buffer: copy.buffer,
  };
}

export function defaultPoolSize() {
  const hw = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 2;
  return Math.max(1, Math.min(4, hw - 1));
}

export function createEnhancePool(size = defaultPoolSize()) {
  const n = Math.max(1, Math.min(4, Math.round(size) || 1));
  const idle: Worker[] = Array.from({ length: n }, spawnEnhanceWorker);
  const waiters: Array<(worker: Worker) => void> = [];
  const ready = new WeakSet<Worker>();
  let closed = false;

  function acquire(): Promise<Worker> {
    if (closed) return Promise.reject(new Error("Pool closed"));
    const worker = idle.pop();
    if (worker) return Promise.resolve(worker);
    return new Promise((resolve) => waiters.push(resolve));
  }

  function release(worker: Worker) {
    if (closed) {
      worker.terminate();
      return;
    }
    const next = waiters.shift();
    if (next) next(worker);
    else idle.push(worker);
  }

  async function ensureReady(worker: Worker) {
    if (ready.has(worker)) return;
    await postAndWait(
      worker,
      { type: "card.initModels", id: requestId() },
      [],
      300000,
    );
    ready.add(worker);
  }

  async function withWorker<T>(fn: (worker: Worker) => Promise<T>, retries = 1): Promise<T> {
    let last: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const worker = await acquire();
      try {
        const result = await fn(worker);
        release(worker);
        return result;
      } catch (err) {
        last = err;
        worker.terminate();
        if (!closed) release(spawnEnhanceWorker());
      }
    }
    throw last instanceof Error ? last : new Error("Enhance failed");
  }

  return {
    size: n,
    async initModels(): Promise<void> {
      // Load models on one worker first so the others reuse Cache Storage
      // instead of racing four CLIP / ONNX downloads.
      const workers = [...idle];
      const first = workers.shift();
      if (first) {
        try {
          await ensureReady(first);
        } catch (err) {
          console.warn("ONNX model init failed; continuing with heuristic fallback.", err);
        }
      }
      await Promise.all(
        workers.map(async (worker) => {
          try {
            await ensureReady(worker);
          } catch (err) {
            console.warn("ONNX model init failed on a pool worker; heuristic fallback.", err);
          }
        }),
      );
    },
    async sheetEnhance(
      image: ImageData,
      settings: StudioSettings,
      manualRotationDeg?: AdaptivePipelineOptions["manualRotationDeg"],
    ): Promise<SheetEnhanceCard[]> {
      return withWorker(async (worker) => {
        await ensureReady(worker);
        const payload = cloneImage(image);
        const response = await postAndWait(
          worker,
          {
            type: "sheet.enhance",
            id: requestId(),
            image: payload.image,
            options: settingsToOptions(settings, manualRotationDeg),
          },
          [payload.buffer],
        );
        if (response.type !== "sheet.enhance.result") {
          throw new Error("Unexpected sheet enhance response");
        }
        return response.cards;
      });
    },
    async cardEnhance(
      image: ImageData,
      settings: StudioSettings,
      manualRotationDeg?: AdaptivePipelineOptions["manualRotationDeg"],
    ): Promise<{ image: ImageData; audit: AdaptiveAuditMetrics }> {
      return withWorker(async (worker) => {
        await ensureReady(worker);
        const payload = cloneImage(image);
        const response = await postAndWait(
          worker,
          {
            type: "card.enhance",
            id: requestId(),
            image: payload.image,
            options: settingsToOptions(settings, manualRotationDeg),
          },
          [payload.buffer],
        );
        if (response.type !== "card.enhance.result") {
          throw new Error("Unexpected card enhance response");
        }
        return { image: response.image, audit: response.audit };
      });
    },
    terminate() {
      closed = true;
      for (const worker of idle) worker.terminate();
      idle.length = 0;
      waiters.length = 0;
    },
  };
}
