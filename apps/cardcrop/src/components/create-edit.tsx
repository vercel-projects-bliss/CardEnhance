"use client";

import { useState } from "react";
import { PixelPreview } from "@/components/pixel-preview";
import { Shell } from "@/components/shell";
import {
  canvasFromImageData,
  canvasToPngBase64,
  describeCanvas,
  downloadCanvas,
  loadImageElement,
  paintPaddedCard,
  readImageData,
} from "@/lib/client/image";
import { postJson } from "@/lib/client/http";
import { saveCardPng } from "@/lib/client/save";

export function CreateEdit() {
  const [prompt, setPrompt] = useState("A clean studio photograph of a blank white trading card, soft shadow, no text");
  const [provider, setProvider] = useState<"xai" | "replicate">("xai");
  const [caption, setCaption] = useState("");
  const [working, setWorking] = useState<ImageData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  function show(data: ImageData) {
    setWorking(data);
  }

  async function loadBlob(blob: Blob) {
    const image = await loadImageElement(blob);
    show(readImageData(image, image.naturalWidth, image.naturalHeight));
  }

  async function generate() {
    setBusy("Generating…");
    setError("");
    try {
      const result = await postJson<{ base64: string; contentType: string }>("/api/images", {
        provider,
        operation: "generate",
        prompt,
      });
      await loadBlob(await (await fetch(`data:${result.contentType};base64,${result.base64}`)).blob());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generate failed");
    } finally {
      setBusy("");
    }
  }

  async function edit() {
    if (!working) return;
    if (provider !== "xai") {
      setError("Image edits go through xAI /v1/images/edits. Switch the provider to xAI.");
      return;
    }
    setBusy("Editing…");
    setError("");
    try {
      const source = canvasFromImageData(working);
      const imageBase64 = await canvasToPngBase64(source);
      const result = await postJson<{ base64: string; contentType: string }>("/api/images", {
        provider: "xai",
        operation: "edit",
        prompt,
        imageBase64,
      });
      await loadBlob(await (await fetch(`data:${result.contentType};base64,${result.base64}`)).blob());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Edit failed");
    } finally {
      setBusy("");
    }
  }

  function blankCard() {
    const canvas = document.createElement("canvas");
    canvas.width = 750;
    canvas.height = 1050;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#f7f4ee";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 8;
    ctx.strokeRect(28, 28, canvas.width - 56, canvas.height - 56);
    show(ctx.getImageData(0, 0, canvas.width, canvas.height));
  }

  function composed() {
    if (!working) throw new Error("Create or upload an image first");
    const source = canvasFromImageData(working);
    const painted = paintPaddedCard(source, working.width, working.height);
    const line = caption.trim();
    if (line) {
      const ctx = painted.canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas unavailable");
      const size = Math.max(18, Math.round(painted.spec.width / 26));
      ctx.font = `${size}px Palatino, Georgia, serif`;
      ctx.fillStyle = "#161616";
      ctx.textAlign = "center";
      const y = painted.spec.offsetY > size + 8
        ? painted.spec.height - painted.spec.offsetY / 2
        : painted.spec.offsetY + painted.spec.scaledHeight - size;
      ctx.fillText(line.slice(0, 80), painted.spec.width / 2, y);
    }
    return painted;
  }

  return (
    <Shell>
      <p className="kicker">Create & Edit Images</p>
      <h1>Imagine a card, then fit it.</h1>
      <p className="muted">
        xAI Imagine uses grok-imagine-image-2.0 (override with XAI_IMAGE_MODEL). Replicate generation uses
        REPLICATE_IMAGE_MODEL or black-forest-labs/flux-schnell. The 5:7 pad is applied after, at scale 1.
      </p>
      {error ? <p className="error">{error}</p> : null}
      {busy ? <p className="ok">{busy}</p> : null}
      <div className="grid-2">
        <div className="panel">
          <label className="field">
            Provider
            <select value={provider} onChange={(event) => setProvider(event.target.value as "xai" | "replicate")}>
              <option value="xai">xAI images</option>
              <option value="replicate">Replicate</option>
            </select>
          </label>
          <label className="field" style={{ marginTop: "0.6rem" }}>
            Prompt
            <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} />
          </label>
          <label className="field" style={{ marginTop: "0.6rem" }}>
            Caption drawn on the export
            <input value={caption} onChange={(event) => setCaption(event.target.value)} type="text" />
          </label>
          <div className="row" style={{ marginTop: "0.8rem" }}>
            <button className="btn" type="button" disabled={!!busy} onClick={() => void generate()}>Generate</button>
            <button className="btn-ghost" type="button" disabled={!working || !!busy} onClick={() => void edit()}>Edit with xAI</button>
            <button className="btn-ghost" type="button" onClick={blankCard}>Blank 750×1050</button>
            <label className="btn-ghost">
              Upload
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  void loadBlob(file).catch((err: Error) => setError(err.message));
                }}
              />
            </label>
            <button
              className="btn-ghost"
              type="button"
              disabled={!working || !!busy}
              onClick={() => {
                try {
                  const { canvas } = composed();
                  void downloadCanvas(canvas, "created-card.png");
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Export failed");
                }
              }}
            >
              Download 5:7
            </button>
            <button
              className="btn-ghost"
              type="button"
              disabled={!working || !!busy}
              onClick={() => {
                setBusy("Saving…");
                setError("");
                try {
                  const { canvas, spec } = composed();
                  void saveCardPng({
                    canvas,
                    filename: "created-card.png",
                    workspace: "create",
                    width: working!.width,
                    height: working!.height,
                    outputWidth: spec.width,
                    outputHeight: spec.height,
                  })
                    .then(() => setBusy("Saved."))
                    .catch((err: Error) => {
                      setError(err.message);
                      setBusy("");
                    });
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Save failed");
                  setBusy("");
                }
              }}
            >
              Save
            </button>
          </div>
          {working ? (
            <p className="muted">
              {describeCanvas(paintPaddedCard(canvasFromImageData(working), working.width, working.height).spec)}
            </p>
          ) : null}
        </div>
        <div className="preview-stage">
          <PixelPreview image={working} label="Nothing generated yet" />
        </div>
      </div>
    </Shell>
  );
}
