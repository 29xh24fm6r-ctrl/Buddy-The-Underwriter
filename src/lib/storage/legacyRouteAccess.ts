const DEFAULT_SIGNED_URL_TTL_SECONDS = 600;
const MIN_SIGNED_URL_TTL_SECONDS = 60;
const MAX_SIGNED_URL_TTL_SECONDS = 600;

export function parseDealScopedStorageKey(fileKey: string): {
  dealId: string;
  normalizedKey: string;
} | null {
  if (!fileKey || fileKey.includes("\0") || fileKey.includes("\\")) return null;

  const normalizedKey = fileKey.replace(/^\/+/, "");
  const parts = normalizedKey.split("/");

  if (
    normalizedKey !== fileKey ||
    parts.length < 2 ||
    parts.some((part) => !part || part === "." || part === "..")
  ) {
    return null;
  }

  return { dealId: parts[0], normalizedKey };
}

export function clampSignedUrlTtl(rawValue: string | null): number {
  if (!rawValue) return DEFAULT_SIGNED_URL_TTL_SECONDS;

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return DEFAULT_SIGNED_URL_TTL_SECONDS;

  return Math.min(
    MAX_SIGNED_URL_TTL_SECONDS,
    Math.max(MIN_SIGNED_URL_TTL_SECONDS, Math.floor(parsed)),
  );
}
