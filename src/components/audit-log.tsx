"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { formatWhen } from "@/lib/card-label";
import type { AuditRow } from "@/lib/types";

const controlClass =
  "h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent sm:max-w-sm";

export function AuditLog({ rows }: { rows: AuditRow[] }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => filterRows(rows, query), [rows, query]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <p className="shrink-0 text-sm text-ink-muted">
          <span className="font-mono tabular-nums text-ink">{rows.length}</span>
          {" "}recorded actions
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

      {rows.length === 0 ? (
        <EmptyState
          compact
          title="No audit entries"
          description="Processing a card in Studio writes a card.processed entry here."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          compact
          title="No matches"
          description={`No audit rows match “${query}”.`}
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="bg-surface-raised text-ink-subtle">
              <tr>
                <th className="px-4 py-3 font-medium">When</th>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium">Subject</th>
                <th className="px-4 py-3 font-medium">File</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="px-4 py-3 font-mono text-xs text-ink-muted">
                    {formatWhen(row.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-ink">{row.action}</td>
                  <td className="px-4 py-3">
                    {row.entityType === "card" && row.entityId ? (
                      <Link
                        href={`/library/${row.entityId}`}
                        className="text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        {row.player || row.entityId.slice(0, 8)}
                      </Link>
                    ) : (
                      <span className="text-ink">
                        {row.player || row.entityId || "—"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink-muted">
                    {row.filename || "—"}
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
