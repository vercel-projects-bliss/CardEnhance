import { isResponse, requireUser } from "@/lib/auth/require";
import { databaseUrl, ensureSchema, getSql, writeAudit } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (!databaseUrl()) {
    return Response.json({ error: "DATABASE_URL is not set" }, { status: 503 });
  }
  let body: { fileCount?: unknown; status?: unknown; metadata?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Expected JSON" }, { status: 400 });
  }
  const fileCount = body.fileCount;
  if (typeof fileCount !== "number" || !Number.isInteger(fileCount) || fileCount < 1 || fileCount > 200) {
    return Response.json({ error: "fileCount must be 1–200" }, { status: 400 });
  }
  const status = body.status === "failed" ? "failed" : "completed";
  const id = crypto.randomUUID();
  try {
    await ensureSchema();
    const sql = getSql();
    await sql`
      insert into batches (id, owner_id, file_count, status, metadata)
      values (${id}, ${user.id}, ${fileCount}, ${status}, ${JSON.stringify(body.metadata ?? {})}::jsonb)
    `;
    await writeAudit("batch.saved", "batch", id, { fileCount, status });
    return Response.json({ id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Insert failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
