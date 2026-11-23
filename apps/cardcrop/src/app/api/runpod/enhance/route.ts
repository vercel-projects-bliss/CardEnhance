import { isResponse, requireUser } from "@/lib/auth/require";
import { notConfiguredResponse, RunpodError, runpodConfig, submitEnhance } from "@/lib/runpod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Vercel caps request bodies at 4.5 MB, so the browser sends a JPEG of the working scan.
const MAX_BASE64 = 4_000_000;

export async function POST(request: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const config = runpodConfig();
  if (!config) return notConfiguredResponse();

  let body: { imageBase64?: unknown; scale?: unknown; outputFormat?: unknown; maxOutputLongEdge?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Expected JSON" }, { status: 400 });
  }
  const imageBase64 = typeof body.imageBase64 === "string" ? body.imageBase64 : "";
  if (imageBase64.length < 32 || imageBase64.length > MAX_BASE64) {
    return Response.json({ error: "Image payload is missing or larger than 4 MB" }, { status: 400 });
  }
  const scale = body.scale === 2 ? 2 : 4;
  const outputFormat =
    body.outputFormat === "png" || body.outputFormat === "webp" ? body.outputFormat : "jpeg";
  const edge = Number(body.maxOutputLongEdge);
  const maxOutputLongEdge = Number.isInteger(edge) && edge >= 512 && edge <= 4096 ? edge : 3072;

  try {
    const job = await submitEnhance(config, {
      image_base64: imageBase64,
      scale,
      output_format: outputFormat,
      quality: 92,
      max_output_long_edge: maxOutputLongEdge,
    });
    return Response.json(
      { jobId: job.id, status: job.status, scale, maxOutputLongEdge },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status = error instanceof RunpodError ? error.status : 502;
    const message = error instanceof Error ? error.message : "Runpod request failed";
    return Response.json({ error: message }, { status });
  }
}
