"use client";

import { useState } from "react";
import { PixelPreview } from "@/components/pixel-preview";
import { Shell } from "@/components/shell";
import {
  canvasFromImageData,
  describeCanvas,
  imageDataFromPixels,
  downloadCanvas,
  fitLongEdge,
  loadImageElement,
  paintPaddedCard,
  readImageData,
  shrinkJpegBase64,
} from "@/lib/client/image";
import { getJson, postJson } from "@/lib/client/http";
import { rememberCard } from "@/lib/client/memory";
import { saveCardPng } from "@/lib/client/save";
import { runAdaptiveCardPipeline } from "@/lib/pipeline/adaptiveCardPipeline";
import type { CardIdentity } from "@/lib/cards/types";

type Audit = Awaited<ReturnType<typeof runAdaptiveCardPipeline>>["audit"];

type RunpodStatus = {
  jobId: string;
  status: string;
  error?: string;
  url?: string;
  base64?: string;
  contentType?: string;
  width?: number;
  height?: number;
  model?: string;
  device?: string;
  seconds?: number;
};

const RUNPOD_POLL_MS = 2_000;
const RUNPOD_DEADLINE_MS = 8 * 60_000;

async function canvasToJpegBase64(canvas: HTMLCanvasElement, maxChars: number): Promise<string> {
  for (const quality of [0.95, 0.9, 0.85, 0.78]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) throw new Error("Could not encode JPEG");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    const encoded = btoa(binary);
    if (encoded.length <= maxChars) return encoded;
  }
  throw new Error("Scan is too large to send to Runpod even at JPEG quality 0.78");
}

export function AutoEnhance() {
  const [name, setName] = useState("card");
  const [working, setWorking] = useState<ImageData | null>(null);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [identity, setIdentity] = useState<Partial<CardIdentity> | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [scale, setScale] = useState(1);
  const [runpodScale, setRunpodScale] = useState<2 | 4>(4);

  async function onFile(file: File) {
    setError("");
    setAudit(null);
    setIdentity(null);
    const image = await loadImageElement(file);
    const fitted = fitLongEdge(image.naturalWidth, image.naturalHeight, 1400);
    const data = readImageData(image, fitted.width, fitted.height);
    setWorking(data);
    setName(file.name);
  }

  async function enhance() {
    if (!working) return;
    setBusy("Running the adaptive pipeline…");
    setError("");
    try {
      const result = await runAdaptiveCardPipeline(working.data, working.width, working.height, {
        mode: "adaptive",
        scale,
        maxLongEdge: 1800,
      });
      const next = imageDataFromPixels(result.rgba, result.width, result.height);
      setWorking(next);
      setAudit(result.audit);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pipeline failed");
    } finally {
      setBusy("");
    }
  }

  function currentCanvas() {
    if (!working) throw new Error("Choose a scan first");
    const source = canvasFromImageData(working);
    return paintPaddedCard(source, working.width, working.height);
  }

  async function exportPng() {
    try {
      const { canvas } = currentCanvas();
      await downloadCanvas(canvas, name.replace(/\.[^.]+$/, "") + "-card.png");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    }
  }

  async function readCard() {
    if (!working) return;
    setBusy("Reading printed text with xAI…");
    setError("");
    try {
      const source = canvasFromImageData(working);
      const jpeg = await shrinkJpegBase64(source, working.width, working.height);
      const result = await postJson<{ ok: boolean; identity?: Partial<CardIdentity>; error?: string }>(
        "/api/ocr",
        { jpeg, engine: "vision" },
      );
      if (!result.ok || !result.identity) throw new Error(result.error || "OCR returned nothing");
      setIdentity(result.identity);
      rememberCard({ filename: name, identity: result.identity, savedAt: Date.now() });
    } catch (err) {
      setError(err instanceof Error ? err.message : "OCR failed");
    } finally {
      setBusy("");
    }
  }

  async function upscale() {
    if (!working) return;
    setBusy("Upscaling on Replicate…");
    setError("");
    try {
      const source = canvasFromImageData(working);
      const imageBase64 = await new Promise<string>((resolve, reject) => {
        source.toBlob(async (blob) => {
          if (!blob) return reject(new Error("Could not encode PNG"));
          const buffer = await blob.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          let binary = "";
          for (let i = 0; i < bytes.length; i += 0x8000) {
            binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          }
          resolve(btoa(binary));
        }, "image/png");
      });
      const result = await postJson<{ base64: string; contentType: string }>("/api/replicate", {
        imageBase64,
        scale: 2,
        contentType: "image/png",
      });
      const image = await loadImageElement(
        await (await fetch(`data:${result.contentType};base64,${result.base64}`)).blob(),
      );
      const fitted = fitLongEdge(image.naturalWidth, image.naturalHeight, 2000);
      const next = readImageData(image, fitted.width, fitted.height);
      setWorking(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upscale failed");
    } finally {
      setBusy("");
    }
  }

  async function runpodUpscale() {
    if (!working) return;
    setBusy("Sending the scan to the Runpod GPU worker…");
    setError("");
    setNote("");
    try {
      const imageBase64 = await canvasToJpegBase64(canvasFromImageData(working), 3_900_000);
      const submitted = await postJson<{ jobId: string; status: string }>("/api/runpod/enhance", {
        imageBase64,
        scale: runpodScale,
        outputFormat: "jpeg",
        maxOutputLongEdge: 3072,
      });
      const started = Date.now();
      let result: RunpodStatus = { jobId: submitted.jobId, status: submitted.status };
      while (result.status !== "COMPLETED") {
        if (Date.now() - started > RUNPOD_DEADLINE_MS) {
          throw new Error(`Runpod job ${submitted.jobId} is still ${result.status} after 8 minutes`);
        }
        setBusy(
          `Runpod job ${result.status === "IN_QUEUE" ? "queued (a cold GPU worker can take a minute)" : "running"}… ${Math.round((Date.now() - started) / 1000)}s`,
        );
        await new Promise((resolve) => setTimeout(resolve, RUNPOD_POLL_MS));
        result = await getJson<RunpodStatus>(`/api/runpod/status/${encodeURIComponent(submitted.jobId)}`);
      }
      const source = result.url
        ? await (await fetch(result.url)).blob()
        : await (await fetch(`data:${result.contentType ?? "image/jpeg"};base64,${result.base64}`)).blob();
      const image = await loadImageElement(source);
      setWorking(readImageData(image, image.naturalWidth, image.naturalHeight));
      setNote(
        `${result.model ?? "Real-ESRGAN"} on ${result.device ?? "Runpod GPU"}: ${result.width}×${result.height} in ${result.seconds ?? "?"}s.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Runpod upscale failed");
    } finally {
      setBusy("");
    }
  }

  async function gpuRestore() {
    if (!working) return;
    setBusy("Sending the scan to the GPU restore proxy…");
    setError("");
    try {
      const source = canvasFromImageData(working);
      const blob = await new Promise<Blob | null>((resolve) => source.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Could not encode PNG");
      const form = new FormData();
      form.set("image", new File([blob], "card.png", { type: "image/png" }));
      form.set("tileSize", "0");
      form.set("tileOverlap", "32");
      form.set("outputFormat", "png");
      const response = await fetch("/api/restore", { method: "POST", body: form });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || `Restore failed (${response.status})`);
      }
      const image = await loadImageElement(await response.blob());
      const next = readImageData(image, image.naturalWidth, image.naturalHeight);
      setWorking(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Restore failed");
    } finally {
      setBusy("");
    }
  }

  async function save() {
    setBusy("Storing the padded card…");
    setError("");
    try {
      const { canvas, spec } = currentCanvas();
      await saveCardPng({
        canvas,
        filename: name,
        workspace: "auto-enhance",
        width: working!.width,
        height: working!.height,
        outputWidth: spec.width,
        outputHeight: spec.height,
        identity: identity ?? undefined,
      });
      setNote("Saved to Neon and Vercel Blob.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy("");
    }
  }

  const spec = working ? describeCanvas(paintPaddedCard(canvasFromImageData(working), working.width, working.height).spec) : "";

  return (
    <Shell>
      <p className="kicker">AI Card Auto-Enhancer</p>
      <h1>Deskew, clean, then pad.</h1>
      <p className="muted">
        The adaptive pipeline from cardenhance-v3 runs in the browser. Replicate upscale, Runpod
        Real-ESRGAN, and the GPU restore proxy run only when you ask, and only with a session.
      </p>
      {error ? <p className="error">{error}</p> : null}
      {busy ? <p className="ok">{busy}</p> : null}
      {note ? <p className="ok">{note}</p> : null}
      <div className="grid-2">
        <div className="panel">
          <label className="drop">
            Drop a scan
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onFile(file).catch((err: Error) => setError(err.message));
              }}
            />
          </label>
          <label className="field" style={{ marginTop: "0.8rem" }}>
            Output scale inside the pipeline ({scale.toFixed(1)}×, capped at 1800 px)
            <input
              type="number"
              min={1}
              max={4}
              step={0.5}
              value={scale}
              onChange={(event) => setScale(Number(event.target.value))}
            />
          </label>
          <div className="row" style={{ marginTop: "0.8rem" }}>
            <button className="btn" type="button" disabled={!working || !!busy} onClick={() => void enhance()}>Enhance</button>
            <button className="btn-ghost" type="button" disabled={!working || !!busy} onClick={() => void readCard()}>Read card</button>
            <button className="btn-ghost" type="button" disabled={!working || !!busy} onClick={() => void upscale()}>Replicate 2×</button>
            <button className="btn-ghost" type="button" disabled={!working || !!busy} onClick={() => void runpodUpscale()}>Runpod GPU {runpodScale}×</button>
            <select
              aria-label="Runpod upscale factor"
              value={runpodScale}
              disabled={!!busy}
              onChange={(event) => setRunpodScale(event.target.value === "2" ? 2 : 4)}
            >
              <option value="4">4×</option>
              <option value="2">2×</option>
            </select>
            <button className="btn-ghost" type="button" disabled={!working || !!busy} onClick={() => void gpuRestore()}>GPU restore</button>
            <button className="btn-ghost" type="button" disabled={!working || !!busy} onClick={() => void exportPng()}>Download 5:7</button>
            <button className="btn-ghost" type="button" disabled={!working || !!busy} onClick={() => void save()}>Save</button>
          </div>
          {spec ? <p className="muted">Export canvas {spec}. Scale stays 1 for the pad.</p> : null}
          {identity ? (
            <p>
              {identity.year || ""} {identity.manufacturer || ""} {identity.player || "Unnamed"} {identity.set || ""} {identity.number || ""}
            </p>
          ) : null}
          {audit ? (
            <ul className="muted">
              <li>Profile {audit.profile}</li>
              <li>Rotation {audit.appliedRotationDeg}° via {audit.orientationSource}</li>
              <li>Deskew {audit.deskewAngleDeg}°</li>
              <li>CIS streaks {audit.cisStreaksRemoved}, dust {audit.dustSpecksRemoved}</li>
              <li>Sharpness {audit.sharpnessBefore} → {audit.sharpnessAfter} ({audit.sharpnessDeltaPct}%)</li>
            </ul>
          ) : null}
        </div>
        <div className="preview-stage">
          <PixelPreview image={working} label="No scan yet" />
        </div>
      </div>
    </Shell>
  );
}
