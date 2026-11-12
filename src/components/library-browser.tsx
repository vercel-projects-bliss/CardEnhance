"use client";

import { useMemo, useState } from "react";
import { ActionLink } from "@/components/action-link";
import { CardGrid } from "@/components/card-thumbnail";
import { EmptyState } from "@/components/empty-state";
import type { StoredCard } from "@/lib/types";

const controlClass =
  "h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent sm:max-w-sm";

export function LibraryBrowser({ cards }: { cards: StoredCard[] }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => filterCards(cards, query), [cards, query]);

  if (cards.length === 0) {
    return (
      <EmptyState
        compact
        title="No cards stored"
        description="Process scans in Studio. Completed cards will be saved here automatically."
        action={<ActionLink href="/studio">Open Studio</ActionLink>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex w-full"
        onSubmit={(event) => event.preventDefault()}
        role="search"
      >
        <label className="sr-only" htmlFor="library-q">
          Search cards
        </label>
        <input
          id="library-q"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Player, set, file"
          className={controlClass}
        />
      </form>

      {filtered.length === 0 ? (
        <EmptyState
          compact
          title="No matches"
          description={`Nothing in the library matches “${query}”.`}
        />
      ) : (
        <CardGrid cards={filtered} label="Library" />
      )}
    </div>
  );
}

function filterCards(cards: StoredCard[], query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return cards;

  return cards.filter((card) =>
    [
      card.player,
      card.setName,
      card.manufacturer,
      card.filename,
      card.number,
      card.parallel,
      card.year?.toString(),
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(needle)),
  );
}
