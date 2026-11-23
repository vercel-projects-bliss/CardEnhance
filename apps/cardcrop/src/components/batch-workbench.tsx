"use client";

import { useState } from "react";
import JSZip from "jszip";
import { Shell } from "@/components/shell";
import type { CardIdentity, EnhancementSettings } from "@/lib/cards/types";
import { defaultSettings } from "@/lib/cards/types";
import {
  canvasFromImageData,
  downloadCanvas,
  imageDataFromPixels,
  fitLongEdge,
  loadImageElement,
  paintPaddedCard,
  readImageData,
  shrinkJpegBase64,
} from "@/lib/client/image";
import { postJson } from "@/lib/client/http";
import { rememberCard } from "@/lib/client/memory";
import { autoCropCard } from "@/lib/image/detect";
import { processPixels } from "@/lib/image/enhance";
import type { PriceQuote } from "@/lib/prices";

type BatchItem = {
  name: string;
  status: "queued" | "done" | "failed";
  error?: string;
  output?: HTMLCanvasElement;
  sourceWidth?: number;
  sourceHeight?: number;
  outputWidth?: number;
  outputHeight?: number;
  identity?: Partial<CardIdentity>;
  soldUrl?: string;
};

const IMAGE = /\.(jpe?g|png|webp)$/i;

function titleFrom(identity: Partial<CardIdentity> | undefined, filename: string) {
  const parts = [
    identity?.year,
    identity?.manufacturer,
    identity?.player,
    identity?.set,
    identity?.number,
    identity?.parallel,
  ].filter((part) => part != null && String(part).trim());
  return parts.length ? parts.join(" ") : filename.replace(/\.[^.]+$/, "");
}

async function filesFromZip(file: File): Promise<File[]> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const images: File[] = [];
  const entries = Object.values(zip.files).filter((entry) => !entry.dir && IMAGE.test(entry.name));
  for (const entry of entries) {
    const blob = await entry.async("blob");
    const name = entry.name.split("/").pop() || entry.name;
    images.push(new File([blob], name, { type: blob.type || "application/octet-stream" }));
  }
  return images;
}

export function BatchWorkbench() {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [settings, setSettings] = useState<EnhancementSettings>({ ...defaultSettings, visionOcr: false });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  async function addFiles(list: FileList | File[]) {
    const incoming = Array.from(list);
    const accepted: File[] = [];
    for (const file of incoming) {
      if (file.size > 50 * 1024 * 1024 && !file.name.toLowerCase().endsWith(".zip")) {
        setError(`${file.name} is over 50 MB`);
        continue;
      }
      if (file.name.toLowerCase().endsWith(".zip") || file.type.includes("zip")) {
        if (file.size > 200 * 1024 * 1024) {
          setError(`${file.name} is over 200 MB`);
          continue;
        }
        const extracted = await filesFromZip(file);
        if (!extracted.length) setError(`${file.name} had no jpeg, png, or webp files`);
        accepted.push(...extracted);
      } else if (IMAGE.test(file.name) || file.type.startsWith("image/")) {
        accepted.push(file);
      } else {
        setError(`${file.name} is not a jpeg, png, webp, or zip`);
      }
    }
    setFiles((current) => [...current, ...accepted]);
    setItems((current) => [
      ...current,
      ...accepted.map((file) => ({ name: file.name, status: "queued" as const })),
    ]);
  }

  async function run() {
    if (!files.length) return;
    setBusy("Processing the batch…");
    setError("");
    const next = items.map((item) => ({ ...item }));
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      const row = next[index];
      if (!row || row.status === "done") continue;
      try {
        const image = await loadImageElement(file);
        const fitted = fitLongEdge(image.naturalWidth, image.naturalHeight, 1800);
        let data = readImageData(image, fitted.width, fitted.height);
        if (settings.autoCrop) data = autoCropCard(data).image;
        const processed = processPixels(data.data, data.width, data.height, settings);
        data = imageDataFromPixels(processed.data, data.width, data.height);
        const painted = paintPaddedCard(canvasFromImageData(data), data.width, data.height);
        row.output = painted.canvas;
        row.sourceWidth = data.width;
        row.sourceHeight = data.height;
        row.outputWidth = painted.spec.width;
        row.outputHeight = painted.spec.height;
        row.status = "done";
        if (settings.visionOcr) {
          const jpeg = await shrinkJpegBase64(painted.canvas, painted.spec.width, painted.spec.height);
          const ocr = await postJson<{ ok: boolean; identity?: Partial<CardIdentity>; error?: string }>("/api/ocr", {
            jpeg,
            engine: "vision",
          });
          if (!ocr.ok || !ocr.identity) throw new Error(ocr.error || "OCR failed");
          row.identity = ocr.identity;
          const prices = await postJson<PriceQuote>("/api/prices", { identity: ocr.identity });
          row.soldUrl = prices.ebaySoldUrl;
          rememberCard({ filename: file.name, identity: ocr.identity, savedAt: Date.now() });
        }
      } catch (err) {
        row.status = "failed";
        row.error = err instanceof Error ? err.message : "Failed";
      }
      setItems(next.map((item) => ({ ...item, output: item.output })));
    }
    setItems(next);
    setBusy("");
  }

  function csv() {
    const lines = ["filename,title,player,year,manufacturer,set,number,parallel,output_width,output_height,ebay_sold_url"];
    for (const item of items) {
      const cells = [
        item.name,
        titleFrom(item.identity, item.name),
        item.identity?.player ?? "",
        item.identity?.year ?? "",
        item.identity?.manufacturer ?? "",
        item.identity?.set ?? "",
        item.identity?.number ?? "",
        item.identity?.parallel ?? "",
        item.outputWidth ?? "",
        item.outputHeight ?? "",
        item.soldUrl ?? "",
      ].map((value) => `"${String(value).replace(/"/g, '""')}"`);
      lines.push(cells.join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "ebay-listings.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function zipOutputs() {
    const zip = new JSZip();
    for (const item of items) {
      if (!item.output) continue;
      const blob = await new Promise<Blob | null>((resolve) => item.output?.toBlob(resolve, "image/png"));
      if (blob) zip.file(item.name.replace(/\.[^.]+$/, "") + "-card.png", blob);
    }
    const archive = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(archive);
    const link = document.createElement("a");
    link.href = url;
    link.download = "card-batch.zip";
    link.click();
    URL.revokeObjectURL(url);
  }

  const done = items.filter((item) => item.status === "done").length;

  return (
    <Shell>
      <p className="kicker">Card Batch Workbench</p>
      <h1>Scanner drop to listing sheet.</h1>
      <p className="muted">
        JPEG, PNG, WebP, or a ZIP of those. Each file is contour-cropped when that is on, enhanced, then padded to 5:7.
        Vision OCR and sold-search links run only if you turn them on.
      </p>
      {error ? <p className="error">{error}</p> : null}
      {busy ? <p className="ok">{busy}</p> : null}
      <div
        className="drop"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          void addFiles(event.dataTransfer.files).catch((err: Error) => setError(err.message));
        }}
      >
        <input
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,.zip,application/zip"
          onChange={(event) => {
            if (event.target.files) void addFiles(event.target.files).catch((err: Error) => setError(err.message));
          }}
        />
        <p className="muted">{files.length} file{files.length === 1 ? "" : "s"} queued · {done} finished</p>
      </div>
      <div className="row" style={{ margin: "0.8rem 0" }}>
        <label className="row"><input type="checkbox" checked={settings.autoCrop} onChange={(event) => setSettings({ ...settings, autoCrop: event.target.checked })} /> Contour crop</label>
        <label className="row"><input type="checkbox" checked={settings.sharpening} onChange={(event) => setSettings({ ...settings, sharpening: event.target.checked })} /> Sharpen</label>
        <label className="row"><input type="checkbox" checked={settings.blemishRemoval} onChange={(event) => setSettings({ ...settings, blemishRemoval: event.target.checked })} /> Blemish</label>
        <label className="row"><input type="checkbox" checked={settings.preserveHolographic} onChange={(event) => setSettings({ ...settings, preserveHolographic: event.target.checked })} /> Keep foil</label>
        <label className="row"><input type="checkbox" checked={settings.visionOcr} onChange={(event) => setSettings({ ...settings, visionOcr: event.target.checked })} /> xAI OCR + eBay links</label>
        <button className="btn" type="button" disabled={!files.length || !!busy} onClick={() => void run()}>Run batch</button>
        <button className="btn-ghost" type="button" disabled={!done} onClick={csv}>eBay CSV</button>
        <button className="btn-ghost" type="button" disabled={!done} onClick={() => void zipOutputs()}>Download ZIP</button>
        <button
          className="btn-ghost"
          type="button"
          disabled={!done}
          onClick={() => {
            void postJson("/api/batch", {
              fileCount: done,
              status: items.some((item) => item.status === "failed") ? "failed" : "completed",
              metadata: { names: items.map((item) => ({ name: item.name, status: item.status, output: item.outputWidth && item.outputHeight ? `${item.outputWidth}x${item.outputHeight}` : null })) },
            })
              .then(() => setBusy("Batch row saved in Neon."))
              .catch((err: Error) => setError(err.message));
          }}
        >
          Save batch
        </button>
        <button
          className="btn-ghost"
          type="button"
          disabled={!done}
          onClick={() => {
            void postJson("/api/notify", { text: `CardCrop batch finished: ${done} of ${items.length} cards.` })
              .then(() => setBusy("Slack/Telegram notice sent when those tokens are set."))
              .catch((err: Error) => setError(err.message));
          }}
        >
          Notify
        </button>
      </div>
      <table className="table">
        <thead>
          <tr><th>File</th><th>Status</th><th>Export</th><th>Title</th><th></th></tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.name}>
              <td>{item.name}</td>
              <td>{item.status}{item.error ? ` — ${item.error}` : ""}</td>
              <td>{item.outputWidth ? `${item.outputWidth}×${item.outputHeight}` : "—"}</td>
              <td>{item.identity ? titleFrom(item.identity, item.name) : "—"}</td>
              <td>
                {item.output ? (
                  <button className="btn-ghost" type="button" onClick={() => void downloadCanvas(item.output!, item.name.replace(/\.[^.]+$/, "") + "-card.png")}>
                    PNG
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Shell>
  );
}
