/**
 * Omega redaction utilities — barrel re-export.
 *
 * The actual implementation lives in `redaction.server.ts` which carries
 * the `import "server-only"` guard. This file re-exports everything so
 * existing callers continue to work unchanged.
 *
 * If this module is accidentally imported on the client, the `server-only`
 * guard in the implementation file will throw at build time.
 */

export { maskEin, hashId, redactPayload } from "./redaction.server";
