/**
 * Pure Vertex location resolution shared by the server-only environment helper
 * and unit tests.
 *
 * The Google provider constructs regional API hostnames from this value, so
 * only region-shaped identifiers are safe here. Multi-region identifiers such
 * as "us", "eu", and "global" require different endpoint formats and must not
 * be interpolated into `${location}-aiplatform.googleapis.com`.
 */
export const DEFAULT_VERTEX_LOCATION = "us-central1";

const REGIONAL_LOCATION_PATTERN = /^[a-z]+(?:-[a-z0-9]+)+[0-9]$/;

export function normalizeVertexLocation(
  value: string | null | undefined,
): string {
  const normalized = value?.trim().toLowerCase();

  if (!normalized || !REGIONAL_LOCATION_PATTERN.test(normalized)) {
    return DEFAULT_VERTEX_LOCATION;
  }

  return normalized;
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
