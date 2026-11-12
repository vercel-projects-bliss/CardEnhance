import { CardThumbnailGrid } from "@/components/card-thumbnail-grid";
import { PageHeader } from "@/components/page-header";

const stats = [
  { label: "Library", value: "—" },
  { label: "Studio", value: "—" },
  { label: "Audit", value: "—" },
] as const;

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        description="A quiet overview of your library and recent work."
      />

      <section className="rounded-2xl border border-border bg-surface px-5 py-5 sm:px-6">
        <h2 className="text-base font-medium text-ink">At a glance</h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-ink-muted">
          Counts and recent cards will show up here as your library fills in.
        </p>
      </section>

      <section className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Summary">
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

      <section className="mt-10">
        <h2 className="mb-4 text-base font-medium text-ink">Recent cards</h2>
        <CardThumbnailGrid
          label="Recent cards"
          message="No cards yet. Thumbnails will appear in this grid when cards are added."
        />
      </section>
    </>
  );
}
