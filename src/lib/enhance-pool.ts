import type { StudioSettings } from "./types";
import type { EnhanceResult } from "./enhance-math";

export type EnhanceOk = EnhanceResult;

function spawnEnhanceWorker() {
  return new Worker(new URL("../workers/enhance.worker.ts", import.meta.url), {
    type: "module",
  });
}

function runOnWorker(
  worker: Worker,
  image: ImageData,
  settings: StudioSettings,
): Promise<EnhanceOk> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      reject(new Error("Enhance timed out"));
    }, 90000);
    const onMessage = (event: MessageEvent) => {
      if (event.data.id !== id) return;
      clearTimeout(timer);
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      if (event.data.error) {
        reject(new Error(event.data.error));
        return;
      }
      const data = new Uint8ClampedArray(event.data.buffer);
      resolve({
        data,
        width: event.data.width,
        height: event.data.height,
        chromeFoil: {
          isChromeFoil: event.data.isChromeFoil,
          specularRatio: event.data.specularRatio,
          specularPeakRatio: event.data.specularPeakRatio,
          metallicContrast: event.data.metallicContrast,
        },
        sharpnessBefore: event.data.sharpnessBefore,
        sharpnessAfter: event.data.sharpnessAfter,
        sharpnessDelta: event.data.sharpnessDelta,
      });
    };
    const onError = (err: ErrorEvent) => {
      clearTimeout(timer);
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      reject(err.error ?? new Error(err.message));
    };
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    const copy = new Uint8ClampedArray(image.data);
    worker.postMessage(
      {
        id,
        width: image.width,
        height: image.height,
        buffer: copy.buffer,
        settings,
      },
      [copy.buffer],
    );
  });
}

export function createEnhancePool(size = 2) {
  const n = Math.max(1, Math.min(4, Math.round(size) || 1));
  const idle: Worker[] = Array.from({ length: n }, spawnEnhanceWorker);
  const waiters: Array<(worker: Worker) => void> = [];
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

  return {
    size: n,
    async enhance(image: ImageData, settings: StudioSettings, retries = 1): Promise<EnhanceOk> {
      let last: unknown;
      for (let attempt = 0; attempt <= retries; attempt++) {
        const worker = await acquire();
        try {
          const result = await runOnWorker(worker, image, settings);
          release(worker);
          return result;
        } catch (err) {
          last = err;
          worker.terminate();
          if (!closed) release(spawnEnhanceWorker());
        }
      }
      throw last instanceof Error ? last : new Error("Enhance failed");
    },
    terminate() {
      closed = true;
      for (const worker of idle) worker.terminate();
      idle.length = 0;
      waiters.length = 0;
    },
  };
}
