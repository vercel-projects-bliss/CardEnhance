"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { formatWhen } from "@/lib/card-label";
import type { AuditRow } from "@/lib/types";

const controlClass =
  "h-10 w-full border border-border bg-background px-3 font-mono text-xs text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent sm:max-w-sm";

const columns = [
  "When",
  "File",
  "Chrome / foil",
  "Scratch removal",
  "Denoise",
  "Sharpness Δ",
  "Upscale (in → out)",
] as const;

export function AuditLog({ rows }: { rows: AuditRow[] }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => filterRows(rows, query), [rows, query]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <p className="shrink-0 font-mono text-xs text-ink-muted">
          <span className="tabular-nums text-ink">{rows.length}</span> recorded actions
        </p>
        <form
          className="flex w-full sm:justify-end"
          onSubmit={(event) => event.preventDefault()}
          role="search"
        >
          <label className="sr-only" htmlFor="audit-q">
            Filter audit
          </label>
          <input
            id="audit-q"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Action, player, file"
            className={controlClass}
          />
        </form>
      </div>

      {rows.length > 0 && filtered.length === 0 ? (
        <EmptyState
          compact
          title="No matches"
          description={`No audit rows match “${query}”.`}
        />
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[52rem] text-left font-mono text-xs">
            <thead className="bg-surface-raised text-laser">
              <tr>
                {columns.map((column) => (
                  <th key={column} className="border-b border-border px-3 py-2 font-medium">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="px-3 py-6 text-ink-muted">
                    <p className="max-w-xl">
                      No restoration records yet. Chrome/foil detection, scratch removal, denoise, sharpness Δ, and in→out resolution will appear here after a batch runs.
                    </p>
                  </td>
                </tr>
              ) : filtered.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="px-3 py-2 text-ink-muted">{formatWhen(row.createdAt)}</td>
                  <td className="px-3 py-2 text-ink">
                    {row.entityType === "card" && row.entityId ? (
                      <Link
                        href={`/library/${row.entityId}`}
                        className="text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        {row.filename || row.player || row.entityId.slice(0, 8)}
                      </Link>
                    ) : (
                      row.filename || row.player || "—"
                    )}
                  </td>
                  <td className="px-3 py-2 text-ink-muted">
                    {row.chromeFoil === null ? "—" : row.chromeFoil ? "detected" : "no"}
                  </td>
                  <td className="px-3 py-2 text-ink-muted">{row.scratchRemoval ?? "—"}</td>
                  <td className="px-3 py-2 text-ink-muted">
                    {row.denoise === null ? "—" : row.denoise.toFixed(2)}
                  </td>
                  <td
                    className={
                      (row.sharpnessDelta ?? 0) > 0 ? "px-3 py-2 text-laser" : "px-3 py-2 text-ink-muted"
                    }
                  >
                    {row.sharpnessDelta === null
                      ? "—"
                      : `${row.sharpnessDelta > 0 ? "+" : ""}${row.sharpnessDelta.toFixed(2)}`}
                  </td>
                  <td className="px-3 py-2 text-ink-muted">
                    {row.resIn || row.resOut ? `${row.resIn ?? "—"} → ${row.resOut ?? "—"}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function filterRows(rows: AuditRow[], query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;

  return rows.filter((row) =>
    [row.action, row.player, row.filename, row.entityId, row.entityType]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(needle)),
  );
}
