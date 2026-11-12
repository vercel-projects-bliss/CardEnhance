import { describe, expect, it } from "vitest";
import { selectSheetBoxes } from "@/lib/detect-sheet";

describe("selectSheetBoxes", () => {
  it("accepts two or more similar valid-aspect cards", () => {
    const boxes = [
      { x: 10, y: 10, w: 250, h: 350, score: 0.8 },
      { x: 300, y: 10, w: 248, h: 352, score: 0.7 },
      { x: 10, y: 400, w: 252, h: 348, score: 0.75 },
      { x: 300, y: 400, w: 249, h: 351, score: 0.7 },
    ];
    const selected = selectSheetBoxes(boxes, 600, 800);
    expect(selected.length).toBe(4);
  });

  it("rejects a single card plus a near-full frame or contained nameplate", () => {
    const boxes = [
      { x: 0, y: 0, w: 800, h: 1100, score: 0.9 }, // almost the whole scan
      { x: 200, y: 300, w: 250, h: 350, score: 0.8 },
      { x: 240, y: 420, w: 80, h: 30, score: 0.6 }, // nameplate inside the card
    ];
    expect(selectSheetBoxes(boxes, 800, 1100).length).toBe(0);
  });

  it("rejects two boxes whose areas are inconsistent (false table split)", () => {
    const boxes = [
      { x: 40, y: 40, w: 500, h: 700, score: 0.6 },
      { x: 80, y: 90, w: 180, h: 250, score: 0.7 },
    ];
    // 500x700 vs 180x250 is more than 2.5× apart and the large one may also
    // fail the fill cap depending on the canvas; either way it is not a sheet.
    const selected = selectSheetBoxes(boxes, 700, 900);
    expect(selected.length).toBe(0);
  });
});
