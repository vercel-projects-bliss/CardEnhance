// src/lib/onnxCardVision.ts
// Browser/WebWorker ONNX Vision Ensemble with persistent Cache Storage.
// Keeps Git/Vercel bundles tiny—models download once on client and cache locally.

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

const MODEL_CACHE_NAME = "cardenhance-onnx-models-v1";

async function fetchCachedModelBytes(url: string): Promise<Uint8Array> {
  if (typeof caches !== "undefined") {
    try {
      const cache = await caches.open(MODEL_CACHE_NAME);
      const hit = await cache.match(url);
      if (hit) return new Uint8Array(await hit.arrayBuffer());
      const res = await fetch(url, { mode: "cors" });
      if (!res.ok) throw new Error(`Failed to fetch model ${url}: ${res.status}`);
      await cache.put(url, res.clone());
      return new Uint8Array(await res.arrayBuffer());
    } catch {
      // Fallback to direct fetch if Cache Storage is unavailable in private context
    }
  }
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) throw new Error(`Failed to fetch model ${url}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
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

async function createBestSession(modelBytes: Uint8Array): Promise<OrtSession> {
  configureOrtWasm();
  const hasWebGpu = typeof navigator !== "undefined" && "gpu" in navigator;
  if (hasWebGpu) {
    try {
      return await ort.InferenceSession.create(modelBytes, {
        executionProviders: ["webgpu", "wasm"],
        graphOptimizationLevel: "all",
      });
    } catch {
      // Fallback cleanly to WASM
    }
  }
  return ort.InferenceSession.create(modelBytes, {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  });
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
        if (conf < 0.45) continue;

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

        // Strict anatomical uprightness: eyes level, nose below eyes, mouth below nose
        if (
          eyeSpan > 6 &&
          mouthMidY > noseY &&
          noseY > eyeMidY &&
          mouthMidY - eyeMidY > eyeSpan * 0.42 &&
          eyeTilt < eyeSpan * 0.65 &&
          lEyeX > rEyeX - eyeSpan * 0.2
        ) {
          if (conf > bestUprightScore) bestUprightScore = conf;
        }
      }
    }
  }
  return bestUprightScore;
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
// Factory: Create Cached Browser Vision Ensemble
// ---------------------------------------------------------------------------
export async function createOnnxCardVisionAdapters(
  urls: OnnxVisionModelUrls = {},
): Promise<CardVisionAdapters> {
  const cfg = { ...DEFAULT_MODEL_URLS, ...urls };
  let yunetSession: OrtSession | null = null;
  let docOriSession: OrtSession | null = null;
  let clipClassifier: ((img: unknown, labels: string[]) => Promise<Array<{ label: string; score: number }>>) | null =
    null;

  const [yunetBytes, docBytes] = await Promise.all([
    cfg.yunetFaceUrl ? fetchCachedModelBytes(cfg.yunetFaceUrl).catch(() => null) : null,
    cfg.docOriUrl ? fetchCachedModelBytes(cfg.docOriUrl).catch(() => null) : null,
  ]);

  if (yunetBytes) yunetSession = await createBestSession(yunetBytes).catch(() => null);
  if (docBytes) docOriSession = await createBestSession(docBytes).catch(() => null);

  // Lazy load quantized q8 CLIP via @huggingface/transformers if installed
  const ensureClip = async () => {
    if (clipClassifier || !cfg.clipModelId) return clipClassifier;
    try {
      const transformers = await import("@huggingface/transformers");
      const pipe = await transformers.pipeline(
        "zero-shot-image-classification",
        cfg.clipModelId,
        { dtype: "q8" },
      );
      clipClassifier = pipe as unknown as typeof clipClassifier;
    } catch {
      clipClassifier = null;
    }
    return clipClassifier;
  };

  const CARD_PROMPTS: Record<string, CardSurfaceProfile> = {
    "the back side of a sports trading card with biography paragraphs, stats, and fine print copyright text":
      "CARD_BACK",
    "a shiny metallic chrome refractor or holographic rainbow foil trading card front":
      "CHROME_FOIL",
    "a dark black background or clear transparent acetate trading card front":
      "DARK_ACETATE_FOIL",
    "a flat matte paper trading card front or fabric jersey patch relic card":
      "MATTE_RELIC",
  };
  const PROMPT_LABELS = Object.keys(CARD_PROMPTS);

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

    classifyCardSemantics: async (rgba, width, height) => {
      const clf = await ensureClip();
      if (!clf) return {};
      const transformers = await import("@huggingface/transformers");
      const rawImg = new transformers.RawImage(new Uint8ClampedArray(rgba), width, height, 4);
      const preds = await clf(rawImg, PROMPT_LABELS);
      const scores: Partial<Record<CardSurfaceProfile, number>> = {};
      for (const p of preds) {
        const mapped = CARD_PROMPTS[p.label];
        if (mapped) scores[mapped] = p.score;
      }
      return scores;
    },
  };
}
