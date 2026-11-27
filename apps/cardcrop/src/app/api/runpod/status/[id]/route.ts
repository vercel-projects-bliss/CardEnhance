import { isResponse, requireUser } from "@/lib/auth/require";
import { blobConfigured, storeImage } from "@/lib/blob";
import { jobStatus, notConfiguredResponse, RunpodError, runpodConfig, validJobId } from "@/lib/runpod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Keep the JSON response under Vercel's 4.5 MB function response cap.
const MAX_INLINE_BASE64 = 4_200_000;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const config = runpodConfig();
  if (!config) return notConfiguredResponse();

  const { id } = await context.params;
  if (!validJobId(id)) return Response.json({ error: "Invalid job id" }, { status: 400 });

  try {
    const job = await jobStatus(config, id);
    const headers = { "Cache-Control": "no-store" };
    if (job.status === "COMPLETED") {
      const output = job.output ?? {};
      if (output.error || !output.image_base64) {
        return Response.json(
          { jobId: id, status: "FAILED", error: output.error || "Worker returned no image" },
          { status: 502, headers },
        );
      }
      const meta = {
        jobId: id,
        status: job.status,
        contentType: output.content_type ?? "image/jpeg",
        width: output.width,
        height: output.height,
        scale: output.scale,
        model: output.model,
        device: output.device,
        seconds: output.seconds,
        delayMs: job.delayTime,
        executionMs: job.executionTime,
      };
      if (blobConfigured()) {
        const ext = meta.contentType === "image/png" ? "png" : meta.contentType === "image/webp" ? "webp" : "jpg";
        const stored = await storeImage(
          `runpod/${id}.${ext}`,
          Buffer.from(output.image_base64, "base64"),
          meta.contentType,
        );
        return Response.json({ ...meta, url: stored.url }, { headers });
      }
      if (output.image_base64.length > MAX_INLINE_BASE64) {
        return Response.json(
          {
            jobId: id,
            status: "FAILED",
            error: "Upscaled image is too large to return inline. Set BLOB_READ_WRITE_TOKEN or lower the output size.",
          },
          { status: 502, headers },
        );
      }
      return Response.json({ ...meta, base64: output.image_base64 }, { headers });
    }
    if (job.status === "FAILED" || job.status === "CANCELLED" || job.status === "TIMED_OUT") {
      return Response.json(
        { jobId: id, status: job.status, error: job.error || job.output?.error || job.status },
        { status: 502, headers },
      );
    }
    return Response.json({ jobId: id, status: job.status, delayMs: job.delayTime }, { headers });
  } catch (error) {
    const status = error instanceof RunpodError ? error.status : 502;
    const message = error instanceof Error ? error.message : "Runpod status failed";
    return Response.json({ error: message }, { status });
  }
}
