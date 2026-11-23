import { isResponse, requireUser } from "@/lib/auth/require";
import { readRemoteImage, imageModel as replicateImageModel, runModel } from "@/lib/replicate";
import { editImage, generateImage } from "@/lib/xai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function materialize(found: { url?: string; b64?: string }) {
  if (found.b64) {
    const bytes = Buffer.from(found.b64, "base64");
    if (bytes.length === 0 || bytes.length > 15_000_000) {
      throw new Error("Image payload was empty or larger than 15 MB");
    }
    return { base64: found.b64, contentType: "image/png" };
  }
  if (!found.url) throw new Error("The image API did not return a URL or base64 payload");
  const remote = await readRemoteImage(found.url);
  return {
    base64: remote.bytes.toString("base64"),
    contentType: remote.contentType,
    url: found.url,
  };
}

export async function POST(request: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  let body: { provider?: unknown; operation?: unknown; prompt?: unknown; imageBase64?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Expected JSON" }, { status: 400 });
  }
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (prompt.length < 3 || prompt.length > 2000) {
    return Response.json({ error: "Prompt must be 3–2000 characters" }, { status: 400 });
  }
  const provider = body.provider === "replicate" ? "replicate" : "xai";
  const operation = body.operation === "edit" ? "edit" : "generate";
  try {
    if (provider === "replicate") {
      if (operation === "edit") {
        return Response.json(
          {
            error:
              "Replicate in this studio generates a new image from the prompt. Edits of an existing image use xAI /v1/images/edits.",
          },
          { status: 400 },
        );
      }
      const generated = await runModel(replicateImageModel(), {
        prompt,
        aspect_ratio: "2:3",
        output_format: "png",
      });
      const image = await materialize({ url: generated.url });
      return Response.json({ provider, model: replicateImageModel(), ...image });
    }
    if (operation === "edit") {
      const raw = typeof body.imageBase64 === "string" ? body.imageBase64 : "";
      if (raw.length < 32 || raw.length > 8_000_000) {
        return Response.json({ error: "An image is required to edit" }, { status: 400 });
      }
      const edited = await editImage(prompt, `data:image/png;base64,${raw}`);
      const image = await materialize(edited);
      return Response.json({ provider, operation, ...image });
    }
    const created = await generateImage(prompt);
    const image = await materialize(created);
    return Response.json({ provider, operation, ...image });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Image request failed";
    const status = message.includes("not set") ? 503 : 502;
    return Response.json({ error: message }, { status });
  }
}
