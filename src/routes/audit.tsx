import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageShell } from "@/components/studio/app-nav";
import { PageEmpty, PageError, PagePending } from "@/components/studio/page-states";
import { listAuditLogs, type AuditRow } from "@/lib/connectors/persist";
import { errorMessage } from "@/lib/error-message";

export const Route = createFileRoute("/audit")({
  loader: () => listAuditLogs(),
  pendingComponent: () => (
    <PageShell current="/audit">
      <PagePending label="Loading audit log" />
    </PageShell>
  ),
  errorComponent: ({ error }) => (
    <PageShell current="/audit">
      <PageError message={errorMessage(error)} />
    </PageShell>
  ),
  component: AuditPage,
});

function AuditPage() {
  const rows = Route.useLoaderData();
  const [q, setQ] = useState("");
  const filtered = useMemo(() => filterRows(rows, q), [rows, q]);

  return (
    <PageShell current="/audit">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl">Audit</h1>
          <p className="text-sm text-muted">{rows.length} recorded actions</p>
        </div>
        <form className="flex w-full gap-2 sm:max-w-sm" onSubmit={(e) => e.preventDefault()} role="search">
          <label className="sr-only" htmlFor="audit-q">
            Filter audit
          </label>
          <input
            id="audit-q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Action, player, file"
            className="h-11 flex-1 rounded-xl border border-border bg-elevated px-3 text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </form>
      </div>

      {rows.length === 0 ? (
        <PageEmpty title="No audit entries" body="Processing a card in Studio writes card.processed here." />
      ) : filtered.length === 0 ? (
        <PageEmpty title="No matches" body={`No audit rows match “${q}”.`} />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-elevated text-muted">
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
                  <td className="px-4 py-3 font-mono text-xs text-muted">{formatWhen(row.createdAt)}</td>
                  <td className="px-4 py-3">{row.action}</td>
                  <td className="px-4 py-3">
                    {row.entityType === "card" && row.entityId ? (
                      <Link
                        to="/library/$cardId"
                        params={{ cardId: row.entityId }}
                        className="text-accent hover:underline"
                      >
                        {row.player || row.entityId.slice(0, 8)}
                      </Link>
                    ) : (
                      row.player || row.entityId || "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted">{row.filename || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  );
}

function filterRows(rows: AuditRow[], q: string) {
  const n = q.trim().toLowerCase();
  if (!n) return rows;
  return rows.filter((r) =>
    [r.action, r.player, r.filename, r.entityId, r.entityType]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(n)),
  );
}

function formatWhen(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}
