import { neonAuthConfigured } from "@/lib/auth/neon";
import { passwordConfigured } from "@/lib/auth/password";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    password: passwordConfigured(),
    neon: neonAuthConfigured(),
  });
}
