import "server-only";

import { classifySdkError } from "@/lib/extraction/sdkResponseGuard";
import { buildStructuredAssistPrompt, PROMPT_VERSION } from "./geminiFlashPrompts";
import { validateStructuredOutput } from "./schemas/structuredOutput";
import { computeStructuredOutputHash } from "./outputCanonicalization";
import { runRole } from "@/lib/ai/gateway";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Structured assist result — matches the entity/formField shape consumed by
 * structuredJsonParser.ts (formerly docAiParser.ts).
 *
 * This is ADVISORY data only. It feeds into deterministic extractors as an
 * assist layer. It never persists facts directly, never alters classification,
 * never influences slot binding.
 */
export type StructuredAssistResult = {
  entities: Array<{
    type: string;
    mentionText: string;
    confidence: number;
    normalizedValue?: {
      text?: string;
      moneyValue?: { units: number; nanos: number };
    };
  }>;
  formFields: Array<{
    name: string;
    value: string;
    confidence: number;
  }>;
  text: string;
  _meta: {
    model: string;
    latencyMs: number;
    source: "gemini_flash_structured_assist";
    promptVersion: string;
    schemaVersion: string;
    outputHash: string | null;
  };
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// ─── Hard Limits (C1) ────────────────────────────────────────────────────────

// SPEC-EXTRACTION-MODEL-UPGRADE-1: resolve the document-extraction model via the
// MODEL_EXTRACTION intent-alias (not GEMINI_FLASH directly), so the extraction
// lane is governed from the single registry alias.
import { MODEL_EXTRACTION } from "@/lib/ai/models";

const STRUCTURED_ASSIST_TIMEOUT_MS = 15_000; // 15s hard timeout (institutional)
const GEMINI_MODEL = MODEL_EXTRACTION;
const GEMINI_TEMPERATURE = 0.1;
const MAX_OCR_TEXT_LENGTH = 50_000;  // Truncate to avoid token limits
const MAX_RETRIES = 1;              // At most 1 retry (C2)
const MAX_INPUT_PAGES = 50;         // Skip structured assist for very long docs

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Call Gemini Flash to extract structured financial data from OCR text.
 *
 * ADVISORY ONLY — this function:
 * - Does NOT write to DB
 * - Does NOT emit facts
 * - Does NOT change classification
 * - Does NOT bind slots
 *
 * Returns null on any failure (timeout, invalid JSON, unsupported type).
 * Never throws — fail-fast, fail-closed, no pipeline block.
 *
 * Retry policy (C2): at most 1 retry, only on invalid JSON or schema
 * mismatch. Retry uses stricter system instruction.
 */
export async function extractStructuredAssist(args: {
  ocrText: string;
  canonicalType: string;
  documentId: string;
  pageCount?: number;
}): Promise<StructuredAssistResult | null> {
  const started = Date.now();

  try {
    // Page-count guard (C1): skip structured assist for very long docs
    if (args.pageCount && args.pageCount > MAX_INPUT_PAGES) {
      console.log("[StructuredAssist] Skipping — too many pages", {
        documentId: args.documentId,
        pageCount: args.pageCount,
        maxPages: MAX_INPUT_PAGES,
      });
      return null;
    }

    // Build type-specific prompt
    const truncatedText = args.ocrText.slice(0, MAX_OCR_TEXT_LENGTH);
    const prompt = buildStructuredAssistPrompt(args.canonicalType, truncatedText);
    if (!prompt) {
      // Unsupported type — deterministic extractors handle via OCR regex
      return null;
    }

    // Attempt extraction with retry (C2)
    let lastFailureReason: string | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const isRetry = attempt > 0;
      const systemInstruction = isRetry
        ? STRICT_RETRY_SYSTEM_INSTRUCTION
        : prompt.systemInstruction;

      // SPEC-M1.1: routed through the AI gateway (runRole, "generator" role,
      // authMode: "vertex"). Temperature omission for Gemini 3.x models is
      // already handled inside providers/google.ts — pass it unconditionally.
      // providers/google.ts's callGoogle throws "empty response" for a blank
      // candidate (rather than this file's old empty-string check) — caught
      // below and folded into the SAME inner-retry path the original empty-
      // response check used, so the retry-on-content-quality-issue contract
      // (as opposed to retry-on-network-failure, which still exits to the
      // outer catch) is preserved.
      let rawText: string;
      try {
        const result = await runRole("generator", {
          purpose: "structured_assist",
          prompt: prompt.userPrompt,
          systemInstruction,
          authMode: "vertex",
          modelOverride: GEMINI_MODEL,
          temperature: isRetry ? 0.0 : GEMINI_TEMPERATURE,
          timeoutMs: STRUCTURED_ASSIST_TIMEOUT_MS,
          responseSchema: { type: "object" },
        });
        rawText = result.text.trim();
      } catch (attemptErr: any) {
        const msg = attemptErr?.message ? String(attemptErr.message) : "";
        if (!/^empty response/.test(msg)) throw attemptErr;
        console.warn("[StructuredAssist] Empty response from Gemini Flash", {
          documentId: args.documentId,
          canonicalType: args.canonicalType,
          attempt,
        });
        lastFailureReason = "empty_response";
        continue; // Retry
      }

      // Parse JSON — reject if not valid
      const parsed = parseJsonSafe(rawText);
      if (!parsed) {
        console.warn("[StructuredAssist] Invalid JSON from Gemini Flash", {
          documentId: args.documentId,
          canonicalType: args.canonicalType,
          rawLength: rawText.length,
          attempt,
        });
        lastFailureReason = "invalid_json";
        continue; // Retry (C2: retry on invalid JSON)
      }

      // Validate against versioned schema (B1)
      const schemaResult = validateStructuredOutput(parsed);
      if (!schemaResult.valid || !schemaResult.data) {
        console.warn("[StructuredAssist] Schema validation failed", {
          documentId: args.documentId,
          canonicalType: args.canonicalType,
          errors: schemaResult.errors,
          attempt,
        });
        lastFailureReason = "schema_mismatch";
        continue; // Retry (C2: retry on schema mismatch)
      }

      // Success — build result
      const { entities, formFields } = schemaResult.data;
      const latencyMs = Date.now() - started;
      const outputHash = computeStructuredOutputHash(schemaResult.data);

      console.log("[StructuredAssist] Extraction completed", {
        documentId: args.documentId,
        canonicalType: args.canonicalType,
        entityCount: entities.length,
        formFieldCount: formFields.length,
        latencyMs,
        outputHash,
        attempt,
      });

      return {
        entities: entities.filter(isValidEntity),
        formFields: formFields.filter(isValidFormField),
        text: truncatedText,
        _meta: {
          model: GEMINI_MODEL,
          latencyMs,
          source: "gemini_flash_structured_assist",
          promptVersion: prompt.promptVersion,
          schemaVersion: "structured_v1",
          outputHash,
        },
      };
    }

    // All attempts exhausted
    console.warn("[StructuredAssist] All attempts failed", {
      documentId: args.documentId,
      canonicalType: args.canonicalType,
      lastFailureReason,
      attempts: MAX_RETRIES + 1,
    });
    return null;
  } catch (err: any) {
    const latencyMs = Date.now() - started;
    // SPEC-VERTEX-SDK-MIGRATION-1: classify SDK errors before falling through.
    const classification = classifySdkError(err);
    if (classification.isHtmlResponse) {
      console.error("[StructuredAssist] SDK_HTML_RESPONSE — Vertex returned HTML where JSON expected", {
        documentId: args.documentId,
        canonicalType: args.canonicalType,
        rawSnippet: classification.rawSnippet,
        latencyMs,
      });
      return null;
    }
    console.warn("[StructuredAssist] Failed — deterministic extractors will use OCR regex", {
      documentId: args.documentId,
      canonicalType: args.canonicalType,
      error: err?.message || String(err),
      latencyMs,
    });
    // Never throw — return null so deterministic extractors fall back to OCR regex
    return null;
  }
}

// ── Strict retry system instruction (C2) ────────────────────────────

const STRICT_RETRY_SYSTEM_INSTRUCTION =
  "You are a financial document extraction engine. " +
  "Return ONLY valid JSON. No commentary. No markdown. No explanation. " +
  "Extract ONLY the requested fields. " +
  "For monetary values use plain numbers. " +
  "Use null for any field you cannot extract with certainty. " +
  "Do NOT infer, interpolate, or fill in missing values. " +
  "If a value is not explicitly stated in the document, use null.";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseJsonSafe(text: string): any | null {
  try {
    // Strip markdown code fences if present (defensive)
    let cleaned = text.trim();
    if (cleaned.startsWith("```json")) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith("```")) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith("```")) {
      cleaned = cleaned.slice(0, -3);
    }
    cleaned = cleaned.trim();

    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function isValidEntity(e: any): boolean {
  return (
    e &&
    typeof e === "object" &&
    typeof e.type === "string" &&
    e.type.length > 0
  );
}

function isValidFormField(f: any): boolean {
  return (
    f &&
    typeof f === "object" &&
    typeof f.name === "string" &&
    f.name.length > 0
  );
}
