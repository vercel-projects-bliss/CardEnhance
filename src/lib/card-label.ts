import type { StoredCard } from "@/lib/types";

export function cardTitle(card: StoredCard): string {
  return card.player || card.filename;
}

export function cardSubtitle(card: StoredCard): string {
  return (
    [card.year, card.manufacturer, card.setName, card.number]
      .filter(Boolean)
      .join(" · ") || "Identity incomplete"
  );
}

export function formatWhen(value: string | null): string {
  if (!value) return "—";

  const raw = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const date = new Date(raw);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString("en-US", { timeZone: "America/New_York" });
}
