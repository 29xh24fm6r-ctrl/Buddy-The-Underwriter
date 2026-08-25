import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Didit webhook verification.
 *
 * Didit sends THREE signature headers so an integrator can pick whichever
 * one survives their stack (https://docs.didit.me/integration/webhooks):
 *
 *   X-Signature         HMAC-SHA256(secret, RAW REQUEST BODY)  ← primary
 *   X-Signature-V2      HMAC-SHA256(secret, recursively key-sorted JSON)
 *   X-Signature-Simple  HMAC-SHA256(secret, "<ts>:<session_id>:<status>:<webhook_type>")
 *
 * This module previously accepted ONLY X-Signature-Simple, over a `data`
 * composition that had never been confirmed against a live account (the
 * old file said so in its own header comment). Any real delivery whose
 * Simple tuple differed by a single field — or that carried only
 * X-Signature — was rejected with a bare 401 and NO log line, so a
 * silently-dropped event was indistinguishable from an event that never
 * arrived. See the 2026-08-25 Didit completion incident.
 *
 * Two changes fix that class of failure:
 *
 *  1. X-Signature (raw-body HMAC) is accepted first. It is the
 *     unambiguous scheme — no canonicalization, no field ordering, no
 *     guessing which tuple Didit composed. X-Signature-Simple remains as
 *     a fallback so a v1/v2 destination keeps working.
 *  2. Failures return a STRUCTURED REASON instead of `false`, so the
 *     route can log exactly which headers were present and why the
 *     signature did not match. A dropped webhook must never again be
 *     invisible.
 *
 * Replay protection: when X-Timestamp is present it must be within 5
 * minutes. A missing timestamp does not by itself reject a request whose
 * raw-body HMAC is valid — the signature still proves authenticity, and
 * rejecting on a header Didit may not send is how completions get lost.
 */

const MAX_CLOCK_SKEW_SECONDS = 300;

export type DiditSignatureScheme = "raw_body" | "simple";

export type DiditVerifyResult =
  | { ok: true; scheme: DiditSignatureScheme }
  | {
      ok: false;
      reason:
        | "NO_SIGNATURE_HEADER"
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

export function verifyDiditWebhook(params: {
  rawBody: string;
  sessionId: string | undefined;
  status: string | undefined;
  webhookType: string | undefined;
  timestampHeader: string | null;
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
    timestampHeader,
    signatureHeader,
    simpleSignatureHeader,
    secret,
  } = params;
  const now = params.nowMs ?? Date.now();

  const headersSeen: string[] = [];
  if (signatureHeader) headersSeen.push("x-signature");
  if (simpleSignatureHeader) headersSeen.push("x-signature-simple");
  if (timestampHeader) headersSeen.push("x-timestamp");

  if (!signatureHeader && !simpleSignatureHeader) {
    return { ok: false, reason: "NO_SIGNATURE_HEADER", headersSeen };
  }

  // Replay window — only enforced when Didit actually sent a timestamp.
  if (timestampHeader) {
    const timestamp = Number(timestampHeader);
    if (!Number.isFinite(timestamp)) {
      return { ok: false, reason: "TIMESTAMP_INVALID", headersSeen };
    }
    if (Math.abs(now / 1000 - timestamp) > MAX_CLOCK_SKEW_SECONDS) {
      return { ok: false, reason: "TIMESTAMP_EXPIRED", headersSeen };
    }
  }

  // 1. Raw-body HMAC — the scheme with no ambiguity.
  if (signatureHeader && hexEquals(hmacHex(secret, rawBody), signatureHeader)) {
    return { ok: true, scheme: "raw_body" };
  }

  // 2. Simple tuple fallback. Requires the timestamp, since it is part of
  //    the signed string.
  if (simpleSignatureHeader && timestampHeader && sessionId && status && webhookType) {
    const data = `${timestampHeader}:${sessionId}:${status}:${webhookType}`;
    if (hexEquals(hmacHex(secret, data), simpleSignatureHeader)) {
      return { ok: true, scheme: "simple" };
    }
  }

  return { ok: false, reason: "SIGNATURE_MISMATCH", headersSeen };
}
