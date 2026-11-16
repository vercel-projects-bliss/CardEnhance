import { createServerFn } from "@tanstack/react-start";
import { csrfMiddleware } from "@/lib/auth/csrf-middleware";
import { getDbSource, getSql } from "@/lib/db";

export type ConnectorStatus = "connected" | "pglite" | "disconnected" | "error";

export const checkConnectors = createServerFn({ method: "GET" })
  .middleware([csrfMiddleware])
  .handler(async () => {
  const { applySecrets } = await import("./secrets-io");
  await applySecrets();
  const statuses: Record<string, ConnectorStatus> = {
    xai: process.env.XAI_API_KEY?.trim() ? "connected" : "disconnected",
    neon: "disconnected",
    slack: "disconnected",
    huggingface: "disconnected",
    telegram: "disconnected",
    pricecharting: "disconnected",
    ebay: "disconnected",
    cloudflare: "disconnected",
    r2: "disconnected",
  };

  try {
    const sql = await getSql();
    await sql`select 1 as ok`;
    statuses.neon = getDbSource() === "neon" ? "connected" : "pglite";
  } catch {
    statuses.neon = "error";
  }

  const slack = process.env.SLACK_BOT_TOKEN?.trim();
  if (slack) {
    try {
      const r = await fetch("https://slack.com/api/auth.test", {
        headers: { Authorization: `Bearer ${slack}` },
      });
      const d = (await r.json()) as { ok?: boolean };
      statuses.slack = d.ok ? "connected" : "error";
    } catch {
      statuses.slack = "error";
    }
  }

  const hf = process.env.HF_TOKEN?.trim() || process.env.HUGGINGFACE_HUB_TOKEN?.trim();
  const space = process.env.HF_SPACE_URL?.trim();
  if (hf || space) {
    try {
      const url = space ? `${space.replace(/\/$/, "")}/v1/models` : "https://huggingface.co/api/models?limit=1";
      const headers: Record<string, string> = {};
      if (hf) headers.Authorization = `Bearer ${hf}`;
      const r = await fetch(url, { headers });
      statuses.huggingface = r.ok ? "connected" : "error";
    } catch {
      statuses.huggingface = "error";
    }
  }

  const tg = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (tg) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${tg}/getMe`);
      const d = (await r.json()) as { ok?: boolean };
      statuses.telegram = d.ok ? "connected" : "error";
    } catch {
      statuses.telegram = "error";
    }
  }

  try {
    const r = await fetch("https://www.pricecharting.com/search-products?q=topps&type=prices", {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(4000),
    });
    statuses.pricecharting = r.ok || r.status === 405 ? "connected" : "error";
  } catch {
    statuses.pricecharting = "error";
  }

  try {
    const r = await fetch("https://www.ebay.com/sch/i.html?_nkw=topps&LH_Sold=1", {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(4000),
    });
    statuses.ebay = r.status === 200 ? "connected" : "error";
  } catch {
    statuses.ebay = "error";
  }

  const tunnel = process.env.CLOUDFLARE_TUNNEL_URL?.trim().replace(/\/$/, "");
  if (tunnel) {
    try {
      const headers: Record<string, string> = {};
      const token = process.env.CLOUDFLARE_TUNNEL_TOKEN?.trim();
      if (token) headers.Authorization = `Bearer ${token}`;
      const binding = (globalThis as typeof globalThis & {
        __PRICE_TUNNEL__?: { fetch: (input: string, init?: RequestInit) => Promise<Response> };
      }).__PRICE_TUNNEL__;
      const r = binding
        ? await binding.fetch(`${tunnel}/health`, { headers })
        : await fetch(`${tunnel}/health`, { headers, signal: AbortSignal.timeout(4000) });
      statuses.cloudflare = r.ok ? "connected" : "error";
    } catch {
      statuses.cloudflare = "error";
    }
  }

  if (process.env.R2_ACCOUNT_ID?.trim() && process.env.R2_ACCESS_KEY_ID?.trim() && process.env.R2_SECRET_ACCESS_KEY?.trim() && process.env.R2_BUCKET?.trim()) {
    try {
      const { headBucket } = await import("./r2-io");
      const head = await headBucket();
      statuses.r2 = head.ok ? "connected" : "error";
    } catch {
      statuses.r2 = "error";
    }
  }

  return statuses;
});
