import { isResponse, requireUser } from "@/lib/auth/require";
import type { ServiceStatus } from "@/lib/cards/types";
import { inferenceEndpoint, inferenceHeaders, maxImageBytes } from "@/lib/server/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const endpoint = inferenceEndpoint("health");
  const base: ServiceStatus = {
    configured: endpoint !== null,
    ready: false,
    maxBytes: maxImageBytes(),
  };
  if (!endpoint) {
    return Response.json(base, { headers: { "Cache-Control": "no-store" } });
  }
  try {
    const response = await fetch(endpoint, {
      headers: inferenceHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      return Response.json(
        { ...base, detail: `Inference service returned HTTP ${response.status}` },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const health = (await response.json()) as Record<string, unknown>;
    const mode = health.mode === "paired" || health.mode === "unpaired" ? health.mode : undefined;
    return Response.json(
      {
        ...base,
        ready: health.status === "ready",
        mode,
        generator: typeof health.generator === "string" ? health.generator : undefined,
        device: typeof health.device === "string" ? health.device : undefined,
        checkpointEpoch: typeof health.checkpoint_epoch === "number" ? health.checkpoint_epoch : undefined,
        detail: health.status === "ready" ? undefined : "Checkpoint is not ready",
      } satisfies ServiceStatus,
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { ...base, detail: "Inference service is unreachable" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
