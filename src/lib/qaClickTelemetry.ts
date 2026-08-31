export type SanitizedQaClickCapture = {
  sessionId: string;
  payload: {
    path: string;
    element: {
      tag: string;
      testId?: string;
      qaId?: string;
    };
  };
};

const SAFE_TOKEN = /^[A-Za-z0-9_.:-]+$/;
const SAFE_ROUTE_SEGMENT = /^[A-Za-z0-9._~-]+$/;
const UUID_SEGMENT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LONG_HEX_SEGMENT = /^[0-9a-f]{24,}$/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function boundedToken(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const token = value.trim();
  if (!token || token.length > maxLength || !SAFE_TOKEN.test(token)) return null;
  return token;
}

function sanitizeRouteSegment(raw: string): string {
  let segment: string;
  try {
    segment = decodeURIComponent(raw);
  } catch {
    return ":redacted";
  }

  if (
    !segment ||
    segment === "." ||
    segment === ".." ||
    segment.includes("@") ||
    /^\d+$/.test(segment) ||
    UUID_SEGMENT.test(segment) ||
    LONG_HEX_SEGMENT.test(segment) ||
    segment.length > 48
  ) {
    return ":id";
  }

  return SAFE_ROUTE_SEGMENT.test(segment) ? segment : ":redacted";
}

/**
 * Keep only the pathname and redact identifier-shaped route segments. Query
 * strings and fragments can contain borrower names, emails, deal identifiers,
 * document identifiers, and one-time tokens, so they never cross this boundary.
 */
export function sanitizeQaPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const pathname = value.split(/[?#]/, 1)[0];
  if (!pathname.startsWith("/") || pathname.length > 2_048) return null;

  const sanitized = pathname
    .split("/")
    .map((segment, index) => (index === 0 || !segment ? segment : sanitizeRouteSegment(segment)))
    .join("/");

  return sanitized.length <= 512 ? sanitized : null;
}

/**
 * Shared browser/server boundary for QA click evidence. Unknown and free-form
 * fields are discarded; only bounded operational tokens survive.
 */
export function sanitizeQaClickCapture(
  input: unknown,
): SanitizedQaClickCapture | null {
  const raw = asRecord(input);
  const payload = asRecord(raw?.payload);
  const element = asRecord(payload?.element);

  const sessionId = boundedToken(raw?.sessionId, 64);
  const path = sanitizeQaPath(payload?.path);
  const tag = boundedToken(element?.tag, 32)?.toLowerCase();

  if (!sessionId || sessionId.length < 4 || !path || !tag) return null;

  const testId = boundedToken(element?.testId, 96);
  const qaId = boundedToken(element?.qaId, 96);

  return {
    sessionId,
    payload: {
      path,
      element: {
        tag,
        ...(testId ? { testId } : {}),
        ...(qaId ? { qaId } : {}),
      },
    },
  };
}
