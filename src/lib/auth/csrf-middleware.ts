import { createMiddleware } from "@tanstack/react-start";

/**
 * Reject scripted cross-site / sibling-tenant calls to server functions.
 *
 * Vercel Authentication can still gate the deployment; this closes CSRF and
 * same-site cookie riding that SSO does not. Import isolation.server only
 * inside the server hook so Vite does not ship AsyncLocalStorage to the
 * browser (see `middleware.ts`).
 *
 *   export const saveThing = createServerFn({ method: "POST" })
 *     .middleware([csrfMiddleware])
 *     .handler(async () => { ... });
 */
export const csrfMiddleware = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const { assertSameSiteRequest } = await import("./isolation.server");
    assertSameSiteRequest();
    return next();
  },
);
