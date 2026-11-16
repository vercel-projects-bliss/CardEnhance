import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertSecretsWritable } from "../../../scripts/secrets-persist.mjs";
import { SECRET_FIELDS, snapshotSecrets, type SecretMap } from "./secret-fields";

const ROOT = process.cwd();
const JSON_FILE = join(ROOT, "data", "secrets.json");
const ENV_FILE = join(ROOT, ".env.local");

export async function readSecretMap(): Promise<SecretMap> {
  if (process.env.VERCEL) return {};
  try {
    const raw = await readFile(JSON_FILE, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: SecretMap = {};
    for (const field of SECRET_FIELDS) {
      const value = parsed[field.key];
      if (typeof value === "string" && value.trim()) out[field.key] = value.trim();
    }
    return out;
  } catch {
    return {};
  }
}

function toEnvFile(map: SecretMap) {
  return SECRET_FIELDS.map((field) => {
    const value = map[field.key];
    return value ? `${field.key}=${JSON.stringify(value)}` : null;
  })
    .filter((line): line is string => Boolean(line))
    .join("\n")
    .concat("\n");
}

export async function applySecrets(): Promise<SecretMap> {
  const map = await readSecretMap();
  for (const [key, value] of Object.entries(map)) {
    if (value) process.env[key] = value;
  }
  return map;
}

export async function persistSecrets(map: SecretMap) {
  assertSecretsWritable();
  await mkdir(join(ROOT, "data"), { recursive: true });
  await writeFile(JSON_FILE, JSON.stringify(map, null, 2), { mode: 0o600 });
  await writeFile(ENV_FILE, toEnvFile(map), { mode: 0o600 });
  for (const field of SECRET_FIELDS) {
    if (map[field.key]) process.env[field.key] = map[field.key];
    else delete process.env[field.key];
  }
  return snapshotSecrets(map);
}
