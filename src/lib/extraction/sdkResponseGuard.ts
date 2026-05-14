/**
 * SPEC-VERTEX-SDK-MIGRATION-1
 *
 * Pure module — no server-only, safe for CI guard imports.
 *
 * Classifies errors thrown by the Vertex AI / @google/genai SDK call chain
 * to detect the "Vertex returned HTML where JSON expected" failure mode
 * (and any future variant).
 *
 * The 2026-05-14 production incident: the deprecated @google-cloud/vertexai
 * SDK got HTML error pages back from Vertex AI's edge for Gemini 3.x calls
 * and crashed on internal response.json(). The migration to @google/genai
 * eliminates the root cause, but this guard remains as a permanent
 * regression detector — if HTML-instead-of-JSON ever happens again (from
 * the new SDK, a different code path, a Vercel edge layer, anything),
 * the error string will be classified as SDK_HTML_RESPONSE and surface
 * in last_error / failure_detail with a stable name.
 *
 * Used by:
 *   - geminiClient.ts (extraction primary)
 *   - geminiFlashStructuredAssist.ts (structured assist)
 *   - runGeminiOcrJob.ts (OCR worker)
 *   - processDocExtractionOutbox.ts (catches and re-tags)
 *   - (future) Aegis watchdog Phase 5 health monitor
 */

export type SdkErrorClassification = {
  /** Failure code (named, stable, queryable). */
  code: "SDK_HTML_RESPONSE" | "UNCLASSIFIED";
  /** True if the error matches the HTML-response signature. */
  isHtmlResponse: boolean;
  /**
   * First ~200 chars of the error message, useful for forensics.
   * Stripped of newlines for log clarity.
   */
  rawSnippet: string;
};

const HTML_RESPONSE_PATTERNS: readonly string[] = [
  "<!DOCTYPE",
  "<!doctype",
  "is not valid JSON",
  "Unexpected token '<'",
];

export function classifySdkError(err: unknown): SdkErrorClassification {
  const message = extractMessage(err);
  const rawSnippet = message.replace(/\s+/g, " ").slice(0, 200);

  const isHtmlResponse = HTML_RESPONSE_PATTERNS.some((p) =>
    message.includes(p),
  );

  return {
    code: isHtmlResponse ? "SDK_HTML_RESPONSE" : "UNCLASSIFIED",
    isHtmlResponse,
    rawSnippet,
  };
}

function extractMessage(err: unknown): string {
  if (err == null) return "";
  if (typeof err === "string") return err;
  if (typeof err === "object") {
    const anyErr = err as any;
    const fromMessage =
      typeof anyErr.message === "string" ? anyErr.message : "";
    const fromCause = anyErr.cause ? extractMessage(anyErr.cause) : "";
    return [fromMessage, fromCause].filter(Boolean).join(" | ");
  }
  return String(err);
}
