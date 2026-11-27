import type { CardIdentity } from "@/lib/cards/types";
import { postJson } from "@/lib/client/http";

export async function saveCardPng(options: {
  canvas: HTMLCanvasElement;
  filename: string;
  workspace: string;
  width: number;
  height: number;
  outputWidth: number;
  outputHeight: number;
  identity?: Partial<CardIdentity>;
}) {
  const blob = await new Promise<Blob | null>((resolve) => options.canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Could not encode PNG");
  const form = new FormData();
  const filename = options.filename.replace(/\.[^.]+$/, "") + "-card.png";
  form.set("file", new File([blob], filename, { type: "image/png" }));
  const upload = await fetch("/api/blob", { method: "POST", body: form });
  const stored = (await upload.json()) as { url?: string; error?: string };
  if (!upload.ok || !stored.url) throw new Error(stored.error || "Blob upload failed");
  const identity = options.identity ?? {};
  const saved = await postJson<{ id: string }>("/api/cards", {
    filename,
    player: identity.player ?? null,
    setName: identity.set ?? null,
    manufacturer: identity.manufacturer ?? null,
    year: identity.year ?? null,
    number: identity.number ?? null,
    parallel: identity.parallel ?? null,
    side: identity.side ?? null,
    workspace: options.workspace,
    width: options.width,
    height: options.height,
    outputWidth: options.outputWidth,
    outputHeight: options.outputHeight,
    blobUrl: stored.url,
    metadata: { engine: identity.engine ?? null },
  });
  return { id: saved.id, url: stored.url };
}
