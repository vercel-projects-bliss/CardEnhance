import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "ccs_session";
const WEEK = 60 * 60 * 24 * 7;

export function passwordConfigured(): boolean {
  return Boolean(process.env.APP_PASSWORD?.trim());
}

function sessionSecret(): string | null {
  const secret = process.env.SESSION_SECRET?.trim() || process.env.APP_PASSWORD?.trim();
  return secret || null;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export async function passwordsMatch(supplied: string, expected: string): Promise<boolean> {
  const { createHash } = await import("node:crypto");
  const a = createHash("sha256").update(supplied.trim()).digest();
  const b = createHash("sha256").update(expected.trim()).digest();
  return timingSafeEqual(a, b);
}

export function issueSessionToken(now = Date.now()): string | null {
  const secret = sessionSecret();
  if (!secret) return null;
  const exp = Math.floor(now / 1000) + WEEK;
  const payload = `v1.${exp}`;
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySessionToken(token: string | undefined, now = Date.now()): boolean {
  if (!token) return false;
  const secret = sessionSecret();
  if (!secret) return false;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  if (!safeEqual(mac, sign(payload, secret))) return false;
  const [version, expRaw] = payload.split(".");
  if (version !== "v1") return false;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp * 1000 <= now) return false;
  return true;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: WEEK,
  };
}
