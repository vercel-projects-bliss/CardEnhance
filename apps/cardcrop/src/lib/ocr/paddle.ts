import type { CardIdentity, CardSide } from "@/lib/cards/types";

export type PaddleVlResult =
  | { ok: true; identity: Partial<CardIdentity>; raw: string; model: string }
  | { ok: false; error: string };

const PROMPT =
  'OCR this trading card. Return JSON only: {"player":string|null,"year":number|null,"manufacturer":string|null,"set":string|null,"number":string|null,"parallel":string|null,"side":"front"|"back"|"unknown","rawText":string}. Read printed text only.';

function asSide(value: unknown): CardSide {
  return value === "front" || value === "back" ? value : "unknown";
}

function parseJson(text: string): Partial<CardIdentity> | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { rawText: text };
  try {
    const raw = JSON.parse(match[0]) as Record<string, unknown>;
    const str = (k: string) =>
      typeof raw[k] === "string" && raw[k].trim() ? String(raw[k]).trim() : null;
    const yearRaw = raw.year;
    let year: number | null = null;
    if (typeof yearRaw === "number" && yearRaw >= 1980 && yearRaw <= 2026) year = yearRaw;
    if (typeof yearRaw === "string") {
      const n = Number((yearRaw.match(/19[8-9]\d|20[0-2]\d/) ?? [])[0]);
      if (n >= 1980 && n <= 2026) year = n;
    }
    return {
      player: str("player"),
      year,
      manufacturer: str("manufacturer"),
      set: str("set"),
      number: str("number"),
      parallel: str("parallel"),
      side: asSide(raw.side),
      rawText: str("rawText") ?? text,
    };
  } catch {
    return { rawText: text };
  }
}

function hfToken() {
  return process.env.HF_TOKEN?.trim() || process.env.HUGGINGFACE_HUB_TOKEN?.trim() || "";
}

async function callSpace(jpeg: string): Promise<PaddleVlResult | null> {
  const space = process.env.HF_SPACE_URL?.trim();
  if (!space) return null;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = hfToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${space.replace(/\/$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: "paddleocr-vl",
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${jpeg}` } },
            { type: "text", text: PROMPT },
          ],
        },
      ],
      max_tokens: 512,
    }),
    cache: "no-store",
  });
  if (!res.ok) return { ok: false, error: `MODEL_UNAVAILABLE ${res.status}` };
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = body.choices?.[0]?.message?.content ?? "";
  const identity = parseJson(text);
  if (!identity) return { ok: false, error: "PROCESSING_FAILED" };
  return { ok: true, identity, raw: text, model: "PaddleOCR-VL-space" };
}

export async function readPaddleVl(jpeg: string): Promise<PaddleVlResult> {
  if (jpeg.length < 32) return { ok: false, error: "Missing image" };
  try {
    const fromSpace = await callSpace(jpeg);
    if (fromSpace && fromSpace.ok) return fromSpace;
    const token = hfToken();
    const url = "https://router.huggingface.co/hf-inference/models/PaddlePaddle/PaddleOCR-VL-1.6";
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        inputs: { image: jpeg },
        parameters: { max_new_tokens: 256, prompt: PROMPT },
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      return fromSpace ?? { ok: false, error: `MODEL_UNAVAILABLE ${res.status}` };
    }
    const body = (await res.json()) as unknown;
    const text =
      typeof body === "string"
        ? body
        : Array.isArray(body)
          ? String((body[0] as { generated_text?: string })?.generated_text ?? JSON.stringify(body))
          : JSON.stringify(body);
    const identity = parseJson(text);
    if (!identity) return { ok: false, error: "PROCESSING_FAILED" };
    return { ok: true, identity, raw: text, model: "PaddleOCR-VL-1.6" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "MODEL_UNAVAILABLE" };
  }
}
