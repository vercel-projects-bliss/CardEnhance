import type { CardIdentity } from "@/lib/cards/types";

export type PriceListing = {
  source: "pricecharting" | "ebay";
  title: string;
  setName: string;
  url: string;
  ungraded: number | null;
  graded: number | null;
  mint: number | null;
  score: number;
};

export type PriceQuote = {
  query: string;
  fetchedAt: number;
  listings: PriceListing[];
  medianUngraded: number | null;
  low: number | null;
  high: number | null;
  ebaySoldUrl: string;
  ebayActiveUrl: string;
  priceChartingUrl: string;
  sciSearchUrl: string;
  notes: string[];
};

export function identityQuery(identity: Partial<CardIdentity> | undefined): string {
  if (!identity) return "";
  const parts = [
    identity.year ? String(identity.year) : "",
    identity.manufacturer ?? "",
    identity.player ?? "",
    identity.set ?? "",
    identity.number ?? "",
    identity.parallel ?? "",
  ]
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export function formatUsd(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function money(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 && n < 1_000_000 ? n : null;
}

function decode(html: string) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function playerTokens(identity: Partial<CardIdentity>): string[] {
  return (identity.player ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !["the", "and"].includes(t));
}

function scoreListing(listing: PriceListing, identity: Partial<CardIdentity>): number {
  const hay = `${listing.title} ${listing.setName}`.toLowerCase();
  const tokens = playerTokens(identity);
  const hits = tokens.filter((t) => hay.includes(t)).length;
  if (tokens.length && hits === 0) return -99;
  let score = hits * 4;
  if (identity.year && hay.includes(String(identity.year))) score += 2;
  if (identity.set && hay.includes(identity.set.toLowerCase())) score += 3;
  if (identity.manufacturer && hay.includes(identity.manufacturer.toLowerCase())) score += 1;
  if (identity.number) {
    const num = identity.number.toLowerCase().replace(/^#/, "");
    if (num && hay.includes(num)) score += 3;
  }
  if (identity.parallel && hay.includes(identity.parallel.toLowerCase())) score += 2;
  return score;
}

function parsePriceCharting(html: string, identity: Partial<CardIdentity>): PriceListing[] {
  const rows = html.match(/<tr[^>]*id="product-\d+"[\s\S]*?<\/tr>/gi) ?? [];
  const out: PriceListing[] = [];
  for (const row of rows) {
    const href = row.match(/href="(https:\/\/www\.pricecharting\.com\/game\/[^"]+)"/i)?.[1];
    const title = row.match(/<td class="title">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)?.[1];
    const setName = row.match(/console-in-title[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)?.[1];
    const used = row.match(/used_price[\s\S]*?js-price">\s*([^<]*)/i)?.[1];
    const cib = row.match(/cib_price[\s\S]*?js-price">\s*([^<]*)/i)?.[1];
    const neu = row.match(/new_price[\s\S]*?js-price">\s*([^<]*)/i)?.[1];
    if (!href || !title) continue;
    const listing: PriceListing = {
      source: "pricecharting",
      title: decode(title),
      setName: decode(setName ?? ""),
      url: href,
      ungraded: money(used),
      graded: money(cib),
      mint: money(neu),
      score: 0,
    };
    if (!listing.ungraded && !listing.graded && !listing.mint) continue;
    listing.score = scoreListing(listing, identity);
    out.push(listing);
  }
  return out;
}

async function fetchText(url: string): Promise<{ ok: boolean; status: number; body: string; via: "direct" | "cloudflare" }> {
  const tunnel = process.env.CLOUDFLARE_TUNNEL_URL?.trim().replace(/\/$/, "");
  const token = process.env.CLOUDFLARE_TUNNEL_TOKEN?.trim();
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (compatible; CardEnhance/1.0)",
    Accept: "text/html,application/xhtml+xml",
  };
  const target = tunnel ? `${tunnel}/fetch?url=${encodeURIComponent(url)}` : url;
  if (tunnel && token) headers.Authorization = `Bearer ${token}`;
  const binding = (globalThis as typeof globalThis & {
    __PRICE_TUNNEL__?: { fetch: (input: string, init?: RequestInit) => Promise<Response> };
  }).__PRICE_TUNNEL__;
  const res = binding
    ? await binding.fetch(target, { headers, redirect: "follow" })
    : await fetch(target, { headers, redirect: "follow" });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body, via: tunnel ? "cloudflare" : "direct" };
}

function parseEbaySold(html: string, identity: Partial<CardIdentity>): PriceListing[] {
  if (/sign in|captcha|pardon our interruption/i.test(html) && !/s-item__title/i.test(html)) return [];
  const chunks = html.split(/s-item__/i);
  const out: PriceListing[] = [];
  for (const chunk of chunks) {
    const title = decode((chunk.match(/title[^>]*>([^<]{8,180})/i) ?? [])[1] ?? "");
    const price = money((chunk.match(/\$[\d,]+(?:\.\d{2})?/) ?? [])[0]);
    const href = (chunk.match(/href="(https:\/\/www\.ebay\.com\/itm\/[^"]+)"/i) ?? [])[1];
    if (!title || !price || !href) continue;
    const listing: PriceListing = {
      source: "ebay",
      title,
      setName: "",
      url: href,
      ungraded: price,
      graded: null,
      mint: null,
      score: 0,
    };
    listing.score = scoreListing(listing, identity);
    out.push(listing);
  }
  return out;
}

export async function lookupCardPrices(identity: Partial<CardIdentity>): Promise<PriceQuote> {
    const query = identityQuery(identity);
    const notes: string[] = [];
    if (!query) {
      return {
        query: "",
        fetchedAt: Date.now(),
        listings: [],
        medianUngraded: null,
        low: null,
        high: null,
        ebaySoldUrl: "https://www.ebay.com/sch/i.html?LH_Sold=1&LH_Complete=1",
        ebayActiveUrl: "https://www.ebay.com/sch/i.html",
        priceChartingUrl: "https://www.pricecharting.com",
        sciSearchUrl: "https://www.sportscardinvestor.com",
        notes: ["OCR did not produce a searchable identity."],
      };
    }

    const q = encodeURIComponent(query);
    const ebaySoldUrl = `https://www.ebay.com/sch/i.html?_nkw=${q}&LH_Sold=1&LH_Complete=1&_sop=13`;
    const ebayActiveUrl = `https://www.ebay.com/sch/i.html?_nkw=${q}&_sop=12`;
    const priceChartingUrl = `https://www.pricecharting.com/search-products?q=${q}&type=prices`;
    const sciSearchUrl = `https://www.sportscardinvestor.com/?s=${q}`;

    notes.push("Sports Card Investor has no public API. Their sold comps are subscription-only.");

    let listings: PriceListing[] = [];
    const queries = [query];
    const player = identity.player?.trim();
    if (player && player !== query) queries.push(player);

    for (const term of queries) {
      try {
        const page = await fetchText(
          `https://www.pricecharting.com/search-products?q=${encodeURIComponent(term)}&type=prices`,
        );
        if (page.via === "cloudflare") notes.push("PriceCharting fetched through Cloudflare Worker.");
        if (!page.ok) {
          notes.push(`PriceCharting HTTP ${page.status} for “${term}”.`);
          continue;
        }
        const parsed = parsePriceCharting(page.body, identity);
        listings.push(...parsed);
        if (parsed.some((l) => l.score >= 4)) break;
      } catch (err) {
        notes.push(err instanceof Error ? err.message : "PriceCharting unreachable.");
      }
    }

    try {
      const sold = await fetchText(ebaySoldUrl);
      if (sold.via === "cloudflare") notes.push("eBay sold page fetched through Cloudflare Worker.");
      const parsed = parseEbaySold(sold.body, identity);
      if (parsed.length) listings.push(...parsed);
      else notes.push("eBay sold HTML is still blocked or login-walled. Sold-search links stay live.");
    } catch {
      notes.push("eBay sold HTML is blocked from this host. Sold-search links stay live.");
    }

    const seen = new Set<string>();
    listings = listings.filter((l) => {
      if (seen.has(l.url)) return false;
      seen.add(l.url);
      return true;
    });
    listings.sort((a, b) => b.score - a.score);
    const shown = listings.filter((l) => l.score >= 4).slice(0, 8);
    if (listings.length) notes.push("PriceCharting comps are aggregated eBay sold prices.");
    if (!shown.length && listings.length) {
      notes.push("No comps matched the OCR player. Open eBay sold search.");
    }
    const ungraded = shown.map((l) => l.ungraded).filter((n): n is number => n != null);

    return {
      query,
      fetchedAt: Date.now(),
      listings: shown,
      medianUngraded: median(ungraded),
      low: ungraded.length ? Math.min(...ungraded) : null,
      high: ungraded.length ? Math.max(...ungraded) : null,
      ebaySoldUrl,
      ebayActiveUrl,
      priceChartingUrl,
      sciSearchUrl,
      notes,
    };
}
