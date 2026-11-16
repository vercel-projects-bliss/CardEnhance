// @ts-check
/**
 * Postgres connection-string helpers shared by `src/lib/db.ts`,
 * `src/lib/auth/server.ts`, and `scripts/migrate.mjs`.
 *
 * Never log a connection string — it carries credentials.
 */

/**
 * Treat empty/whitespace as unset so a misconfigured deploy UI cannot look
 * like a real URL.
 *
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {string | undefined}
 */
export function readDatabaseUrl(env = process.env) {
  const raw = env["DATABASE_URL"];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * PGLite is the local/dev fallback. Vercel functions must not boot it:
 * the WASM image is not in the serverless bundle (`/var/task/pglite.data`)
 * and the filesystem is ephemeral. Production/preview use Neon via
 * `DATABASE_URL`.
 *
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {boolean}
 */
export function shouldUsePglite(env = process.env) {
  if (readDatabaseUrl(env)) return false;
  if (env["VERCEL"]) return false;
  return true;
}

/**
 * Modes that node-postgres currently aliases to verify-full, emitting a
 * SECURITY WARNING until pg v9. Rewriting to verify-full keeps today's
 * (stronger) behavior and silences the warning. Do not add uselibpqcompat
 * — that opts into weaker libpq `require` semantics.
 */
const ALIAS_MODES = new Set(["require", "prefer", "verify-ca"]);
const LEAVE_ALONE = new Set(["verify-full", "disable", "allow"]);

/**
 * Return a connection string whose `sslmode` is explicit when it was one of
 * the modes pg currently aliases to verify-full. URLs with no sslmode are
 * left unchanged so local/non-TLS Postgres keeps working.
 * Mutates only the sslmode query param so userinfo encoding is untouched.
 *
 * @param {string} connectionString
 * @returns {string}
 */
export function withExplicitSslMode(connectionString) {
  if (typeof connectionString !== "string" || connectionString.length === 0) {
    return connectionString;
  }
  const match = connectionString.match(/([?&])sslmode=([^&]*)/i);
  if (!match || match.index === undefined) {
    return connectionString;
  }
  let current = match[2];
  try {
    current = decodeURIComponent(current);
  } catch {
    // keep the raw capture
  }
  const mode = current.trim().toLowerCase();
  if (LEAVE_ALONE.has(mode) || !ALIAS_MODES.has(mode)) {
    return connectionString;
  }
  return (
    connectionString.slice(0, match.index) +
    `${match[1]}sslmode=verify-full` +
    connectionString.slice(match.index + match[0].length)
  );
}
