export type ChatTurn = { role: "user" | "assistant"; content: string };

export function imageModel(): string {
  return process.env.XAI_IMAGE_MODEL?.trim() || "grok-imagine-image-2.0";
}

function apiKey(): string {
  const key = process.env.XAI_API_KEY?.trim();
  if (!key) throw new Error("XAI_API_KEY is not set");
  return key;
}

type ImagePayload = {
  data?: { url?: string; b64_json?: string }[] | { url?: string; b64_json?: string };
};

export function imagePayload(body: ImagePayload): { url?: string; b64?: string } {
  const item = Array.isArray(body.data) ? body.data[0] : body.data;
  if (!item) return {};
  return { url: item.url, b64: item.b64_json };
}

export async function chatComplete(system: string, messages: ChatTurn[], model: string) {
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey()}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      messages: [{ role: "system", content: system }, ...messages],
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`xAI returned HTTP ${res.status}: ${detail.slice(0, 300)}`);
  }
  const body = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    model?: string;
  };
  const text = body.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("xAI returned an empty reply");
  return { text, model: body.model ?? model };
}

async function postImage(path: string, payload: Record<string, unknown>) {
  const res = await fetch(`https://api.x.ai/v1${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey()}`,
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`xAI images returned HTTP ${res.status}: ${detail.slice(0, 400)}`);
  }
  return imagePayload((await res.json()) as ImagePayload);
}

export async function generateImage(prompt: string) {
  return postImage("/images/generations", {
    model: imageModel(),
    prompt,
    aspect_ratio: "2:3",
    n: 1,
  });
}

export async function editImage(prompt: string, imageUrl: string) {
  return postImage("/images/edits", {
    model: imageModel(),
    prompt,
    image: { url: imageUrl, type: "image_url" },
  });
}
