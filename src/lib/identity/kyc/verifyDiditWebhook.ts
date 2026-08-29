import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Didit webhook verification.
 *
 * Didit signs every delivery with three HMAC-SHA256 variants and always sends
 * X-Timestamp. Verify the complete body with X-Signature-V2 first, then the
 * exact raw request body, and use the envelope-only Simple signature only as a
 * compatibility fallback. Every accepted scheme is bound to the five-minute
 * timestamp window so an authentic delivery cannot be replayed indefinitely.
 *
 * Contract: https://docs.didit.me/integration/webhooks
 */
const MAX_CLOCK_SKEW_SECONDS = 300;

export type DiditSignatureScheme = "v2" | "raw_body" | "simple";

export type DiditVerifyResult =
  | { ok: true; scheme: DiditSignatureScheme }
  | {
      ok: false;
      reason:
        | "NO_SIGNATURE_HEADER"
        | "TIMESTAMP_MISSING"
        | "TIMESTAMP_INVALID"
        | "TIMESTAMP_EXPIRED"
        | "SIGNATURE_MISMATCH";
      /** Header names actually present — logged so a misconfiguration is diagnosable. */
      headersSeen: string[];
    };

function hmacHex(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data, "utf8").digest("hex");
}

/** Constant-time hex compare that tolerates casing and a `sha256=` prefix. */
function hexEquals(expectedHex: string, providedRaw: string): boolean {
  const provided = providedRaw.trim().replace(/^sha256=/i, "").toLowerCase();
  if (!/^[0-9a-f]+$/.test(provided)) return false;
  const expectedBuf = Buffer.from(expectedHex, "hex");
  const providedBuf = Buffer.from(provided, "hex");
  if (expectedBuf.length !== providedBuf.length || expectedBuf.length === 0) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

/**
 * Reproduce Didit's V2 canonical JSON: object keys sorted recursively,
 * arrays kept in order, compact JSON, and Unicode preserved. JSON.parse
 * already normalizes whole-valued JSON floats before JSON.stringify.
 */
function canonicalizeV2(value: unknown): string {
  function sortKeys(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(sortKeys);
    if (input !== null && typeof input === "object") {
      const record = input as Record<string, unknown>;
      return Object.keys(record)
        .sort()
        .reduce<Record<string, unknown>>((out, key) => {
          out[key] = sortKeys(record[key]);
          return out;
        }, {});
    }
    return input;
  }

  return JSON.stringify(sortKeys(value));
}

export function verifyDiditWebhook(params: {
  rawBody: string;
  sessionId: string | undefined;
  status: string | undefined;
  webhookType: string | undefined;
  /** Didit's envelope timestamp, used by the Simple signature. */
  payloadTimestamp: string | number | undefined;
  timestampHeader: string | null;
  signatureV2Header: string | null;
  signatureHeader: string | null;
  simpleSignatureHeader: string | null;
  secret: string;
  /** Injectable for tests. */
  nowMs?: number;
}): DiditVerifyResult {
  const {
    rawBody,
    sessionId,
    status,
    webhookType,
    payloadTimestamp,
    timestampHeader,
    signatureV2Header,
    signatureHeader,
    simpleSignatureHeader,
    secret,
  } = params;
  const now = params.nowMs ?? Date.now();

  const headersSeen: string[] = [];
  if (signatureV2Header) headersSeen.push("x-signature-v2");
  if (signatureHeader) headersSeen.push("x-signature");
  if (simpleSignatureHeader) headersSeen.push("x-signature-simple");
  if (timestampHeader) headersSeen.push("x-timestamp");

  if (!signatureV2Header && !signatureHeader && !simpleSignatureHeader) {
    return { ok: false, reason: "NO_SIGNATURE_HEADER", headersSeen };
  }

  // Didit always sends X-Timestamp and requires every scheme to enforce it.
  if (!timestampHeader) {
    return { ok: false, reason: "TIMESTAMP_MISSING", headersSeen };
  }
  if (!/^-?\d+$/.test(timestampHeader.trim())) {
    return { ok: false, reason: "TIMESTAMP_INVALID", headersSeen };
  }
  const timestamp = Number(timestampHeader);
  if (!Number.isSafeInteger(timestamp)) {
    return { ok: false, reason: "TIMESTAMP_INVALID", headersSeen };
  }
  if (Math.abs(now / 1000 - timestamp) > MAX_CLOCK_SKEW_SECONDS) {
    return { ok: false, reason: "TIMESTAMP_EXPIRED", headersSeen };
  }

  // 1. Recommended V2 scheme: authenticates canonical JSON, including decision.
  if (signatureV2Header) {
    try {
      const parsed = JSON.parse(rawBody) as unknown;
      if (hexEquals(hmacHex(secret, canonicalizeV2(parsed)), signatureV2Header)) {
        return { ok: true, scheme: "v2" };
      }
    } catch {
      // The route returns invalid_json separately; verification still fails closed.
    }
  }

  // 2. Exact raw-body HMAC. Safe because the route has retained the original bytes.
  if (signatureHeader && hexEquals(hmacHex(secret, rawBody), signatureHeader)) {
    return { ok: true, scheme: "raw_body" };
  }

  // 3. Envelope-only compatibility fallback. The downstream handler re-fetches
  //    canonical session state from Didit and therefore never trusts decision data
  //    authenticated only by this limited scheme.
  if (simpleSignatureHeader && sessionId && status && webhookType) {
    const signedTimestamp = payloadTimestamp ?? timestampHeader;
    const data = `${signedTimestamp}:${sessionId}:${status}:${webhookType}`;
    if (hexEquals(hmacHex(secret, data), simpleSignatureHeader)) {
      return { ok: true, scheme: "simple" };
    }
  }

  return { ok: false, reason: "SIGNATURE_MISMATCH", headersSeen };
}
