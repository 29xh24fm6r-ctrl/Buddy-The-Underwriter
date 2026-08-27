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
 *   3. Default: "us-central1"
 *
 * Valid endpoint classes are preserved:
 *   - regional locations such as "us-central1"
 *   - multi-region locations "us" and "eu"
 *   - the "global" location
 *
 * The raw-fetch Google provider pairs this location with getVertexApiHost()
 * so the hostname and /locations/<location> path remain consistent. Invalid,
 * blank, or zonal values fail safely to us-central1.
 *
 * Callers MUST import this helper rather than defining their own.
 */
export function getVertexLocation(): string {
  return resolveVertexLocation(
    process.env.GOOGLE_CLOUD_LOCATION,
    process.env.GOOGLE_CLOUD_REGION,
  );
}
