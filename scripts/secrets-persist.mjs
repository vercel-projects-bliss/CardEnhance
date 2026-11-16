// @ts-check
/**
 * Secret files (`data/secrets.json`, `.env.local`) are a local-dev convenience.
 * On Vercel the filesystem is ephemeral and writing DATABASE_URL / API keys
 * through an HTTP handler is a credential-exfiltration path.
 */

export const SECRETS_VERCEL_MESSAGE =
  "Secrets cannot be written on Vercel. Set them in Project Settings → Environment Variables.";

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {boolean}
 */
export function canPersistSecrets(env = process.env) {
  return !env.VERCEL;
}

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export function assertSecretsWritable(env = process.env) {
  if (!canPersistSecrets(env)) {
    throw new Error(SECRETS_VERCEL_MESSAGE);
  }
}
