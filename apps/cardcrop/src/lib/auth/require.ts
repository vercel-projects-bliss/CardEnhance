import { cookies } from "next/headers";
import { getNeonAuth, neonAuthConfigured } from "@/lib/auth/neon";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/password";

export type SessionUser = {
  id: string;
  method: "password" | "neon";
  email?: string;
  name?: string;
};

export async function readUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  if (verifySessionToken(jar.get(SESSION_COOKIE)?.value)) {
    return { id: "password-gate", method: "password" };
  }
  if (!neonAuthConfigured()) return null;
  try {
    const auth = getNeonAuth();
    if (!auth) return null;
    const { data } = await auth.getSession();
    const user = data?.user;
    if (!user?.id) return null;
    return {
      id: user.id,
      method: "neon",
      email: user.email,
      name: user.name,
    };
  } catch {
    return null;
  }
}

export async function requireUser(): Promise<SessionUser | Response> {
  const user = await readUser();
  if (!user) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  return user;
}

export function isResponse(value: SessionUser | Response): value is Response {
  return value instanceof Response;
}
