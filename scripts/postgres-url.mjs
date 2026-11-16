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
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Local Postgres (loopback) may run without TLS. Remote hosts must not inherit
 * pg's plaintext default when sslmode is omitted.
 *
 * @param {string} connectionString
 * @returns {boolean}
 */
export function isLocalPostgresHost(connectionString) {
  try {
    const parsed = new URL(connectionString.replace(/^postgres(ql)?:/i, "http:"));
    return LOCAL_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Return a connection string whose `sslmode` is explicit.
 * - Missing sslmode on a remote host → verify-full (do not allow plaintext).
 * - Missing sslmode on localhost → unchanged (local/non-TLS still works).
 * - require/prefer/verify-ca → verify-full (today's pg alias, without the warning).
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
    if (isLocalPostgresHost(connectionString)) return connectionString;
    const sep = connectionString.includes("?") ? "&" : "?";
    return `${connectionString}${sep}sslmode=verify-full`;
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
