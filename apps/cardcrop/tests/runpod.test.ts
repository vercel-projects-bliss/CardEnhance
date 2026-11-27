import { afterEach, describe, expect, it, vi } from "vitest";
import { jobStatus, notConfiguredResponse, RunpodError, runpodConfig, submitEnhance, validJobId } from "@/lib/runpod";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("runpod config", () => {
  it("is null until both env vars are set", () => {
    vi.stubEnv("RUNPOD_API_KEY", "");
    vi.stubEnv("RUNPOD_ENDPOINT_ID", "");
    expect(runpodConfig()).toBeNull();
    vi.stubEnv("RUNPOD_API_KEY", "test-key");
    expect(runpodConfig()).toBeNull();
    vi.stubEnv("RUNPOD_ENDPOINT_ID", "abc123def");
    expect(runpodConfig()).toEqual({ apiKey: "test-key", endpointId: "abc123def" });
    vi.stubEnv("RUNPOD_ENDPOINT_ID", "../evil");
    expect(runpodConfig()).toBeNull();
  });

  it("answers 503 Runpod not configured", async () => {
    const response = notConfiguredResponse();
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("Runpod not configured");
  });

  it("validates job ids", () => {
    expect(validJobId("c80ffee4-f315-4e25-a146-0f3d98cf024b-u1")).toBe(true);
    expect(validJobId("../../x")).toBe(false);
  });
});

describe("runpod api calls", () => {
  const config = { apiKey: "test-key", endpointId: "abc123def" };

  it("submits to /run with the job input and bearer auth", async () => {
    const fetchSpy = vi.fn(async () => Response.json({ id: "job-12345678", status: "IN_QUEUE" }));
    vi.stubGlobal("fetch", fetchSpy);
    const job = await submitEnhance(config, {
      image_base64: "AAAA",
      scale: 4,
      output_format: "jpeg",
      quality: 92,
      max_output_long_edge: 3072,
    });
    expect(job).toEqual({ id: "job-12345678", status: "IN_QUEUE" });
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.runpod.ai/v2/abc123def/run");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    expect(JSON.parse(init.body as string).input.scale).toBe(4);
  });

  it("surfaces Runpod HTTP errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
    await expect(jobStatus(config, "job-12345678")).rejects.toBeInstanceOf(RunpodError);
  });
});
