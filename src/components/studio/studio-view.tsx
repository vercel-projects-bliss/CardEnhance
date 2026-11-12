"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Upload } from "lucide-react";
import { SectionLabel } from "@/components/section-label";
import { useStudioSettings } from "@/components/studio-settings";
import type { LocalScan } from "@/lib/types";

const ACCEPT = "image/jpeg,image/png,image/webp,image/bmp,image/tiff";

const btn =
  "inline-flex h-9 items-center justify-center gap-2 border border-border bg-surface-raised px-3 font-mono text-xs tracking-wide text-ink transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40";

const btnGhost =
  "inline-flex h-9 items-center justify-center gap-2 border border-transparent px-3 font-mono text-xs tracking-wide text-ink-muted transition-colors hover:border-border hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40";

export function StudioView() {
  const [scans, setScans] = useState<LocalScan[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(false);
  const urlsRef = useRef<string[]>([]);

  useEffect(() => {
    return () => {
      urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const addFiles = useCallback(async (list: FileList | File[] | null) => {
    if (!list || (Array.isArray(list) ? list.length === 0 : list.length === 0)) {
      return;
    }

    const incoming = [...list].filter((file) =>
      file.type.startsWith("image/") || /\.(jpe?g|png|webp|bmp|tiff)$/i.test(file.name),
    );

    if (incoming.length === 0) {
      setNotice("Drop image files to build a batch. ZIP unpacking connects in a later step.");
      return;
    }

    const next: LocalScan[] = [];
    for (const file of incoming) {
      try {
        next.push(await readScan(file));
      } catch {
        setNotice(`Could not read ${file.name}.`);
      }
    }

    if (next.length) {
      urlsRef.current.push(...next.map((scan) => scan.url));
      setScans((current) => [...current, ...next]);
      setNotice(null);
    }
  }, []);

  const selected = scans.filter((scan) => scan.selected).length;
  const enhanced = scans.filter((scan) => scan.sharpnessDelta !== null).length;

  const selectAll = () =>
    setScans((current) => current.map((scan) => ({ ...scan, selected: true })));
  const clear = () =>
    setScans((current) => current.map((scan) => ({ ...scan, selected: false })));
  const toggle = (id: string) =>
    setScans((current) =>
      current.map((scan) =>
        scan.id === id ? { ...scan, selected: !scan.selected } : scan,
      ),
    );

  const pill = `${scans.length} scans · ${selected} selected · ${enhanced} enhanced`;

  return (
    <div className="flex flex-col gap-3">
      <div className="panel flex flex-wrap items-center gap-2 px-3 py-2 sm:gap-3">
        <span className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-laser shadow-[0_0_8px_#00ff66]" aria-hidden />
          <span className="glow-text text-sm font-medium">Batch editor</span>
        </span>
        <span className="border border-border px-2 py-1 font-mono text-[11px] text-ink-muted">
          {pill}
        </span>
        <div className="flex flex-wrap items-center gap-1 sm:ml-auto">
          <button type="button" className={btnGhost} onClick={selectAll} disabled={!scans.length}>
            Select all
          </button>
          <button type="button" className={btnGhost} onClick={clear} disabled={!scans.length}>
            Clear
          </button>
          <button
            type="button"
            className="inline-flex h-9 items-center justify-center border border-accent/40 bg-accent/20 px-3 font-mono text-xs font-medium tracking-wide text-accent/70 cursor-not-allowed opacity-70"
            disabled
            title="Processing connects in step 5"
            aria-label={`Run on ${selected} selected. Processing connects in step 5.`}
          >
            Run on {selected} selected
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[272px_minmax(0,1fr)] lg:items-start">
        <div className="lg:sticky lg:top-4">
          <button
            type="button"
            className="panel mb-2 flex w-full items-center justify-between px-3 py-2 font-mono text-[11px] text-laser lg:hidden"
            aria-expanded={railOpen}
            onClick={() => setRailOpen((value) => !value)}
          >
            <span>// 01 ENHANCEMENT & EXPORT</span>
            <ChevronDown
              className={`h-4 w-4 transition-transform ${railOpen ? "rotate-180" : ""}`}
              strokeWidth={1.75}
            />
          </button>
          <div className={railOpen ? "block" : "hidden lg:block"}>
            <InspectorRail />
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <DropZone onFiles={addFiles} count={scans.length} />
          {notice ? (
            <p role="status" className="panel px-3 py-2 font-mono text-xs text-ink-muted">
              {notice}
            </p>
          ) : null}
          <ScanGrid scans={scans} onToggle={toggle} />
        </div>
      </div>
    </div>
  );
}

function InspectorRail() {
  const { settings, setSettings } = useStudioSettings();

  return (
    <aside className="panel flex flex-col gap-4 p-3">
      <SectionLabel index="01">ENHANCEMENT & EXPORT</SectionLabel>

      <SliderField
        label="Scale"
        value={settings.scale}
        min={1}
        max={4}
        step={0.25}
        format={(value) => `${value.toFixed(2)}×`}
        onChange={(value) => setSettings({ scale: value })}
        help="Resamples with high-quality smoothing. Long edge is capped at 2200px."
      />
      <SliderField
        label="Descratch"
        value={settings.descratch}
        min={0}
        max={1}
        step={0.01}
        format={(value) => value.toFixed(2)}
        onChange={(value) => setSettings({ descratch: value })}
        help="Median-filters thin bright/dark scanner scratches before denoise."
      />
      <label className="flex items-start gap-2 font-mono text-[11px] leading-snug text-ink-muted">
        <input
          type="checkbox"
          className="mt-0.5 accent-accent"
          checked={settings.descratchFoilOnly}
          onChange={(event) =>
            setSettings({ descratchFoilOnly: event.target.checked })
          }
        />
        <span>Only on scans detected as chrome/foil (specular-highlight heuristic)</span>
      </label>
      <SliderField
        label="Denoise"
        value={settings.denoise}
        min={0}
        max={1}
        step={0.01}
        format={(value) => value.toFixed(2)}
        onChange={(value) => setSettings({ denoise: value })}
        help="Blends a 3×3 box average back over the original."
      />
      <SliderField
        label="Sharpen"
        value={settings.sharpen}
        min={0}
        max={1}
        step={0.01}
        format={(value) => value.toFixed(2)}
        onChange={(value) => setSettings({ sharpen: value })}
        help="Unsharp mask. Updates the measured sharpness delta after processing."
      />
      <SliderField
        label="Contrast"
        value={settings.contrast}
        min={0}
        max={1}
        step={0.01}
        format={(value) => value.toFixed(2)}
        onChange={(value) => setSettings({ contrast: value })}
        help="Mid-grey S-curve, kept low so foil/chrome does not clip."
      />

      <div className="border-t border-border pt-3">
        <SectionLabel index="02">EXPORT</SectionLabel>
        <p className="mt-2 font-mono text-[11px] leading-relaxed text-ink-subtle">
          Downloads come from real processed pixels and measured sharpness
          delta, never placeholders.
        </p>
        <div className="mt-3 flex flex-col gap-2">
          <button type="button" className={btn} disabled>
            Download enhanced PNGs
          </button>
          <button type="button" className={btn} disabled>
            Export audit JSON
          </button>
        </div>
      </div>
    </aside>
  );
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  help,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
  help: string;
}) {
  const id = label.toLowerCase();

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="font-mono text-[11px] text-ink">
          {label}
        </label>
        <span className="font-mono text-[11px] tabular-nums text-accent">
          {format(value)}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full"
      />
      <p className="mt-1 font-mono text-[10px] leading-relaxed text-ink-subtle">
        {help}
      </p>
    </div>
  );
}

function DropZone({
  onFiles,
  count,
}: {
  onFiles: (list: FileList | File[] | null) => void;
  count: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <div
      onDragEnter={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        onFiles(event.dataTransfer.files);
      }}
      className={
        over
          ? "flex items-center justify-between gap-3 border border-dashed border-accent bg-accent/5 px-3 py-3"
          : "panel flex items-center justify-between gap-3 border-dashed px-3 py-3"
      }
    >
      <input
        id="batch-upload"
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        data-testid="batch-upload"
        className="sr-only"
        onChange={(event) => {
          onFiles(event.target.files);
          event.currentTarget.value = "";
        }}
      />
      <div className="flex min-w-0 items-center gap-3">
        <Upload className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.75} />
        <div className="min-w-0">
          <p className="text-sm text-ink">Drop scans or choose images</p>
          <p className="font-mono text-[11px] text-ink-subtle">
            Local preview only · {count} in grid · no upload
          </p>
        </div>
      </div>
      <button
        type="button"
        className={btn + " shrink-0 whitespace-nowrap"}
        onClick={() => inputRef.current?.click()}
      >
        Choose images
      </button>
    </div>
  );
}

function ScanGrid({
  scans,
  onToggle,
}: {
  scans: LocalScan[];
  onToggle: (id: string) => void;
}) {
  if (scans.length === 0) {
    return (
      <div className="panel px-4 py-8 text-center">
        <p className="text-sm text-ink">No scans in this batch</p>
        <p className="mt-1 font-mono text-[11px] text-ink-subtle">
          Drop portrait or landscape images to preview the mixed grid.
        </p>
      </div>
    );
  }

  return (
    <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {scans.map((scan) => {
        const landscape = scan.width > scan.height;
        const dim = `${scan.width} × ${scan.height}`;
        const delta =
          scan.sharpnessDelta === null
            ? "—"
            : `${scan.sharpnessDelta > 0 ? "+" : ""}${scan.sharpnessDelta.toFixed(2)}`;
        const deltaPositive = (scan.sharpnessDelta ?? 0) > 0;

        return (
          <li
            key={scan.id}
            className={landscape ? "col-span-2" : "col-span-1"}
          >
            <button
              type="button"
              onClick={() => onToggle(scan.id)}
              aria-pressed={scan.selected}
              className={
                scan.selected
                  ? "glow-box flex w-full flex-col bg-surface text-left focus-visible:outline-none"
                  : "flex w-full flex-col border border-border bg-surface text-left opacity-60 transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              }
            >
              <div className="relative bg-background">
                {scan.selected ? (
                  <span className="absolute top-2 left-2 z-10 flex h-6 w-6 items-center justify-center bg-accent text-background">
                    <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                    <span className="sr-only">Selected</span>
                  </span>
                ) : null}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={scan.url}
                  alt={scan.name}
                  className="mx-auto max-h-64 w-full object-contain"
                />
              </div>
              <div className="border-t border-border px-2 py-2">
                <p className="truncate font-mono text-[11px] text-ink">{scan.name}</p>
                <p className="mt-0.5 font-mono text-[10px] text-ink-subtle">
                  {dim}
                  {landscape ? " · landscape" : ""}
                </p>
                <p
                  className={
                    deltaPositive
                      ? "mt-0.5 font-mono text-[10px] text-laser"
                      : "mt-0.5 font-mono text-[10px] text-ink-subtle"
                  }
                >
                  sharpness Δ {delta}
                </p>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

async function readScan(file: File): Promise<LocalScan> {
  const url = URL.createObjectURL(file);
  const size = await readSize(url);

  return {
    id: crypto.randomUUID(),
    name: file.name,
    url,
    width: size.width,
    height: size.height,
    selected: true,
    sharpnessDelta: null,
  };
}

function readSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () =>
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("image"));
    image.src = url;
  });
}
