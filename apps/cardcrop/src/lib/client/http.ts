export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) {
    throw new Error(data?.error || `Request failed (${response.status})`);
  }
  return data as T;
}

export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: "no-store" });
  const data = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) {
    throw new Error(data?.error || `Request failed (${response.status})`);
  }
  return data as T;
}
