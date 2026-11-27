import { cardCanvasSize } from "@/lib/geometry/card-canvas";
import { isResponse, requireUser } from "@/lib/auth/require";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  let body: { width?: unknown; height?: unknown };
  try {
    body = (await request.json()) as { width?: unknown; height?: unknown };
  } catch {
    return Response.json({ error: "Expected JSON" }, { status: 400 });
  }
  const width = body.width;
  const height = body.height;
  if (typeof width !== "number" || typeof height !== "number") {
    return Response.json({ error: "width and height are required" }, { status: 400 });
  }
  try {
    return Response.json(cardCanvasSize(width, height));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid dimensions";
    return Response.json({ error: message }, { status: 400 });
  }
}
