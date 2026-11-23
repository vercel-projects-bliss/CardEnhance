/**
 * Trading-card export geometry.
 *
 * Mode: "Padding only, no crop, no stretch, centered".
 *
 * The source is placed at native resolution (uniform scale 1) on a white
 * portrait canvas whose aspect is 5:7 (2.5 in × 3.5 in). The canvas is 5%
 * larger than the source on the side that is tight against that aspect, and
 * never closer than 5 px on any side. The other side is the integer 5:7 pair.
 *
 * Binding side
 *   Compare with integer cross-multiply so the boundary is exact:
 *     width binds when `srcWidth * 7 >= srcHeight * 5`  (w/h >= 5/7)
 *     height binds otherwise
 *
 * Tight side (5% pad, and at least `minMargin` px each side)
 *   width binds:  W = max(ceil(w * 21/20), w + 2 * minMargin)
 *                 H = roundHalfUp(W * 7/5)
 *   height binds: H = max(ceil(h * 21/20), h + 2 * minMargin)
 *                 W = roundHalfUp(H * 5/7)
 *
 * `ceil(n * 21/20)` and `roundHalfUp` are integer operations:
 *   ceil(n * a/b)      = floor((n * a + b - 1) / b)
 *   roundHalfUp(n*a/b) = floor((n * a + floor(b/2)) / b)
 * so the four reference scans do not depend on binary floating point.
 *
 * If rounding ever leaves a side inside the 5 px margin, that side is lifted
 * to `image + 2 * minMargin` and its pair is re-derived. The reference scans
 * already clear the margin, so the lift does not move them.
 *
 * Placement: offsetX = (W - w) / 2, offsetY = (H - h) / 2. Scale stays 1,
 * so the bitmap is not resampled, cropped, or non-uniformly scaled.
 */

export const CARD_WIDTH_PART = 5;
export const CARD_HEIGHT_PART = 7;
export const PADDING_NUMERATOR = 21;
export const PADDING_DENOMINATOR = 20;
export const MIN_MARGIN_PX = 5;

export type CardCanvas = {
  width: number;
  height: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  scaledWidth: number;
  scaledHeight: number;
  binding: "width" | "height";
  mode: "padding-only";
};

export function ceilMulDiv(n: number, num: number, den: number): number {
  return Math.floor((n * num + den - 1) / den);
}

export function roundMulDiv(n: number, num: number, den: number): number {
  return Math.floor((n * num + Math.floor(den / 2)) / den);
}

export function cardCanvasSize(
  srcWidth: number,
  srcHeight: number,
  minMargin = MIN_MARGIN_PX,
): CardCanvas {
  if (
    !Number.isInteger(srcWidth) ||
    !Number.isInteger(srcHeight) ||
    srcWidth < 1 ||
    srcHeight < 1
  ) {
    throw new Error("Source dimensions must be positive integers");
  }
  if (!Number.isInteger(minMargin) || minMargin < 0) {
    throw new Error("Minimum margin must be a non-negative integer");
  }

  const widthBinds = srcWidth * CARD_HEIGHT_PART >= srcHeight * CARD_WIDTH_PART;
  let width: number;
  let height: number;
  if (widthBinds) {
    width = Math.max(
      ceilMulDiv(srcWidth, PADDING_NUMERATOR, PADDING_DENOMINATOR),
      srcWidth + 2 * minMargin,
    );
    height = roundMulDiv(width, CARD_HEIGHT_PART, CARD_WIDTH_PART);
  } else {
    height = Math.max(
      ceilMulDiv(srcHeight, PADDING_NUMERATOR, PADDING_DENOMINATOR),
      srcHeight + 2 * minMargin,
    );
    width = roundMulDiv(height, CARD_WIDTH_PART, CARD_HEIGHT_PART);
  }

  for (let pass = 0; pass < 3; pass++) {
    const widthShort = width < srcWidth + 2 * minMargin;
    const heightShort = height < srcHeight + 2 * minMargin;
    if (!widthShort && !heightShort) break;
    if (widthShort) {
      width = srcWidth + 2 * minMargin;
      height = roundMulDiv(width, CARD_HEIGHT_PART, CARD_WIDTH_PART);
    }
    if (height < srcHeight + 2 * minMargin) {
      height = srcHeight + 2 * minMargin;
      width = roundMulDiv(height, CARD_WIDTH_PART, CARD_HEIGHT_PART);
    }
  }

  return {
    width,
    height,
    scale: 1,
    offsetX: (width - srcWidth) / 2,
    offsetY: (height - srcHeight) / 2,
    scaledWidth: srcWidth,
    scaledHeight: srcHeight,
    binding: widthBinds ? "width" : "height",
    mode: "padding-only",
  };
}
