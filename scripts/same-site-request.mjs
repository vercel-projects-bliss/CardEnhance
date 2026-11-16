// @ts-check
/**
 * Pure Fetch-Metadata / Origin checks used by `src/lib/auth/isolation.server.ts`.
 * Mutating methods must not treat a missing `Sec-Fetch-Site` as allowed — that
 * lets curl and other non-browser clients skip CSRF. Safe methods still allow
 * missing headers so SSR and server-to-server GETs work.
 */

/**
 * @param {string | null | undefined} origin
 * @param {string | null | undefined} host
 * @returns {boolean}
 */
export function originMatchesHost(origin, host) {
  if (!origin || !host) return false;
  try {
    const originHost = new URL(origin).host.toLowerCase();
    const requestHost = host.split(",")[0].trim().toLowerCase();
    return originHost.length > 0 && originHost === requestHost;
  } catch {
    return false;
  }
}

/**
 * @typedef {object} SameSiteRequestHeaders
 * @property {string} [method]
 * @property {string | null} [secFetchSite]
 * @property {string | null} [secFetchMode]
 * @property {string | null} [secFetchDest]
 * @property {string | null} [origin]
 * @property {string | null} [host]
 */

/**
 * @param {SameSiteRequestHeaders} req
 * @returns {boolean}
 */
export function isSameSiteRequestAllowed(req) {
  const method = (req.method ?? "GET").toUpperCase();
  const site = (req.secFetchSite ?? "").toLowerCase();
  const mutating = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";

  if (mutating) {
    if (site === "same-origin") return true;
    return originMatchesHost(req.origin, req.host);
  }

  if (!site || site === "same-origin" || site === "none") return true;
  const dest = req.secFetchDest;
  return (
    req.secFetchMode === "navigate" &&
    method === "GET" &&
    dest !== "object" &&
    dest !== "embed"
  );
}
