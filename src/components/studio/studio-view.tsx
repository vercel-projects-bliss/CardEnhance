"use client";

import { useEffect, useRef, useState } from "react";
import {
  Camera,
  Download,
  Eraser,
  Maximize,
  RotateCcw,
  RotateCw,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { useStudioSettings } from "@/components/studio-settings";
import {
  ARTIFACT_VERSIONS,
  type ArtifactType,
  type DescratchLevel,
  type OutputFormat,
} from "@/lib/types";

const ACCEPT =
  "image/jpeg,image/png,image/webp,image/bmp,image/tiff,application/zip,.zip";

const controlClass =
  "h-10 rounded-lg border border-border bg-surface-raised px-2.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent";

const btnClass =
  "inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-surface-raised px-3 text-sm font-medium text-ink transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40";

const btnAccentClass =
  "inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-accent/10 px-3 text-sm font-medium text-accent ring-1 ring-inset ring-accent/20 transition-colors hover:bg-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40";

const btnGhostClass =
  "inline-flex h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium text-ink-muted transition-colors hover:bg-surface-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40";

export function StudioView() {
  const { settings, setSettings } = useStudioSettings();
  const [exportOpen, setExportOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const onPick = () => {
    setNotice(
      "Detect, crop, rectify, and OCR will run on upload once the pipeline is connected in a later step.",
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <section
        onDragEnter={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          onPick();
        }}
        className={
          dragOver
            ? "rounded-2xl border border-dashed border-accent bg-accent/10 px-4 py-8 text-center sm:py-10"
            : "rounded-2xl border border-dashed border-border bg-surface px-4 py-8 text-center sm:py-10"
        }
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="sr-only"
          onChange={() => {
            onPick();
            if (inputRef.current) inputRef.current.value = "";
          }}
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={() => {
            onPick();
            if (cameraRef.current) cameraRef.current.value = "";
          }}
        />
        <Upload className="mx-auto h-8 w-8 text-accent" strokeWidth={1.75} />
        <p className="mt-3 text-base font-medium text-ink">
          Drop scans or a ZIP
        </p>
        <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-ink-muted">
          One image, many images, or a ZIP. Multi-card sheets are split
          automatically. Each scan is detected, cropped, rectified, and read
          with OCR to orient the card.
        </p>
        <p className="mt-2 font-mono text-xs text-ink-subtle">
          0 sources · 0 cards · idle
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            className={btnAccentClass}
            onClick={() => inputRef.current?.click()}
          >
            Choose images
          </button>
          <button
            type="button"
            className={btnClass}
            onClick={() => cameraRef.current?.click()}
          >
            <Camera className="h-4 w-4" strokeWidth={1.75} />
            Camera
          </button>
        </div>
      </section>

      {notice ? (
        <p
          role="status"
          className="rounded-2xl border border-border bg-surface px-4 py-3 text-sm leading-relaxed text-ink-muted"
        >
          {notice}
        </p>
      ) : null}

      <section className="rounded-2xl border border-border bg-surface p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink-muted">
          <p>
            <span className="font-mono tabular-nums text-ink">0</span> sources
            {" · "}
            <span className="font-mono tabular-nums text-ink">0</span> cards
            {" · "}
            <span className="font-mono tabular-nums text-ink">0</span> processing
            {" · "}
            <span className="font-mono tabular-nums text-ink">0</span> ready
            {" · "}
            <span className="font-mono tabular-nums text-ink">0</span> failed
            {" · "}
            <span className="font-mono tabular-nums text-ink">0</span> selected
          </p>
          <div className="flex flex-wrap gap-1">
            <button type="button" className={btnGhostClass} disabled>
              Select all
            </button>
            <button type="button" className={btnGhostClass} disabled>
              Select completed
            </button>
            <button type="button" className={btnGhostClass} disabled>
              Select failed
            </button>
            <button type="button" className={btnGhostClass} disabled>
              Clear selection
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className={btnAccentClass} disabled>
            <Maximize className="h-4 w-4" strokeWidth={1.75} />
            Upscale all
          </button>
          <button type="button" className={btnClass} disabled>
            <Eraser className="h-4 w-4" strokeWidth={1.75} />
            Descratch selected
          </button>
          <button type="button" className={btnClass} disabled>
            <Sparkles className="h-4 w-4" strokeWidth={1.75} />
            Descratch + Upscale selected
          </button>
          <button type="button" className={btnClass} disabled>
            Retry failed
          </button>
          <button
            type="button"
            className={`${btnAccentClass} sm:ml-auto`}
            onClick={() => setExportOpen(true)}
          >
            <Download className="h-4 w-4" strokeWidth={1.75} />
            Export
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-3 text-xs text-ink-muted">
          <label className="flex items-center gap-2">
            Scale
            <select
              className={controlClass}
              value={settings.upscaleScale}
              onChange={(event) =>
                setSettings({
                  upscaleScale: Number(event.target.value) as 2 | 4,
                })
              }
            >
              <option value={2}>2×</option>
              <option value={4}>4×</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            Descratch
            <select
              className={controlClass}
              value={settings.descratchLevel}
              onChange={(event) =>
                setSettings({
                  descratchLevel: event.target.value as DescratchLevel,
                })
              }
            >
              <option value="off">Off</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            Concurrency
            <select
              className={controlClass}
              value={settings.concurrency}
              onChange={(event) =>
                setSettings({
                  concurrency: Number(event.target.value) as 1 | 2 | 3 | 4,
                })
              }
            >
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
              <option value={4}>4</option>
            </select>
          </label>
        </div>
      </section>

      <section className="flex min-h-72 flex-col rounded-2xl border border-border bg-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-medium text-ink">Workspace</h2>
            <p className="mt-1 text-sm leading-relaxed text-ink-muted">
              Compare original and rectified versions, rotate a card, then
              generate a descratch or upscale.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnClass} disabled aria-label="Rotate left">
              <RotateCcw className="h-4 w-4" strokeWidth={1.75} />
            </button>
            <button type="button" className={btnClass} disabled aria-label="Rotate right">
              <RotateCw className="h-4 w-4" strokeWidth={1.75} />
            </button>
            <button type="button" className={btnClass} disabled>
              0°
            </button>
            <button type="button" className={btnClass} disabled>
              90°
            </button>
            <button type="button" className={btnClass} disabled>
              180°
            </button>
            <button type="button" className={btnClass} disabled>
              270°
            </button>
            <button type="button" className={btnClass} disabled>
              Reset rectified
            </button>
          </div>
        </div>

        <div className="mt-4 grid flex-1 gap-3 sm:grid-cols-2">
          <div className="flex min-h-48 items-center justify-center rounded-xl border border-border bg-surface-raised text-sm text-ink-subtle">
            Before
          </div>
          <div className="flex min-h-48 items-center justify-center rounded-xl border border-border bg-surface-raised text-sm text-ink-subtle">
            After
          </div>
        </div>
        <p className="mt-3 text-center text-sm text-ink-muted">
          No scan open. Drop a file above to start a batch once processing is
          connected.
        </p>
      </section>

      {exportOpen ? (
        <ExportDialog onClose={() => setExportOpen(false)} />
      ) : null}
    </div>
  );
}

function ExportDialog({ onClose }: { onClose: () => void }) {
  const { settings, setSettings } = useStudioSettings();
  const [scope, setScope] = useState<"current" | "selected" | "completed">(
    "selected",
  );
  const [version, setVersion] = useState<ArtifactType>("cropped");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-title"
    >
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative z-10 w-full max-w-lg space-y-4 rounded-2xl border border-border bg-surface p-4 shadow-2xl sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="export-title" className="text-lg font-semibold tracking-tight text-ink">
              Export
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              Download a ZIP with images and a manifest. 0 cards are ready.
            </p>
          </div>
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label="Close export"
            onClick={onClose}
          >
            <X className="h-5 w-5" strokeWidth={1.75} />
          </button>
        </div>

        <fieldset className="space-y-2">
          <legend className="font-mono text-[11px] font-medium uppercase tracking-wide text-ink-subtle">
            Scope
          </legend>
          <div className="flex flex-wrap gap-2">
            <ScopeButton
              current={scope}
              value="current"
              label="Current card"
              disabled
              onClick={setScope}
            />
            <ScopeButton
              current={scope}
              value="selected"
              label="Selected (0)"
              onClick={setScope}
            />
            <ScopeButton
              current={scope}
              value="completed"
              label="All completed (0)"
              onClick={setScope}
            />
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="font-mono text-[11px] font-medium uppercase tracking-wide text-ink-subtle">
            Version
          </legend>
          <div className="flex flex-wrap gap-2">
            {ARTIFACT_VERSIONS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setVersion(item.key)}
                className={version === item.key ? btnAccentClass : btnClass}
              >
                {item.label}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            Format
            <select
              className={controlClass}
              value={settings.exportFormat}
              onChange={(event) =>
                setSettings({
                  exportFormat: event.target.value as OutputFormat,
                })
              }
            >
              <option value="png">PNG</option>
              <option value="jpg">JPEG</option>
              <option value="webp">WebP</option>
            </select>
          </label>
          {settings.exportFormat !== "png" ? (
            <label className="flex items-center gap-2 text-sm text-ink-muted">
              Quality
              <input
                type="range"
                min={60}
                max={100}
                value={settings.exportQuality}
                onChange={(event) =>
                  setSettings({ exportQuality: Number(event.target.value) })
                }
                className="accent-accent"
              />
              <span className="font-mono text-xs tabular-nums text-ink">
                {settings.exportQuality}
              </span>
            </label>
          ) : null}
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" className={btnClass} onClick={onClose}>
            Close
          </button>
          <button type="button" className={btnClass} disabled>
            Download ZIP
          </button>
        </div>
      </div>
    </div>
  );
}

function ScopeButton({
  current,
  value,
  label,
  disabled,
  onClick,
}: {
  current: "current" | "selected" | "completed";
  value: "current" | "selected" | "completed";
  label: string;
  disabled?: boolean;
  onClick: (value: "current" | "selected" | "completed") => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onClick(value)}
      className={current === value ? btnAccentClass : btnClass}
    >
      {label}
    </button>
  );
}
