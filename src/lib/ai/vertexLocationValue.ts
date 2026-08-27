/**
 * Pure Vertex location and endpoint-host resolution shared by the server-only
 * environment helper, the Google provider, and unit tests.
 *
 * Vertex has three endpoint classes:
 *   regional:     <region>-aiplatform.googleapis.com
 *   multi-region: aiplatform.<us|eu>.rep.googleapis.com
 *   global:       aiplatform.googleapis.com
 *
 * The location used in the request path must stay paired with the host. Never
 * rewrite a valid multi-region or global location to a single region.
 */
export const DEFAULT_VERTEX_LOCATION = "us-central1";
export const VERTEX_GLOBAL_LOCATION = "global";
export const VERTEX_MULTI_REGIONS: ReadonlySet<string> = new Set(["us", "eu"]);

const REGIONAL_LOCATION_PATTERN = /^[a-z]+(?:-[a-z0-9]+)+[0-9]$/;

export function normalizeVertexLocation(
  value: string | null | undefined,
): string {
  const normalized = value?.trim().toLowerCase();

  if (!normalized) {
    return DEFAULT_VERTEX_LOCATION;
  }

  if (
    normalized === VERTEX_GLOBAL_LOCATION ||
    VERTEX_MULTI_REGIONS.has(normalized) ||
    REGIONAL_LOCATION_PATTERN.test(normalized)
  ) {
    return normalized;
  }

  return DEFAULT_VERTEX_LOCATION;
}

export function resolveVertexLocation(
  location: string | null | undefined,
  region: string | null | undefined,
): string {
  const configured =
    [location, region].find((value) => value?.trim()) ??
    DEFAULT_VERTEX_LOCATION;

  return normalizeVertexLocation(configured);
}

export function getVertexApiHost(
  location: string | null | undefined,
): string {
  const normalized = normalizeVertexLocation(location);

  if (normalized === VERTEX_GLOBAL_LOCATION) {
    return "aiplatform.googleapis.com";
  }

  if (VERTEX_MULTI_REGIONS.has(normalized)) {
    return `aiplatform.${normalized}.rep.googleapis.com`;
  }

  return `${normalized}-aiplatform.googleapis.com`;
}
