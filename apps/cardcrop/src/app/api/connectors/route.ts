import { isResponse, requireUser } from "@/lib/auth/require";
import { blobConfigured } from "@/lib/blob";
import { databaseUrl, getSql } from "@/lib/db";
import { neonAuthConfigured } from "@/lib/auth/neon";
import { passwordConfigured } from "@/lib/auth/password";
import { envSet, inferenceEndpoint } from "@/lib/server/config";
import { endpointHealth, runpodConfig } from "@/lib/runpod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Status = "connected" | "disconnected" | "error";

async function probe(url: string, init: RequestInit = {}): Promise<Status> {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(4000) });
    return response.ok || response.status === 405 ? "connected" : "error";
  } catch {
    return "error";
  }
}

export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;

  const statuses: Record<string, Status | string> = {
    passwordGate: passwordConfigured() ? "connected" : "disconnected",
    neonAuth: neonAuthConfigured() ? "connected" : "disconnected",
    xai: envSet("XAI_API_KEY") ? "connected" : "disconnected",
    replicate: envSet("REPLICATE_API_TOKEN") ? "connected" : "disconnected",
    runpod: "disconnected",
    blob: blobConfigured() ? "connected" : "disconnected",
    neon: "disconnected",
    restoration: inferenceEndpoint("health") ? "connected" : "disconnected",
    slack: "disconnected",
    huggingface: "disconnected",
    telegram: "disconnected",
    pricecharting: "disconnected",
    ebay: "disconnected",
    cloudflare: "disconnected",
  };

  const runpod = runpodConfig();
  if (runpod) statuses.runpod = (await endpointHealth(runpod)) ? "connected" : "error";

  if (databaseUrl()) {
    try {
      const sql = getSql();
      await sql`select 1 as ok`;
      statuses.neon = "connected";
    } catch {
      statuses.neon = "error";
    }
  }

  if (envSet("SLACK_BOT_TOKEN")) {
    try {
      const response = await fetch("https://slack.com/api/auth.test", {
        headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
        signal: AbortSignal.timeout(4000),
      });
      const body = (await response.json()) as { ok?: boolean };
      statuses.slack = body.ok ? "connected" : "error";
    } catch {
      statuses.slack = "error";
    }
  }

  const hf = process.env.HF_TOKEN?.trim() || process.env.HUGGINGFACE_HUB_TOKEN?.trim();
  const space = process.env.HF_SPACE_URL?.trim();
  if (hf || space) {
    const url = space ? `${space.replace(/\/$/, "")}/v1/models` : "https://huggingface.co/api/models?limit=1";
    const headers: Record<string, string> = {};
    if (hf) headers.Authorization = `Bearer ${hf}`;
    statuses.huggingface = await probe(url, { headers });
  }

  if (envSet("TELEGRAM_BOT_TOKEN")) {
    statuses.telegram = await probe(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`);
  }

  statuses.pricecharting = await probe("https://www.pricecharting.com/search-products?q=topps&type=prices", {
    method: "HEAD",
    redirect: "follow",
  });

  try {
    const response = await fetch("https://www.ebay.com/sch/i.html?_nkw=topps&LH_Sold=1", {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(4000),
    });
    statuses.ebay = response.status === 200 || response.status === 301 || response.status === 302 ? "connected" : "error";
  } catch {
    statuses.ebay = "error";
  }

  const tunnel = process.env.CLOUDFLARE_TUNNEL_URL?.trim().replace(/\/$/, "");
  if (tunnel) {
    const headers: Record<string, string> = {};
    const token = process.env.CLOUDFLARE_TUNNEL_TOKEN?.trim();
    if (token) headers.Authorization = `Bearer ${token}`;
    statuses.cloudflare = await probe(`${tunnel}/health`, { headers });
  }

  return Response.json({ statuses });
}
