import { NextResponse } from "next/server";
import { getNeonAuth, neonAuthConfigured } from "@/lib/auth/neon";
import { SESSION_COOKIE } from "@/lib/auth/password";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  if (neonAuthConfigured()) {
    try {
      const auth = getNeonAuth();
      await auth?.signOut();
    } catch {
      // The password cookie is still cleared below.
    }
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}
