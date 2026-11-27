import { isResponse, requireUser } from "@/lib/auth/require";
import { xaiModel } from "@/lib/ocr/vision";
import { chatComplete, type ChatTurn } from "@/lib/xai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYSTEM = `You are the CardCrop Studio assistant. You help with trading-card scans: identification from printed text the user supplies, listing titles, condition notes, and how to use the studio (detect, rectify, OCR, enhance, 5:7 padding export). Never invent a player name, year, grade, or price. If the user did not supply a fact, say it is unknown. Keep answers concise.`;

export async function POST(request: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  let body: { messages?: unknown; card?: unknown };
  try {
    body = (await request.json()) as { messages?: unknown; card?: unknown };
  } catch {
    return Response.json({ error: "Expected JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 24) {
    return Response.json({ error: "messages must be 1–24 turns" }, { status: 400 });
  }
  const messages: ChatTurn[] = [];
  for (const turn of body.messages) {
    if (!turn || typeof turn !== "object") {
      return Response.json({ error: "Invalid message" }, { status: 400 });
    }
    const role = (turn as { role?: unknown }).role;
    const content = (turn as { content?: unknown }).content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string" || !content.trim()) {
      return Response.json({ error: "Each message needs a role and content" }, { status: 400 });
    }
    if (content.length > 6000) {
      return Response.json({ error: "A message is too long" }, { status: 400 });
    }
    messages.push({ role, content: content.trim() });
  }
  if (messages[messages.length - 1]?.role !== "user") {
    return Response.json({ error: "The last message must be from the user" }, { status: 400 });
  }
  const card =
    body.card && typeof body.card === "object"
      ? `\n\nCard context supplied by the studio (do not treat missing fields as known):\n${JSON.stringify(body.card).slice(0, 4000)}`
      : "";
  try {
    const reply = await chatComplete(SYSTEM + card, messages, xaiModel());
    return Response.json(reply);
  } catch (error) {
    const message = error instanceof Error ? error.message : "xAI request failed";
    const status = message.includes("not set") ? 503 : 502;
    return Response.json({ error: message }, { status });
  }
}
