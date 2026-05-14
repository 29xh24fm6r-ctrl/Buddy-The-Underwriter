import "server-only";

/**
 * Single source of truth for Vertex AI location resolution.
 *
 * SPEC-OUTBOX-ROUTING-AND-LOCATION-CENTRALIZATION-1
 *
 * Resolution chain (highest priority first):
 *   1. GOOGLE_CLOUD_LOCATION env var
 *   2. GOOGLE_CLOUD_REGION env var
 *   3. Default: "us" (multi-region)
 *
 * Why "us" multi-region (default):
 *   - gemini-3.1-flash-lite (current GEMINI_FLASH) is deployed to global,
 *     us, and eu — NOT to regional endpoints like us-central1.
 *   - "us" preserves U.S. data residency for SBA/bank tenant compliance
 *     (better than "global" for regulated workloads).
 *   - Vercel production env var is currently set to "us"; code default
 *     matches so future env removals don't regress.
 *
 * Callers MUST import this helper rather than defining their own. A
 * source-grep guard test enforces this.
 */
export function getVertexLocation(): string {
  return (
    process.env.GOOGLE_CLOUD_LOCATION ||
    process.env.GOOGLE_CLOUD_REGION ||
    "us"
  );
}
