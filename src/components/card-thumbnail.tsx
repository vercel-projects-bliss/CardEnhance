import Link from "next/link";
import { cardSubtitle, cardTitle } from "@/lib/card-label";
import type { StoredCard } from "@/lib/types";

type CardThumbnailProps = {
  card: StoredCard;
  href?: string;
  imageUrl?: string | null;
};

export function CardThumbnail({ card, href, imageUrl }: CardThumbnailProps) {
  const title = cardTitle(card);
  const subtitle = cardSubtitle(card);

  const body = (
    <div className="relative aspect-[2.5/3.5] overflow-hidden border border-border bg-surface-raised">
      <span className="pointer-events-none absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-white/[0.04] to-transparent" />
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : null}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-background/90 to-transparent px-2.5 pb-2.5 pt-8">
        <p className="truncate text-xs font-medium text-ink">{title}</p>
        <p className="mt-0.5 truncate font-mono text-[10px] text-ink-muted">
          {subtitle}
        </p>
      </div>
    </div>
  );

  if (!href) {
    return body;
  }

  return (
    <Link
      href={href}
      className="block outline-none transition-opacity hover:opacity-95 focus-visible:ring-2 focus-visible:ring-accent"
    >
      {body}
    </Link>
  );
}

type CardGridProps = {
  cards: StoredCard[];
  label: string;
};

export function CardGrid({ cards, label }: CardGridProps) {
  return (
    <ul
      aria-label={label}
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5"
    >
      {cards.map((card) => (
        <li key={card.id}>
          <CardThumbnail card={card} href={`/library/${card.id}`} />
        </li>
      ))}
    </ul>
  );
}
