import { createServerFn } from "@tanstack/react-start";
import { csrfMiddleware } from "@/lib/auth/csrf-middleware";

export const checkR2 = createServerFn({ method: "GET" })
  .middleware([csrfMiddleware])
  .handler(async () => {
  const { applySecrets } = await import("./secrets-io");
  await applySecrets();
  const { r2Config, headBucket } = await import("./r2-io");
  if (!r2Config()) return { ok: false as const, status: "disconnected" as const, error: "R2 credentials missing" };
  const result = await headBucket();
  return {
    ok: result.ok,
    status: result.ok ? ("connected" as const) : ("error" as const),
    error: result.error,
    http: result.status,
  };
});

export const putR2Object = createServerFn({ method: "POST" })
  .middleware([csrfMiddleware])
  .validator((input: { key: string; contentType: string; dataBase64: string; cardId?: string }) => input)
  .handler(async ({ data }) => {
    const { applySecrets } = await import("./secrets-io");
    await applySecrets();
    const { r2Config, putObject } = await import("./r2-io");
    if (!r2Config()) return { ok: false as const, skipped: true as const, error: "R2 credentials missing" };
    const key = data.key.replace(/^\/+/, "").replace(/\.\./g, "");
    if (!key || key.length > 512) return { ok: false as const, skipped: false as const, error: "Invalid key" };
    const body = Buffer.from(data.dataBase64, "base64");
    if (!body.length || body.length > 12_000_000) return { ok: false as const, skipped: false as const, error: "Object too large" };
    const result = await putObject(key, body, data.contentType || "application/octet-stream");
    if (result.ok && data.cardId) {
      const { getSql } = await import("@/lib/db");
      const sql = await getSql();
      await sql`
        update cards set r2_key = ${result.key}, r2_url = ${result.url} where id = ${data.cardId}
      `;
      await sql`
        insert into audit_logs (action, entity_type, entity_id, metadata)
        values (
          ${"r2.uploaded"},
          ${"card"},
          ${data.cardId},
          ${JSON.stringify({ key: result.key, url: result.url, bytes: body.length })}::jsonb
        )
      `;
    }
    return { ok: result.ok, skipped: false as const, key: result.key, url: result.url, error: result.error };
  });

export const probeR2 = createServerFn({ method: "POST" })
  .middleware([csrfMiddleware])
  .handler(async () => {
  const { applySecrets } = await import("./secrets-io");
  await applySecrets();
  const { r2Config, putObject, getObject, headBucket } = await import("./r2-io");
  if (!r2Config()) return { ok: false as const, error: "R2 credentials missing" };
  const head = await headBucket();
  if (!head.ok) return { ok: false as const, error: head.error ?? "HEAD bucket failed" };
  const key = `cardenhance/health-${Date.now()}.txt`;
  const payload = Buffer.from(`cardenhance r2 ${new Date().toISOString()}`, "utf8");
  const put = await putObject(key, payload, "text/plain");
  if (!put.ok) return { ok: false as const, error: put.error ?? "PUT failed" };
  const got = await getObject(key);
  if (!got.ok || !got.body.includes("cardenhance r2")) return { ok: false as const, error: "GET mismatch" };
  return { ok: true as const, key: put.key, url: put.url };
});
