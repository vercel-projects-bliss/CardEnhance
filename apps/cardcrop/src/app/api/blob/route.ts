import { isResponse, requireUser } from "@/lib/auth/require";
import { storeImage } from "@/lib/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Expected multipart form data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ error: "Choose a file" }, { status: 400 });
  }
  if (file.size > 12_000_000) {
    return Response.json({ error: "File is larger than 12 MB" }, { status: 413 });
  }
  if (!file.type.startsWith("image/")) {
    return Response.json({ error: "Only images can be stored" }, { status: 415 });
  }
  const safeName = (file.name || "card.png").replace(/[^\w.-]+/g, "_").slice(0, 80);
  try {
    const stored = await storeImage(`cards/${user.id}/${safeName}`, file, file.type);
    return Response.json({ url: stored.url, pathname: stored.pathname, contentType: file.type });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Blob upload failed";
    const status = message.includes("not set") ? 503 : 502;
    return Response.json({ error: message }, { status });
  }
}
