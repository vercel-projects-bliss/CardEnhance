import { DEFAULT_MAX_IMAGE_BYTES } from "@/lib/cards/types";

export function maxImageBytes(): number {
  const parsed = Number(process.env.MAX_IMAGE_BYTES);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 4_000_000
    ? parsed
    : DEFAULT_MAX_IMAGE_BYTES;
}

export function inferenceEndpoint(path: "health" | "restore"): URL | null {
  const base = process.env.RESTORATION_API_URL?.trim();
  if (!base) return null;
  const normalized = base.endsWith("/") ? base : `${base}/`;
  const endpoint = new URL(path, normalized);
  if (endpoint.protocol !== "https:" && endpoint.protocol !== "http:") {
    throw new Error("RESTORATION_API_URL must use HTTP or HTTPS");
  }
  return endpoint;
}

export function inferenceHeaders(): Record<string, string> {
  const key = process.env.RESTORATION_API_KEY?.trim();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

export function envSet(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}
