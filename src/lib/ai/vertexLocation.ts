import "server-only";

/**
 * Single source of truth for Vertex AI location resolution.
 *
 * SPEC-OUTBOX-ROUTING-AND-LOCATION-CENTRALIZATION-1
 *
 * Resolution chain (highest priority first):
 *   1. GOOGLE_CLOUD_LOCATION env var
 *   2. GOOGLE_CLOUD_REGION env var
 *   3. Default: "us-central1" (regional endpoint)
 *
 * Why "us-central1" (not "us" multi-region):
 *   - @google/genai SDK v2.x with vertexai:true requires a specific regional
 *     endpoint. Multi-region values like "us" or "eu" construct invalid
 *     endpoint URLs that return HTML auth pages instead of JSON responses.
 *   - The old @google-cloud/vertexai SDK supported multi-region; the new
 *     @google/genai SDK does not. This was the root cause of SDK_HTML_RESPONSE
 *     failures after SPEC-GEMINI-FLASH-LITE-MIGRATION-1.
 *   - gemini-2.0-flash and gemini-flash-lite are deployed to us-central1.
 *   - GOOGLE_CLOUD_LOCATION Vercel env var must also be set to "us-central1".
 *
 * Callers MUST import this helper rather than defining their own. A
 * source-grep guard test enforces this.
 */
export function getVertexLocation(): string {
  return (
    process.env.GOOGLE_CLOUD_LOCATION ||
    process.env.GOOGLE_CLOUD_REGION ||
    "us-central1"
  );
}
