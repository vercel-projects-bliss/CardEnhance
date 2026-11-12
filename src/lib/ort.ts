/**
 * Shared ONNX Runtime Web loader. YOLO26 and PP-OCR det share one WASM runtime.
 */

type OrtTensor = { data: Float32Array; dims: number[] };
export type OrtSession = {
  inputNames: string[];
  outputNames: string[];
  run: (feeds: Record<string, unknown>) => Promise<Record<string, OrtTensor>>;
};
type OrtModule = {
  env: { wasm: { wasmPaths: string; numThreads: number; simd: boolean; proxy: boolean } };
  Tensor: new (type: string, data: Float32Array, dims: number[]) => unknown;
  InferenceSession: {
    create: (path: string, opts: Record<string, unknown>) => Promise<OrtSession>;
  };
};

let ortRef: OrtModule | null = null;

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export async function getOrt(): Promise<OrtModule> {
  if (ortRef) return ortRef;
  const ort = (await import("onnxruntime-web")) as unknown as OrtModule;
  const origin = window.location.origin;
  ort.env.wasm.wasmPaths = `${origin}/ort/`;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.simd = true;
  ort.env.wasm.proxy = false;
  ortRef = ort;
  return ort;
}

export async function createSession(path: string, timeoutMs = 25000): Promise<OrtSession> {
  const ort = await getOrt();
  return withTimeout(
    ort.InferenceSession.create(path, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    }),
    timeoutMs,
    `Model timed out: ${path}`,
  );
}
