"use client";

import { useState } from "react";
import { PixelPreview } from "@/components/pixel-preview";
import { Shell } from "@/components/shell";
import type { CardIdentity, EnhancementSettings } from "@/lib/cards/types";
import { defaultSettings } from "@/lib/cards/types";
import {
  canvasFromImageData,
  describeCanvas,
  imageDataFromPixels,
  downloadCanvas,
  loadImageElement,
  paintPaddedCard,
  readImageData,
  shrinkJpegBase64,
} from "@/lib/client/image";
import { postJson } from "@/lib/client/http";
import { rememberCard } from "@/lib/client/memory";
import { saveCardPng } from "@/lib/client/save";
import { autoCropCard } from "@/lib/image/detect";
import { processPixels } from "@/lib/image/enhance";
import { rotateImage } from "@/lib/image/image-ops";
import { warpPerspective, type Quad } from "@/lib/geometry/perspective";
import type { PriceQuote } from "@/lib/prices";

function quadFromImage(width: number, height: number): Quad {
  return [
    { x: 0, y: 0 },
    { x: width - 1, y: 0 },
    { x: width - 1, y: height - 1 },
    { x: 0, y: height - 1 },
  ];
}

export function SingleEditor() {
  const [name, setName] = useState("card");
  const [working, setWorking] = useState<ImageData | null>(null);
  const [quad, setQuad] = useState<Quad | null>(null);
  const [settings, setSettings] = useState<EnhancementSettings>(defaultSettings);
  const [identity, setIdentity] = useState<Partial<CardIdentity> | null>(null);
  const [quote, setQuote] = useState<PriceQuote | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function openFile(file: File) {
    setError("");
    setQuote(null);
    setIdentity(null);
    const image = await loadImageElement(file);
    const data = readImageData(image, image.naturalWidth, image.naturalHeight);
    setWorking(data);
    setQuad(quadFromImage(data.width, data.height));
    setName(file.name);
  }

  function replace(next: ImageData) {
    setWorking(next);
    setQuad(quadFromImage(next.width, next.height));
  }

  function updateCorner(index: number, axis: "x" | "y", value: number) {
    if (!working || !quad) return;
    const next = quad.map((point) => ({ ...point })) as Quad;
    const max = axis === "x" ? working.width - 1 : working.height - 1;
    next[index] = { ...next[index], [axis]: Math.min(max, Math.max(0, value)) };
    setQuad(next);
  }

  function applyWarp() {
    if (!working || !quad) return;
    const width = Math.max(
      32,
      Math.round((Math.hypot(quad[1].x - quad[0].x, quad[1].y - quad[0].y) + Math.hypot(quad[2].x - quad[3].x, quad[2].y - quad[3].y)) / 2),
    );
    const height = Math.max(
      32,
      Math.round((Math.hypot(quad[3].x - quad[0].x, quad[3].y - quad[0].y) + Math.hypot(quad[2].x - quad[1].x, quad[2].y - quad[1].y)) / 2),
    );
    const warped = warpPerspective(working, quad, width, height);
    if (!warped) {
      setError("Those corners do not form a usable quadrilateral.");
      return;
    }
    setError("");
    replace(warped);
  }

  function enhance() {
    if (!working) return;
    const fitted = working.width > 2200 || working.height > 2200
      ? (() => {
          const scale = 2200 / Math.max(working.width, working.height);
          const canvas = canvasFromImageData(working);
          return readImageData(canvas, Math.round(working.width * scale), Math.round(working.height * scale));
        })()
      : working;
    const processed = processPixels(fitted.data, fitted.width, fitted.height, settings);
    replace(imageDataFromPixels(processed.data, fitted.width, fitted.height));
    setNote(`Enhancement marked ${processed.blemishCount} outlier pixels.`);
  }

  async function readCard() {
    if (!working) return;
    setBusy(true);
    setError("");
    try {
      const jpeg = await shrinkJpegBase64(canvasFromImageData(working), working.width, working.height);
      const result = await postJson<{ ok: boolean; identity?: Partial<CardIdentity>; error?: string }>("/api/ocr", {
        jpeg,
        engine: "vision",
      });
      if (!result.ok || !result.identity) throw new Error(result.error || "OCR returned nothing");
      setIdentity(result.identity);
      rememberCard({ filename: name, identity: result.identity, savedAt: Date.now() });
    } catch (err) {
      setError(err instanceof Error ? err.message : "OCR failed");
    } finally {
      setBusy(false);
    }
  }

  async function prices() {
    if (!identity) {
      setError("Read the card before looking up prices.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      setQuote(await postJson<PriceQuote>("/api/prices", { identity }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Price lookup failed");
    } finally {
      setBusy(false);
    }
  }

  function padded() {
    if (!working) throw new Error("Open a card first");
    return paintPaddedCard(canvasFromImageData(working), working.width, working.height);
  }

  return (
    <Shell>
      <p className="kicker">Single Card Editor</p>
      <h1>One card, full frame, then the margin.</h1>
      <p className="muted">
        Contour crop and perspective come from CardEnhance. Enhancement is the same pixel pass. Export is padding only.
      </p>
      {error ? <p className="error">{error}</p> : null}
      {note ? <p className="ok">{note}</p> : null}
      <div className="grid-2">
        <div className="panel">
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void openFile(file).catch((err: Error) => setError(err.message));
            }}
          />
          <div className="row" style={{ marginTop: "0.7rem" }}>
            <button className="btn" type="button" disabled={!working} onClick={() => working && replace(autoCropCard(working).image)}>Contour crop</button>
            <button className="btn-ghost" type="button" disabled={!working} onClick={() => working && replace(rotateImage(working, 90))}>Rotate 90°</button>
            <button className="btn-ghost" type="button" disabled={!working} onClick={applyWarp}>Rectify corners</button>
            <button className="btn-ghost" type="button" disabled={!working} onClick={enhance}>Enhance</button>
            <button className="btn-ghost" type="button" disabled={!working || busy} onClick={() => void readCard()}>Read card</button>
            <button className="btn-ghost" type="button" disabled={!identity || busy} onClick={() => void prices()}>Prices</button>
            <button className="btn-ghost" type="button" disabled={!working} onClick={() => void downloadCanvas(padded().canvas, name.replace(/\.[^.]+$/, "") + "-card.png")}>Download 5:7</button>
            <button
              className="btn-ghost"
              type="button"
              disabled={!working || busy}
              onClick={() => {
                if (!working) return;
                setBusy(true);
                const shot = padded();
                void saveCardPng({
                  canvas: shot.canvas,
                  filename: name,
                  workspace: "editor",
                  width: working.width,
                  height: working.height,
                  outputWidth: shot.spec.width,
                  outputHeight: shot.spec.height,
                  identity: identity ?? undefined,
                })
                  .then(() => setNote("Saved to the library."))
                  .catch((err: Error) => setError(err.message))
                  .finally(() => setBusy(false));
              }}
            >
              Save
            </button>
          </div>
          <div className="row" style={{ marginTop: "0.8rem" }}>
            <label className="row"><input type="checkbox" checked={settings.sharpening} onChange={(event) => setSettings({ ...settings, sharpening: event.target.checked })} /> Sharpen</label>
            <label className="row"><input type="checkbox" checked={settings.blemishRemoval} onChange={(event) => setSettings({ ...settings, blemishRemoval: event.target.checked })} /> Blemish</label>
            <label className="row"><input type="checkbox" checked={settings.descratch} onChange={(event) => setSettings({ ...settings, descratch: event.target.checked })} /> Descratch</label>
            <label className="row"><input type="checkbox" checked={settings.preserveHolographic} onChange={(event) => setSettings({ ...settings, preserveHolographic: event.target.checked })} /> Keep foil</label>
          </div>
          <label className="field" style={{ marginTop: "0.6rem" }}>
            Color temperature {settings.colorTemperature.toFixed(2)}
            <input type="range" min={-1} max={1} step={0.05} value={settings.colorTemperature} onChange={(event) => setSettings({ ...settings, colorCorrection: true, colorTemperature: Number(event.target.value) })} />
          </label>
          {working && quad ? (
            <div className="grid-6" style={{ marginTop: "0.6rem" }}>
              {quad.map((point, index) => (
                <div key={index}>
                  <span className="muted">Corner {index + 1}</span>
                  <input type="number" value={Math.round(point.x)} onChange={(event) => updateCorner(index, "x", Number(event.target.value))} />
                  <input type="number" value={Math.round(point.y)} onChange={(event) => updateCorner(index, "y", Number(event.target.value))} />
                </div>
              ))}
            </div>
          ) : null}
          {working ? <p className="muted">{describeCanvas(padded().spec)} from {working.width}×{working.height}</p> : null}
          {identity ? <p>{[identity.year, identity.manufacturer, identity.player, identity.set, identity.number, identity.parallel].filter(Boolean).join(" ") || identity.rawText}</p> : null}
          {quote ? (
            <div>
              <p>Median ungraded {quote.medianUngraded ?? "—"} · <a href={quote.ebaySoldUrl}>eBay sold</a> · <a href={quote.ebayActiveUrl}>eBay live</a></p>
              <ul>
                {quote.listings.map((listing) => (
                  <li key={listing.url}><a href={listing.url}>{listing.title}</a> {listing.ungraded ?? ""}</li>
                ))}
              </ul>
              {quote.notes.map((line) => <p key={line} className="muted">{line}</p>)}
            </div>
          ) : null}
        </div>
        <div className="preview-stage"><PixelPreview image={working} label="Open one scan" /></div>
      </div>
    </Shell>
  );
}
