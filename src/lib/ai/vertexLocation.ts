import "server-only";

import { resolveVertexLocation } from "@/lib/ai/vertexLocationValue";

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
 *   - The current-generation Google GenAI SDK (v2.x, vertexai:true) requires
 *     a specific regional endpoint. Multi-region values like "us" or "eu"
 *     construct invalid endpoint URLs that return HTML auth pages instead
 *     of JSON responses.
 *   - The old (now-legacy) Vertex AI SDK supported multi-region; the
 *     current-generation SDK does not. This was the root cause of
 *     SDK_HTML_RESPONSE failures after SPEC-GEMINI-FLASH-LITE-MIGRATION-1.
 *   - gemini-2.0-flash and gemini-flash-lite are deployed to us-central1.
 *
 * Invalid, blank, zonal, or multi-region configuration fails safely to
 * us-central1. Callers MUST import this helper rather than defining their own.
 */
export function getVertexLocation(): string {
  return resolveVertexLocation(
    process.env.GOOGLE_CLOUD_LOCATION,
    process.env.GOOGLE_CLOUD_REGION,
  );
}
