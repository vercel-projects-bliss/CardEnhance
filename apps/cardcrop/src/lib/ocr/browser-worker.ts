import type { Worker, WorkerOptions } from "tesseract.js";

// Tesseract reports language/init failures through errorHandler, but its
// createWorker promise can remain pending. Race that callback and a deadline
// so a failed download never locks the workspace in its busy state.
export async function initializeOcrWorker(
  options: Partial<WorkerOptions>,
  timeoutMs = 60_000,
): Promise<Worker> {
  const { createWorker } = await import("tesseract.js");
  let rejectFailure!: (error: Error) => void;
  const failure = new Promise<never>((_, reject) => {
    rejectFailure = reject;
  });
  const timer = setTimeout(
    () => rejectFailure(new Error("OCR initialization timed out")),
    timeoutMs,
  );
  let abandoned = false;
  const initializing = createWorker("eng", 1, {
    ...options,
    errorHandler: (error: unknown) => {
      rejectFailure(error instanceof Error ? error : new Error(String(error)));
    },
  }).then((worker) => {
    // If initialization finishes after the deadline, do not leave a live worker.
    if (abandoned) void worker.terminate();
    return worker;
  });
  try {
    return await Promise.race([initializing, failure]);
  } catch (error) {
    abandoned = true;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
