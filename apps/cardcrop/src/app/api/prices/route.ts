import { isResponse, requireUser } from "@/lib/auth/require";
import type { CardIdentity } from "@/lib/cards/types";
import { lookupCardPrices } from "@/lib/prices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  let body: { identity?: Partial<CardIdentity> };
  try {
    body = (await request.json()) as { identity?: Partial<CardIdentity> };
  } catch {
    return Response.json({ error: "Expected JSON" }, { status: 400 });
  }
  if (!body.identity || typeof body.identity !== "object") {
    return Response.json({ error: "Missing identity" }, { status: 400 });
  }
  try {
    const quote = await lookupCardPrices(body.identity);
    return Response.json(quote);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Price lookup failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
