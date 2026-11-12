"use client";

import { SectionLabel } from "@/components/section-label";
import { useStudioSettings } from "@/components/studio-settings";

export function SettingsForm() {
  const { settings, setSettings } = useStudioSettings();

  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <p className="font-mono text-xs leading-relaxed text-ink-muted">
        These are the same session defaults as the Studio inspector. They stay
        in memory for this session and are not saved to the database.
      </p>

      <section className="panel p-4">
        <SectionLabel index="01">ENHANCEMENT</SectionLabel>
        <div className="mt-4 flex flex-col gap-4">
          <SliderRow
            label="Scale"
            value={settings.scale}
            min={1}
            max={4}
            step={0.25}
            format={(value) => `${value.toFixed(2)}×`}
            help="Resamples with high-quality smoothing. Long edge is capped at 2200px."
            onChange={(value) => setSettings({ scale: value })}
          />
          <SliderRow
            label="Descratch"
            value={settings.descratch}
            min={0}
            max={1}
            step={0.01}
            format={(value) => value.toFixed(2)}
            help="Median-filters thin bright/dark scanner scratches before denoise."
            onChange={(value) => setSettings({ descratch: value })}
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
            <span>
              Only on scans detected as chrome/foil (specular-highlight heuristic)
            </span>
          </label>
          <SliderRow
            label="Denoise"
            value={settings.denoise}
            min={0}
            max={1}
            step={0.01}
            format={(value) => value.toFixed(2)}
            help="Blends a 3×3 box average back over the original."
            onChange={(value) => setSettings({ denoise: value })}
          />
          <SliderRow
            label="Sharpen"
            value={settings.sharpen}
            min={0}
            max={1}
            step={0.01}
            format={(value) => value.toFixed(2)}
            help="Unsharp mask. Updates the measured sharpness delta after processing."
            onChange={(value) => setSettings({ sharpen: value })}
          />
          <SliderRow
            label="Contrast"
            value={settings.contrast}
            min={0}
            max={1}
            step={0.01}
            format={(value) => value.toFixed(2)}
            help="Mid-grey S-curve, kept low so foil/chrome does not clip."
            onChange={(value) => setSettings({ contrast: value })}
          />
        </div>
      </section>

      <section className="panel p-4">
        <SectionLabel index="02">EXPORT</SectionLabel>
        <p className="mt-3 font-mono text-[11px] leading-relaxed text-ink-subtle">
          Download enhanced PNGs and export audit JSON once real processed
          pixels and a measured sharpness delta exist. Those actions stay
          disabled until processing is connected.
        </p>
      </section>
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  format,
  help,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  help: string;
  onChange: (value: number) => void;
}) {
  const id = `settings-${label.toLowerCase()}`;

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
