import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";

type CardDetailPageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({
  params,
}: CardDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  return { title: `Card ${id}` };
}

export default function CardDetailPage({ params }: CardDetailPageProps) {
  return (
    <Suspense fallback={<CardDetailBody id="…" />}>
      <CardDetail params={params} />
    </Suspense>
  );
}

async function CardDetail({ params }: CardDetailPageProps) {
  const { id } = await params;
  return <CardDetailBody id={id} />;
}

function CardDetailBody({ id }: { id: string }) {
  return (
    <>
      <PageHeader
        title="Card"
        description="Details for this card will appear here."
      />

      <section className="flex flex-col items-center rounded-2xl border border-border bg-surface px-5 py-10 sm:px-6">
        <p className="font-mono text-[11px] font-medium uppercase tracking-wide text-ink-subtle">
          Card id
        </p>
        <p className="mt-2 max-w-full break-all text-center font-mono text-sm text-ink">
          {id}
        </p>

        <div className="mt-8 w-full max-w-[220px]">
          <div
            className="relative aspect-[2.5/3.5] overflow-hidden rounded-xl border border-border bg-surface-raised"
            aria-hidden="true"
          >
            <span className="pointer-events-none absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-white/[0.04] to-transparent" />
          </div>
        </div>
        <p className="mt-4 text-center text-sm leading-relaxed text-ink-muted">
          No thumbnail yet.
        </p>
      </section>
    </>
  );
}
