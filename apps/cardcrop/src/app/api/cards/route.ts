import { isResponse, requireUser } from "@/lib/auth/require";
import { databaseUrl, ensureSchema, getSql, writeAudit } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unavailable() {
  return Response.json(
    { error: "DATABASE_URL is not set. Card library rows are stored in Neon Postgres." },
    { status: 503 },
  );
}

export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (!databaseUrl()) return unavailable();
  try {
    await ensureSchema();
    const sql = getSql();
    const rows = await sql`
      select id, owner_id, filename, player, set_name, manufacturer, year, number, parallel,
             side, workspace, width, height, output_width, output_height, blob_url, status, created_at
      from cards
      where owner_id = ${user.id} or owner_id is null
      order by created_at desc
      limit 50
    `;
    return Response.json({ cards: rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Database query failed";
    return Response.json({ error: message }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (!databaseUrl()) return unavailable();
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Expected JSON" }, { status: 400 });
  }
  const filename = typeof body.filename === "string" && body.filename.trim() ? body.filename.trim() : "";
  if (!filename) return Response.json({ error: "filename is required" }, { status: 400 });
  const id = crypto.randomUUID();
  const text = (key: string) => (typeof body[key] === "string" ? body[key] : null);
  const num = (key: string) => (typeof body[key] === "number" && Number.isFinite(body[key]) ? body[key] : null);
  try {
    await ensureSchema();
    const sql = getSql();
    await sql`
      insert into cards (
        id, owner_id, filename, player, set_name, manufacturer, year, number, parallel, side,
        workspace, width, height, output_width, output_height, blob_url, status, metadata
      ) values (
        ${id},
        ${user.id},
        ${filename.slice(0, 180)},
        ${text("player")},
        ${text("setName")},
        ${text("manufacturer")},
        ${num("year")},
        ${text("number")},
        ${text("parallel")},
        ${text("side")},
        ${text("workspace")},
        ${num("width")},
        ${num("height")},
        ${num("outputWidth")},
        ${num("outputHeight")},
        ${text("blobUrl")},
        ${"completed"},
        ${JSON.stringify(body.metadata ?? {})}::jsonb
      )
    `;
    await writeAudit("card.saved", "card", id, { filename, workspace: text("workspace") });
    return Response.json({ id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Insert failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
