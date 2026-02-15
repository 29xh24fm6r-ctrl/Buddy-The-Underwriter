/**
 * Re-throw Next.js framework errors that must propagate to the framework.
 *
 * redirect() and notFound() throw special errors with a `digest` property.
 * If a try/catch swallows them, you get a 500 instead of the intended response.
 *
 * Call as the FIRST line in every API route catch block:
 *
 *   catch (e: any) {
 *     rethrowNextErrors(e);
 *     // ... your error handling ...
 *   }
 *
 * Uses digest-based detection — no imports from Next.js internals.
 */
export function rethrowNextErrors(e: unknown): void {
  if (
    e != null &&
    typeof e === "object" &&
    "digest" in e &&
    typeof (e as any).digest === "string"
  ) {
    const digest: string = (e as any).digest;
    if (digest.startsWith("NEXT_REDIRECT")) throw e;
    if (digest === "NEXT_NOT_FOUND") throw e;
  }
}
