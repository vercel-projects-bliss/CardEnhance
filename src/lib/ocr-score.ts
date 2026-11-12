import type { Rotation } from "./types";

export type OcrWord = {
  text: string;
  confidence: number;
};

export type OcrRotationScore = {
  rotation: Rotation;
  wordCount: number;
  meanConfidence: number;
  score: number;
  text: string;
};

const TOKEN = /[A-Za-z]{2,}|[0-9]{2,}/;

/** Valid "word" tokens: letters or digits, with a minimum OCR confidence. */
export function validOcrWords(words: OcrWord[], minConfidence = 35): OcrWord[] {
  return words.filter((w) => w.confidence >= minConfidence && TOKEN.test((w.text || "").trim()));
}

/**
 * Score one rotation's OCR output: mean confidence × log(1 + valid word count).
 * Empty or garbage reads score 0.
 */
export function scoreOcrWords(words: OcrWord[], text = ""): Omit<OcrRotationScore, "rotation"> {
  const valid = validOcrWords(words);
  const wordCount = valid.length;
  const meanConfidence = wordCount
    ? valid.reduce((s, w) => s + w.confidence, 0) / wordCount
    : 0;
  const score = wordCount === 0 ? 0 : (meanConfidence / 100) * Math.log(1 + wordCount);
  return { wordCount, meanConfidence, score, text };
}

export type CombinedOrientation = {
  rotation: Rotation;
  confidence: number;
  uncertain: boolean;
  source: "ocr" | "projection" | "agreed" | "fallback";
  ocr: OcrRotationScore[];
};

/**
 * Combine projection-profile scores with per-rotation OCR scores.
 * OCR wins when it has a clear word-count/confidence margin. If both
 * signals are weak, keep 0° and mark the result uncertain rather than
 * guessing a 90/270 flip.
 */
export function combineOrientationSignals(
  projection: Array<{ rotation: Rotation; score: number }>,
  ocr: OcrRotationScore[],
): CombinedOrientation {
  const projBest = bestOf(projection, (s) => s.score);
  const ocrBest = bestOf(ocr, (s) => s.score);
  const ocrSecond = secondBest(ocr, (s) => s.score);
  const projSecond = secondBest(projection, (s) => s.score);

  const ocrMargin = ocrBest && ocrSecond
    ? ocrBest.score - ocrSecond.score
    : (ocrBest?.score ?? 0);
  const projMargin = projBest && projSecond
    ? projBest.score - projSecond.score
    : (projBest?.score ?? 0);

  const ocrStrong =
    !!ocrBest &&
    ocrBest.wordCount >= 3 &&
    ocrBest.meanConfidence >= 40 &&
    (ocrBest.score >= (ocrSecond?.score ?? 0) * 1.15 || ocrMargin >= 0.12);

  const projStrong = !!projBest && projMargin >= 0.25;
  const agreed =
    !!ocrBest &&
    !!projBest &&
    ocrBest.rotation === projBest.rotation &&
    (ocrBest.wordCount >= 2 || projStrong);

  if (agreed) {
    const confidence = Math.min(0.98, 0.55 + 0.15 * Math.min(ocrBest!.wordCount / 8, 1) + 0.2 * Math.min(projMargin, 1));
    return { rotation: ocrBest!.rotation, confidence, uncertain: confidence < 0.4, source: "agreed", ocr };
  }
  if (ocrStrong) {
    const confidence = Math.min(0.95, 0.45 + 0.08 * Math.min(ocrBest!.wordCount, 8) + 0.3 * Math.min(ocrMargin, 1));
    return { rotation: ocrBest!.rotation, confidence, uncertain: false, source: "ocr", ocr };
  }
  if (projStrong && (ocrBest?.wordCount ?? 0) < 2) {
    const confidence = Math.min(0.7, 0.35 + 0.3 * Math.min(projMargin, 1));
    return {
      rotation: projBest!.rotation,
      confidence,
      uncertain: confidence < 0.45,
      source: "projection",
      ocr,
    };
  }
  // Weak / conflicting: do not invent a 90/270 guess.
  const keep = 0 as Rotation;
  return { rotation: keep, confidence: 0.2, uncertain: true, source: "fallback", ocr };
}

function bestOf<T>(items: T[], score: (t: T) => number): T | null {
  if (!items.length) return null;
  return items.reduce((a, b) => (score(b) > score(a) ? b : a));
}

function secondBest<T>(items: T[], score: (t: T) => number): T | null {
  if (items.length < 2) return null;
  const sorted = [...items].sort((a, b) => score(b) - score(a));
  return sorted[1];
}
