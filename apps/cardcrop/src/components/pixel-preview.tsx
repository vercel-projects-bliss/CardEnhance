"use client";

import { useEffect, useRef } from "react";

export function PixelPreview({ image, label }: { image: ImageData | null; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !image) return;
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext("2d")?.putImageData(image, 0, 0);
  }, [image]);

  if (!image) return <span>{label}</span>;
  return <canvas ref={ref} aria-label={label} style={{ width: "100%", height: "auto" }} />;
}
