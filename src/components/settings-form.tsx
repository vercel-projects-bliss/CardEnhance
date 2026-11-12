"use client";

import { useStudioSettings } from "@/components/studio-settings";
import type { DescratchLevel, OutputFormat } from "@/lib/types";

const controlClass =
  "h-10 w-full rounded-lg border border-border bg-surface-raised px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent";

export function SettingsForm() {
  const { settings, setSettings } = useStudioSettings();

  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <p className="text-sm leading-relaxed text-ink-muted">
        These are the same session options used in Studio. In the working app
        they stay in memory for the session and are not saved to the database.
      </p>

      <section className="rounded-2xl border border-border bg-surface px-5 py-5">
        <h2 className="text-base font-medium text-ink">Restore</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Applied when you descratch or upscale a selected card.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm text-ink-muted">
            Upscale scale
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
          <label className="flex flex-col gap-2 text-sm text-ink-muted">
            Descratch level
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
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-surface px-5 py-5">
        <h2 className="text-base font-medium text-ink">Batch</h2>
        <p className="mt-1 text-sm text-ink-muted">
          How many cards the enhance pool works on at once (1–4).
        </p>
        <div className="mt-4 flex gap-2">
          {([1, 2, 3, 4] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setSettings({ concurrency: value })}
              className={
                settings.concurrency === value
                  ? "h-11 flex-1 rounded-xl border border-accent/40 bg-accent/10 text-sm font-medium text-accent"
                  : "h-11 flex-1 rounded-xl border border-border bg-surface-raised text-sm font-medium text-ink-muted hover:text-ink"
              }
            >
              {value}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-surface px-5 py-5">
        <h2 className="text-base font-medium text-ink">Output</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Format and quality used when exporting a ZIP.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm text-ink-muted">
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
            <label className="flex flex-col gap-2 text-sm text-ink-muted">
              Quality
              <div className="flex h-10 items-center gap-3">
                <input
                  type="range"
                  min={60}
                  max={100}
                  value={settings.exportQuality}
                  onChange={(event) =>
                    setSettings({ exportQuality: Number(event.target.value) })
                  }
                  className="flex-1 accent-accent"
                />
                <span className="font-mono text-xs tabular-nums text-ink">
                  {settings.exportQuality}
                </span>
              </div>
            </label>
          ) : (
            <p className="self-end text-sm text-ink-subtle">
              PNG is lossless, so quality does not apply.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
