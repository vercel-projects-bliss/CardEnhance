import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageShell } from "@/components/studio/app-nav";
import { PageEmpty, PageError, PagePending } from "@/components/studio/page-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listStoredCards, type StoredCard } from "@/lib/connectors/persist";
import { errorMessage } from "@/lib/error-message";

export const Route = createFileRoute("/library/")({
  loader: () => listStoredCards(),
  pendingComponent: () => (
    <PageShell current="/library">
      <PagePending label="Loading library" />
    </PageShell>
  ),
  errorComponent: ({ error }) => (
    <PageShell current="/library">
      <PageError message={errorMessage(error)} />
    </PageShell>
  ),
  component: LibraryPage,
});

function LibraryPage() {
  const cards = Route.useLoaderData();
  const [q, setQ] = useState("");
  const filtered = useMemo(() => filterCards(cards, q), [cards, q]);

  return (
    <PageShell current="/library">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl">Library</h1>
          <p className="text-sm text-muted">{cards.length} persisted cards</p>
        </div>
        <form
          className="flex w-full gap-2 sm:max-w-sm"
          onSubmit={(e) => e.preventDefault()}
          role="search"
        >
          <label className="sr-only" htmlFor="library-q">
            Search cards
          </label>
          <input
            id="library-q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Player, set, file"
            className="h-11 flex-1 rounded-xl border border-border bg-elevated px-3 text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </form>
      </div>

      {cards.length === 0 ? (
        <PageEmpty
          title="No cards stored"
          body="Process scans in Studio. Completed identities are saved here automatically."
        />
      ) : filtered.length === 0 ? (
        <PageEmpty title="No matches" body={`Nothing in the library matches “${q}”.`} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((card) => (
            <li key={card.id}>
              <Link
                to="/library/$cardId"
                params={{ cardId: card.id }}
                className="block rounded-2xl border border-border bg-surface p-4 transition hover:border-accent/50"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium">{card.player || card.filename}</p>
                  <Badge variant="outline">{card.status}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted">
                  {[card.year, card.manufacturer, card.setName, card.number].filter(Boolean).join(" · ") ||
                    "Identity incomplete"}
                </p>
                <p className="mt-2 font-mono text-xs text-muted">{card.filename}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {cards.length === 0 ? (
        <div className="flex justify-center">
          <Button asChild>
            <Link to="/">Open Studio</Link>
          </Button>
        </div>
      ) : null}
    </PageShell>
  );
}

function filterCards(cards: StoredCard[], q: string) {
  const n = q.trim().toLowerCase();
  if (!n) return cards;
  return cards.filter((c) =>
    [c.player, c.setName, c.manufacturer, c.filename, c.number, c.parallel, c.year?.toString()]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(n)),
  );
}
