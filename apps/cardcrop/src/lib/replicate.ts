const DEFAULT_UPSCALE = "nightmareai/real-esrgan";
const DEFAULT_IMAGE = "black-forest-labs/flux-schnell";

export function upscaleModel(): string {
  return process.env.REPLICATE_UPSCALE_MODEL?.trim() || DEFAULT_UPSCALE;
}

export function imageModel(): string {
  return process.env.REPLICATE_IMAGE_MODEL?.trim() || DEFAULT_IMAGE;
}

type Prediction = {
  id?: string;
  status?: string;
  output?: unknown;
  error?: unknown;
  urls?: { get?: string };
};

function token(): string {
  const value = process.env.REPLICATE_API_TOKEN?.trim();
  if (!value) throw new Error("REPLICATE_API_TOKEN is not set");
  return value;
}

function outputUrl(output: unknown): string | null {
  if (typeof output === "string" && output.startsWith("http")) return output;
  if (Array.isArray(output)) {
    const first = output.find((item) => typeof item === "string" && item.startsWith("http"));
    return typeof first === "string" ? first : null;
  }
  return null;
}

async function fetchPrediction(url: string, key: string): Promise<Prediction> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Replicate returned HTTP ${response.status}`);
  }
  return (await response.json()) as Prediction;
}

export async function runModel(
  model: string,
  input: Record<string, unknown>,
): Promise<{ url: string; predictionId: string | null }> {
  const key = token();
  const response = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "wait=60",
    },
    body: JSON.stringify({ input }),
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Replicate returned HTTP ${response.status}: ${detail.slice(0, 400)}`);
  }
  let prediction = (await response.json()) as Prediction;
  const deadline = Date.now() + 90_000;
  while (
    prediction.status &&
    prediction.status !== "succeeded" &&
    prediction.status !== "failed" &&
    prediction.status !== "canceled" &&
    prediction.urls?.get &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    prediction = await fetchPrediction(prediction.urls.get, key);
  }
  if (prediction.status === "failed" || prediction.status === "canceled") {
    const message = typeof prediction.error === "string" ? prediction.error : prediction.status;
    throw new Error(`Replicate ${message}`);
  }
  const url = outputUrl(prediction.output);
  if (!url) {
    throw new Error(`Replicate did not return an image URL (status ${prediction.status ?? "unknown"})`);
  }
  return { url, predictionId: prediction.id ?? null };
}

export async function readRemoteImage(url: string): Promise<{ bytes: Buffer; contentType: string }> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not download generated image (HTTP ${response.status})`);
  const contentType = response.headers.get("content-type") ?? "image/png";
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > 15_000_000) {
    throw new Error("Generated image was empty or larger than 15 MB");
  }
  return { bytes, contentType };
}
