import { isResponse, requireUser } from "@/lib/auth/require";
import { IMAGE_TYPES } from "@/lib/cards/types";
import { inferenceEndpoint, inferenceHeaders, maxImageBytes } from "@/lib/server/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function errorResponse(message: string, status: number): Response {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

function validInteger(value: FormDataEntryValue | null, fallback: number): number {
  if (value === null) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : -1;
}

export async function POST(request: Request): Promise<Response> {
  const user = await requireUser();
  if (isResponse(user)) return user;

  const endpoint = inferenceEndpoint("restore");
  if (!endpoint) {
    return errorResponse("Set RESTORATION_API_URL to your deployed GPU inference service.", 503);
  }

  let incoming: FormData;
  try {
    incoming = await request.formData();
  } catch {
    return errorResponse("The upload must be valid multipart form data.", 400);
  }
  const image = incoming.get("image");
  if (!(image instanceof File)) return errorResponse("Choose an image to restore.", 400);
  if (!IMAGE_TYPES.includes(image.type as (typeof IMAGE_TYPES)[number])) {
    return errorResponse("Only JPEG, PNG, and WebP images are supported.", 415);
  }
  if (image.size === 0 || image.size > maxImageBytes()) {
    return errorResponse(
      `Image must be between 1 byte and ${Math.floor(maxImageBytes() / 1_000_000)} MB.`,
      413,
    );
  }

  const tileSize = validInteger(incoming.get("tileSize"), 0);
  const tileOverlap = validInteger(incoming.get("tileOverlap"), 32);
  const outputFormat = incoming.get("outputFormat") ?? "png";
  if (![0, 256, 512, 1024].includes(tileSize)) return errorResponse("Invalid tile size.", 400);
  if (tileOverlap < 0 || tileOverlap > 256 || (tileSize > 0 && tileOverlap >= tileSize)) {
    return errorResponse("Tile overlap must be non-negative and smaller than the tile.", 400);
  }
  if (outputFormat !== "png" && outputFormat !== "jpeg") {
    return errorResponse("Output format must be PNG or JPEG.", 400);
  }

  const upstreamBody = new FormData();
  upstreamBody.append("file", image, image.name);
  upstreamBody.append("tile_size", String(tileSize));
  upstreamBody.append("tile_overlap", String(tileOverlap));
  upstreamBody.append("amp", String(incoming.get("amp") === "true"));
  upstreamBody.append("output_format", outputFormat);

  try {
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: inferenceHeaders(),
      body: upstreamBody,
      cache: "no-store",
      signal: request.signal,
    });
    if (!upstream.ok) {
      let detail = `Inference service returned HTTP ${upstream.status}`;
      try {
        const payload = (await upstream.json()) as { detail?: string };
        if (typeof payload.detail === "string" && payload.detail.length <= 300) detail = payload.detail;
      } catch {
        // Keep the status message when the upstream body is not JSON.
      }
      return errorResponse(detail, upstream.status < 500 ? upstream.status : 502);
    }
    const contentType = upstream.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/") || !upstream.body) {
      return errorResponse("Inference service did not return an image.", 502);
    }
    const headers = new Headers({
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      "Content-Disposition": `inline; filename="restored.${outputFormat === "png" ? "png" : "jpg"}"`,
    });
    for (const name of ["x-checkpoint-mode", "x-generator", "x-inference-ms"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(upstream.body, { status: 200, headers });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return errorResponse("Restoration cancelled.", 499);
    }
    return errorResponse("Could not reach the inference service.", 502);
  }
}
