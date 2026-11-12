import { classifyCard, mapAdaptiveParams, measureAdaptiveStats } from "../lib/classify";
import { processEnhance, type ScaleFn } from "../lib/enhance-math";
import type { StudioSettings } from "../lib/types";

type InMsg = {
  id: string;
  width: number;
  height: number;
  buffer: ArrayBuffer;
  settings: StudioSettings;
  ocrWordCount?: number;
};

async function highQualityScale(
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Promise<Uint8ClampedArray> {
  const source = new ImageData(new Uint8ClampedArray(src), srcW, srcH);
  const steps: Array<{ w: number; h: number }> = [];
  let w = srcW;
  let h = srcH;
  // Multi-step upsample (no more than 2× per hop) then a final exact size.
  while (w * 2 < dstW || h * 2 < dstH) {
    w = Math.min(dstW, w * 2);
    h = Math.min(dstH, h * 2);
    steps.push({ w, h });
  }
  if (w !== dstW || h !== dstH) steps.push({ w: dstW, h: dstH });

  let current = source;
  for (const step of steps) {
    try {
      const bmp = await createImageBitmap(current, {
        resizeWidth: step.w,
        resizeHeight: step.h,
        resizeQuality: "high",
      } as ImageBitmapOptions);
      const canvas = new OffscreenCanvas(step.w, step.h);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("OffscreenCanvas unavailable");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bmp, 0, 0, step.w, step.h);
      bmp.close();
      current = ctx.getImageData(0, 0, step.w, step.h);
    } catch {
      const canvas = new OffscreenCanvas(step.w, step.h);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("OffscreenCanvas unavailable");
      const tmp = new OffscreenCanvas(current.width, current.height);
      const tctx = tmp.getContext("2d");
      if (!tctx) throw new Error("OffscreenCanvas unavailable");
      tctx.putImageData(current, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(tmp, 0, 0, step.w, step.h);
      current = ctx.getImageData(0, 0, step.w, step.h);
    }
  }
  return current.data;
}

const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<InMsg>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

const scaleFn: ScaleFn = highQualityScale;

ctx.onmessage = (event: MessageEvent<InMsg>) => {
  const { id, width, height, buffer, settings, ocrWordCount } = event.data;
  const src = new Uint8ClampedArray(buffer);
  const classified = classifyCard(src, width, height, { ocrWordCount: ocrWordCount ?? 0 });
  const adaptiveStats = measureAdaptiveStats(src, width, height);
  const chosen = mapAdaptiveParams(adaptiveStats, classified.cardClass, settings);
  processEnhance(src, width, height, chosen, scaleFn, {
    cardClass: classified.cardClass,
    edgeProtect: 0.05,
  })
    .then((result) => {
      ctx.postMessage(
        {
          id,
          width: result.width,
          height: result.height,
          buffer: result.data.buffer,
          isChromeFoil: classified.cardClass === "chrome_foil_front",
          specularRatio: result.chromeFoil.specularRatio,
          specularPeakRatio: result.chromeFoil.specularPeakRatio,
          metallicContrast: result.chromeFoil.metallicContrast,
          sharpnessBefore: result.sharpnessBefore,
          sharpnessAfter: result.sharpnessAfter,
          sharpnessDelta: result.sharpnessDelta,
          cardClass: classified.cardClass,
          adaptiveStats,
          chosenParams: chosen,
        },
        [result.data.buffer],
      );
    })
    .catch((err: unknown) => {
      ctx.postMessage({
        id,
        error: err instanceof Error ? err.message : "Enhance failed",
      });
    });
};
