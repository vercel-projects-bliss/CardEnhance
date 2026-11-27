import { isResponse, requireUser } from "@/lib/auth/require";
import { readPaddleVl } from "@/lib/ocr/paddle";
import { readTradingCard } from "@/lib/ocr/vision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  let body: { jpeg?: unknown; engine?: unknown };
  try {
    body = (await request.json()) as { jpeg?: unknown; engine?: unknown };
  } catch {
    return Response.json({ error: "Expected JSON" }, { status: 400 });
  }
  if (typeof body.jpeg !== "string" || body.jpeg.length < 32) {
    return Response.json({ error: "Missing image" }, { status: 400 });
  }
  const engine = body.engine === "paddle" ? "paddle" : "vision";
  const result = engine === "paddle" ? await readPaddleVl(body.jpeg) : await readTradingCard(body.jpeg);
  const status = result.ok ? 200 : result.error.includes("not set") || result.error.includes("ENABLE_VISION") ? 503 : 422;
  return Response.json(result, { status });
}
