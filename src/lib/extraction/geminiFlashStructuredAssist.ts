import "server-only";

import { VertexAI } from "@google-cloud/vertexai";
import { ensureGcpAdcBootstrap, getVertexAuthOptions } from "@/lib/gcpAdcBootstrap";
import { buildStructuredAssistPrompt, PROMPT_VERSION } from "./geminiFlashPrompts";
import { validateStructuredOutput } from "./schemas/structuredOutput";
import { computeStructuredOutputHash } from "./outputCanonicalization";

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

import { GEMINI_FLASH, isGemini3Model } from "@/lib/ai/models";

const STRUCTURED_ASSIST_TIMEOUT_MS = 15_000; // 15s hard timeout (institutional)
const GEMINI_MODEL = GEMINI_FLASH;
const GEMINI_TEMPERATURE = 0.1;
const MAX_OCR_TEXT_LENGTH = 50_000;  // Truncate to avoid token limits
const MAX_RETRIES = 1;              // At most 1 retry (C2)
const MAX_INPUT_PAGES = 50;         // Skip structured assist for very long docs

// ---------------------------------------------------------------------------
// GCP helpers (reuse from Gemini OCR patterns)
// ---------------------------------------------------------------------------

function getGoogleProjectId(): string {
  const projectId =
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GOOGLE_PROJECT_ID ||
    process.env.GCS_PROJECT_ID ||
    process.env.GCP_PROJECT_ID;
  if (!projectId) {
    throw new Error(
      "Missing Google Cloud project id. Set GOOGLE_CLOUD_PROJECT.",
    );
  }
  return projectId;
}

function getGoogleLocation(): string {
  return (
    process.env.GOOGLE_CLOUD_LOCATION ||
    process.env.GOOGLE_CLOUD_REGION ||
    "us-central1"
  );
}

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

    await ensureGcpAdcBootstrap();
    const googleAuthOptions = await getVertexAuthOptions();
    const vertexAI = new VertexAI({
      project: getGoogleProjectId(),
      location: getGoogleLocation(),
      ...(googleAuthOptions ? { googleAuthOptions: googleAuthOptions as any } : {}),
    });

    // Attempt extraction with retry (C2)
    let lastFailureReason: string | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const isRetry = attempt > 0;
      const systemInstruction = isRetry
        ? STRICT_RETRY_SYSTEM_INSTRUCTION
        : prompt.systemInstruction;

      // Phase 93 follow-up: Gemini 3.x rejects sub-1.0 temperatures with
      // looping/degraded output. Omit temperature for 3.x; keep explicit
      // low-temp for 2.x families.
      const generationConfig: Record<string, unknown> = {
        responseMimeType: "application/json",
      };
      if (!isGemini3Model(GEMINI_MODEL)) {
        generationConfig.temperature = isRetry ? 0.0 : GEMINI_TEMPERATURE;
      }
      const model = vertexAI.getGenerativeModel({
        model: GEMINI_MODEL,
        generationConfig,
      });

      const generatePromise = model.generateContent({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt.userPrompt }],
          },
        ],
        systemInstruction: {
          role: "system",
          parts: [{ text: systemInstruction }],
        },
      });

      // Enforce hard timeout
      const resp = await Promise.race([
        generatePromise,
        new Promise<never>((_resolve, reject) =>
          setTimeout(
            () => reject(new Error(`structured_assist_timeout_${STRUCTURED_ASSIST_TIMEOUT_MS}ms`)),
            STRUCTURED_ASSIST_TIMEOUT_MS,
          ),
        ),
      ]);

      // Extract response text
      const parts = (resp as any)?.response?.candidates?.[0]?.content?.parts ?? [];
      const rawText = parts
        .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
        .join("")
        .trim();

      if (!rawText) {
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
