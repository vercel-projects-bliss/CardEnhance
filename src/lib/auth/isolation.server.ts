import { getRequest } from "@tanstack/react-start/server";
import { isSameSiteRequestAllowed } from "../../../scripts/same-site-request.mjs";

/**
 * Fetch-Metadata sibling isolation — **server-only** (`.server.ts` suffix).
 *
 * MUST keep the `.server` suffix: this file imports `@tanstack/react-start/server`
 * (`getRequest` → Node `AsyncLocalStorage`). If it is imported from a dual
 * client/server module under a non-`.server` name, Vite ships it to the browser
 * and the app dies with: `AsyncLocalStorage is not a constructor`.
 *
 * Apps deployed on `*.grok.me` are "same-site" to each other but MUTUALLY
 * UNTRUSTED, and a `SameSite=Lax` session cookie IS sent on same-site
 * subrequests — so without this, a malicious sibling could make a SCRIPTED
 * (fetch/XHR/form-POST) request to this app's server functions and ride this
 * app's session cookie.
 *
 * Safe methods (GET/HEAD/OPTIONS) allow missing `Sec-Fetch-Site` so SSR and
 * server-to-server reads still work. Mutating methods require `same-origin`
 * Fetch Metadata or a matching `Origin`/`Host` pair — a missing header is
 * not treated as trusted. Enforced at the `authMiddleware` / `csrfMiddleware`
 * chokepoints.
 */
export class CrossSiteRequestError extends Error {
  readonly status = 403;
  constructor() {
    super("Forbidden: cross-site request blocked");
    this.name = "CrossSiteRequestError";
  }
}

/** Throw `CrossSiteRequestError` for a scripted cross-site/sibling request. */
export function assertSameSiteRequest(): void {
  const request = getRequest();
  if (!request) return; // no request context (e.g. build) — nothing to guard
  const h = request.headers;
  const allowed = isSameSiteRequestAllowed({
    method: request.method,
    secFetchSite: h.get("sec-fetch-site"),
    secFetchMode: h.get("sec-fetch-mode"),
    secFetchDest: h.get("sec-fetch-dest"),
    origin: h.get("origin"),
    host: h.get("x-forwarded-host") ?? h.get("host"),
  });
  if (!allowed) throw new CrossSiteRequestError();
}
