/** Narrow an unknown thrown value to a display string without using `any`. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
