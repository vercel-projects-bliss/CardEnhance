/**
 * A single shared Tesseract worker (internally threaded) with a queue so
 * 100+ scans don't spawn extra WASM heaps. Used for orientation OCR / OSD.
 */
import type { Rotation } from "./types";
import { scoreOcrWords, type OcrRotationScore, type OcrWord } from "./ocr-score";

type TessWorker = {
  setParameters?: (params: Record<string, string>) => Promise<void>;
  detect?: (image: Blob | HTMLCanvasElement) => Promise<{
    data: { orientation_degrees?: number; orientation_confidence?: number };
  }>;
  recognize: (image: Blob | HTMLCanvasElement) => Promise<{
    data: {
      text: string;
      confidence: number;
      words?: Array<{ text: string; confidence: number }>;
    };
  }>;
  terminate?: () => Promise<void>;
};

let workerPromise: Promise<TessWorker> | null = null;
let chain: Promise<void> = Promise.resolve();

function tessPaths() {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return {
    workerPath: `${origin}/tess/worker.min.js`,
    corePath: `${origin}/tess/tesseract-core-simd-lstm.wasm.js`,
    langPath: `${origin}/tess`,
  };
}

async function getWorker(): Promise<TessWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      const paths = tessPaths();
      let worker;
      try {
        worker = await createWorker(["eng", "osd"], 1, {
          workerPath: paths.workerPath,
          corePath: paths.corePath,
          langPath: paths.langPath,
          gzip: true,
          workerBlobURL: false,
          logger: () => {},
        });
      } catch {
        worker = await createWorker("eng", 1, {
          workerPath: paths.workerPath,
          corePath: paths.corePath,
          langPath: paths.langPath,
          gzip: true,
          workerBlobURL: false,
          logger: () => {},
        });
      }
      const tess = worker as unknown as TessWorker;
      await tess.setParameters?.({
        user_defined_dpi: "150",
        tessedit_char_whitelist:
          "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-'./",
      });
      return tess;
    })();
  }
  return workerPromise;
}

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function ocrRecognize(
  image: Blob | HTMLCanvasElement,
): Promise<{ words: OcrWord[]; text: string; confidence: number }> {
  return enqueue(async () => {
    const worker = await getWorker();
    await worker.setParameters?.({ tessedit_pageseg_mode: "6" });
    const result = await worker.recognize(image);
    const words = (result.data.words ?? []).map((w) => ({
      text: w.text ?? "",
      confidence: w.confidence ?? 0,
    }));
    return { words, text: result.data.text ?? "", confidence: result.data.confidence ?? 0 };
  });
}

export async function ocrDetectOrientation(
  image: Blob | HTMLCanvasElement,
): Promise<{ degrees: Rotation; confidence: number } | null> {
  return enqueue(async () => {
    const worker = await getWorker();
    if (!worker.detect) return null;
    try {
      const result = await worker.detect(image);
      const deg = result.data.orientation_degrees;
      const conf = result.data.orientation_confidence ?? 0;
      if (deg === 0 || deg === 90 || deg === 180 || deg === 270) {
        return { degrees: deg, confidence: conf };
      }
      return null;
    } catch {
      return null;
    }
  });
}

export async function scoreRotationImage(
  image: Blob | HTMLCanvasElement,
  rotation: Rotation,
): Promise<OcrRotationScore> {
  const rec = await ocrRecognize(image);
  const scored = scoreOcrWords(rec.words, rec.text);
  return { rotation, ...scored };
}

export async function terminateTess() {
  if (!workerPromise) return;
  try {
    const w = await workerPromise;
    await w.terminate?.();
  } catch {
    /* ignore */
  }
  workerPromise = null;
}
