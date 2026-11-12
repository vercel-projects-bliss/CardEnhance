import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ActionLink } from "@/components/action-link";
import { CardThumbnail } from "@/components/card-thumbnail";
import { EmptyState } from "@/components/empty-state";
import { IdentityForm } from "@/components/identity-form";
import { PageHeader } from "@/components/page-header";
import { cardSubtitle, cardTitle } from "@/lib/card-label";
import { getStoredCard } from "@/lib/data";

type CardDetailPageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({
  params,
}: CardDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  const card = await getStoredCard(id);
  return { title: card ? cardTitle(card) : "Card" };
}

export default function CardDetailPage({ params }: CardDetailPageProps) {
  return (
    <Suspense fallback={<p className="text-sm text-ink-muted">Loading card…</p>}>
      <CardDetail params={params} />
    </Suspense>
  );
}

async function CardDetail({ params }: CardDetailPageProps) {
  const { id } = await params;
  const card = await getStoredCard(id);

  if (!card) {
    return (
      <>
        <PageHeader
          index="01"
          title="Card"
          description="That card is not in the library."
        />
        <EmptyState
          compact
          title="Nothing here"
          description="The library has no card with this id yet."
          action={<ActionLink href="/library">Back to Library</ActionLink>}
        />
      </>
    );
  }

  return (
    <>
      <p className="mb-3 text-xs text-ink-subtle">
        <Link
          href="/library"
          className="hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Library
        </Link>
        <span aria-hidden> / </span>
        <span>{cardTitle(card)}</span>
      </p>
      <PageHeader title={cardTitle(card)} description={cardSubtitle(card)} />

      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-start">
        <CardThumbnail card={card} />
        <IdentityForm card={card} />
      </div>
    </>
  );
}
