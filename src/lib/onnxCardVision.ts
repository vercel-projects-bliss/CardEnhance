// src/lib/onnxCardVision.ts
// Browser/WebWorker ONNX Vision Ensemble with persistent Cache Storage.
// Keeps Git/Vercel bundles tiny—models download once on client and cache locally.

import { installWorkerWindowShim } from "./workerWindowShim";
import * as ort from "onnxruntime-web";
import type { CardSurfaceProfile, CardVisionAdapters } from "./adaptiveCardPipeline";

type OrtSession = Awaited<ReturnType<typeof ort.InferenceSession.create>>;
type OrtOutputMap = Record<string, { data: unknown }>;

export interface OnnxVisionModelUrls {
  /** OpenCV Zoo YuNet (~230 KB): face_detection_yunet_2023mar.onnx */
  yunetFaceUrl?: string;
  /** PaddleOCR PP-LCNet_x1_0_doc_ori.onnx (~6.5 MB) */
  docOriUrl?: string;
  /**
   * Optional HuggingFace model id for quantized zero-shot CLIP via @huggingface/transformers
   * (e.g. "Xenova/clip-vit-base-patch32" with dtype "q8", cached automatically in browser Cache API).
   */
  clipModelId?: string;
}

export const DEFAULT_MODEL_URLS: Required<OnnxVisionModelUrls> = {
  // OpenCV Zoo YuNet 2023mar, ~227 KB. GitHub mirror also works:
  // https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx
  yunetFaceUrl:
    "https://huggingface.co/opencv/face_detection_yunet/resolve/main/face_detection_yunet_2023mar.onnx",
  // Official-style PaddleOCR PP-LCNet_x1_0_doc_ori ONNX (~6.47 MB). Public and live.
  docOriUrl:
    "https://huggingface.co/xberg-io/paddleocr-onnx-models/resolve/main/v2/classifiers/PP-LCNet_x1_0_doc_ori.onnx",
  clipModelId: "Xenova/clip-vit-base-patch32",
};

// Git-LFS-backed GitHub copy of the same YuNet blob (CORS *). jsdelivr serves the LFS pointer (131 B), so do not use it.
const YUNET_FALLBACK_URLS = [
  "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
];

const MODEL_CACHE_NAME = "cardenhance-onnx-models-v1";

// @huggingface/transformers@3.8.1 depends on onnxruntime-web@1.22.0-dev, not the
// app's vendored 1.21.0 /ort files. Point its wasm loader at the matching CDN.
const TRANSFORMERS_ORT_WASM =
  "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0-dev.20250409-89f8206ba4/dist/";

export type OnnxVisionStatus = {
  yunet: boolean;
  docOri: boolean;
  clip: boolean;
  clipError: string | null;
  backend: "wasm" | "webgpu";
};

const visionStatus: OnnxVisionStatus = {
  yunet: false,
  docOri: false,
  clip: false,
  clipError: null,
  backend: "wasm",
};

export function getOnnxVisionStatus(): OnnxVisionStatus {
  return { ...visionStatus };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchOneModelUrl(url: string, cache?: Cache): Promise<Uint8Array> {
  if (cache) {
    const hit = await cache.match(url);
    if (hit) return new Uint8Array(await hit.arrayBuffer());
  }
  const res = await withTimeout(fetch(url, { mode: "cors", redirect: "follow" }), 60000, `model fetch ${url}`);
  if (!res.ok) throw new Error(`Failed to fetch model ${url}: ${res.status}`);
  if (cache) {
    try {
      await cache.put(url, res.clone());
    } catch {
      // Quota or opaque-redirect cache failures should not block inference.
    }
  }
  return new Uint8Array(await res.arrayBuffer());
}

async function fetchCachedModelBytes(url: string, fallbackUrls: string[] = []): Promise<Uint8Array> {
  let cache: Cache | undefined;
  if (typeof caches !== "undefined") {
    try {
      cache = await caches.open(MODEL_CACHE_NAME);
    } catch {
      cache = undefined;
    }
  }
  const candidates = [url, ...fallbackUrls];
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return await fetchOneModelUrl(candidate, cache);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Failed to fetch model ${url}`);
}

function configureOrtWasm(): void {
  const scope = globalThis as unknown as { location?: { origin?: string } };
  const origin = scope.location?.origin ?? "";
  // Serve the already-vendored 1.21 WASM from /ort (same files as onnxruntime-web@1.21.0).
  // CDN fallback if the app is opened from a non-HTTP context.
  ort.env.wasm.wasmPaths = origin
    ? `${origin}/ort/`
    : "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/";
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.simd = true;
  ort.env.wasm.proxy = false;
}

/**
 * Probe WebGPU in a *separate* worker so a hung requestAdapter / software
 * adapter cannot block this enhance worker's thread. Time out and terminate
 * the probe if it does not answer.
 */
async function probeWebGpu(timeoutMs = 2500): Promise<boolean> {
  if (typeof Worker === "undefined") return false;
  const nav = globalThis as unknown as { navigator?: { gpu?: unknown } };
  if (!nav.navigator || !("gpu" in nav.navigator)) return false;
  const source = `self.onmessage = async () => {
    try {
      const gpu = self.navigator && self.navigator.gpu;
      if (!gpu || typeof gpu.requestAdapter !== "function") {
        self.postMessage({ ok: false });
        return;
      }
      const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
      if (!adapter || adapter.isFallbackAdapter) {
        self.postMessage({ ok: false });
        return;
      }
      let info = {};
      try { info = adapter.info || (await adapter.requestAdapterInfo?.()) || {}; } catch (e) { /* ignore */ }
      const blob = JSON.stringify(info).toLowerCase();
      if (/swiftshader|llvmpipe|software|microsoft basic render/.test(blob)) {
        self.postMessage({ ok: false });
        return;
      }
      self.postMessage({ ok: true });
    } catch (err) {
      self.postMessage({ ok: false });
    }
  };`;
  let worker: Worker | null = null;
  let url: string | null = null;
  try {
    url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    worker = new Worker(url);
    const ok = await withTimeout(
      new Promise<boolean>((resolve, reject) => {
        worker!.onmessage = (event: MessageEvent<{ ok?: boolean }>) => resolve(Boolean(event.data?.ok));
        worker!.onerror = (event) => reject(event.error ?? new Error(event.message || "webgpu probe failed"));
        worker!.postMessage("probe");
      }),
      timeoutMs,
      "webgpu probe",
    );
    return ok;
  } catch {
    return false;
  } finally {
    try {
      worker?.terminate();
    } catch {
      // ignore
    }
    if (url) URL.revokeObjectURL(url);
  }
}

let webGpuDecision: Promise<boolean> | null = null;

function webGpuAllowed(): Promise<boolean> {
  if (!webGpuDecision) webGpuDecision = probeWebGpu();
  return webGpuDecision;
}

async function createBestSession(modelBytes: Uint8Array): Promise<OrtSession> {
  configureOrtWasm();
  const wasmOptions = {
    executionProviders: ["wasm"] as const,
    graphOptimizationLevel: "all" as const,
  };
  if (await webGpuAllowed()) {
    try {
      const session = await ort.InferenceSession.create(modelBytes, {
        executionProviders: ["webgpu"],
        graphOptimizationLevel: "all",
      });
      visionStatus.backend = "webgpu";
      return session;
    } catch (err) {
      console.warn("WebGPU session failed; using WASM.", errorMessage(err));
    }
  }
  visionStatus.backend = "wasm";
  return ort.InferenceSession.create(modelBytes, wasmOptions);
}

// ---------------------------------------------------------------------------
// 1. YuNet Upright Face + 5-Point Landmark Scorer ([1, 3, 640, 640] BGR 0..255)
// ---------------------------------------------------------------------------
function letterboxBgr640(rgba: Uint8ClampedArray, w: number, h: number): Float32Array {
  const target = 640;
  const scale = Math.min(target / w, target / h);
  const nw = Math.max(1, Math.round(w * scale));
  const nh = Math.max(1, Math.round(h * scale));
  const padX = Math.floor((target - nw) * 0.5);
  const padY = Math.floor((target - nh) * 0.5);

  const plane = target * target;
  const tensor = new Float32Array(3 * plane); // BGR NCHW [0..255]

  for (let y = 0; y < nh; y++) {
    const sy = Math.min(h - 1, Math.floor(y / scale));
    for (let x = 0; x < nw; x++) {
      const sx = Math.min(w - 1, Math.floor(x / scale));
      const p = (sy * w + sx) * 4;
      const dst = (y + padY) * target + (x + padX);
      tensor[dst] = rgba[p + 2]; // B
      tensor[plane + dst] = rgba[p + 1]; // G
      tensor[2 * plane + dst] = rgba[p]; // R
    }
  }
  return tensor;
}

function scoreYuNetOutputs(outputs: OrtOutputMap): number {
  const strides = [8, 16, 32] as const;
  let bestUprightScore = 0;
  let bestInvertedScore = 0;

  for (const s of strides) {
    const clsT = outputs[`cls_${s}`];
    const objT = outputs[`obj_${s}`];
    const kpsT = outputs[`kps_${s}`];
    if (!clsT || !objT || !kpsT) continue;

    const cls = clsT.data as Float32Array;
    const obj = objT.data as Float32Array;
    const kps = kpsT.data as Float32Array;
    const grid = 640 / s;

    for (let r = 0; r < grid; r++) {
      for (let c = 0; c < grid; c++) {
        const idx = r * grid + c;
        const cVal = cls[idx] > 1 || cls[idx] < 0 ? 1 / (1 + Math.exp(-cls[idx])) : cls[idx];
        const oVal = obj[idx] > 1 || obj[idx] < 0 ? 1 / (1 + Math.exp(-obj[idx])) : obj[idx];
        const conf = Math.sqrt(Math.max(0, cVal * oVal));
        // Lower than 0.45 so softer / illustrated / matte faces still vote.
        if (conf < 0.28) continue;

        const base = idx * 10;
        const rEyeX = (c + kps[base]) * s;
        const rEyeY = (r + kps[base + 1]) * s;
        const lEyeX = (c + kps[base + 2]) * s;
        const lEyeY = (r + kps[base + 3]) * s;
        const noseY = (r + kps[base + 5]) * s;
        const rMouthY = (r + kps[base + 7]) * s;
        const lMouthY = (r + kps[base + 9]) * s;

        const eyeMidY = 0.5 * (rEyeY + lEyeY);
        const mouthMidY = 0.5 * (rMouthY + lMouthY);
        const eyeSpan = Math.hypot(lEyeX - rEyeX, lEyeY - rEyeY);
        const eyeTilt = Math.abs(lEyeY - rEyeY);
        if (eyeSpan <= 5 || eyeTilt > eyeSpan * 0.7) continue;

        const vertical = mouthMidY - eyeMidY;
        // Upright: eyes above mouth (y increases downward). Inverted: mouth above eyes.
        if (mouthMidY > noseY && noseY > eyeMidY && vertical > eyeSpan * 0.28) {
          if (conf > bestUprightScore) bestUprightScore = conf;
        } else if (eyeMidY > noseY && noseY > mouthMidY && -vertical > eyeSpan * 0.28) {
          if (conf > bestInvertedScore) bestInvertedScore = conf;
        }
      }
    }
  }
  // Eyes-above-mouth wins; an inverted face on this rotation is a negative vote.
  return Math.max(0, Math.min(1, bestUprightScore - 0.65 * bestInvertedScore));
}

// ---------------------------------------------------------------------------
// 2. PP-LCNet Document Orientation Scorer ([1, 3, 224, 224] ImageNet RGB)
// ---------------------------------------------------------------------------
function preprocessDocOri224(rgba: Uint8ClampedArray, w: number, h: number): Float32Array {
  const shortTarget = 256;
  const crop = 224;
  const scale = shortTarget / Math.min(w, h);
  const rw = Math.max(crop, Math.round(w * scale));
  const rh = Math.max(crop, Math.round(h * scale));
  const offX = Math.floor((rw - crop) * 0.5);
  const offY = Math.floor((rh - crop) * 0.5);

  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];
  const plane = crop * crop;
  const tensor = new Float32Array(3 * plane);

  for (let y = 0; y < crop; y++) {
    const sy = Math.min(h - 1, Math.floor((y + offY) / scale));
    for (let x = 0; x < crop; x++) {
      const sx = Math.min(w - 1, Math.floor((x + offX) / scale));
      const p = (sy * w + sx) * 4;
      const dst = y * crop + x;
      tensor[dst] = (rgba[p] / 255 - mean[0]) / std[0];
      tensor[plane + dst] = (rgba[p + 1] / 255 - mean[1]) / std[1];
      tensor[2 * plane + dst] = (rgba[p + 2] / 255 - mean[2]) / std[2];
    }
  }
  return tensor;
}

function extractClassZeroProb(raw: Float32Array): number {
  if (raw.length < 4) return 0;
  // Check if output is already probabilities summing to ~1, else softmax
  const sum = raw[0] + raw[1] + raw[2] + raw[3];
  const allNonNeg = raw[0] >= 0 && raw[1] >= 0 && raw[2] >= 0 && raw[3] >= 0;
  if (allNonNeg && Math.abs(sum - 1) < 0.05) return raw[0];
  const maxLogit = Math.max(raw[0], raw[1], raw[2], raw[3]);
  const e0 = Math.exp(raw[0] - maxLogit);
  const denom =
    e0 +
    Math.exp(raw[1] - maxLogit) +
    Math.exp(raw[2] - maxLogit) +
    Math.exp(raw[3] - maxLogit);
  return denom > 0 ? e0 / denom : 0;
}

// ---------------------------------------------------------------------------
// CLIP: image encoder + precomputed text embeddings (class + upright/inverted)
// ---------------------------------------------------------------------------
const CLASS_PROMPT_ENTRIES: Array<{ prompt: string; profile: CardSurfaceProfile }> = [
  {
    prompt: "the back of a sports trading card with biography paragraphs, statistics, and copyright fine print",
    profile: "CARD_BACK",
  },
  {
    prompt: "the front of a shiny metallic chrome or holographic foil trading card",
    profile: "CHROME_FOIL",
  },
  {
    prompt: "the front of a clear acetate or dark black-background trading card",
    profile: "DARK_ACETATE_FOIL",
  },
  {
    prompt: "the front of a matte paper photograph trading card",
    profile: "MATTE_RELIC",
  },
  {
    prompt: "the front of a fabric jersey patch or relic memorabilia trading card",
    profile: "MATTE_RELIC",
  },
];

const UPRIGHT_PROMPT = "an upright trading card, right side up";
const INVERTED_PROMPT = "an upside-down trading card, rotated 180 degrees";

type ClipHandle = {
  embedImage: (rgba: Uint8ClampedArray, width: number, height: number) => Promise<Float32Array>;
  classEmbeds: Float32Array[];
  classProfiles: CardSurfaceProfile[];
  uprightEmbed: Float32Array;
  invertedEmbed: Float32Array;
};

function l2Normalize(vec: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
  const inv = sum > 0 ? 1 / Math.sqrt(sum) : 1;
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] * inv;
  return out;
}

function dot(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function softmax(logits: number[]): number[] {
  const max = Math.max(...logits);
  const exps = logits.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((v) => v / sum);
}

function configureTransformersEnv(env: typeof import("@huggingface/transformers").env): void {
  // Bundled workers can look like Node (stubbed fs/path) and then fail looking for local models.
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.useBrowserCache = true;
  env.useFS = false;
  env.useFSCache = false;
  const onnx = env.backends.onnx as { wasm?: { wasmPaths?: string; numThreads?: number; proxy?: boolean; simd?: boolean } };
  onnx.wasm = onnx.wasm ?? {};
  // transformers.js 3.8.1 vendors onnxruntime-web 1.22.0-dev — do not point it at /ort (1.21.0).
  onnx.wasm.wasmPaths = TRANSFORMERS_ORT_WASM;
  onnx.wasm.numThreads = 1;
  onnx.wasm.proxy = false;
  onnx.wasm.simd = true;
}

function toFloatEmbed(raw: unknown): Float32Array {
  if (raw instanceof Float32Array) return l2Normalize(raw);
  if (Array.isArray(raw) && raw[0] instanceof Float32Array) return l2Normalize(raw[0]);
  if (raw && typeof raw === "object" && "data" in (raw as object)) {
    const data = (raw as { data: ArrayLike<number> }).data;
    return l2Normalize(Float32Array.from(data));
  }
  if (Array.isArray(raw)) {
    const first = raw[0];
    if (Array.isArray(first) || first instanceof Float32Array) {
      return l2Normalize(Float32Array.from(first as ArrayLike<number>));
    }
    return l2Normalize(Float32Array.from(raw as number[]));
  }
  throw new Error("Unexpected CLIP embedding shape");
}

async function loadClipEncoder(modelId: string): Promise<ClipHandle> {
  installWorkerWindowShim();
  const transformers = await import("@huggingface/transformers");
  configureTransformersEnv(transformers.env);

  const tokenizer = await transformers.AutoTokenizer.from_pretrained(modelId);
  const processor = await transformers.AutoProcessor.from_pretrained(modelId);
  const textModel = await transformers.CLIPTextModelWithProjection.from_pretrained(modelId, { dtype: "q8" });
  const visionModel = await transformers.CLIPVisionModelWithProjection.from_pretrained(modelId, { dtype: "q8" });

  const allPrompts = [...CLASS_PROMPT_ENTRIES.map((e) => e.prompt), UPRIGHT_PROMPT, INVERTED_PROMPT];
  const textInputs = tokenizer(allPrompts, { padding: true, truncation: true });
  const textOut = (await textModel(textInputs)) as { text_embeds?: unknown };
  const textEmbedsRaw = textOut.text_embeds;
  if (!textEmbedsRaw) throw new Error("CLIP text model did not return text_embeds");

  const rows: Float32Array[] = [];
  if (textEmbedsRaw instanceof Float32Array) {
    const dim = textEmbedsRaw.length / allPrompts.length;
    if (!Number.isInteger(dim) || dim < 8) throw new Error("Unexpected packed CLIP text embedding size");
    for (let i = 0; i < allPrompts.length; i++) {
      rows.push(l2Normalize(textEmbedsRaw.slice(i * dim, (i + 1) * dim)));
    }
  } else if (Array.isArray(textEmbedsRaw)) {
    for (const row of textEmbedsRaw) rows.push(toFloatEmbed(row));
  } else if (typeof textEmbedsRaw === "object" && textEmbedsRaw && "data" in textEmbedsRaw && "dims" in textEmbedsRaw) {
    const tensor = textEmbedsRaw as { data: ArrayLike<number>; dims: number[] };
    const data = Float32Array.from(tensor.data);
    const dim = tensor.dims[tensor.dims.length - 1];
    const count = data.length / dim;
    for (let i = 0; i < count; i++) rows.push(l2Normalize(data.slice(i * dim, (i + 1) * dim)));
  } else {
    throw new Error("Unrecognized CLIP text_embeds format");
  }
  if (rows.length !== allPrompts.length) {
    throw new Error(`Expected ${allPrompts.length} text embeddings, got ${rows.length}`);
  }

  return {
    classEmbeds: rows.slice(0, CLASS_PROMPT_ENTRIES.length),
    classProfiles: CLASS_PROMPT_ENTRIES.map((e) => e.profile),
    uprightEmbed: rows[rows.length - 2],
    invertedEmbed: rows[rows.length - 1],
    async embedImage(rgba, width, height) {
      const image = new transformers.RawImage(new Uint8ClampedArray(rgba), width, height, 4);
      const inputs = await processor(image);
      const out = (await visionModel(inputs)) as { image_embeds?: unknown };
      if (!out.image_embeds) throw new Error("CLIP vision model did not return image_embeds");
      return toFloatEmbed(out.image_embeds);
    },
  };
}

// ---------------------------------------------------------------------------
// Factory: Create Cached Browser Vision Ensemble
// ---------------------------------------------------------------------------
export async function createOnnxCardVisionAdapters(
  urls: OnnxVisionModelUrls = {},
): Promise<CardVisionAdapters> {
  const cfg = { ...DEFAULT_MODEL_URLS, ...urls };
  let yunetSession: OrtSession | null = null;
  let docOriSession: OrtSession | null = null;
  let clipHandle: ClipHandle | null = null;

  const [yunetBytes, docBytes] = await Promise.all([
    cfg.yunetFaceUrl
      ? fetchCachedModelBytes(
          cfg.yunetFaceUrl,
          cfg.yunetFaceUrl === DEFAULT_MODEL_URLS.yunetFaceUrl ? YUNET_FALLBACK_URLS : [],
        ).catch(() => null)
      : null,
    cfg.docOriUrl ? fetchCachedModelBytes(cfg.docOriUrl).catch(() => null) : null,
  ]);

  if (yunetBytes) yunetSession = await createBestSession(yunetBytes).catch(() => null);
  if (docBytes) docOriSession = await createBestSession(docBytes).catch(() => null);

  let clipFailed = false;
  const ensureClip = async () => {
    if (clipHandle) return clipHandle;
    if (clipFailed) return null;
    if (!cfg.clipModelId) {
      visionStatus.clipError = "No CLIP model id configured";
      return null;
    }
    try {
      clipHandle = await loadClipEncoder(cfg.clipModelId);
      visionStatus.clip = true;
      visionStatus.clipError = null;
    } catch (err) {
      clipHandle = null;
      clipFailed = true;
      visionStatus.clip = false;
      visionStatus.clipError = errorMessage(err);
      console.error("CLIP init failed", visionStatus.clipError);
    }
    return clipHandle;
  };

  await ensureClip();
  visionStatus.yunet = Boolean(yunetSession);
  visionStatus.docOri = Boolean(docOriSession);
  console.info("onnx card vision ready", getOnnxVisionStatus());

  return {
    scoreUprightFace: yunetSession
      ? async (rgba, width, height) => {
          const inputName = yunetSession!.inputNames[0];
          const data = letterboxBgr640(rgba, width, height);
          const tensor = new ort.Tensor("float32", data, [1, 3, 640, 640]);
          const outputs = await yunetSession!.run({ [inputName]: tensor });
          return scoreYuNetOutputs(outputs);
        }
      : undefined,

    scoreUprightDoc: docOriSession
      ? async (rgba, width, height) => {
          const inputName = docOriSession!.inputNames[0];
          const data = preprocessDocOri224(rgba, width, height);
          const tensor = new ort.Tensor("float32", data, [1, 3, 224, 224]);
          const outputs = await docOriSession!.run({ [inputName]: tensor });
          const firstOut = outputs[docOriSession!.outputNames[0]];
          return extractClassZeroProb(firstOut.data as Float32Array);
        }
      : undefined,

    scoreUprightClip: async (rgba, width, height) => {
      const clip = await ensureClip();
      if (!clip) return 0;
      const image = await clip.embedImage(rgba, width, height);
      const probs = softmax([dot(image, clip.uprightEmbed) * 100, dot(image, clip.invertedEmbed) * 100]);
      return probs[0];
    },

    classifyCardSemantics: async (rgba, width, height) => {
      const clip = await ensureClip();
      if (!clip) return {};
      const image = await clip.embedImage(rgba, width, height);
      const logits = clip.classEmbeds.map((emb) => dot(image, emb) * 100);
      const probs = softmax(logits);
      const scores: Partial<Record<CardSurfaceProfile, number>> = {};
      for (let i = 0; i < probs.length; i++) {
        const profile = clip.classProfiles[i];
        scores[profile] = Math.max(scores[profile] ?? 0, probs[i]);
      }
      // matte + relic were separate prompts; use their combined mass for MATTE_RELIC
      const matteMass = clip.classProfiles.reduce(
        (sum, profile, i) => sum + (profile === "MATTE_RELIC" ? probs[i] : 0),
        0,
      );
      if (matteMass > 0) scores.MATTE_RELIC = matteMass;
      return scores;
    },
  };
}
