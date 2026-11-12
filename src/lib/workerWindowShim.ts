// Turbopack minifies `typeof window !== "undefined" && typeof window.document !== "undefined"`
// down to `void 0 !== window.document`. That throws ReferenceError in a dedicated worker
// where `window` does not exist. Alias it to the worker global before transformers.js loads.
// `window.document` stays undefined, so IS_BROWSER_ENV remains false and IS_WEBWORKER_ENV stays true.
export function installWorkerWindowShim(): void {
  const g = globalThis as typeof globalThis & { window?: unknown };
  if (typeof g.window === "undefined") {
    Object.defineProperty(g, "window", { value: g, configurable: true, writable: true });
  }
}

installWorkerWindowShim();
