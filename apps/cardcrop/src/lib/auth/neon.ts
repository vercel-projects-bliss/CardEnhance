import { createNeonAuth } from "@neondatabase/auth/next/server";

export function neonAuthConfigured(): boolean {
  return Boolean(
    process.env.NEON_AUTH_BASE_URL?.trim() && process.env.NEON_AUTH_COOKIE_SECRET?.trim(),
  );
}

type NeonAuth = ReturnType<typeof createNeonAuth>;

let cached: NeonAuth | null = null;

export function getNeonAuth(): NeonAuth | null {
  if (!neonAuthConfigured()) return null;
  if (cached) return cached;
  const secret = process.env.NEON_AUTH_COOKIE_SECRET!.trim();
  if (secret.length < 32) {
    throw new Error("NEON_AUTH_COOKIE_SECRET must be at least 32 characters");
  }
  cached = createNeonAuth({
    baseUrl: process.env.NEON_AUTH_BASE_URL!.trim(),
    cookies: { secret },
  });
  return cached;
}
