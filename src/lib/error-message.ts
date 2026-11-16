/** TanStack Router types route `error` as unknown. */
export function errorMessage(
  error: unknown,
  fallback = "An unexpected error occurred. Try reloading the page.",
): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}
