import type { CardIdentity } from "@/lib/cards/types";

const KEY = "ccs.identity";

export type RememberedCard = {
  filename?: string;
  identity: Partial<CardIdentity>;
  savedAt: number;
};

export function rememberCard(card: RememberedCard) {
  sessionStorage.setItem(KEY, JSON.stringify(card));
}

export function recallCard(): RememberedCard | null {
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as RememberedCard;
    if (!parsed || typeof parsed !== "object" || !parsed.identity) return null;
    return parsed;
  } catch {
    return null;
  }
}
