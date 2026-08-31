export type SanitizedClientTelemetry = {
  request_id: string;
  stage: string;
  meta?: Record<string, string | number | boolean>;
};

const SAFE_TOKEN = /^[A-Za-z0-9_.:-]+$/;
const SAFE_META_KEYS = new Set([
  "attempt",
  "status",
  "ok",
  "response_ok",
  "isAbort",
  "code",
]);

function boundedToken(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const token = value.trim();
  if (!token || token.length > maxLength || !SAFE_TOKEN.test(token)) return null;
  return token;
}

function safeMetaValue(key: string, value: unknown): string | number | boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (key === "code") return boundedToken(value, 64);
  return null;
}

/**
 * Boundary shared by the browser emitter and server route. Only operational
 * tokens and scalar delivery state survive. Deal ids, document ids, filenames,
 * object paths, MIME types, raw errors, nested objects, and free-form messages
 * are deliberately excluded.
 */
export function sanitizeClientTelemetry(
  input: unknown,
  fallbackRequestId?: string | null,
): SanitizedClientTelemetry | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;

  const raw = input as Record<string, unknown>;
  const requestId =
    boundedToken(raw.request_id, 128) ??
    boundedToken(fallbackRequestId, 128);
  const stage = boundedToken(raw.stage, 64);
  if (!requestId || !stage) return null;

  const safeMeta: Record<string, string | number | boolean> = {};
  if (raw.meta && typeof raw.meta === "object" && !Array.isArray(raw.meta)) {
    for (const [key, value] of Object.entries(raw.meta as Record<string, unknown>)) {
      if (!SAFE_META_KEYS.has(key)) continue;
      const safeValue = safeMetaValue(key, value);
      if (safeValue !== null) safeMeta[key] = safeValue;
    }
  }

  return {
    request_id: requestId,
    stage,
    ...(Object.keys(safeMeta).length > 0 ? { meta: safeMeta } : {}),
  };
}
