"use client";

import { useState } from "react";
import type { StoredCard } from "@/lib/types";

const controlClass =
  "h-11 w-full border border-border bg-surface-raised px-3 font-mono text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent";

export function IdentityForm({ card }: { card: StoredCard }) {
  const [player, setPlayer] = useState(card.player ?? "");
  const [setName, setSetName] = useState(card.setName ?? "");
  const [manufacturer, setManufacturer] = useState(card.manufacturer ?? "");
  const [year, setYear] = useState(card.year?.toString() ?? "");
  const [number, setNumber] = useState(card.number ?? "");
  const [parallel, setParallel] = useState(card.parallel ?? "");
  const [side, setSide] = useState(card.side ?? "unknown");

  return (
    <form
      className="panel grid gap-4 p-4 sm:p-6"
      onSubmit={(event) => event.preventDefault()}
    >
      <p className="text-sm text-ink-muted">
        File {card.filename} · detector {card.detector || "—"} · OCR{" "}
        {card.engine || "—"}
      </p>
      <Field id="player" label="Player" value={player} onChange={setPlayer} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="manufacturer"
          label="Manufacturer"
          value={manufacturer}
          onChange={setManufacturer}
        />
        <Field id="set" label="Set" value={setName} onChange={setSetName} />
        <Field
          id="year"
          label="Year"
          value={year}
          onChange={setYear}
          inputMode="numeric"
        />
        <Field id="number" label="Number" value={number} onChange={setNumber} />
        <Field
          id="parallel"
          label="Parallel"
          value={parallel}
          onChange={setParallel}
        />
        <div className="space-y-2">
          <label htmlFor="side" className="text-sm text-ink-muted">
            Side
          </label>
          <select
            id="side"
            value={side}
            onChange={(event) => setSide(event.target.value)}
            className={controlClass}
          >
            <option value="front">front</option>
            <option value="back">back</option>
            <option value="unknown">unknown</option>
          </select>
        </div>
      </div>
      <div className="flex flex-col items-end gap-2">
        <button
          type="submit"
          disabled
          className="inline-flex h-10 items-center justify-center bg-accent px-4 text-sm font-medium text-background disabled:cursor-not-allowed disabled:opacity-40"
        >
          Save identity
        </button>
        <p className="text-xs text-ink-subtle">
          Saving to the library will be connected in a later step.
        </p>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  inputMode,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  inputMode?: "numeric";
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm text-ink-muted">
        {label}
      </label>
      <input
        id={id}
        value={value}
        inputMode={inputMode}
        onChange={(event) => onChange(event.target.value)}
        className={controlClass}
      />
    </div>
  );
}
