import { Suspense } from "react";
import { ActionLink } from "@/components/action-link";
import { CardGrid } from "@/components/card-thumbnail";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { getLibrarySummary } from "@/lib/data";

const pipeline = ["Detect", "Rectify", "OCR", "Enhance", "Export"] as const;

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        description="A quiet overview of your library and recent work."
      />
      <Suspense fallback={<DashboardFallback />}>
        <DashboardBody />
      </Suspense>
    </>
  );
}

async function DashboardBody() {
  const { cards, processed, auditCount } = await getLibrarySummary();

  if (cards.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <EmptyState
          compact
          title="No cards yet"
          description="Open Studio to upload and process your first card scans."
          action={<ActionLink href="/studio">Open Studio</ActionLink>}
        />
        <PipelineStrip />
      </div>
    );
  }

  const recent = cards.slice(0, 10);
  const stats = [
    { label: "Library", value: String(cards.length) },
    { label: "Processed", value: String(processed) },
    { label: "Audit", value: String(auditCount) },
  ];

  return (
    <>
      <section
        className="grid grid-cols-1 gap-3 sm:grid-cols-3"
        aria-label="Summary"
      >
        {stats.map((stat) => (
          <article
            key={stat.label}
            className="rounded-2xl border border-border bg-surface px-5 py-5"
          >
            <p className="font-mono text-[11px] font-medium uppercase tracking-wide text-ink-subtle">
              {stat.label}
            </p>
            <p className="mt-3 text-2xl font-semibold tracking-tight text-ink">
              {stat.value}
            </p>
          </article>
        ))}
      </section>

      <PipelineStrip />

      <section className="mt-10">
        <h2 className="mb-4 text-base font-medium text-ink">Recent cards</h2>
        <CardGrid cards={recent} label="Recent cards" />
      </section>
    </>
  );
}

function PipelineStrip() {
  return (
    <section className="rounded-2xl border border-border bg-surface px-5 py-4">
      <h2 className="text-sm font-medium text-ink">Pipeline</h2>
      <ol className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-muted">
        {pipeline.map((stage, index) => (
          <li key={stage} className="flex items-center gap-2 whitespace-nowrap">
            <span>{stage}</span>
            {index < pipeline.length - 1 ? (
              <span aria-hidden className="text-ink-subtle">
                →
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

function DashboardFallback() {
  return (
    <div className="rounded-2xl border border-border bg-surface px-5 py-8 text-sm text-ink-muted">
      Loading library…
    </div>
  );
}
