export type SignedUploadEvidence = {
  signedUrl: string;
  token: string;
  path?: string;
};

const MAX_SIGNED_URL_LENGTH = 8_192;
const MAX_SIGNED_TOKEN_LENGTH = 4_096;
const MAX_SIGNED_PATH_LENGTH = 1_024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) return null;
  return normalized;
}

/**
 * Proves a Supabase response is signed-upload evidence. A download-only signed
 * URL has no upload token and is rejected instead of being passed to a PUT.
 */
export function parseSignedUploadEvidence(value: unknown): SignedUploadEvidence | null {
  if (!isRecord(value)) return null;

  const signedUrl = boundedString(value.signedUrl, MAX_SIGNED_URL_LENGTH);
  const token = boundedString(value.token, MAX_SIGNED_TOKEN_LENGTH);
  if (!signedUrl || !token) return null;

  let parsed: URL;
  try {
    parsed = new URL(signedUrl);
  } catch {
    return null;
  }

  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    parsed.username ||
    parsed.password
  ) {
    return null;
  }

  const path =
    value.path === undefined
      ? null
      : boundedString(value.path, MAX_SIGNED_PATH_LENGTH);
  if (value.path !== undefined && !path) return null;

  return {
    signedUrl,
    token,
    ...(path ? { path } : {}),
  };
}
