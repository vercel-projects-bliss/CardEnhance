import { describe, expect, it } from "vitest";
import { cardCanvasSize } from "@/lib/geometry/card-canvas";

const REFERENCE = [
  { width: 2132, height: 2544, outW: 2239, outH: 3135 },
  { width: 1916, height: 2984, outW: 2239, outH: 3134 },
  { width: 1714, height: 2342, outW: 1800, outH: 2520 },
  { width: 2120, height: 3078, outW: 2309, outH: 3232 },
] as const;

describe("padding-only 5:7 card canvas", () => {
  it.each(REFERENCE)(
    "$width×$height → $outW×$outH",
    ({ width, height, outW, outH }) => {
      const canvas = cardCanvasSize(width, height);
      expect(canvas.width).toBe(outW);
      expect(canvas.height).toBe(outH);
      expect(canvas.scale).toBe(1);
      expect(canvas.scaledWidth).toBe(width);
      expect(canvas.scaledHeight).toBe(height);
      expect(canvas.mode).toBe("padding-only");
      expect(canvas.offsetX).toBe((outW - width) / 2);
      expect(canvas.offsetY).toBe((outH - height) / 2);
      expect(canvas.offsetX).toBeGreaterThanOrEqual(5);
      expect(canvas.offsetY).toBeGreaterThanOrEqual(5);
      expect(canvas.offsetX + width).toBeLessThanOrEqual(outW - 5);
      expect(canvas.offsetY + height).toBeLessThanOrEqual(outH - 5);
      expect(Math.abs(outW * 7 - outH * 5)).toBeLessThanOrEqual(4);
    },
  );

  it("lifts a tiny square to the 5 px margin instead of a 5% pad", () => {
    const canvas = cardCanvasSize(40, 40);
    expect(canvas.binding).toBe("width");
    expect(canvas.width).toBe(50);
    expect(canvas.height).toBe(70);
    expect(canvas.offsetX).toBe(5);
    expect(canvas.offsetY).toBe(15);
  });

  it("binds height for a narrow strip and still keeps 5 px", () => {
    const canvas = cardCanvasSize(40, 200);
    expect(canvas.binding).toBe("height");
    expect(canvas.height).toBe(210);
    expect(canvas.width).toBe(150);
    expect(canvas.offsetY).toBe(5);
    expect(canvas.offsetX).toBeGreaterThanOrEqual(5);
  });

  it("rejects non-positive dimensions", () => {
    expect(() => cardCanvasSize(0, 10)).toThrow(/positive integers/);
    expect(() => cardCanvasSize(1.5, 10)).toThrow(/positive integers/);
  });
});
