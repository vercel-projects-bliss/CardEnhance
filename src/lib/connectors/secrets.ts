import { createServerFn } from "@tanstack/react-start";
import { csrfMiddleware } from "@/lib/auth/csrf-middleware";
import { parseCredentialText, SECRET_FIELDS, snapshotSecrets } from "./secret-fields";

export { SECRET_FIELDS };

export const listSecrets = createServerFn({ method: "GET" })
  .middleware([csrfMiddleware])
  .handler(async () => {
  const { applySecrets } = await import("./secrets-io");
  const map = await applySecrets();
  return snapshotSecrets(map);
});

export const saveSecrets = createServerFn({ method: "POST" })
  .middleware([csrfMiddleware])
  .validator((input: { values?: Record<string, string>; paste?: string }) => input)
  .handler(async ({ data }) => {
    const { applySecrets, persistSecrets, readSecretMap } = await import("./secrets-io");
    const { assertSecretsWritable } = await import("../../../scripts/secrets-persist.mjs");
    assertSecretsWritable();
    const current = await readSecretMap();
    const incoming: Record<string, string> = { ...(data.values ?? {}) };
    Object.assign(incoming, parseCredentialText(data.paste ?? ""));
    for (const field of SECRET_FIELDS) {
      if (!(field.key in incoming)) continue;
      const next = incoming[field.key]?.trim() ?? "";
      if (next === "" || next === "-") delete current[field.key];
      else current[field.key] = next;
    }
    const rows = await persistSecrets(current);
    await applySecrets();
    return rows;
  });

export async function applySecrets() {
  const mod = await import("./secrets-io");
  return mod.applySecrets();
}
