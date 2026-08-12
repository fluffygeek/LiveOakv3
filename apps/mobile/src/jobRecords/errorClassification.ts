// Callable-function errors that mean the server actively rejected the
// submission (bad input, no permission, business-rule violation) — retrying
// it unchanged will fail identically forever, so these must surface to the
// Technician immediately rather than being queued for background sync.
const NON_RETRYABLE_CODES = new Set([
  "functions/invalid-argument",
  "functions/permission-denied",
  "functions/failed-precondition",
  "functions/not-found",
  "functions/unauthenticated",
  "functions/already-exists",
]);

/** True when the error looks like connectivity trouble (no code, or a transient one) rather than a real rejection. */
export function isLikelyOffline(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  if (typeof code !== "string") {
    return true; // no recognizable Functions error code — likely a raw network failure
  }
  return !NON_RETRYABLE_CODES.has(code);
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}
