import { useEffect, useState, type FormEvent, type HTMLAttributes } from "react";
import { createFileRoute, Link, notFound, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { PageShell } from "@/components/studio/app-nav";
import { PageError, PagePending } from "@/components/studio/page-states";
import { errorMessage } from "@/lib/error-message";
import { PriceQuoteView } from "@/components/studio/price-quote";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Toaster } from "@/components/ui/sonner";
import { getStoredCard, updateStoredCard, type StoredCard } from "@/lib/connectors/persist";
import { lookupCardPrices, type PriceQuote } from "@/lib/prices";

export const Route = createFileRoute("/library/$cardId")({
  loader: async ({ params }) => {
    const card = await getStoredCard({ data: { id: params.cardId } });
    if (!card) throw notFound();
    return card;
  },
  pendingComponent: () => (
    <PageShell current="/library">
      <PagePending label="Loading card" />
    </PageShell>
  ),
  errorComponent: ({ error }) => (
    <PageShell current="/library">
      <PageError message={errorMessage(error)} />
    </PageShell>
  ),
  notFoundComponent: () => (
    <PageShell current="/library">
      <PageError message="That card is not in the library." />
    </PageShell>
  ),
  component: CardDetailPage,
});

function CardDetailPage() {
  const card = Route.useLoaderData();
  return (
    <PageShell current="/library">
      <Toaster position="top-right" />
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs text-muted">
            <Link to="/library" className="hover:text-fg">
              Library
            </Link>
            <span aria-hidden> / </span>
            <span>{card.player || card.filename}</span>
          </p>
          <h1 className="font-display text-2xl">{card.player || "Unnamed card"}</h1>
        </div>
        <Button asChild variant="outline">
          <Link to="/library">Back</Link>
        </Button>
      </div>
      <IdentityForm card={card} />
      <LibraryPrices card={card} />
    </PageShell>
  );
}

function IdentityForm({ card }: { card: StoredCard }) {
  const router = useRouter();
  const [player, setPlayer] = useState(card.player ?? "");
  const [setName, setSetName] = useState(card.setName ?? "");
  const [manufacturer, setManufacturer] = useState(card.manufacturer ?? "");
  const [year, setYear] = useState(card.year?.toString() ?? "");
  const [number, setNumber] = useState(card.number ?? "");
  const [parallel, setParallel] = useState(card.parallel ?? "");
  const [side, setSide] = useState(card.side ?? "unknown");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    let yearVal: number | null = null;
    if (year.trim()) {
      yearVal = Number(year);
      if (!Number.isInteger(yearVal) || yearVal < 1980 || yearVal > 2026) {
        setError("Year must be an integer between 1980 and 2026.");
        return;
      }
    }
    setPending(true);
    try {
      const result = await updateStoredCard({
        data: {
          id: card.id,
          player: player.trim() || null,
          setName: setName.trim() || null,
          manufacturer: manufacturer.trim() || null,
          year: yearVal,
          number: number.trim() || null,
          parallel: parallel.trim() || null,
          side: side.trim() || null,
        },
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("Identity saved");
      await router.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="grid gap-4 rounded-2xl border border-border bg-surface p-4 sm:p-6">
      <p className="text-sm text-muted">
        File {card.filename} · detector {card.detector || "—"} · OCR {card.engine || "—"}
      </p>
      <Field id="player" label="Player" value={player} onChange={setPlayer} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="manufacturer" label="Manufacturer" value={manufacturer} onChange={setManufacturer} />
        <Field id="set" label="Set" value={setName} onChange={setSetName} />
        <Field id="year" label="Year" value={year} onChange={setYear} inputMode="numeric" />
        <Field id="number" label="Number" value={number} onChange={setNumber} />
        <Field id="parallel" label="Parallel" value={parallel} onChange={setParallel} />
        <div className="space-y-2">
          <Label htmlFor="side">Side</Label>
          <select
            id="side"
            value={side}
            onChange={(e) => setSide(e.target.value)}
            className="h-11 w-full rounded-xl border border-border bg-elevated px-3 text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="front">front</option>
            <option value="back">back</option>
            <option value="unknown">unknown</option>
          </select>
        </div>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving" : "Save identity"}
        </Button>
      </div>
    </form>
  );
}

function LibraryPrices({ card }: { card: StoredCard }) {
  const [quote, setQuote] = useState<PriceQuote | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "empty" | "error">("idle");
  const [error, setError] = useState<string | undefined>();

  const load = async () => {
    setStatus("loading");
    setError(undefined);
    try {
      const next = await lookupCardPrices({
        data: {
          identity: {
            player: card.player,
            year: card.year,
            manufacturer: card.manufacturer,
            set: card.setName,
            number: card.number,
            parallel: card.parallel,
            side: card.side === "front" || card.side === "back" ? card.side : "unknown",
            confidence: 1,
            rawText: "",
          },
        },
      });
      setQuote(next);
      setStatus(next.listings.length ? "ok" : "empty");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Price lookup failed");
    }
  };

  useEffect(() => {
    void load();
    // identity fields are the lookup key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id, card.player, card.year, card.manufacturer, card.setName, card.number, card.parallel]);

  return <PriceQuoteView quote={quote} status={status} error={error} onRefresh={() => void load()} />;
}

function Field({
  id,
  label,
  value,
  onChange,
  inputMode,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <input
        id={id}
        value={value}
        inputMode={inputMode}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full rounded-xl border border-border bg-elevated px-3 text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </div>
  );
}
