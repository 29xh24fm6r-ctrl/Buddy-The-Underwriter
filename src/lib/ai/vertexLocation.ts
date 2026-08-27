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
 *   - The current-generation Google GenAI SDK (v2.x, vertexai:true) requires
 *     a specific regional endpoint. Multi-region values like "us" or "eu"
 *     construct invalid endpoint URLs that return HTML auth pages instead
 *     of JSON responses.
 *   - The old (now-legacy) Vertex AI SDK supported multi-region; the
 *     current-generation SDK does not. This was the root cause of
 *     SDK_HTML_RESPONSE failures after SPEC-GEMINI-FLASH-LITE-MIGRATION-1.
 *   - gemini-2.0-flash and gemini-flash-lite are deployed to us-central1.
 *   - GOOGLE_CLOUD_LOCATION Vercel env var must also be set to "us-central1".
 *
 * Callers MUST import this helper rather than defining their own. A
 * source-grep guard test enforces this.
 *
 * The env var is normalized rather than trusted. Production had
 * GOOGLE_CLOUD_LOCATION="us", which this helper passed straight through into
 * `https://${location}-aiplatform.googleapis.com`, producing the non-existent
 * host `us-aiplatform.googleapis.com` and a 400 on every Vertex call — exactly
 * the failure the comment above warns about, but nothing enforced it. A
 * misconfigured region now degrades to the correct regional endpoint (and says
 * so in the logs) instead of silently disabling every AI path in the app.
 */

/**
 * Vertex multi-region / global values, which are NOT valid regional endpoint
 * hostname prefixes, mapped to the regional endpoint serving that geography.
 */
const MULTI_REGION_TO_REGIONAL: Record<string, string> = {
  us: "us-central1",
  eu: "europe-west4",
  europe: "europe-west4",
  asia: "asia-northeast1",
  global: "us-central1",
};

const DEFAULT_LOCATION = "us-central1";

/** Regional locations are `<geo>-<direction><n>`, e.g. us-central1, me-west1. */
const REGIONAL_PATTERN = /^[a-z]+(?:-[a-z]+\d+)$/;

let warned = false;

function warnOnce(configured: string, resolved: string): void {
  if (warned) return;
  warned = true;
  console.warn(
    `[vertexLocation] GOOGLE_CLOUD_LOCATION/GOOGLE_CLOUD_REGION is "${configured}", ` +
      `which is not a valid Vertex regional endpoint and would build the invalid host ` +
      `"${configured}-aiplatform.googleapis.com". Falling back to "${resolved}". ` +
      `Set the env var to a regional value (e.g. "us-central1") to silence this.`,
  );
}

export function getVertexLocation(): string {
  const configured = (
    process.env.GOOGLE_CLOUD_LOCATION ||
    process.env.GOOGLE_CLOUD_REGION ||
    "us-central1"
  )
    .trim()
    .toLowerCase();

  if (REGIONAL_PATTERN.test(configured)) return configured;

  const resolved = MULTI_REGION_TO_REGIONAL[configured] ?? DEFAULT_LOCATION;
  warnOnce(configured, resolved);
  return resolved;
}

/** Test seam: lets the guard suite assert the warning fires exactly once. */
export function __resetVertexLocationWarningForTests(): void {
  warned = false;
}
