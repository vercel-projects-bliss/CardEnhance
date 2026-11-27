const API_BASE = "https://api.runpod.ai/v2";
const JOB_ID = /^[A-Za-z0-9-]{8,128}$/;
const ENDPOINT_ID = /^[A-Za-z0-9-]{4,64}$/;

export type RunpodConfig = { apiKey: string; endpointId: string };

export type RunpodJobStatus =
  | "IN_QUEUE"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "TIMED_OUT";

export type EnhanceOutput = {
  image_base64?: string;
  content_type?: string;
  width?: number;
  height?: number;
  input_width?: number;
  input_height?: number;
  source_width?: number;
  source_height?: number;
  scale?: number;
  model?: string;
  device?: string;
  seconds?: number;
  error?: string;
};

export type RunpodJob = {
  id: string;
  status: RunpodJobStatus;
  output?: EnhanceOutput;
  error?: string;
  delayTime?: number;
  executionTime?: number;
};

export class RunpodError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function runpodConfig(): RunpodConfig | null {
  const apiKey = process.env.RUNPOD_API_KEY?.trim();
  const endpointId = process.env.RUNPOD_ENDPOINT_ID?.trim();
  if (!apiKey || !endpointId || !ENDPOINT_ID.test(endpointId)) return null;
  return { apiKey, endpointId };
}

export function notConfiguredResponse(): Response {
  return Response.json(
    {
      error: "Runpod not configured",
      detail: "Set RUNPOD_API_KEY and RUNPOD_ENDPOINT_ID on the CardCrop Vercel project.",
    },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

export function validJobId(id: string): boolean {
  return JOB_ID.test(id);
}

async function call<T>(config: RunpodConfig, path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/${config.endpointId}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "network error";
    throw new RunpodError(`Runpod is unreachable: ${message}`, 502);
  }
  const text = await response.text();
  if (!response.ok) {
    const status = response.status === 401 || response.status === 403 ? 502 : response.status === 404 ? 404 : 502;
    throw new RunpodError(`Runpod returned HTTP ${response.status}: ${text.slice(0, 300)}`, status);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new RunpodError("Runpod returned a non-JSON response", 502);
  }
}

export type EnhanceInput = {
  image_base64: string;
  scale: 2 | 4;
  output_format: "png" | "jpeg" | "webp";
  quality: number;
  max_output_long_edge: number;
};

export async function submitEnhance(config: RunpodConfig, input: EnhanceInput): Promise<RunpodJob> {
  return call<RunpodJob>(config, "/run", {
    method: "POST",
    body: JSON.stringify({ input, policy: { executionTimeout: 300_000, ttl: 3_600_000 } }),
  });
}

export async function jobStatus(config: RunpodConfig, id: string): Promise<RunpodJob> {
  return call<RunpodJob>(config, `/status/${encodeURIComponent(id)}`);
}

export async function endpointHealth(config: RunpodConfig): Promise<boolean> {
  try {
    await call<unknown>(config, "/health");
    return true;
  } catch {
    return false;
  }
}
