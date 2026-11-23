import { isResponse, requireUser } from "@/lib/auth/require";
import { writeAudit } from "@/lib/db";
import { dispatchNotice } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  let body: { text?: unknown };
  try {
    body = (await request.json()) as { text?: unknown };
  } catch {
    return Response.json({ error: "Expected JSON" }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text || text.length > 2000) {
    return Response.json({ error: "text is required" }, { status: 400 });
  }
  const result = await dispatchNotice(text);
  try {
    await writeAudit("notify.sent", "notify", user.id, result);
  } catch {
    // Delivery already happened. A missing database does not undo Slack or Telegram.
  }
  return Response.json(result);
}
