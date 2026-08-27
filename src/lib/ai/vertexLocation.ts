import "server-only";

/**
 * Single source of truth for Vertex AI location resolution and endpoint hosts.
 *
 * SPEC-OUTBOX-ROUTING-AND-LOCATION-CENTRALIZATION-1
 *
 * Resolution chain (highest priority first):
 *   1. GOOGLE_CLOUD_LOCATION env var
 *   2. GOOGLE_CLOUD_REGION env var
 *   3. Default: "us-central1" (regional endpoint)
 *
 * Vertex has THREE endpoint classes, and they do not share a hostname shape.
 * Building the regional shape for all three is the bug that produced the
 * non-existent host `us-aiplatform.googleapis.com` and a 400 on every Vertex
 * call in production:
 *
 *   regional      us-central1  -> us-central1-aiplatform.googleapis.com
 *                               /locations/us-central1
 *   multi-region  us | eu      -> aiplatform.us.rep.googleapis.com
 *                               /locations/us
 *   global        global       -> aiplatform.googleapis.com
 *                               /locations/global
 *
 * The multi-region ("REP", Representative Endpoint) class went GA in May 2026.
 * It pools capacity across the regions of one geography while keeping
 * processing inside that geography, so `us` is a deliberate data-residency
 * choice, NOT a misconfiguration to be rewritten to `us-central1`. Callers
 * must therefore pair getVertexApiHost() with the SAME location string in the
 * URL path — never substitute a region for a multi-region value.
 *
 * Caveat for the SDK path: the current-generation Google GenAI SDK
 * (v2.x, vertexai:true) builds its own endpoint from the `location` it is
 * given and has historically required a specific regional endpoint —
 * multi-region values like "us" or "eu" made it construct invalid endpoint
 * URLs that returned HTML auth pages instead of JSON (the root cause of
 * SDK_HTML_RESPONSE failures after SPEC-GEMINI-FLASH-LITE-MIGRATION-1).
 * getVertexApiHost() below fixes the raw-fetch provider path only. Callers
 * that hand this location to the SDK instead (gcpAdcBootstrap.ts) inherit
 * whatever the installed SDK does with a multi-region value, so verify that
 * path separately before relying on "us"/"eu" there.
 *
 * Refs:
 *   https://cloud.google.com/blog/products/ai-machine-learning/multi-region-endpoints-for-claude-available-on-vertex-ai
 *   https://github.com/vercel/ai/issues/15722  (same bug, same wrong hostname)
 *
 * Callers MUST import these helpers rather than defining their own. A
 * source-grep guard test enforces this.
 */

/** Vertex multi-region locations, served on REP hosts. */
export const VERTEX_MULTI_REGIONS: ReadonlySet<string> = new Set(["us", "eu"]);

/** The global endpoint location, served on the bare host. */
export const VERTEX_GLOBAL_LOCATION = "global";

export function getVertexLocation(): string {
  return (
    process.env.GOOGLE_CLOUD_LOCATION ||
    process.env.GOOGLE_CLOUD_REGION ||
    "us-central1"
  )
    .trim()
    .toLowerCase();
}

/**
 * The API host serving `location`. Pair with the same location in the
 * `/locations/<location>` path segment.
 */
export function getVertexApiHost(location: string = getVertexLocation()): string {
  const loc = location.trim().toLowerCase();
  if (loc === VERTEX_GLOBAL_LOCATION) return "aiplatform.googleapis.com";
  if (VERTEX_MULTI_REGIONS.has(loc)) return `aiplatform.${loc}.rep.googleapis.com`;
  return `${loc}-aiplatform.googleapis.com`;
}
