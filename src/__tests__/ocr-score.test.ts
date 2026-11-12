import { describe, expect, it } from "vitest";
import { combineOrientationSignals, scoreOcrWords, validOcrWords } from "@/lib/ocr-score";

describe("scoreOcrWords", () => {
  it("scores more high-confidence words higher than a single token", () => {
    const many = scoreOcrWords([
      { text: "Hikaru", confidence: 90 },
      { text: "Shida", confidence: 88 },
      { text: "Allure", confidence: 85 },
      { text: "2024", confidence: 80 },
      { text: "victory", confidence: 84 },
    ]);
    const few = scoreOcrWords([{ text: "AEW", confidence: 60 }]);
    expect(many.wordCount).toBe(5);
    expect(many.score).toBeGreaterThan(few.score);
  });

  it("ignores garbage and very low-confidence tokens", () => {
    const valid = validOcrWords([
      { text: "ab", confidence: 20 },
      { text: "!!", confidence: 90 },
      { text: "Mina", confidence: 70 },
    ]);
    expect(valid.map((w) => w.text)).toEqual(["Mina"]);
  });
});

describe("combineOrientationSignals", () => {
  const proj = (scores: number[]) =>
    ([0, 90, 180, 270] as const).map((rotation, i) => ({ rotation, score: scores[i] }));

  it("uses OCR when word count and margin are clear", () => {
    const result = combineOrientationSignals(proj([0.1, 0.9, 0.1, 0.2]), [
      { rotation: 0, wordCount: 1, meanConfidence: 40, score: 0.2, text: "AEW" },
      { rotation: 90, wordCount: 12, meanConfidence: 80, score: 2.0, text: "Festival Fury Chelsea Green" },
      { rotation: 180, wordCount: 0, meanConfidence: 0, score: 0, text: "" },
      { rotation: 270, wordCount: 2, meanConfidence: 45, score: 0.3, text: "xy" },
    ]);
    expect(result.rotation).toBe(90);
    expect(result.uncertain).toBe(false);
    expect(result.source === "ocr" || result.source === "agreed").toBe(true);
  });

  it("keeps 0 and flags uncertain when every signal is weak", () => {
    const result = combineOrientationSignals(proj([0.05, 0.04, 0.03, 0.02]), [
      { rotation: 0, wordCount: 0, meanConfidence: 0, score: 0, text: "" },
      { rotation: 90, wordCount: 1, meanConfidence: 30, score: 0.1, text: "x" },
      { rotation: 180, wordCount: 0, meanConfidence: 0, score: 0, text: "" },
      { rotation: 270, wordCount: 1, meanConfidence: 32, score: 0.11, text: "y" },
    ]);
    expect(result.rotation).toBe(0);
    expect(result.uncertain).toBe(true);
    expect(result.source).toBe("fallback");
  });

  it("does not let a weak projection 90 override a strong OCR 0", () => {
    const result = combineOrientationSignals(proj([0.2, 0.8, 0.2, 0.3]), [
      { rotation: 0, wordCount: 10, meanConfidence: 85, score: 1.8, text: "Hikaru Shida Red Pulsar" },
      { rotation: 90, wordCount: 1, meanConfidence: 50, score: 0.2, text: "AEW" },
      { rotation: 180, wordCount: 2, meanConfidence: 45, score: 0.3, text: "ab cd" },
      { rotation: 270, wordCount: 1, meanConfidence: 40, score: 0.15, text: "zz" },
    ]);
    expect(result.rotation).toBe(0);
    expect(result.uncertain).toBe(false);
  });
});
