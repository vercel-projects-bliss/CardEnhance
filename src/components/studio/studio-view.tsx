"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Upload } from "lucide-react";
import { SectionLabel } from "@/components/section-label";
import { useStudioSettings } from "@/components/studio-settings";
import { createEnhancePool } from "@/lib/enhance-pool";
import {
  downloadBlob,
  encodePng,
  expandFiles,
  imageDataFromBlob,
  zipBlobs,
} from "@/lib/files";
import { enhancePrepared, prepareScan } from "@/lib/process-scan";
import type { EnhanceAudit, LocalScan, ScanStatus, StudioSettings } from "@/lib/types";

const ACCEPT = "image/jpeg,image/png,image/webp,image/bmp,image/tiff,application/zip,.zip";

const btn =
  "inline-flex h-9 items-center justify-center gap-2 border border-border bg-surface-raised px-3 font-mono text-xs tracking-wide text-ink transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40";

const btnGhost =
  "inline-flex h-9 items-center justify-center gap-2 border border-transparent px-3 font-mono text-xs tracking-wide text-ink-muted transition-colors hover:border-border hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40";

const btnPrimary =
  "glow-box inline-flex h-9 items-center justify-center bg-accent px-3 font-mono text-xs font-medium tracking-wide text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:border disabled:border-accent/40 disabled:bg-accent/20 disabled:text-accent/70 disabled:shadow-none disabled:opacity-70";

type PixelRecord = {
  source: Blob;
  processed?: Blob;
};

export function StudioView() {
  const { settings } = useStudioSettings();
  const [scans, setScans] = useState<LocalScan[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [activeLabel, setActiveLabel] = useState("");
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [compareOn, setCompareOn] = useState(false);
  const urlsRef = useRef<string[]>([]);
  const pixelsRef = useRef(new Map<string, PixelRecord>());

  useEffect(() => {
    const urls = urlsRef;
    const pixels = pixelsRef;
    return () => {
      urls.current.forEach((url) => URL.revokeObjectURL(url));
      pixels.current.clear();
    };
  }, []);

  const patchScan = useCallback((id: string, partial: Partial<LocalScan>) => {
    setScans((current) => current.map((scan) => (scan.id === id ? { ...scan, ...partial } : scan)));
  }, []);

  const addFiles = useCallback(async (list: FileList | File[] | null) => {
    if (!list || (Array.isArray(list) ? list.length === 0 : list.length === 0)) {
      return;
    }

    let incoming: File[] = [];
    try {
      incoming = await expandFiles([...list]);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not read files.");
      return;
    }

    incoming = incoming.filter(
      (file) => file.type.startsWith("image/") || /\.(jpe?g|png|webp|bmp|tiff)$/i.test(file.name),
    );

    if (incoming.length === 0) {
      setNotice("Drop image files or a ZIP of images to build a batch.");
      return;
    }

    const next: LocalScan[] = [];
    for (const file of incoming) {
      try {
        const scan = await readScan(file);
        pixelsRef.current.set(scan.id, { source: file });
        urlsRef.current.push(scan.url);
        next.push(scan);
      } catch {
        setNotice(`Could not read ${file.name}.`);
      }
    }

    if (next.length) {
      setScans((current) => [...current, ...next]);
      setNotice(null);
    }
  }, []);

  const selected = scans.filter((scan) => scan.selected).length;
  const enhanced = scans.filter((scan) => scan.status === "completed").length;
  const canExport = enhanced > 0 && !running;

  const selectAll = () =>
    setScans((current) => current.map((scan) => ({ ...scan, selected: true })));
  const clear = () =>
    setScans((current) => current.map((scan) => ({ ...scan, selected: false })));
  const toggle = (id: string) => {
    setFocusedId(id);
    setScans((current) =>
      current.map((scan) =>
        scan.id === id ? { ...scan, selected: !scan.selected } : scan,
      ),
    );
  };

  const runSelected = async () => {
    const targets = scans.filter((scan) => scan.selected);
    if (!targets.length || running) return;
    setRunning(true);
    setNotice(null);
    setActiveLabel(`Running ${targets.length}`);
    setScans((current) =>
      current.map((scan) =>
        scan.selected && scan.status !== "processing"
          ? { ...scan, status: "queued" as ScanStatus, error: undefined, stage: "queued" }
          : scan,
      ),
    );

    const pool = createEnhancePool(2);
    let cursor = 0;
    const work = async () => {
      while (cursor < targets.length) {
        const target = targets[cursor++];
        setActiveLabel(target.name);
        await processOne(target, settings, pool, {
          pixels: pixelsRef.current,
          urls: urlsRef.current,
          patchScan,
          insertScans: (afterId, extras) => {
            setScans((current) => {
              const index = current.findIndex((scan) => scan.id === afterId);
              if (index < 0) return [...current, ...extras];
              return [...current.slice(0, index + 1), ...extras, ...current.slice(index + 1)];
            });
          },
        });
      }
    };

    try {
      await Promise.all([work(), work()]);
      setActiveLabel("");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Batch failed.");
    } finally {
      pool.terminate();
      setRunning(false);
    }
  };

  const downloadPngs = async () => {
    const done = scans.filter((scan) => scan.status === "completed" && pixelsRef.current.get(scan.id)?.processed);
    if (!done.length) return;
    if (done.length === 1) {
      const rec = pixelsRef.current.get(done[0].id);
      if (rec?.processed) downloadBlob(rec.processed, pngName(done[0].name));
      return;
    }
    await zipBlobs(
      done.map((scan) => ({
        name: pngName(scan.name),
        blob: pixelsRef.current.get(scan.id)!.processed!,
      })),
      `CardEnhance_enhanced_${Date.now()}.zip`,
    );
  };

  const exportAudit = () => {
    const rows: EnhanceAudit[] = scans
      .filter((scan) => scan.status === "completed" && scan.processedAt)
      .map((scan) => ({
        filename: scan.name,
        inputWidth: scan.inputWidth,
        inputHeight: scan.inputHeight,
        outputWidth: scan.width,
        outputHeight: scan.height,
        isChromeFoil: Boolean(scan.isChromeFoil),
        specularRatio: scan.specularRatio ?? 0,
        specularPeakRatio: scan.specularPeakRatio ?? 0,
        metallicContrast: scan.metallicContrast ?? 0,
        settings: scan.settingsUsed ?? settings,
        sharpnessBefore: scan.sharpnessBefore ?? 0,
        sharpnessAfter: scan.sharpnessAfter ?? 0,
        sharpnessDelta: scan.sharpnessDelta ?? 0,
        timestamp: scan.processedAt ?? new Date().toISOString(),
      }));
    if (!rows.length) return;
    const body = JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        count: rows.length,
        cards: rows,
      },
      null,
      2,
    );
    downloadBlob(new Blob([body], { type: "application/json" }), `CardEnhance_audit_${Date.now()}.json`);
  };

  const focused = scans.find((scan) => scan.id === focusedId) ?? scans.find((scan) => scan.status === "completed") ?? null;
  const showCompare = compareOn && focused && focused.status === "completed";
  const pill = `${scans.length} scans · ${selected} selected · ${enhanced} enhanced`;

  return (
    <div className="flex flex-col gap-3">
      <div className="panel flex flex-wrap items-center gap-2 px-3 py-2 sm:gap-3">
        <span className="flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 rounded-full ${running ? "animate-pulse bg-laser shadow-[0_0_8px_#00ff66]" : "bg-laser shadow-[0_0_8px_#00ff66]"}`}
            aria-hidden
          />
          <span className="glow-text text-sm font-medium">Batch editor</span>
        </span>
        <span className="border border-border px-2 py-1 font-mono text-[11px] text-ink-muted" data-testid="batch-counts">
          {pill}
        </span>
        {activeLabel ? (
          <span className="font-mono text-[11px] text-ink-subtle" role="status">
            {running ? `Processing · ${activeLabel}` : activeLabel}
          </span>
        ) : null}
        <div className="flex flex-wrap items-center gap-1 sm:ml-auto">
          <button type="button" className={btnGhost} onClick={selectAll} disabled={!scans.length || running}>
            Select all
          </button>
          <button type="button" className={btnGhost} onClick={clear} disabled={!scans.length || running}>
            Clear
          </button>
          <button
            type="button"
            className={btnPrimary}
            data-testid="run-batch"
            disabled={!selected || running}
            title={running ? "Processing…" : "Run the client pipeline on the selected scans"}
            aria-label={`Run on ${selected} selected`}
            onClick={() => void runSelected()}
          >
            {running ? "Running…" : `Run on ${selected} selected`}
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
            <InspectorRail
              canExport={canExport}
              onDownloadPngs={() => void downloadPngs()}
              onExportAudit={exportAudit}
            />
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <DropZone onFiles={addFiles} count={scans.length} />
          {notice ? (
            <p role="status" className="panel px-3 py-2 font-mono text-xs text-ink-muted">
              {notice}
            </p>
          ) : null}
          {enhanced > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={compareOn ? btnPrimary : btn}
                data-testid="toggle-compare"
                onClick={() => {
                  if (!focusedId && focused) setFocusedId(focused.id);
                  setCompareOn((value) => !value);
                }}
              >
                {compareOn ? "Hide compare" : "Before / after"}
              </button>
              {compareOn && focused ? (
                <span className="font-mono text-[11px] text-ink-subtle">
                  Comparing {focused.name}
                </span>
              ) : null}
            </div>
          ) : null}
          {showCompare && focused ? <CompareView scan={focused} /> : null}
          <ScanGrid scans={scans} onToggle={toggle} focusedId={focusedId} />
        </div>
      </div>
    </div>
  );
}

async function processOne(
  target: LocalScan,
  settings: StudioSettings,
  pool: ReturnType<typeof createEnhancePool>,
  ctx: {
    pixels: Map<string, PixelRecord>;
    urls: string[];
    patchScan: (id: string, partial: Partial<LocalScan>) => void;
    insertScans: (afterId: string, extras: LocalScan[]) => void;
  },
) {
  const rec = ctx.pixels.get(target.id);
  if (!rec) {
    ctx.patchScan(target.id, { status: "failed", error: "Source pixels missing", stage: "failed" });
    return;
  }

  try {
    ctx.patchScan(target.id, { status: "processing", stage: "detecting" });
    const source = await imageDataFromBlob(rec.source);
    const prepared = await prepareScan(source, target.name);
    if (!prepared.length) throw new Error("No card detected");

    const first = prepared[0];
    ctx.patchScan(target.id, { stage: "enhancing" });
    await finishPrepared(target.id, target.name, first, settings, pool, ctx, source.width, source.height);

    const extras: LocalScan[] = [];
    const extraPrepared: Array<{ id: string; card: (typeof prepared)[number] }> = [];
    for (let i = 1; i < prepared.length; i++) {
      const extra = prepared[i];
      const id = crypto.randomUUID();
      const preview = await encodePng(extra.image);
      const url = URL.createObjectURL(preview);
      ctx.urls.push(url);
      ctx.pixels.set(id, { source: preview });
      extras.push({
        id,
        name: extra.filename,
        url,
        originalUrl: url,
        width: extra.image.width,
        height: extra.image.height,
        inputWidth: extra.image.width,
        inputHeight: extra.image.height,
        selected: true,
        status: "processing",
        stage: "enhancing",
        sharpnessDelta: null,
      });
      extraPrepared.push({ id, card: extra });
    }
    if (extras.length) ctx.insertScans(target.id, extras);
    for (const item of extraPrepared) {
      await finishPrepared(item.id, item.card.filename, item.card, settings, pool, ctx, item.card.image.width, item.card.image.height);
    }
  } catch (err) {
    ctx.patchScan(target.id, {
      status: "failed",
      stage: "failed",
      error: err instanceof Error ? err.message : "Processing failed",
    });
  }
}

async function finishPrepared(
  id: string,
  filename: string,
  prepared: Awaited<ReturnType<typeof prepareScan>>[number],
  settings: StudioSettings,
  pool: ReturnType<typeof createEnhancePool>,
  ctx: {
    pixels: Map<string, PixelRecord>;
    urls: string[];
    patchScan: (id: string, partial: Partial<LocalScan>) => void;
  },
  sourceW: number,
  sourceH: number,
) {
  const rectified = await encodePng(prepared.image);
  const rectifiedUrl = URL.createObjectURL(rectified);
  ctx.urls.push(rectifiedUrl);

  const enhanced = await enhancePrepared(prepared.image, settings, pool);
  ctx.urls.push(enhanced.url);
  const existing = ctx.pixels.get(id);
  ctx.pixels.set(id, { source: existing?.source ?? rectified, processed: enhanced.blob });

  ctx.patchScan(id, {
    name: filename,
    url: enhanced.url,
    originalUrl: rectifiedUrl,
    width: enhanced.width,
    height: enhanced.height,
    inputWidth: prepared.image.width,
    inputHeight: prepared.image.height,
    status: "completed",
    stage: "completed",
    error: undefined,
    sharpnessDelta: enhanced.sharpnessDelta,
    sharpnessBefore: enhanced.sharpnessBefore,
    sharpnessAfter: enhanced.sharpnessAfter,
    isChromeFoil: enhanced.chromeFoil.isChromeFoil,
    specularRatio: enhanced.chromeFoil.specularRatio,
    specularPeakRatio: enhanced.chromeFoil.specularPeakRatio,
    metallicContrast: enhanced.chromeFoil.metallicContrast,
    processedAt: new Date().toISOString(),
    settingsUsed: { ...settings },
  });
  void sourceW;
  void sourceH;
}

function pngName(name: string) {
  return `${name.replace(/\.[^.]+$/, "")}-enhanced.png`;
}

function InspectorRail({
  canExport,
  onDownloadPngs,
  onExportAudit,
}: {
  canExport: boolean;
  onDownloadPngs: () => void;
  onExportAudit: () => void;
}) {
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
          onChange={(event) => setSettings({ descratchFoilOnly: event.target.checked })}
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
          <button
            type="button"
            className={btn}
            data-testid="download-pngs"
            disabled={!canExport}
            onClick={onDownloadPngs}
          >
            Download enhanced PNGs
          </button>
          <button
            type="button"
            className={btn}
            data-testid="export-audit"
            disabled={!canExport}
            onClick={onExportAudit}
          >
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

function CompareView({ scan }: { scan: LocalScan }) {
  return (
    <div className="panel grid grid-cols-2 gap-0 overflow-hidden" data-testid="studio-compare">
      <figure className="border-r border-border">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={scan.originalUrl} alt={`${scan.name} before`} className="max-h-80 w-full object-contain" />
        <figcaption className="border-t border-border px-2 py-1 font-mono text-[11px] text-ink-subtle">
          Before · {scan.inputWidth} × {scan.inputHeight}
        </figcaption>
      </figure>
      <figure>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={scan.url} alt={`${scan.name} after`} className="max-h-80 w-full object-contain" />
        <figcaption className="border-t border-border px-2 py-1 font-mono text-[11px] text-ink-subtle">
          After · {scan.width} × {scan.height}
          {scan.sharpnessDelta != null
            ? ` · Δ ${scan.sharpnessDelta > 0 ? "+" : ""}${scan.sharpnessDelta.toFixed(1)}%`
            : ""}
        </figcaption>
      </figure>
    </div>
  );
}

function ScanGrid({
  scans,
  onToggle,
  focusedId,
}: {
  scans: LocalScan[];
  onToggle: (id: string) => void;
  focusedId: string | null;
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
        const dim =
          scan.status === "completed" &&
          (scan.inputWidth !== scan.width || scan.inputHeight !== scan.height)
            ? `${scan.inputWidth} × ${scan.inputHeight} → ${scan.width} × ${scan.height}`
            : `${scan.width} × ${scan.height}`;
        const delta =
          scan.sharpnessDelta === null
            ? "—"
            : `${scan.sharpnessDelta > 0 ? "+" : ""}${scan.sharpnessDelta.toFixed(1)}%`;
        const deltaPositive = (scan.sharpnessDelta ?? 0) > 0;

        return (
          <li key={scan.id} className={landscape ? "col-span-2" : "col-span-1"}>
            <button
              type="button"
              onClick={() => onToggle(scan.id)}
              aria-pressed={scan.selected}
              data-focused={focusedId === scan.id ? "true" : "false"}
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
                {scan.isChromeFoil ? (
                  <span
                    data-testid="chrome-foil-badge"
                    className="absolute top-2 right-2 z-10 border border-laser/60 bg-background/80 px-1.5 py-0.5 font-mono text-[9px] tracking-wide text-laser"
                  >
                    CHROME / FOIL
                  </span>
                ) : null}
                {scan.status === "processing" || scan.status === "queued" ? (
                  <span className="absolute bottom-2 left-2 z-10 border border-border bg-background/80 px-1.5 py-0.5 font-mono text-[9px] text-ink-muted">
                    {scan.stage ?? scan.status}
                  </span>
                ) : null}
                {scan.status === "failed" ? (
                  <span className="absolute bottom-2 left-2 z-10 border border-border bg-background/80 px-1.5 py-0.5 font-mono text-[9px] text-ink">
                    {scan.error ?? "failed"}
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
                  data-testid="sharpness-delta"
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
    originalUrl: url,
    width: size.width,
    height: size.height,
    inputWidth: size.width,
    inputHeight: size.height,
    selected: true,
    status: "idle",
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
