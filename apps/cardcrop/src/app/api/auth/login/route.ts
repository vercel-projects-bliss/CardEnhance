import { NextResponse } from "next/server";
import {
  issueSessionToken,
  passwordConfigured,
  passwordsMatch,
  sessionCookieOptions,
  SESSION_COOKIE,
} from "@/lib/auth/password";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!passwordConfigured()) {
    return NextResponse.json(
      { error: "APP_PASSWORD is not set. Use Neon Auth or set APP_PASSWORD." },
      { status: 503 },
    );
  }
  let body: { password?: unknown };
  try {
    body = (await request.json()) as { password?: unknown };
  } catch {
    return NextResponse.json({ error: "Expected JSON" }, { status: 400 });
  }
  const password = typeof body.password === "string" ? body.password.trim() : "";
  const expected = process.env.APP_PASSWORD!.trim();
  if (!password || !(await passwordsMatch(password, expected))) {
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }
  const token = issueSessionToken();
  if (!token) {
    return NextResponse.json({ error: "Could not issue a session" }, { status: 500 });
  }
  const response = NextResponse.json({ ok: true, method: "password" });
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return response;
}
