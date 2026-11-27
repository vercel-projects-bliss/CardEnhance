import { readUser } from "@/lib/auth/require";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await readUser();
  return Response.json({ user });
}
