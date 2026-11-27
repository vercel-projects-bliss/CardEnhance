import { isResponse, requireUser } from "@/lib/auth/require";
import { readRemoteImage, runModel, upscaleModel } from "@/lib/replicate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  let body: { imageBase64?: unknown; scale?: unknown; contentType?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Expected JSON" }, { status: 400 });
  }
  const imageBase64 = typeof body.imageBase64 === "string" ? body.imageBase64 : "";
  if (imageBase64.length < 32 || imageBase64.length > 8_000_000) {
    return Response.json({ error: "Image payload is missing or too large" }, { status: 400 });
  }
  const scale = body.scale === 4 ? 4 : 2;
  const contentType = body.contentType === "image/jpeg" ? "image/jpeg" : "image/png";
  try {
    const model = upscaleModel();
    const prediction = await runModel(model, {
      image: `data:${contentType};base64,${imageBase64}`,
      scale,
      face_enhance: false,
    });
    const remote = await readRemoteImage(prediction.url);
    return Response.json({
      model,
      predictionId: prediction.predictionId,
      contentType: remote.contentType,
      base64: remote.bytes.toString("base64"),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Replicate request failed";
    const status = message.includes("not set") ? 503 : 502;
    return Response.json({ error: message }, { status });
  }
}
